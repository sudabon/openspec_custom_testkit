import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executionBlock } from './evidence-check.mjs';
import { asString, validDate } from './frontmatter.mjs';
import { hasBoundedToken, parseTable, section } from './markdown.mjs';
import { layerAssignments } from './plan-check.mjs';

export const HANDOFF_FILE = 'qa-handoff.md';
const EXAMPLE_MARK = '<!-- example -->';
const NONE = /^(?:なし|該当なし|none|n\/a)[。.]?$/i;
const RESIDUAL_HEADING = '## Residual Risk';
const NEAR_RESIDUAL_HEADING = /^#{1,6}\s*(?:Residual\b|残存リスク)/i;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])(?:\s+(.*))?$/;
const RESIDUAL_ID = /^(RR\d+)\s*[:：]/;
const RESIDUAL_ID_LIKE = /^[^\p{L}\p{N}]*RR\d+/u;
const MANUAL_KINDS = ['Manual', 'Residual'];
const VERDICTS = ['pass', 'fail'];

// Residual Risk items are list items such as `- RR1: text` or `1. RR1: text`, at any indent.
// A list item indented deeper than the item above it is a note on that item, not another residual,
// unless it starts with an RR id: residuals grouped under a label must not be dropped.
// A nested id written in another form (`RR1 text`, `**RR1**: text`) is kept without an id so it fails.
// An empty item or a bare "なし" means no residual.
export function qualityResiduals(qualityText) {
  const body = section(qualityText ?? '', RESIDUAL_HEADING) ?? '';
  const items = [];
  let itemIndent = null;
  for (const line of body.split('\n')) {
    const bullet = line.match(BULLET);
    if (!bullet) continue;
    const indent = bullet[1].length;
    const text = (bullet[2] ?? '').trim();
    const id = text.match(RESIDUAL_ID);
    if (itemIndent !== null && indent > itemIndent) {
      if (RESIDUAL_ID_LIKE.test(text)) items.push({ id: id ? id[1] : null, text });
      continue;
    }
    itemIndent = indent;
    if (!text || NONE.test(text)) continue;
    items.push({ id: id ? id[1] : null, text });
  }
  return items;
}

// A missing or differently written Residual Risk heading would be read as no residual at all.
export function residualHeadingErrors(qualityText) {
  const errors = [];
  let found = false;
  for (const line of String(qualityText ?? '').split('\n')) {
    if (line.trimEnd() === RESIDUAL_HEADING) {
      found = true;
      continue;
    }
    const heading = line.trim();
    if (NEAR_RESIDUAL_HEADING.test(heading)) {
      errors.push(`quality.md の見出し「${heading}」は読み取れません。\`${RESIDUAL_HEADING}\` にしてください`);
    }
  }
  if (!found && !errors.length) {
    errors.push(`quality.md に \`${RESIDUAL_HEADING}\` がありません（保証しないことが無ければ \`- なし\` と書きます）`);
  }
  return errors;
}

function evidenceResiduals(evidence) {
  const list = Array.isArray(evidence?.residuals) ? evidence.residuals : [];
  return list.filter(item => item !== null && typeof item === 'object');
}

export function handoffNeed({ qualityText, evidence }) {
  const manual = layerAssignments(parseTable(section(qualityText ?? '', '## Test Layer Mapping'))).filter(row => row.manual);
  const quality = qualityResiduals(qualityText);
  const residuals = evidenceResiduals(evidence);
  const reasons = [];
  if (manual.length) reasons.push('Manual 層');
  if (quality.length) reasons.push('quality.md の Residual Risk');
  if (residuals.length) reasons.push('evidence の residuals');
  return { required: reasons.length > 0, reasons, manual, quality, residuals };
}

// A missing or broken evidence file is reported by checkEvidence; here it only disables the comparison.
function readEvidence(repo, change) {
  const path = join(repo, change.path, 'evidence.md');
  if (!existsSync(path)) return { data: null, readable: false };
  const parsed = executionBlock(readFileSync(path, 'utf8'));
  return parsed.error ? { data: null, readable: false } : { data: parsed.data, readable: true };
}

function cell(row, key) {
  return asString(row[key]).replace(EXAMPLE_MARK, '').trim();
}

