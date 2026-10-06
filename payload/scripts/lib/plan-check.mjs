import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_E2E, SCHEMA_INTEGRATED } from './critical.mjs';
import { asString, splitFrontmatter } from './frontmatter.mjs';
import { hasBoundedToken, parseTable, section } from './markdown.mjs';
import { listFiles } from './files.mjs';
import { installedE2eRoot } from './e2e-root.mjs';

const TAG_SOURCE = /\.(?:[cm]?[jt]sx?|feature)$/i;

function filesOf(repo, root) {
  const listed = listFiles(repo, root, { optional: true });
  if (listed.error) throw new Error(`ファイルを参照できません: ${listed.path} (${listed.code})`);
  return listed.files.map(path => join(repo, path));
}

function scenariosOf(repo, dir) {
  const root = `${dir}/specs`;
  const found = [];
  for (const file of filesOf(repo, root)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^#### Scenario:\s*(.+)\s*$/gm)) found.push(match[1].trim());
  }
  return found;
}

function ids(rows, key) {
  return rows.map(row => row[key] ?? '').map(value => value.trim()).filter(Boolean);
}

const E2E_WORD = /(^|[^A-Za-z])E2E([^A-Za-z]|$)/;
const MANUAL_WORD = /(^|[^A-Za-z])Manual([^A-Za-z]|$)/i;
export const LAYERS = ['Static', 'Unit', 'Integration', 'E2E', 'Monitoring', 'Manual'];
const LAYER_HEADER = /^Layer\b/i;

// With a Layer column (header starting with "Layer"), each cell is a list of LAYERS names separated
// by spaces, `/`, `,`, `、`, `+` or `・`; any other word is reported in `unknown`.
// Without one, every cell is searched for E2E / Manual so that old quality.md files keep working.
export function layerAssignments(table) {
  const layerKey = table.headers.find(header => LAYER_HEADER.test(header));
  const reasonKey = table.headers.find(header => header.includes('理由') || /^Reason\b/i.test(header));
  const modeKey = table.headers.find(header => /^Failure Mode\b/i.test(header)) ?? table.headers[0];
  return table.rows.map(row => {
    const base = { id: (row[modeKey] ?? '').trim(), reason: reasonKey ? asString(row[reasonKey]) : '' };
    if (!layerKey) {
      const layer = Object.values(row).join(' ');
      return { ...base, layer, empty: false, unknown: [], e2e: E2E_WORD.test(layer), manual: MANUAL_WORD.test(layer) };
    }
    const layer = row[layerKey] ?? '';
    const tokens = layer.split(/[\s/,、+・]+/).filter(Boolean);
    const known = tokens.map(token => LAYERS.find(name => name.toLowerCase() === token.toLowerCase()));
    return {
      ...base,
      layer,
      empty: tokens.length === 0,
      unknown: tokens.filter((_, index) => !known[index]),
      e2e: known.includes('E2E'),
      manual: known.includes('Manual'),
    };
  });
}

export function qualityModel(text) {
  const risks = parseTable(section(text, '## Risk Register')).rows.filter(row => /^R\d+$/.test(row.ID ?? ''));
  const oracles = parseTable(section(text, '## Test Oracles')).rows.filter(row => /^O\d+$/.test(row.ID ?? ''));
  const layerTable = parseTable(section(text, '## Test Layer Mapping'));
  const layers = layerTable.rows;
  const assignments = layerAssignments(layerTable);
  const levels = risks.map(row => (row.Level ?? '').trim());
  const rank = { low: 1, medium: 2, high: 3 };
  let max = null;
  const rawBad = levels.find(level => !rank[level]);
  if (rawBad == null) {
    for (const level of levels) if (!max || rank[level] > rank[max]) max = level;
  }
  const e2eLayer = assignments.some(row => row.e2e);
  const manual = assignments.filter(row => row.manual);
  const manualWithoutReason = manual.filter(row => !row.reason).map(row => row.id || '(Failure Mode 空)');
  const manualWithoutId = manual.filter(row => !row.id).length;
  const unknownLayers = assignments.filter(row => row.unknown.length).map(row => ({ id: row.id || '(Failure Mode 空)', values: row.unknown }));
  const layerColumn = layerTable.headers.some(header => LAYER_HEADER.test(header));
  const emptyLayers = assignments.filter(row => row.empty).map(row => row.id || '(Failure Mode 空)');
  return { risks, oracles, layers, levels, max, badLevel: rawBad == null ? null : (rawBad || '(空)'), e2eLayer, manual, manualWithoutReason, manualWithoutId, unknownLayers, layerColumn, emptyLayers };
}

export function tpRows(planText) {
  return parseTable(section(planText, '## E2E観点一覧')).rows.filter(row => /^TP-\d{3}$/.test(row['TP-ID'] ?? ''));
}

