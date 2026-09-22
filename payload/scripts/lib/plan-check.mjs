import { existsSync, readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_E2E, SCHEMA_INTEGRATED } from './critical.mjs';
import { asString, splitFrontmatter } from './frontmatter.mjs';
import { hasBoundedToken, parseTable, section } from './markdown.mjs';
import { installedE2eRoot } from './e2e-root.mjs';

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    let listed;
    try {
      listed = lstatSync(abs);
      if (listed.isSymbolicLink()) {
        if (statSync(abs).isFile()) out.push(abs);
        continue;
      }
    } catch {
      throw new Error(`ファイルを参照できません: ${abs}`);
    }
    if (listed.isDirectory()) walk(abs, out);
    else if (listed.isFile()) out.push(abs);
  }
  return out;
}

function scenariosOf(repo, dir) {
  const root = join(repo, dir, 'specs');
  const found = [];
  for (const file of walk(root)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^#### Scenario:\s*(.+)\s*$/gm)) found.push(match[1].trim());
  }
  return found;
}

function ids(rows, key) {
  return rows.map(row => row[key] ?? '').map(value => value.trim()).filter(Boolean);
}

export function qualityModel(text) {
  const risks = parseTable(section(text, '## Risk Register')).rows.filter(row => /^R\d+$/.test(row.ID ?? ''));
  const oracles = parseTable(section(text, '## Test Oracles')).rows.filter(row => /^O\d+$/.test(row.ID ?? ''));
  const layers = parseTable(section(text, '## Test Layer Mapping')).rows;
  const levels = risks.map(row => (row.Level ?? '').trim()).filter(Boolean);
  const rank = { low: 1, medium: 2, high: 3 };
  let max = null;
  const bad = levels.find(level => !rank[level]);
  if (!bad) {
    for (const level of levels) if (!max || rank[level] > rank[max]) max = level;
  }
  const e2eLayer = layers.some(row => /(^|[^A-Za-z])E2E([^A-Za-z]|$)/.test(Object.values(row).join(' ')));
  return { risks, oracles, layers, levels, max, badLevel: bad || null, e2eLayer };
}

export function checkTestPlan(repo, change) {
  const errors = [];
  const notes = [];
  if (![SCHEMA_INTEGRATED, SCHEMA_E2E].includes(change.schema) && change.scope !== 'integrated') {
    return { errors, notes, requiredTags: [] };
  }
  const planPath = join(repo, change.path, 'test-plan.md');
  if (!existsSync(planPath)) {
    if ([SCHEMA_E2E, SCHEMA_INTEGRATED].includes(change.schema) || change.scope === 'integrated') {
      errors.push(`${change.id}: test-plan.md がありません`);
    }
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

  const tp = parseTable(section(text, '## E2E観点一覧')).rows.filter(row => /^TP-\d{3}$/.test(row['TP-ID'] ?? ''));
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

export function checkTagPresence(repo, change, tpIds) {
  const errors = [];
  if (!tpIds.length) return errors;
  const root = join(repo, installedE2eRoot(repo));
  let files;
  try {
    files = walk(root);
  } catch (err) {
    return [err.message];
  }
  const corpus = files.map(file => readFileSync(file, 'utf8'));
  if (!corpus.some(text => hasBoundedToken(text, change.id))) {
    errors.push(`${change.id}: @${change.id} が ${installedE2eRoot(repo)} にありません`);
  }
  for (const tp of tpIds) {
    const found = corpus.some(text => hasBoundedToken(text, change.id) && hasBoundedToken(text, tp));
    if (!found) errors.push(`${change.id}: @${tp} が @${change.id} と同一テスト文脈にありません`);
  }
  return errors;
}
