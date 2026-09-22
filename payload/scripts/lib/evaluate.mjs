import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_E2E, SCHEMA_INTEGRATED, SCHEMA_QE } from './critical.mjs';
import { digestForSchema } from './digest.mjs';
import { checkEvidence } from './evidence-check.mjs';
import { asList, asString, splitFrontmatter, validDate } from './frontmatter.mjs';
import { qualityModel, checkTagPresence, checkTestPlan } from './plan-check.mjs';
import { parseTasks, taskState } from './tasks.mjs';

function sealRequired(change, level, env) {
  if (change.schema === SCHEMA_INTEGRATED || change.scope === 'integrated') return level === 'low' || level === 'medium' || level === 'high';
  const configured = env.QE_SEAL_REQUIRED_LEVELS ?? 'medium high';
  return configured.split(/\s+/).filter(Boolean).includes(level);
}

function approvalOf(change, data) {
  const by = asString(data?.approved_by);
  const at = asString(data?.approved_at);
  if (change.schema === SCHEMA_INTEGRATED) {
    if (!by && !at) return 'empty';
    if (!by || !validDate(at)) return 'invalid';
    return 'ok';
  }
  return by ? 'ok' : 'empty';
}

export function effectivePhase(requested, change, tasks) {
  if (change.lifecycle === 'archived' || change.lifecycle === 'deleted' || tasks.complete) return 'final';
  return requested === 'final' ? 'final' : 'plan';
}

export function evaluateChange(repo, change, options = {}) {
  const env = options.env ?? process.env;
  const tasks = taskState(parseTasks(change.tasksText));
  const phase = effectivePhase(options.phase ?? 'plan', change, tasks);
  const failures = [];
  const warnings = [];
  const oks = [];
  let level = 'none';

  if (change.scope === 'out-of-scope' && change.errors.length === 0 && change.e2e !== 'unknown') {
    warnings.push(change.reason);
    return { failures, warnings, oks, level, phase };
  }
  failures.push(...change.errors);

  const wantQuality = options.quality !== false && (change.qe || change.schema === SCHEMA_INTEGRATED || change.schema === SCHEMA_QE);
  const wantPlan = options.plan !== false && (change.schema === SCHEMA_INTEGRATED || change.schema === SCHEMA_E2E || change.scope === 'integrated');
  if (change.pendingPlan && !change.tasksText && phase === 'plan') warnings.push(`${change.id}: 計画途中(test-plan 未作成)`);

  if (wantQuality && change.lifecycle !== 'deleted' && (change.schema === SCHEMA_INTEGRATED || change.schema === SCHEMA_QE)) {
    const qualityPath = join(repo, change.path, 'quality.md');
    if (!existsSync(qualityPath)) {
      if (change.tasksText) failures.push('quality.md がないまま tasks.md が作成されています');
      else if (phase !== 'final') warnings.push('計画段階(quality.md 未作成)');
      else failures.push('quality.md がありません');
      if (phase === 'final') {
        if (!change.tasksText || !tasks.complete) failures.push('未完了タスクが残っています');
        const evidence = checkEvidence(repo, change, { digest: '', policyText: '', manifest: options.manifest });
        failures.push(...evidence.errors);
        warnings.push(...evidence.notes);
      }
    } else {
      const text = readFileSync(qualityPath, 'utf8');
      const frontmatter = splitFrontmatter(text);
      if (frontmatter.error) failures.push(`quality.md の frontmatter が不正です: ${frontmatter.error}`);
      else {
        const model = qualityModel(text);
        const declared = asString(frontmatter.data.risk_level);
        if (!['high', 'medium', 'low'].includes(declared)) failures.push(`risk_level が不正です: '${declared}'`);
        else if (model.badLevel) failures.push(`Risk が不正です: '${model.badLevel}'`);
        else if (!model.max || declared !== model.max) failures.push(`risk_level ${declared || '(空)'} は Risk Register の最大値 ${model.max ?? '(なし)'} と一致しません`);
        else {
          oks.push(`risk_level: ${declared}`);
          level = declared;
        }
        const approved = approvalOf(change, frontmatter.data);
        if (approved === 'invalid') failures.push('統合版の承認には空でない approved_by と YYYY-MM-DD の approved_at が必要です');
        else if (approved === 'ok') oks.push(`承認済み: ${asString(frontmatter.data.approved_by)}`);
        else if (tasks.anyDone) failures.push('quality.md が未承認のままタスクが進行しています(approved_by が空)');
        else warnings.push('quality.md 未承認(実装開始前に人間の承認が必要)');

        const digest = digestForSchema(repo, change.schema, asList(frontmatter.data.oracle_paths));
        const recorded = asString(frontmatter.data.oracle_digest);
        const required = declared && sealRequired(change, declared, env);
        const enforceSeal = change.schema === SCHEMA_INTEGRATED ? (tasks.implStarted || phase === 'final') : tasks.implStarted;
        if (digest.error === 'MISSING') {
          if ((required && enforceSeal) || recorded) failures.push(`oracle_paths が存在しません: ${digest.path}`);
          else warnings.push(`Oracle未作成: ${digest.path}`);
        } else if (digest.empty || digest.error === 'empty') {
          if ((required && enforceSeal) || recorded) failures.push('空の Oracle 集合は seal できません');
          else warnings.push('Oracle が空です');
        } else if (recorded && recorded !== digest.digest) {
          failures.push('seal 後に Oracle が変更されています(人間が確認のうえ再 seal し、evidence の再seal履歴に記録)');
        } else if (recorded && recorded === digest.digest) oks.push('Oracle は seal 時から変更されていません');
        else if (required && enforceSeal) failures.push(`risk_level=${declared} では実装開始前に Oracle の seal が必要です`);
        else if (digest.digest) warnings.push('Oracle は未 seal です');

        if (phase === 'final') {
          if (!change.tasksText || !tasks.complete) failures.push('未完了タスクが残っています');
          else oks.push('全タスク完了');
          const policyPath = join(repo, 'openspec/quality-policy.md');
          const policyText = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';
          const evidence = checkEvidence(repo, change, { digest: digest.digest, policyText, manifest: options.manifest });
          failures.push(...evidence.errors);
          warnings.push(...evidence.notes);
        }
      }
    }
  } else if (phase === 'final' && change.lifecycle === 'archived' && change.schema === SCHEMA_QE) {
    const evidence = checkEvidence(repo, change, { manifest: options.manifest });
    failures.push(...evidence.errors);
    warnings.push(...evidence.notes);
    if (!change.tasksText || !tasks.complete) failures.push('未完了タスクが残っています');
  }

  if (wantPlan && change.lifecycle !== 'deleted' && (change.tasksText || change.schema === SCHEMA_E2E || phase === 'final')) {
    const plan = checkTestPlan(repo, change);
    failures.push(...plan.errors);
    if (options.tags && (change.e2e === 'required' || change.schema === SCHEMA_E2E)) {
      try {
        failures.push(...checkTagPresence(repo, change, plan.requiredTags));
      } catch (err) {
        failures.push(err.message);
      }
      oks.push('tag-presence は実行 coverage ではありません');
    }
  }
  return { failures, warnings, oks, level, phase };
}

export function maxLevel(levels) {
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  return levels.reduce((best, level) => (rank[level] ?? 0) > (rank[best] ?? 0) ? level : best, 'none');
}
