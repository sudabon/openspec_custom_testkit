import { parseTable, section } from './markdown.mjs';

const SAMPLE = `次を openspec/quality-policy.md のゲート表と機械可読行に追記してください（kit は --force でもこのファイルを上書きしません）:

\`\`\`
integrated_minimum:
mutation_threshold_high: 70

| Oracle の seal | 必須 | 必須 | 必須 |
| Falsification レビュー | 必須 | 必須 | 必須 |
\`\`\`

統合 schema の low は、旧 quality-driven policy の「任意」より厳しく、環境変数では弱められません。`;

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
