import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTable, section } from './markdown.mjs';

export const POLICY_PATH = 'openspec/quality-policy.md';

// The policy text, or null when the file is missing. Read errors propagate to the caller.
export function readPolicyText(repo) {
  const path = join(repo, POLICY_PATH);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

const SAMPLE = `次を openspec/quality-policy.md のゲート表と機械可読行に追記してください（kit は --force でもこのファイルを上書きしません）:

\`\`\`
integrated_minimum:
mutation_threshold_high: 70

| Oracle の seal | 必須 | 必須 | 必須 |
| Falsification レビュー | 必須 | 必須 | 必須 |
\`\`\`

統合 schema の low は、旧 quality-driven policy の「任意」より厳しく、環境変数では弱められません。

任意: モック契約の鮮度の上限日数を変える場合は、\`mock_contract_max_age_days: 90\` を同じ書式の独立した行として書きます（正の整数。書かなければ 90 日）。

任意: QA レビューを必須にする Risk Level を変える場合は、\`qa_review_required_levels: [medium, high]\` を同じ書式の独立した行として書きます（low / medium / high を列挙。\`[]\` は不要。書かなければ [medium, high]）。

任意: Risk 別にフレークを不合格にする場合は、\`flaky_fail_levels: [high]\` をインデント・箇条書き記号・バッククォートの無い独立した行として追記します（low / medium / high を列挙。書かなければ従来どおり flaky を pass として数えます）。`;

function gateRow(text, label) {
  const body = section(text, '## 3. Quality Gate Matrix') ?? text;
  const { rows } = parseTable(body);
  const row = rows.find(candidate => Object.values(candidate).some(cell => String(cell).includes(label)));
  if (!row) return null;
  const values = Object.values(row);
  return { low: values[1] ?? '', medium: values[2] ?? '', high: values[3] ?? '' };
}

export function mutationThreshold(policyText) {
  const match = String(policyText ?? '').match(/mutation_threshold_high:\s*(\d+)/);
  const declared = match ? Number(match[1]) : 70;
  return Math.max(70, Number.isFinite(declared) ? declared : 70);
}

export function policyIssues(policyText) {
  const text = String(policyText ?? '');
  if (!text.trim()) return ['openspec/quality-policy.md が空です', SAMPLE];
  const issues = [];
  const seal = gateRow(text, 'Oracle の seal');
  const falsification = gateRow(text, 'Falsification');
  if (!seal || seal.low !== '必須') issues.push('low の Oracle seal が必須になっていません。旧 policy の任意規定は統合 schema に使えません。');
  if (!falsification || falsification.low !== '必須') issues.push('low の独立反証が必須になっていません。');
  if (!/mutation_threshold_high:\s*\d+/.test(text) && !/70%/.test(text)) {
    issues.push('high の Mutation 閾値（最低 70%）が読み取れません。');
  }
  if (issues.length) issues.push(SAMPLE);
  return issues;
}

export const RISK_LEVELS = ['low', 'medium', 'high'];

// The single `key: value` line at the start of a line. `nearMiss` is the regex source of a setting-like key stem;
// a line that matches it with indentation, a bullet, backticks or another spelling is a format error rather than
// prose, while prose that mentions the key mid-sentence is ignored. Returns { missing: true }, { error: 'format' },
// { error: 'multiple' } or { value }. stripComment removes a trailing ` # comment` from the value.
export function policyKeyLine(policyText, key, { nearMiss, stripComment = true }) {
  const pattern = new RegExp(`^[ \\t]*(?:[-*+]\\s+)?\`*${nearMiss}[\\w-]*\\b`, 'i');
  const candidates = String(policyText ?? '').split(/\r?\n/).filter(line => pattern.test(line));
  if (candidates.some(line => !line.startsWith(`${key}:`))) return { error: 'format' };
  if (!candidates.length) return { missing: true };
  if (candidates.length > 1) return { error: 'multiple' };
  const value = candidates[0].slice(key.length + 1);
  return { value: (stripComment ? value.replace(/[ \t]+#.*$/, '') : value).trim() };
}

// `[medium, high]` into distinct levels, or { error } with the detail to show.
export function parseLevelList(value) {
  const list = value.match(/^\[(.*)\]$/);
  if (!list) return { error: value || '空' };
  const items = list[1].trim() ? list[1].split(',').map(item => item.trim()) : [];
  const bad = items.filter(item => !RISK_LEVELS.includes(item));
  if (bad.length) return { error: bad.map(item => item || '空の要素').join(', ') };
  return { levels: [...new Set(items)] };
}

// `flaky_fail_levels: [high]` at the start of a line. Missing means no policy (flaky counts as pass).
// A value that cannot be read is an input error: silently ignoring it would look like an active policy.
export function flakyFailLevels(policyText) {
  const invalid = detail => ({ levels: [], error: `quality-policy.md の flaky_fail_levels が不正です (${detail})。[high] や [medium, high] のように low / medium / high を角括弧で列挙してください` });
  // Unlike the other keys, a trailing # comment is kept as part of the value (preserved behavior).
  const line = policyKeyLine(policyText, 'flaky_fail_levels', { nearMiss: 'flaky[-_]fail[-_]level', stripComment: false });
  if (line.error === 'format') {
    return invalid('書式が不正です。インデント・箇条書き・バッククォートを付けず、flaky_fail_levels: [high] の形式で独立した行に書いてください');
  }
  if (line.missing) return { levels: [], error: null };
  if (line.error === 'multiple') return invalid('複数の行があります');
  const list = parseLevelList(line.value);
  if (list.error) return invalid(list.error);
  return { levels: list.levels, error: null };
}

export const E2E_LINT_DEFAULTS = { mode: 'enforce', scope: 'changed' };

// Missing settings retain migration defaults. Invalid settings are gate failures;
// fallback values only allow the remaining diagnostics to be collected.
export function e2eLintPolicy(policyText) {
  const text = String(policyText ?? '');
  const result = { ...E2E_LINT_DEFAULTS, missing: [], invalid: [], errors: [] };
  for (const [key, field, allowed] of [['e2e_lint_mode', 'mode', ['warn', 'enforce']], ['e2e_lint_scope', 'scope', ['changed', 'all']]]) {
    const match = text.match(new RegExp(`^${key}:[ \\t]*([^\\s#]*)`, 'm'));
    if (!match) result.missing.push(key);
    else if (allowed.includes(match[1])) result[field] = match[1];
    else result.invalid.push(`quality-policy.md の ${key} が不正です (${match[1] || '空'})。設定を修正してください（診断用の既定値 ${E2E_LINT_DEFAULTS[field]}）`);
  }
  for (const key of text.matchAll(/^(e2e_lint_[\w-]+):/gm)) {
    if (!['e2e_lint_mode', 'e2e_lint_scope'].includes(key[1])) result.invalid.push(`quality-policy.md の未知のキーです: ${key[1]}`);
  }
  result.errors = [...result.invalid];
  if (text.trim() && result.missing.length) result.invalid.push(`quality-policy.md に ${result.missing.join(' / ')} がありません。既定値で動かします`);
  return result;
}

export const MOCK_CONTRACT_MAX_AGE_DEFAULT = 90;

// `mock_contract_max_age_days: 90` at the start of a line. Missing means the default; a value that cannot
// be read is an input error instead of silently falling back to a looser or stricter limit.
export function mockContractMaxAgeDays(policyText) {
  const invalid = detail => ({ days: MOCK_CONTRACT_MAX_AGE_DEFAULT, error: `quality-policy.md の mock_contract_max_age_days が不正です (${detail})。mock_contract_max_age_days: 90 のように正の整数の日数を独立した行に書いてください` });
  const line = policyKeyLine(policyText, 'mock_contract_max_age_days', { nearMiss: 'mock[-_]contract[-_]max[-_]age' });
  if (line.error === 'format') return invalid('書式が不正です。インデント・箇条書き・バッククォートを付けないでください');
  if (line.missing) return { days: MOCK_CONTRACT_MAX_AGE_DEFAULT, error: null };
  if (line.error === 'multiple') return invalid('複数の行があります');
  if (!/^[1-9]\d*$/.test(line.value)) return invalid(line.value || '空');
  return { days: Number(line.value), error: null };
}

export const QA_REVIEW_DEFAULT_LEVELS = ['medium', 'high'];

// `qa_review_required_levels: [medium, high]` at the start of a line. Missing means the default levels.
// An unreadable value fails closed: it is reported as an error and still requires the default levels,
// never "QA review not required".
export function qaReviewRequiredLevels(policyText) {
  const invalid = detail => ({ levels: [...QA_REVIEW_DEFAULT_LEVELS], error: `quality-policy.md の qa_review_required_levels が不正です (${detail})。[medium, high] や [] のように low / medium / high を角括弧で列挙し、独立した行に書いてください`, defaulted: false });
  const line = policyKeyLine(policyText, 'qa_review_required_levels', { nearMiss: 'qa[-_]review[-_]required[-_]level' });
  if (line.error === 'format') {
    return invalid('書式が不正です。インデント・箇条書き・バッククォートを付けず、qa_review_required_levels: [medium, high] の形式で書いてください');
  }
  if (line.missing) return { levels: [...QA_REVIEW_DEFAULT_LEVELS], error: null, defaulted: true };
  if (line.error === 'multiple') return invalid('複数の行があります');
  const list = parseLevelList(line.value);
  if (list.error) return invalid(list.error);
  return { levels: list.levels, error: null, defaulted: false };
}
