import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asString, validDate } from './frontmatter.mjs';
import { markdownProse, planTables } from './markdown.mjs';
import { qualityModel, tpRows } from './plan-check.mjs';
import { installedE2eRoot } from './e2e-root.mjs';
import { readPolicyText, RISK_LEVELS } from './policy.mjs';
import { isIntegratedChange } from './critical.mjs';

const RANK = Object.fromEntries(RISK_LEVELS.map((level, index) => [level, index + 1]));

// TP-ID -> { level, risks } or { error }. Resolution follows test-plan Risk -> quality.md Risk Register Level.
// plan-check already fails these cases; the reporter still needs a reason to show for each TP.
export function tpLevels(planText, qualityText) {
  const risks = qualityText == null ? null : new Map(qualityModel(qualityText).risks.map(row => [row.ID, asString(row.Level)]));
  const resolved = new Map();
  for (const row of tpRows(planText)) {
    const id = row['TP-ID'];
    const risk = asString(row.Risk);
    let entry;
    if (!risks) entry = { error: 'quality.md がありません' };
    else if (!risk) entry = { error: 'test-plan の Risk 列が空です' };
    else if (!risks.has(risk)) entry = { error: `${risk} は Risk Register にありません` };
    else if (!RANK[risks.get(risk)]) entry = { error: `${risk} の Level が不正です (${risks.get(risk) || '空'})` };
    else entry = { level: risks.get(risk), risks: [risk] };
    const previous = resolved.get(id);
    // A duplicated TP row keeps the strictest reading: any error wins, otherwise the highest Level.
    if (previous?.error) continue;
    if (!previous || entry.error || RANK[entry.level] > RANK[previous.level]) resolved.set(id, entry);
  }
  return resolved;
}

// One flaky test can carry several TPs: judge it by the highest Level, and fail closed if any TP is unresolved.
export function flakyVerdict(ids, levels, failLevels) {
  const unresolved = ids.map(id => [id, levels.get(id) ?? { error: 'test-plan の E2E観点一覧 にありません' }]).filter(([, entry]) => entry.error);
  if (unresolved.length) return { fail: true, level: null, reason: unresolved.map(([id, entry]) => `${id}: ${entry.error}`).join(' / ') };
  let level = null;
  for (const id of ids) {
    const current = levels.get(id).level;
    if (!level || RANK[current] > RANK[level]) level = current;
  }
  return { fail: failLevels.includes(level), level, reason: '' };
}

const QUARANTINE_COLUMNS = ['TP-ID', 'Change', '理由', '担当', '期限', '代替'];

function quarantineCell(row, column) {
  const value = asString(row[column]);
  return /^[-–—ー―]$/.test(value) ? '' : value;
}

// Only rows naming this change can affect coverage. Unscoped rows warn without invalidating another row.
// `invalid` includes incomplete, malformed, expired, duplicate rows and unknown Oracle alternatives.
export function quarantineFor(text, { changeId, plannedIds, qualityText, today }) {
  const result = { active: [], invalid: [], warnings: [] };
  if (text == null) return result;
  const prose = markdownProse(text);
  if (prose.unclosedFence) result.warnings.push('quarantine.md のコードフェンスが閉じられていません（閉じていないフェンス以降の行を読めません）');
  const rows = planTables(prose.text).filter(table => table.firstCells.includes('TP-ID')).flatMap(table => table.rows);
  const oracles = qualityText == null ? null : new Set(qualityModel(qualityText).oracles.map(row => row.ID));
  const entries = [];
  for (const row of rows) {
    const [tp, change, reason, owner, due, alternative] = QUARANTINE_COLUMNS.map(column => quarantineCell(row, column));
    if (!change) {
      result.warnings.push(`隔離リストの ${tp || '(TP-ID 空)'} は Change がありません。対象を特定できないため隔離として扱いません`);
      continue;
    }
    if (change !== changeId) continue;
    if (!plannedIds.includes(tp)) {
      result.warnings.push(`隔離リストの ${tp || '(TP-ID 空)'} は ${changeId} の test-plan にありません`);
      continue;
    }
    const entry = { tp, change, reason, owner, due, alternative, problems: [] };
    const missing = QUARANTINE_COLUMNS.filter(column => !quarantineCell(row, column));
    if (missing.length) entry.problems.push(`${missing.join('・')} がありません`);
    if (due && !validDate(due)) entry.problems.push(`期限 ${due} は YYYY-MM-DD ではありません`);
    if (/^O\d+$/.test(alternative)) {
      if (!oracles) entry.problems.push(`quality.md が無いため代替 ${alternative} を確認できません`);
      else if (!oracles.has(alternative)) entry.problems.push(`代替 ${alternative} は quality.md の Test Oracles にありません`);
    }
    entries.push(entry);
  }
  for (const entry of entries) {
    const count = entries.filter(other => other.tp === entry.tp).length;
    if (count > 1) entry.problems.push(`同じ TP の行が ${count} 件あります`);
    if (!entry.problems.length && entry.due < today) {
      entry.expired = true;
      entry.problems.push(`期限切れ（${entry.due}）`);
    }
    if (entry.problems.length) result.invalid.push(entry);
    else result.active.push(entry);
  }
  return result;
}

function readOptional(repo, rel) {
  const abs = join(repo, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

// Reporter inputs beyond test-plan and results. Read errors propagate for integrated changes: the caller
// reports them as input errors (exit 2). Legacy changes only read the quarantine list, to warn that it does not apply.
export function reportInputs(repo, { path, schema, scope, integrated = isIntegratedChange({ schema, scope }) }) {
  if (!integrated) {
    try {
      const quarantinePath = `${installedE2eRoot(repo)}/quarantine.md`;
      return { integrated: false, quarantineText: readOptional(repo, quarantinePath), quarantinePath };
    } catch {
      return { integrated: false };
    }
  }
  const quarantinePath = `${installedE2eRoot(repo)}/quarantine.md`;
  return {
    integrated: true,
    policyText: readPolicyText(repo) ?? '',
    qualityText: readOptional(repo, `${path}/quality.md`),
    quarantineText: readOptional(repo, quarantinePath),
    quarantinePath,
  };
}

// Final-gate check for active quarantines: an Oracle alternative needs a passing result outside the E2E layer,
// a Residual alternative needs an approver and an approval date.
export function quarantineAlternativeErrors(active, { results, residuals }) {
  const errors = [];
  for (const entry of active) {
    if (/^O\d+$/.test(entry.alternative)) {
      const passed = results.some(row => row.result === 'pass'
        && Array.isArray(row.oracles) && row.oracles.includes(entry.alternative)
        && asString(row.layer).split(/[\s/,、+・]+/).some(layer => layer && layer.toUpperCase() !== 'E2E'));
      if (!passed) errors.push(`隔離中の ${entry.tp} の代替 Oracle ${entry.alternative} に、E2E 以外の層の pass の結果が evidence にありません`);
      continue;
    }
    const residual = residuals.find(item => item.id === entry.alternative);
    if (!residual) errors.push(`隔離中の ${entry.tp} の代替 Residual ${entry.alternative} が evidence の residuals にありません`);
    else if (!asString(residual.approved_by) || !validDate(residual.approved_at)) {
      errors.push(`隔離中の ${entry.tp} の代替 Residual ${entry.alternative} に承認者または承認日がありません。人間の承認が必要です`);
    }
  }
  return errors;
}
