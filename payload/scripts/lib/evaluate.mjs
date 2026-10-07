import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_E2E, SCHEMA_INTEGRATED, SCHEMA_QE } from './critical.mjs';
import { digestForSchema } from './digest.mjs';
import { lintChange } from './e2e-lint.mjs';
import { checkEvidence } from './evidence-check.mjs';
import { asList, asString, splitFrontmatter, validDate } from './frontmatter.mjs';
import { LAYERS, qualityModel, checkTagPresence, checkTestPlan } from './plan-check.mjs';
import { checkHandoff, residualHeadingErrors } from './qa-handoff.mjs';
import { IDEMPOTENCY_NOTE } from './registry.mjs';
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
  const progress = { level: 'unknown', failures: [], warnings: [], planWarnings: [], oks: [] };
  try {
    return evaluateReadableChange(repo, change, options, progress);
  } catch (err) {
    if (typeof err.syscall !== 'string' || typeof err.code !== 'string' || !/^E[A-Z]+$/.test(err.code)) throw err;
    progress.failures.push(`${change.id}: gate 入力を読み取れません (${err.code}: ${err.path ?? err.message})`);
    return { ...progress, phase: effectivePhase(options.phase, change, taskState(parseTasks(change.tasksText))) };
  }
}

function evaluateReadableChange(repo, change, options = {}, progress = {}) {
  const env = options.env ?? process.env;
  const tasks = taskState(parseTasks(change.tasksText));
  const phase = effectivePhase(options.phase ?? 'plan', change, tasks);
  const { failures, warnings, planWarnings, oks } = progress;
  let level = 'none';

  const selectedCustomQe = change.qe === true && change.scope === 'out-of-scope' && change.lifecycle !== 'deleted';
  if (change.scope === 'out-of-scope' && !selectedCustomQe && change.errors.length === 0 && change.e2e !== 'unknown') {
    warnings.push(change.reason);
    return { failures, warnings, planWarnings, oks, level, phase };
  }
  failures.push(...change.errors);

  const wantQuality = options.quality !== false && (change.qe || change.schema === SCHEMA_INTEGRATED || change.schema === SCHEMA_QE);
  const wantPlan = options.plan !== false && (change.schema === SCHEMA_INTEGRATED || change.schema === SCHEMA_E2E || change.scope === 'integrated');
  const runPlan = wantPlan && change.lifecycle !== 'deleted' && Boolean(change.tasksText || change.schema === SCHEMA_E2E || phase === 'final');
  const legacyQe = change.schema === SCHEMA_QE || selectedCustomQe;
  if (change.pendingPlan && !change.tasksText && phase === 'plan') warnings.push(`${change.id}: 計画途中(test-plan 未作成)`);

  if (wantQuality && change.lifecycle !== 'deleted' && (change.schema === SCHEMA_INTEGRATED || legacyQe)) {
    const qualityPath = join(repo, change.path, 'quality.md');
    if (!existsSync(qualityPath)) {
      // With a plan to inspect, the integrated plan check owns this diagnostic.
      if (!(runPlan && change.schema === SCHEMA_INTEGRATED && existsSync(join(repo, change.path, 'test-plan.md')))) {
        if (change.tasksText) failures.push('quality.md がないまま tasks.md が作成されています');
        else if (phase !== 'final') warnings.push('計画段階(quality.md 未作成)');
        else failures.push('quality.md がありません');
      }
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
        if (['high', 'medium', 'low'].includes(declared)) progress.level = declared;
        if (!['high', 'medium', 'low'].includes(declared)) failures.push(`risk_level が不正です: '${declared}'`);
        else if (model.badLevel) failures.push(`Risk が不正です: '${model.badLevel}'`);
        else if (!model.max || declared !== model.max) failures.push(`risk_level ${declared || '(空)'} は Risk Register の最大値 ${model.max ?? '(なし)'} と一致しません`);
        else {
          oks.push(`risk_level: ${declared}`);
          level = declared;
        }
        if (change.schema === SCHEMA_INTEGRATED) {
          for (const id of model.manualWithoutReason) failures.push(`Manual 層の ${id} に自動化しない理由（選定理由）がありません`);
          if (model.manualWithoutId) failures.push(`Manual 層の行に Failure Mode の ID がありません（${model.manualWithoutId} 件）`);
          if (!model.layerColumn) failures.push('Test Layer Mapping の表に Layer 列がありません（見出しが `Layer` で始まる列を置きます）');
          for (const id of model.emptyLayers) failures.push(`Test Layer Mapping の ${id} の Layer が空です（${LAYERS.join(' / ')} から選びます）`);
          for (const row of model.unknownLayers) failures.push(`Test Layer Mapping の ${row.id} の Layer に不明な値があります: ${row.values.join(', ')}（${LAYERS.join(' / ')} から選びます）`);
          failures.push(...residualHeadingErrors(text));
        }
        const approved = approvalOf(change, frontmatter.data);
        if (approved === 'invalid') failures.push('統合版の承認には空でない approved_by と YYYY-MM-DD の approved_at が必要です');
        else if (approved === 'ok') oks.push(`承認済み: ${asString(frontmatter.data.approved_by)}`);
        else if (tasks.anyDone) failures.push('quality.md が未承認のままタスクが進行しています(approved_by が空)');
        else warnings.push('quality.md 未承認(実装開始前に人間の承認が必要)');

        const digest = digestForSchema(repo, change.schema, asList(frontmatter.data.oracle_paths));
        const recorded = asString(frontmatter.data.oracle_digest);
        const required = declared && sealRequired(change, declared, env);
        const enforceSeal = change.schema === SCHEMA_INTEGRATED ? (tasks.implStarted || phase === 'final') : tasks.legacyImplStarted;
        if (digest.error === 'MISSING') {
          if ((required && enforceSeal) || recorded) failures.push(`oracle_paths が存在しません: ${digest.path}`);
          else warnings.push(`Oracle未作成: ${digest.path}`);
        } else if (digest.error === 'UNREADABLE') {
          failures.push(`oracle_paths を読み取れません: ${digest.path} (${digest.code})`);
        } else if (digest.empty || digest.error === 'empty') {
          if ((required && enforceSeal) || recorded) failures.push('空の Oracle 集合は seal できません');
          else warnings.push('Oracle が空です');
        } else if (recorded && recorded !== digest.digest && recorded !== digest.compatDigest) {
          failures.push('seal 後に Oracle が変更されています(人間が確認のうえ再 seal し、evidence の再seal履歴に記録)');
        } else if (recorded) oks.push('Oracle は seal 時から変更されていません');
        else if (required && enforceSeal) failures.push(`risk_level=${declared} では実装開始前に Oracle の seal が必要です`);
        else if (digest.digest) warnings.push('Oracle は未 seal です');

        if (phase === 'final') {
          if (!change.tasksText || !tasks.complete) failures.push('未完了タスクが残っています');
          else oks.push('全タスク完了');
          const policyPath = join(repo, 'openspec/quality-policy.md');
          const policyText = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';
          const evidence = checkEvidence(repo, change, { digest: digest.digest, policyText, manifest: options.manifest, now: options.now });
          failures.push(...evidence.errors);
          warnings.push(...evidence.notes);
          if (change.schema === SCHEMA_INTEGRATED) {
            const handoff = checkHandoff(repo, change, { qualityText: text });
            failures.push(...handoff.errors);
            warnings.push(...handoff.warnings);
          }
        }
      }
    }
  }

  if (runPlan) {
    const plan = checkTestPlan(repo, change, { now: options.now });
    failures.push(...plan.errors);
    warnings.push(...plan.warnings);
    planWarnings.push(...plan.warnings);
    if (plan.registryChecked) oks.push(IDEMPOTENCY_NOTE);
    if (options.tags && (change.e2e === 'required' || change.schema === SCHEMA_E2E)) {
      failures.push(...checkTagPresence(repo, change, plan.requiredTags, options.cache));
      oks.push('tag-presence は実行 coverage ではありません');
      if (options.lint !== false) {
        const lint = lintChange(repo, change, { phase, base: options.base, env, cache: options.cache, tpIds: plan.requiredTags });
        failures.push(...lint.failures);
        warnings.push(...lint.warnings);
        oks.push(...lint.oks);
      }
    }
  }
  return { failures, warnings, planWarnings, oks, level, phase };
}

export function maxLevel(levels) {
  if (levels.includes('high')) return 'high';
  if (levels.includes('unknown')) return 'unknown';
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  return levels.reduce((best, level) => (rank[level] ?? 0) > (rank[best] ?? 0) ? level : best, 'none');
}
