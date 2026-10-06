import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executionBlock } from './evidence-check.mjs';
import { asString, validDate } from './frontmatter.mjs';
import { hasBoundedToken, parseTable, section } from './markdown.mjs';
import { layerAssignments } from './plan-check.mjs';

export const HANDOFF_FILE = 'qa-handoff.md';
const EXAMPLE_MARK = '<!-- example -->';
const NONE = /^(?:なし|該当なし|none|n\/a)[。.]?$/i;

// Residual Risk items are `- RR1: text`. An empty bullet or a bare "なし" means no residual.
export function qualityResiduals(qualityText) {
  const body = section(qualityText ?? '', '## Residual Risk') ?? '';
  const items = [];
  for (const line of body.split('\n')) {
    const bullet = line.match(/^[-*]\s*(.*)$/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (!text || NONE.test(text)) continue;
    const id = text.match(/^(RR\d+)\s*[:：]/);
    items.push({ id: id ? id[1] : null, text });
  }
  return items;
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

function readEvidence(repo, change) {
  const path = join(repo, change.path, 'evidence.md');
  if (!existsSync(path)) return null;
  const parsed = executionBlock(readFileSync(path, 'utf8'));
  // A broken evidence file is reported by checkEvidence; here it only means no recorded residuals.
  return parsed.error ? null : parsed.data;
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

function qaResult(text) {
  const rows = parseTable(section(text, '## QA 実施結果')).rows;
  const row = rows.find(candidate => Object.values(candidate).some(value => asString(value))) ?? {};
  return { by: cell(row, '実施者'), at: cell(row, '実施日'), verdict: cell(row, '判定') };
}

export function checkHandoff(repo, change, { qualityText }) {
  const errors = [];
  const warnings = [];
  const evidence = readEvidence(repo, change);
  const need = handoffNeed({ qualityText, evidence });
  if (!need.required) return { errors, warnings };

  for (const item of need.quality) {
    if (!item.id) errors.push(`quality.md の Residual Risk に ID（\`- RR1: 内容\` の形式）がありません: ${item.text}`);
  }
  for (const item of need.residuals) {
    if (!asString(item.id)) errors.push('evidence の residuals に id の無い項目があります');
  }

  const path = join(repo, change.path, HANDOFF_FILE);
  if (!existsSync(path)) {
    errors.push(`${HANDOFF_FILE} がありません（${need.reasons.join('・')}があるため QA への引き継ぎが必要です）`);
    return { errors, warnings };
  }
  const text = readFileSync(path, 'utf8');
  const sections = {};
  for (const heading of ['自動化済み範囲', '手動確認範囲', '探索チャーター', 'QA 実施結果']) {
    sections[heading] = section(text, `## ${heading}`);
    if (sections[heading] == null) errors.push(`${HANDOFF_FILE} に ## ${heading} がありません`);
  }

  const examples = text.split('\n').filter(line => /^\s*\|/.test(line) && line.includes(EXAMPLE_MARK));
  if (examples.length) errors.push(`${HANDOFF_FILE} にテンプレートの記入例が残っています（${EXAMPLE_MARK} の行が ${examples.length} 件）`);

  const automated = parseTable(sections['自動化済み範囲']).rows;
  const results = Array.isArray(evidence?.risk_results) ? evidence.risk_results.filter(row => row && typeof row === 'object') : [];
  const passing = new Map(results.filter(row => row.result === 'pass' && asString(row.risk)).map(row => [row.risk, row]));
  for (const row of automated) {
    const risk = cell(row, 'Risk');
    for (const key of ['Risk', 'Failure Mode', 'Oracle', 'Layer', 'Run-ID']) {
      if (!cell(row, key)) errors.push(`${HANDOFF_FILE} の自動化済み範囲 ${rowLabel(row, 'Risk')} の ${key} が空です`);
    }
    if (!risk) continue;
    const result = passing.get(risk);
    if (!result) {
      errors.push(`${HANDOFF_FILE} の自動化済み範囲に evidence で pass でない ${risk} があります`);
      continue;
    }
    const modes = Array.isArray(result.failure_modes) ? result.failure_modes : [];
    for (const mode of splitIds(cell(row, 'Failure Mode'))) {
      if (!modes.includes(mode)) errors.push(`${HANDOFF_FILE} の自動化済み範囲 ${risk} の ${mode} は evidence の failure_modes にありません`);
    }
  }
  const listed = new Set(automated.map(row => cell(row, 'Risk')));
  for (const risk of passing.keys()) {
    if (!listed.has(risk)) errors.push(`${HANDOFF_FILE} の自動化済み範囲に pass の ${risk} がありません`);
  }

  const manualRows = parseTable(sections['手動確認範囲']).rows;
  for (const row of manualRows) {
    for (const key of ['ID', '種別', '確認観点', '理由']) {
      if (!cell(row, key)) errors.push(`${HANDOFF_FILE} の手動確認範囲 ${rowLabel(row, 'ID')} の ${key} が空です`);
    }
  }
  const expected = [
    ...need.manual.map(row => row.id).filter(Boolean),
    ...need.quality.map(item => item.id).filter(Boolean),
    ...need.residuals.map(item => asString(item.id)).filter(Boolean),
  ];
  for (const id of [...new Set(expected)]) {
    if (!manualRows.some(row => hasBoundedToken(cell(row, 'ID'), id))) errors.push(`${HANDOFF_FILE} の手動確認範囲に ${id} がありません`);
  }

  for (const row of parseTable(sections['探索チャーター']).rows) {
    for (const key of ['Charter-ID', '目的', '対象', '時間の目安']) {
      if (!cell(row, key)) errors.push(`${HANDOFF_FILE} の探索チャーター ${rowLabel(row, 'Charter-ID')} の ${key} が空です`);
    }
  }

  const qa = qaResult(text);
  const complete = qa.by && validDate(qa.at) && (qa.verdict === 'pass' || qa.verdict === 'fail');
  if (change.lifecycle === 'archived') {
    if (!complete) errors.push(`archive には ${HANDOFF_FILE} の QA 実施結果（実施者・YYYY-MM-DD の実施日・pass または fail の判定）が必要です`);
    else if (qa.verdict === 'fail') errors.push('QA 判定が fail です。所見を修正するか、Residual として人間が承認し直してから archive してください');
  } else if (!complete) {
    warnings.push(`${HANDOFF_FILE} の QA 実施結果が未記入です（archive の前に人間が記入します）`);
  } else if (qa.verdict === 'fail') {
    warnings.push('QA 判定が fail です。archive の前に修正するか、Residual として人間が承認し直してください');
  }
  return { errors, warnings };
}
