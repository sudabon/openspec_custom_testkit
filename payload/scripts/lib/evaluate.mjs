import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isE2eRequired, isIntegratedChange, SCHEMA_E2E, SCHEMA_INTEGRATED, SCHEMA_QE } from './critical.mjs';
import { digestForSchema } from './digest.mjs';
import { lintChange } from './e2e-lint.mjs';
import { checkEvidence } from './evidence-check.mjs';
import { asList, asString, splitFrontmatter, validDate } from './frontmatter.mjs';
import { LAYERS, qualityModel, checkTagPresence, checkTestPlan } from './plan-check.mjs';
import { qaReviewRequiredLevels, readPolicyText, RISK_LEVELS } from './policy.mjs';
import { checkHandoff, residualHeadingErrors } from './qa-handoff.mjs';
import { IDEMPOTENCY_NOTE } from './registry.mjs';
import { qaReviewNeeded, qaReviewOf, qaReviewOrderError } from './seal.mjs';
import { parseTasks, taskState } from './tasks.mjs';

function sealRequired(change, level, env) {
  if (isIntegratedChange(change)) return RISK_LEVELS.includes(level);
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

function readPolicy(repo) {
  return readPolicyText(repo) ?? '';
}

export function effectivePhase(requested, change, tasks) {
  if (change.lifecycle === 'archived' || change.lifecycle === 'deleted' || tasks.complete) return 'final';
  return requested === 'final' ? 'final' : 'plan';
}

export function evaluateChange(repo, change, options = {}) {
  if (isIntegratedChange(change)) change = { ...change, schema: SCHEMA_INTEGRATED };
  const progress = { level: 'unknown', failures: [], warnings: [], planWarnings: [], oks: [] };
  try {
    return evaluateReadableChange(repo, change, options, progress);
  } catch (err) {
    if (typeof err.syscall !== 'string' || typeof err.code !== 'string' || !/^E[A-Z]+$/.test(err.code)) throw err;
    progress.failures.push(`${change.id}: gate 入力を読み取れません (${err.code}: ${err.path ?? err.message})`);
    return { ...progress, phase: effectivePhase(options.phase, change, taskState(parseTasks(change.tasksText))) };
  }
}

// Appends one check's result to the running totals. Callers merge right after each check, so the order of the calls
// is the order of the output, and an input error part-way keeps what the earlier checks found.
function merge(progress, result) {
  for (const key of ['failures', 'warnings', 'planWarnings', 'oks']) if (result[key]) progress[key].push(...result[key]);
  return result;
}

function evaluateReadableChange(repo, change, options = {}, progress = {}) {
  const env = options.env ?? process.env;
  const tasks = taskState(parseTasks(change.tasksText));
  const phase = effectivePhase(options.phase ?? 'plan', change, tasks);
  const { failures, warnings, planWarnings, oks } = progress;
  const result = level => ({ failures, warnings, planWarnings, oks, level, phase });

  const selectedCustomQe = change.qe === true && change.scope === 'out-of-scope' && change.lifecycle !== 'deleted';
  if (change.scope === 'out-of-scope' && !selectedCustomQe && change.errors.length === 0 && change.e2e !== 'unknown') {
    warnings.push(change.reason);
    return result('none');
  }
  failures.push(...change.errors);

  const wantQuality = options.quality !== false && (change.qe || change.schema === SCHEMA_INTEGRATED || change.schema === SCHEMA_QE);
  const wantPlan = options.plan !== false && (change.schema === SCHEMA_INTEGRATED || change.schema === SCHEMA_E2E || change.scope === 'integrated');
  const runPlan = wantPlan && change.lifecycle !== 'deleted' && Boolean(change.tasksText || change.schema === SCHEMA_E2E || phase === 'final');
  const legacyQe = change.schema === SCHEMA_QE || selectedCustomQe;
  if (change.pendingPlan && !change.tasksText && phase === 'plan') warnings.push(`${change.id}: 計画途中(test-plan 未作成)`);

  const ctx = { repo, change, options, env, tasks, phase, runPlan };
  let level = 'none';
  if (wantQuality && change.lifecycle !== 'deleted' && (change.schema === SCHEMA_INTEGRATED || legacyQe)) level = evaluateQuality(ctx, progress);
  if (runPlan) checkPlanAndTags(ctx, progress);
  return result(level);
}

// Returns the risk level that the quality checks confirmed, or 'none'.
function evaluateQuality(ctx, progress) {
  const { repo, change, phase } = ctx;
  const qualityPath = join(repo, change.path, 'quality.md');
  if (!existsSync(qualityPath)) {
    merge(progress, checkMissingQuality(ctx));
    if (phase === 'final') merge(progress, evidenceResult(ctx, { digest: '', policyText: '', manifest: ctx.options.manifest }));
    return 'none';
  }
  const text = readFileSync(qualityPath, 'utf8');
  const frontmatter = splitFrontmatter(text);
  if (frontmatter.error) {
    progress.failures.push(`quality.md の frontmatter が不正です: ${frontmatter.error}`);
    return 'none';
  }
  const quality = { ...ctx, text, data: frontmatter.data, model: qualityModel(text), declared: asString(frontmatter.data.risk_level) };
  if (RISK_LEVELS.includes(quality.declared)) progress.level = quality.declared;
  const { level } = merge(progress, checkRiskLevel(quality));
  if (change.schema === SCHEMA_INTEGRATED) merge(progress, checkLayerMapping(quality));
  const { approved } = merge(progress, checkApproval(quality));
  if (change.schema === SCHEMA_INTEGRATED && RISK_LEVELS.includes(quality.declared)) merge(progress, checkQaReview(quality, approved));
  const { digest } = merge(progress, checkSeal(quality));
  if (phase === 'final') checkFinalPhase(quality, digest, progress);
  return level;
}

function checkMissingQuality({ repo, change, phase, tasks, runPlan }) {
  const failures = [];
  const warnings = [];
  // With a plan to inspect, the integrated plan check owns this diagnostic.
  if (!(runPlan && change.schema === SCHEMA_INTEGRATED && existsSync(join(repo, change.path, 'test-plan.md')))) {
    if (change.tasksText) failures.push('quality.md がないまま tasks.md が作成されています');
    else if (phase !== 'final') warnings.push('計画段階(quality.md 未作成)');
    else failures.push('quality.md がありません');
  }
  if (phase === 'final' && (!change.tasksText || !tasks.complete)) failures.push('未完了タスクが残っています');
  return { failures, warnings };
}

function checkRiskLevel({ model, declared }) {
  if (!RISK_LEVELS.includes(declared)) return { failures: [`risk_level が不正です: '${declared}'`], level: 'none' };
  if (model.badLevel) return { failures: [`Risk が不正です: '${model.badLevel}'`], level: 'none' };
  if (!model.max || declared !== model.max) {
    return { failures: [`risk_level ${declared || '(空)'} は Risk Register の最大値 ${model.max ?? '(なし)'} と一致しません`], level: 'none' };
  }
  return { oks: [`risk_level: ${declared}`], level: declared };
}

function checkLayerMapping({ model, text }) {
  const failures = [];
  for (const id of model.manualWithoutReason) failures.push(`Manual 層の ${id} に自動化しない理由（選定理由）がありません`);
  if (model.manualWithoutId) failures.push(`Manual 層の行に Failure Mode の ID がありません（${model.manualWithoutId} 件）`);
  if (!model.layerColumn) failures.push('Test Layer Mapping の表に Layer 列がありません（見出しが `Layer` で始まる列を置きます）');
  for (const id of model.emptyLayers) failures.push(`Test Layer Mapping の ${id} の Layer が空です（${LAYERS.join(' / ')} から選びます）`);
  for (const row of model.unknownLayers) failures.push(`Test Layer Mapping の ${row.id} の Layer に不明な値があります: ${row.values.join(', ')}（${LAYERS.join(' / ')} から選びます）`);
  failures.push(...residualHeadingErrors(text));
  return { failures };
}

function checkApproval({ change, data, tasks }) {
  const approved = approvalOf(change, data);
  if (approved === 'invalid') return { approved, failures: ['統合版の承認には空でない approved_by と YYYY-MM-DD の approved_at が必要です'] };
  if (approved === 'ok') return { approved, oks: [`承認済み: ${asString(data.approved_by)}`] };
  if (tasks.anyDone) return { approved, failures: ['quality.md が未承認のままタスクが進行しています(approved_by が空)'] };
  return { approved, warnings: ['quality.md 未承認(実装開始前に人間の承認が必要)'] };
}

function checkQaReview({ repo, data, declared, tasks, phase }, approved) {
  const failures = [];
  const warnings = [];
  const oks = [];
  const qa = qaReviewRequiredLevels(readPolicy(repo));
  if (qa.error) failures.push(qa.error);
  const reviewed = qaReviewOf(data);
  const needed = qaReviewNeeded(declared, qa.levels);
  const orderError = qaReviewOrderError(data);
  if (orderError) (needed ? failures : warnings).push(orderError);
  if (reviewed === 'ok') {
    if (!orderError) oks.push(`QA レビュー済み: ${asString(data.qa_reviewed_by)}`);
  } else if (reviewed === 'invalid') {
    (needed ? failures : warnings).push('QA レビューの記録には空でない qa_reviewed_by と YYYY-MM-DD の qa_reviewed_at が必要です');
  } else if (needed) {
    const message = `risk_level=${declared} は qa_review_required_levels [${qa.levels.join(', ')}] に含まれるため、承認・seal 前に QA レビューが必要です(qa_reviewed_by が空)`;
    (approved !== 'empty' || tasks.anyDone || phase === 'final' ? failures : warnings).push(message);
  }
  return { failures, warnings, oks };
}

function checkSeal({ repo, change, data, declared, env, tasks, phase }) {
  const digest = digestForSchema(repo, change.schema, asList(data.oracle_paths));
  const recorded = asString(data.oracle_digest);
  const required = declared && sealRequired(change, declared, env);
  const enforceSeal = change.schema === SCHEMA_INTEGRATED ? (tasks.implStarted || phase === 'final') : tasks.legacyImplStarted;
  const fail = message => ({ digest, failures: [message] });
  const warn = message => ({ digest, warnings: [message] });
  if (digest.error === 'MISSING') {
    return (required && enforceSeal) || recorded ? fail(`oracle_paths が存在しません: ${digest.path}`) : warn(`Oracle未作成: ${digest.path}`);
  }
  if (digest.error === 'UNREADABLE') return fail(`oracle_paths を読み取れません: ${digest.path} (${digest.code})`);
  if (digest.empty || digest.error === 'empty') {
    return (required && enforceSeal) || recorded ? fail('空の Oracle 集合は seal できません') : warn('Oracle が空です');
  }
  if (recorded && recorded !== digest.digest && recorded !== digest.compatDigest) {
    return fail('seal 後に Oracle が変更されています(人間が確認のうえ再 seal し、evidence の再seal履歴に記録)');
  }
  if (recorded) return { digest, oks: ['Oracle は seal 時から変更されていません'] };
  if (required && enforceSeal) return fail(`risk_level=${declared} では実装開始前に Oracle の seal が必要です`);
  if (digest.digest) return warn('Oracle は未 seal です');
  return { digest };
}

function checkFinalPhase(quality, digest, progress) {
  const { repo, change, tasks, options, text } = quality;
  merge(progress, !change.tasksText || !tasks.complete ? { failures: ['未完了タスクが残っています'] } : { oks: ['全タスク完了'] });
  const policyText = readPolicy(repo);
  merge(progress, evidenceResult(quality, { digest: digest.digest, policyText, manifest: options.manifest, now: options.now }));
  if (change.schema === SCHEMA_INTEGRATED) {
    const handoff = checkHandoff(repo, change, { qualityText: text });
    merge(progress, { failures: handoff.errors, warnings: handoff.warnings });
  }
}

function evidenceResult({ repo, change }, evidenceOptions) {
  const evidence = checkEvidence(repo, change, evidenceOptions);
  return { failures: evidence.errors, warnings: evidence.notes };
}

function checkPlanAndTags({ repo, change, options, env, phase }, progress) {
  const plan = checkTestPlan(repo, change, { now: options.now });
  merge(progress, { failures: plan.errors, warnings: plan.warnings, planWarnings: plan.warnings, oks: plan.registryChecked ? [IDEMPOTENCY_NOTE] : [] });
  if (!options.tags || !isE2eRequired(change)) return;
  merge(progress, { failures: checkTagPresence(repo, change, plan.requiredTags, options.cache), oks: ['tag-presence は実行 coverage ではありません'] });
  if (options.lint === false) return;
  const lint = lintChange(repo, change, { phase, base: options.base, env, cache: options.cache, tpIds: plan.requiredTags });
  merge(progress, { failures: lint.failures, warnings: lint.warnings, oks: lint.oks });
}

export function maxLevel(levels) {
  if (levels.includes('high')) return 'high';
  if (levels.includes('unknown')) return 'unknown';
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  return levels.reduce((best, level) => (rank[level] ?? 0) > (rank[best] ?? 0) ? level : best, 'none');
}