function rowLabel(row, key) {
  return cell(row, key) || '(ID 空)';
}

function splitIds(value) {
  return value.split(/[,、\s]+/).map(item => item.trim()).filter(Boolean);
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

// The last filled row is the current verdict, so a re-run of QA can be appended below an earlier result.
function qaResult(text) {
  const rows = parseTable(section(text, '## QA 実施結果')).rows;
  const row = rows.findLast(candidate => Object.keys(candidate).some(key => cell(candidate, key))) ?? {};
  return { by: cell(row, '実施者'), at: cell(row, '実施日'), verdict: cell(row, '判定') };
}

function qaResultProblems(qa) {
  const problems = [];
  if (!qa.by) problems.push('実施者が空');
  if (!qa.at) problems.push('実施日が空');
  else if (!validDate(qa.at)) problems.push(`実施日 '${qa.at}' が YYYY-MM-DD ではない`);
  if (!qa.verdict) problems.push('判定が空');
  else if (!VERDICTS.includes(qa.verdict)) problems.push(`判定 '${qa.verdict}' が pass / fail ではない`);
  return problems;
}

function checkAutomated(rows, evidence, errors, warnings) {
  for (const row of rows) {
    for (const key of ['Risk', 'Failure Mode', 'Oracle', 'Layer', 'Run-ID']) {
      if (!cell(row, key)) errors.push(`${HANDOFF_FILE} の自動化済み範囲 ${rowLabel(row, 'Risk')} の ${key} が空です`);
    }
  }
  for (const risk of duplicates(rows.map(row => cell(row, 'Risk')))) errors.push(`${HANDOFF_FILE} の自動化済み範囲で ${risk} が重複しています`);
  if (!evidence.readable) {
    warnings.push(`evidence.md の Execution Records を読めないため、${HANDOFF_FILE} の自動化済み範囲を evidence と照合していません`);
    return;
  }
  const results = Array.isArray(evidence.data?.risk_results) ? evidence.data.risk_results.filter(row => row && typeof row === 'object') : [];
  const passing = new Map(results.filter(row => row.result === 'pass' && asString(row.risk)).map(row => [row.risk, row]));
  for (const row of rows) {
    const risk = cell(row, 'Risk');
    if (!risk) continue;
    const result = passing.get(risk);
    if (!result) {
      errors.push(`${HANDOFF_FILE} の自動化済み範囲に evidence で pass でない ${risk} があります`);
      continue;
    }
    for (const [key, field] of Object.entries({ 'Failure Mode': 'failure_modes', Oracle: 'oracles', 'Run-ID': 'run_ids' })) {
      const values = Array.isArray(result[field]) ? result[field] : [];
      for (const id of splitIds(cell(row, key))) {
        if (!values.includes(id)) errors.push(`${HANDOFF_FILE} の自動化済み範囲 ${risk} の ${id} は evidence の ${field} にありません`);
      }
    }
  }
  const listed = new Set(rows.map(row => cell(row, 'Risk')));
  for (const risk of passing.keys()) {
    if (!listed.has(risk)) errors.push(`${HANDOFF_FILE} の自動化済み範囲に pass の ${risk} がありません`);
  }
}

export function checkHandoff(repo, change, { qualityText }) {
  const evidence = readEvidence(repo, change);
  const need = handoffNeed({ qualityText, evidence: evidence.data });
  if (!need.required) return { errors: [], warnings: [] };
  const errors = residualIdErrors(need);
  const path = join(repo, change.path, HANDOFF_FILE);
  if (!existsSync(path)) {
    errors.push(`${HANDOFF_FILE} がありません（${need.reasons.join('・')}があるため QA への引き継ぎが必要です）`);
    return { errors, warnings: [] };
  }
  const text = readFileSync(path, 'utf8');
  const sections = {};
  for (const heading of ['自動化済み範囲', '手動確認範囲', '探索チャーター', 'QA 実施結果']) {
    sections[heading] = section(text, `## ${heading}`);
    if (sections[heading] == null) errors.push(`${HANDOFF_FILE} に ## ${heading} がありません`);
  }
  const examples = text.split('\n').filter(line => /^\s*\|/.test(line) && line.includes(EXAMPLE_MARK));
  if (examples.length) errors.push(`${HANDOFF_FILE} にテンプレートの記入例が残っています（${EXAMPLE_MARK} の行が ${examples.length} 件）`);
  const warnings = [];
  checkAutomated(parseTable(sections['自動化済み範囲']).rows, evidence, errors, warnings);
  errors.push(...manualErrors(parseTable(sections['手動確認範囲']).rows, need));
  errors.push(...charterErrors(sections['探索チャーター']));
  const qa = qaResultFindings(change, text);
  return { errors: [...errors, ...qa.errors], warnings: [...warnings, ...qa.warnings] };
}

function residualIdErrors(need) {
  const errors = [];
  for (const item of need.quality) {
    if (!item.id) errors.push(`quality.md の Residual Risk に ID（\`- RR1: 内容\` の形式）がありません: ${item.text}`);
  }
  for (const item of need.residuals) {
    if (!asString(item.id)) errors.push('evidence の residuals に id の無い項目があります');
  }
  return errors;
}

// Every Manual-layer row and every Residual must have its own manual check row.
function manualErrors(manualRows, need) {
  const errors = [];
  for (const row of manualRows) {
    for (const key of ['ID', '種別', '確認観点', '理由']) {
      if (!cell(row, key)) errors.push(`${HANDOFF_FILE} の手動確認範囲 ${rowLabel(row, 'ID')} の ${key} が空です`);
    }
    const kind = cell(row, '種別');
    if (kind && !MANUAL_KINDS.includes(kind)) errors.push(`${HANDOFF_FILE} の手動確認範囲 ${rowLabel(row, 'ID')} の種別 '${kind}' は ${MANUAL_KINDS.join(' / ')} ではありません`);
  }
  for (const id of duplicates(manualRows.map(row => cell(row, 'ID')))) errors.push(`${HANDOFF_FILE} の手動確認範囲で ${id} が重複しています`);
  const expected = [
    ...need.manual.map(row => row.id).filter(Boolean),
    ...need.quality.map(item => item.id).filter(Boolean),
    ...need.residuals.map(item => asString(item.id)).filter(Boolean),
  ];
  for (const id of [...new Set(expected)]) {
    if (!manualRows.some(row => hasBoundedToken(cell(row, 'ID'), id))) errors.push(`${HANDOFF_FILE} の手動確認範囲に ${id} がありません`);
  }
  return errors;
}

function charterErrors(body) {
  const errors = [];
  const charters = parseTable(body).rows;
  if (body != null && charters.length === 0) errors.push(`${HANDOFF_FILE} の探索チャーターが 0 件です`);
  for (const row of charters) {
    for (const key of ['Charter-ID', '目的', '対象', '時間の目安']) {
      if (!cell(row, key)) errors.push(`${HANDOFF_FILE} の探索チャーター ${rowLabel(row, 'Charter-ID')} の ${key} が空です`);
    }
  }
  for (const id of duplicates(charters.map(row => cell(row, 'Charter-ID')))) errors.push(`${HANDOFF_FILE} の探索チャーターで ${id} が重複しています`);
  return errors;
}

// The QA result is a warning until archive, where it becomes required.
function qaResultFindings(change, text) {
  const qa = qaResult(text);
  const filled = qa.by || qa.at || qa.verdict;
  const problems = qaResultProblems(qa);
  const detail = problems.join('、');
  if (change.lifecycle === 'archived') {
    if (problems.length) return { errors: [`archive には ${HANDOFF_FILE} の QA 実施結果（実施者・YYYY-MM-DD の実施日・pass または fail の判定）が必要です（${detail}）`], warnings: [] };
    if (qa.verdict === 'fail') return { errors: ['QA 判定が fail です。所見を修正するか、Residual として人間が承認し直してから archive してください'], warnings: [] };
    return { errors: [], warnings: [] };
  }
  if (!filled) return { errors: [], warnings: [`${HANDOFF_FILE} の QA 実施結果が未記入です（archive の前に人間が記入します）`] };
  if (problems.length) return { errors: [], warnings: [`${HANDOFF_FILE} の QA 実施結果が不正です（${detail}）`] };
  if (qa.verdict === 'fail') return { errors: [], warnings: ['QA 判定が fail です。archive の前に修正するか、Residual として人間が承認し直してください'] };
  return { errors: [], warnings: [] };
}
