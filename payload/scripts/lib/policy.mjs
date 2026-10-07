import { parseTable, section } from './markdown.mjs';

const SAMPLE = `次を openspec/quality-policy.md のゲート表と機械可読行に追記してください（kit は --force でもこのファイルを上書きしません）:

\`\`\`
integrated_minimum:
mutation_threshold_high: 70

| Oracle の seal | 必須 | 必須 | 必須 |
| Falsification レビュー | 必須 | 必須 | 必須 |
\`\`\`

統合 schema の low は、旧 quality-driven policy の「任意」より厳しく、環境変数では弱められません。

任意: モック契約の鮮度の上限日数を変える場合は、\`mock_contract_max_age_days: 90\` を同じ書式の独立した行として書きます（正の整数。書かなければ 90 日）。

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

// `flaky_fail_levels: [high]` at the start of a line. Missing means no policy (flaky counts as pass).
// A value that cannot be read is an input error: silently ignoring it would look like an active policy.
export function flakyFailLevels(policyText) {
  const invalid = detail => ({ levels: [], error: `quality-policy.md の flaky_fail_levels が不正です (${detail})。[high] や [medium, high] のように low / medium / high を角括弧で列挙してください` });
  // Reject setting-like near misses, while allowing prose that mentions the key mid-sentence.
  const candidates = String(policyText ?? '').split(/\r?\n/).filter(line => /^[ \t]*(?:[-*+]\s+)?`*flaky_fail_level\w*\b/.test(line));
  if (candidates.some(line => !/^flaky_fail_levels:/.test(line))) {
    return invalid('書式が不正です。インデント・箇条書き・バッククォートを付けず、flaky_fail_levels: [high] の形式で独立した行に書いてください');
  }
  const lines = candidates.map(line => line.slice('flaky_fail_levels:'.length).trim());
  if (!lines.length) return { levels: [], error: null };
  if (lines.length > 1) return invalid('複数の行があります');
  const list = lines[0].match(/^\[(.*)\]$/);
  if (!list) return invalid(lines[0] || '空');
  const items = list[1].trim() ? list[1].split(',').map(item => item.trim()) : [];
  const bad = items.filter(item => !RISK_LEVELS.includes(item));
  if (bad.length) return invalid(bad.map(item => item || '空の要素').join(', '));
  return { levels: [...new Set(items)], error: null };
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
  const candidates = String(policyText ?? '').split(/\r?\n/).filter(line => /^[ \t]*(?:[-*+]\s+)?`*mock_contract_max_age\w*\b/.test(line));
  if (candidates.some(line => !/^mock_contract_max_age_days:/.test(line))) {
    return invalid('書式が不正です。インデント・箇条書き・バッククォートを付けないでください');
  }
  if (!candidates.length) return { days: MOCK_CONTRACT_MAX_AGE_DEFAULT, error: null };
  if (candidates.length > 1) return invalid('複数の行があります');
  const value = candidates[0].slice('mock_contract_max_age_days:'.length).replace(/[ \t]+#.*$/, '').trim();
  if (!/^[1-9]\d*$/.test(value)) return invalid(value || '空');
  return { days: Number(value), error: null };
}