export function checkTestPlan(repo, change) {
  const errors = [];
  const notes = [];
  if (![SCHEMA_INTEGRATED, SCHEMA_E2E].includes(change.schema) && change.scope !== 'integrated') {
    return { errors, notes, requiredTags: [] };
  }
  const planPath = join(repo, change.path, 'test-plan.md');
  if (!existsSync(planPath)) {
    errors.push(`${change.id}: test-plan.md がありません`);
    return { errors, notes, requiredTags: [] };
  }
  const text = readFileSync(planPath, 'utf8');
  const frontmatter = splitFrontmatter(text);
  if (change.schema === SCHEMA_INTEGRATED) {
    if (frontmatter.error || change.e2e === 'unknown') errors.push(`${change.id}: ${change.reason || frontmatter.error || 'e2e を判定できません'}`);
    if (change.e2e === 'not-applicable') {
      const reason = asString(frontmatter.data?.reason);
      const alternatives = Array.isArray(frontmatter.data?.alternative_verification) ? frontmatter.data.alternative_verification : [];
      if (!reason) errors.push(`${change.id}: not-applicable の reason が空です`);
      if (!alternatives.length || alternatives.some(item => !asString(item?.oracle) || !asString(item?.layer) || !asString(item?.method))) {
        errors.push(`${change.id}: alternative_verification に Oracle・層・方法が必要です`);
      }
    }
  }

  const tp = tpRows(text);
  const delegated = parseTable(section(text, '## 対象外シナリオ')).rows.filter(row => asString(row.Scenario));
  const tpIds = tp.map(row => row['TP-ID']);
  if (new Set(tpIds).size !== tpIds.length) errors.push(`${change.id}: TP-ID が重複しています`);

  if (change.schema === SCHEMA_INTEGRATED && change.e2e === 'required' && tp.length === 0) {
    errors.push(`${change.id}: required なのに TP が 0 件です`);
  }
  if (change.schema === SCHEMA_INTEGRATED && change.e2e === 'not-applicable' && tp.length > 0) {
    errors.push(`${change.id}: not-applicable なのに TP があります`);
  }

  const qualityPath = join(repo, change.path, 'quality.md');
  let model = null;
  if (change.schema === SCHEMA_INTEGRATED && existsSync(qualityPath)) {
    model = qualityModel(readFileSync(qualityPath, 'utf8'));
    const riskIds = new Set(model.risks.map(row => row.ID));
    const oracleIds = new Set(model.oracles.map(row => row.ID));
    for (const row of tp) {
      for (const key of ['Requirement', 'Scenario', 'Risk', 'Oracle', 'Fixture', 'Intent', 'Expected']) {
        if (!asString(row[key])) errors.push(`${change.id}: ${row['TP-ID']} の ${key} が空です`);
      }
      if (row.Risk && !riskIds.has(row.Risk)) errors.push(`${change.id}: ${row.Risk} は Risk Register にありません`);
      if (row.Oracle && !oracleIds.has(row.Oracle)) errors.push(`${change.id}: ${row.Oracle} は Test Oracles にありません`);
    }
    if (change.e2e === 'not-applicable' && model.e2eLayer) errors.push(`${change.id}: quality が E2E 層を要求しているのに test-plan は not-applicable です`);
    if (change.e2e === 'required' && !model.e2eLayer) errors.push(`${change.id}: required なのに quality の層選択に E2E がありません`);
  }

  if (change.schema === SCHEMA_INTEGRATED) {
    let scenarios = [];
    try {
      scenarios = change.skipSpecs ? [] : scenariosOf(repo, change.path);
    } catch (err) {
      errors.push(err.message);
    }
    const assigned = new Set([...ids(tp, 'Scenario'), ...delegated.map(row => asString(row.Scenario))]);
    for (const scenario of scenarios) {
      if (!assigned.has(scenario)) errors.push(`${change.id}: シナリオ未割当: ${scenario}`);
    }
    for (const row of delegated) {
      if (!asString(row.Reason) || !asString(row.Oracle) || !asString(row.Layer) || !asString(row.Method)) {
        errors.push(`${change.id}: 対象外シナリオ ${row.Scenario} の理由・Oracle・層・方法が不足しています`);
      }
    }
    if (model) {
      for (const oracle of model.oracles) {
        const layerText = model.layers.map(row => Object.values(row).join(' ')).join('\n');
        const oracleIsE2E = new RegExp(`${oracle.ID}[\\s\\S]{0,80}E2E`).test(layerText);
        if (!oracleIsE2E && tp.some(row => row.Oracle === oracle.ID) && change.e2e === 'not-applicable') {
          notes.push(`${oracle.ID} は TP 不要の層です`);
        }
      }
    }
  }

  const legacyIds = change.schema === SCHEMA_E2E
    ? [...text.matchAll(/TP-\d{3}(?!\d)/g)].map(match => match[0])
    : tpIds;
  return { errors, notes, requiredTags: [...new Set(legacyIds)] };
}

function loadTagCorpus(repo) {
  try {
    const root = installedE2eRoot(repo);
    const texts = filesOf(repo, root).filter(file => TAG_SOURCE.test(file)).map(file => readFileSync(file, 'utf8'));
    return { root, texts };
  } catch (err) {
    return { error: err.message };
  }
}

export function checkTagPresence(repo, change, tpIds, cache = {}) {
  const errors = [];
  if (!tpIds.length) return errors;
  const corpus = cache.tagCorpus ??= loadTagCorpus(repo);
  if (corpus.error) return [corpus.error];
  if (!corpus.texts.some(text => hasBoundedToken(text, change.id))) {
    errors.push(`${change.id}: @${change.id} が ${corpus.root} にありません`);
  }
  for (const tp of tpIds) {
    const found = corpus.texts.some(text => hasBoundedToken(text, change.id) && hasBoundedToken(text, tp));
    if (!found) errors.push(`${change.id}: @${tp} が @${change.id} と同一テスト文脈にありません`);
  }
  return errors;
}
