import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SCHEMA_E2E, SCHEMA_INTEGRATED, SCHEMA_QE } from './critical.mjs';
import { readChangeMetadata } from './change-metadata.mjs';
import { resolveSchemaFamily } from './schema-family.mjs';
import { ARCHIVE_ROOT, CHANGES_ROOT, listActiveChanges, listArchivedChanges } from './changes.mjs';
import { asString, isCustomTag, isPlainMapping } from './frontmatter.mjs';
import { errorCode, isFsError, listFiles } from './files.mjs';
import { TP_ID } from './ids.mjs';
import { readConfigDocument } from './environment.mjs';
import {
  DELEGATED_SECTION, delegatedHeading, hasScenarioColumn, isPlaceholderCell, markdownCell, markdownProse, planSections, planTables,
  scenarioCell, TP_SECTION, tpReferences,
} from './markdown.mjs';
import { flatten, resultsFreshness, specMatches, tagTextOf, validateResults } from './results.mjs';

export const CLASS = {
  e2e: '保護（E2E）',
  declared: '保護（他層の宣言）',
  none: '未保護',
  stale: '要再確認',
};
export const ORPHAN = '孤立';
export const UNRESOLVED = '対応不明';
export const LEGACY_UNRESOLVED = '旧形式・対応不明';
export const NOT_RUN = '未実行';
const DECLARED_RESULT = '宣言のみ（実行結果は未照合）';

class InvalidCoverageInputError extends Error {}
class CoverageReadError extends InvalidCoverageInputError {}

function readInput(path, read) {
  try { return read(); }
  catch (err) {
    if (!isFsError(err)) throw err;
    throw new CoverageReadError(`ファイルを読めません: ${path} (${err.code})`, { cause: err });
  }
}

// Test plans sometimes repeat the heading prefix; it is not part of the name.
function requirementName(value) {
  return asString(value).replace(/^Requirement:\s*/, '');
}

function readText(repo, rel) {
  return readInput(rel, () => readFileSync(join(repo, rel), 'utf8'));
}

function specFiles(repo, root) {
  const listed = listFiles(repo, root, { optional: true });
  if (listed.error) throw new CoverageReadError(`ファイルを参照できません: ${listed.path} (${listed.code})`);
  if (listed.files.includes(root)) throw new CoverageReadError(`ディレクトリを参照できません: ${root} (ENOTDIR)`);
  const prefix = `${root}/`;
  return listed.files
    .filter(path => path.startsWith(prefix) && (path === `${prefix}spec.md` || path.endsWith('/spec.md')))
    .map(path => ({ path, capability: path.slice(prefix.length, -'/spec.md'.length) || '.' }))
    .filter(entry => entry.capability !== '.');
}

// Reads requirement and scenario headings, tagged with the delta operation of the enclosing `##` section.
export function parseSpec(text, { delta = false } = {}) {
  const requirements = [];
  const renames = [];
  let op = null;
  let current = null;
  let rename = null;
  for (const line of proseText(text).split('\n')) {
    const requirement = line.match(/^### Requirement:\s*(.+?)\s*$/);
    if (requirement) {
      if (delta && !op) throw new InvalidCoverageInputError(`delta の操作見出しがありません: ${requirement[1]}`);
      current = { name: requirement[1], op, scenarios: [] };
      requirements.push(current);
      continue;
    }
    // Reserve explicit overview titles for prose; declarations are checked at every level.
    const overview = /^#{1,2} (?:Requirement|Scenario) overview\s*$/i.test(line);
    if (!overview && /^#{1,6}[^\S\r\n]*requirement(?![A-Za-z0-9_-])/i.test(line)) throw new InvalidCoverageInputError(`Requirement 見出しが不正です: ${line.trim()}`);
    const scenario = line.match(/^#### Scenario:\s*(.+?)\s*$/);
    if (scenario && current) {
      current.scenarios.push(scenario[1]);
      continue;
    }
    if (!overview && /^#{1,6}[^\S\r\n]*(?:scenario|scenaro)(?![A-Za-z0-9_-])/i.test(line)) throw new InvalidCoverageInputError(`Scenario 見出しが不正、または Requirement がありません: ${line.trim()}`);
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      if (rename) throw new InvalidCoverageInputError('RENAMED の FROM に対応する TO がありません');
      op = heading[1].match(/^(ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/)?.[1] ?? null;
      if (delta && !op && /requirements/i.test(heading[1])) throw new InvalidCoverageInputError(`delta の操作見出しが不正です: ${heading[1]}`);
      current = null;
      continue;
    }
    if (/^### /.test(line)) {
      current = null;
      continue;
    }
    if (op === 'RENAMED') {
      const from = line.match(/FROM:\s*`?\s*(?:###\s*)?Requirement:\s*(.+?)\s*`?\s*$/);
      const to = line.match(/TO:\s*`?\s*(?:###\s*)?Requirement:\s*(.+?)\s*`?\s*$/);
      if (from) {
        if (rename) throw new InvalidCoverageInputError('RENAMED の FROM に対応する TO がありません');
        rename = { from: from[1] };
      } else if (to) {
        if (!rename) throw new InvalidCoverageInputError('RENAMED の TO に対応する FROM がありません');
        renames.push({ ...rename, to: to[1] });
        rename = null;
      }
    }
  }
  if (rename) throw new InvalidCoverageInputError('RENAMED の FROM に対応する TO がありません');
  return { requirements, renames };
}

export function listMainScenarios(repo, names = new Map()) {
  const scenarios = [];
  for (const { path, capability } of specFiles(repo, 'openspec/specs')) {
    let parsed;
    try { parsed = parseSpec(readText(repo, path)); }
    catch (err) {
      if (err instanceof InvalidCoverageInputError && !(err instanceof CoverageReadError)) throw new InvalidCoverageInputError(`${path}: ${err.message}`);
      throw err;
    }
    for (const requirement of parsed.requirements) {
      if (!names.has(capability)) names.set(capability, new Set());
      names.get(capability).add(requirement.name);
      for (const scenario of requirement.scenarios) {
        scenarios.push({ capability, requirement: requirement.name, scenario });
      }
    }
  }
  return scenarios;
}

function schemaOf(repo, dir) {
  const rel = `${dir}/.openspec.yaml`;
  const metadata = readInput(rel, () => readChangeMetadata(repo, dir, { strict: true }));
  if (metadata.missing) return null;
  if (metadata.problem) throw new InvalidCoverageInputError(`${rel} が不正です: ${metadata.errors.join('; ') || 'schema を持つ YAML mapping が必要です'}`);
  return metadata.schema;
}

function hasFrontmatter(text) {
  return /^---\r?\n/.test(text);
}

function proseText(text, options) {
  const prose = markdownProse(text, options);
  if (prose.unclosedFence) throw new InvalidCoverageInputError('コードフェンスが閉じられていません');
  return prose.text;
}

function delegatedList(line) {
  const bullet = line.match(/^\s*(?:[-*+]\s|\d+[.)]\s)(.*)$/)?.[1];
  if (!bullet) return false;
  if (/^(?:補足|メモ|注|Notes?)\s*[:：]/i.test(bullet)) return false;
  // Only recognizable declarations are errors; notes and other prose are allowed.
  return /\b(?:Scenario|Requirement|Oracle|Layer|Method)\s*[:：]|対応シナリオ\s*[:：]/i.test(bullet)
    || /[:：]\s*(?:Unit|Integration|Contract|Manual|E2E|単体|結合|手動)(?![A-Za-z])/i.test(bullet);
}

// Rows of a test plan in a form shared by the integrated and legacy layouts.
export function planRows(text, { legacy }) {
  const prose = proseText(text, { tables: true });
  const sections = planSections(prose);
  const tp = tpRowsOf(sections);
  const delegated = legacy ? [] : delegatedRows(sections);
  const tableIds = new Set(tp.map(row => row.id));
  const textOnly = tpReferences(prose).filter(id => !tableIds.has(id));
  const hasSections = sections.some(item => item.heading === TP_SECTION || item.heading === DELEGATED_SECTION);
  return { rows: [...tp, ...delegated], textOnly, hasSections };
}

function tpRowsOf(sections) {
  const table = sections.filter(item => item.heading === TP_SECTION)
    .flatMap(item => planTables(item.body).flatMap(table => table.rows));
  return table.map(row => {
    const id = asString(row['TP-ID'] ?? row['TP ID']);
    const scenario = scenarioCell(row);
    const reason = !('TP-ID' in row) ? 'TP-ID 列を解析できません（列名は TP-ID）'
      : !TP_ID.test(id) ? `TP-ID が不正です: ${id || '(空)'}（TP-NNN が必要です）`
      : !hasScenarioColumn(row) ? 'シナリオ列を解析できません（列名は Scenario または 対応シナリオ）'
      : isPlaceholderCell(scenario) ? 'シナリオ名がありません' : null;
    return { kind: 'tp', id, requirement: requirementName(row.Requirement), scenario, parsable: !reason, reason };
  });
}

function unparsedDelegated(reason, row = {}) {
  return { kind: 'delegated', id: '対象外', requirement: requirementName(row.Requirement), scenario: scenarioCell(row), parsable: false, reason };
}

// Rows of the delegated-scenario table. A misspelled or repeated heading, a header-only table and a bullet list
// each become unparsable rows so that the map reports them instead of dropping the declaration.
function delegatedRows(sections) {
  const delegated = [];
  let delegatedSections = 0;
  for (const { heading, body } of sections) {
    if (!delegatedHeading(heading)) continue;
    const tables = planTables(body);
    const rows = tables.flatMap(table => table.rows);
    let reason = null;
    if (heading !== DELEGATED_SECTION) reason = `対象外の表の見出しを解析できません: ${heading}（${DELEGATED_SECTION} が必要です）`;
    else if (delegatedSections++) reason = `対象外の表の見出しが重複しています: ${DELEGATED_SECTION}`;
    if (reason) {
      for (const row of rows.length ? rows : [{}]) delegated.push(unparsedDelegated(reason, row));
      continue;
    }
    for (const { headers } of tables) {
      if (!headers.length) delegated.push(unparsedDelegated('対象外シナリオを表として解析できません（ヘッダ行だけでなく区切り行が必要です）'));
    }
    for (const line of body.split('\n').filter(delegatedList)) {
      delegated.push(unparsedDelegated(`対象外シナリオを表として解析できません（箇条書きではなく表が必要です）: ${line.trim()}`));
    }
    delegated.push(...rows.map(row => ({
      kind: 'delegated',
      id: '対象外',
      requirement: requirementName(row.Requirement),
      scenario: scenarioCell(row),
      oracle: asString(row.Oracle),
      layer: asString(row.Layer),
      method: asString(row.Method),
      parsable: !isPlaceholderCell(scenarioCell(row)),
      reason: !hasScenarioColumn(row) ? 'シナリオ列を解析できません（列名は Scenario または 対応シナリオ）' : null,
    })));
  }
  return delegated;
}

function deltaIndex(repo, dir) {
  const files = specFiles(repo, `${dir}/specs`);
  return files.map(({ path, capability }) => {
    try {
      return { capability, ...parseSpec(readText(repo, path), { delta: true }) };
    } catch (err) {
      if (err instanceof InvalidCoverageInputError && !(err instanceof CoverageReadError)) throw new InvalidCoverageInputError(`${path}: ${err.message}`);
      throw err;
    }
  });
}

// Design decision 2: a row belongs to the delta file of the same change that contains its scenario.
export function resolveCapability(delta, row) {
  let hits = [];
  for (const file of delta) {
    for (const requirement of file.requirements) {
      if (requirement.op === 'REMOVED') continue;
      if (requirement.scenarios.includes(row.scenario)) hits.push({ capability: file.capability, requirement: requirement.name });
    }
  }
  if (hits.length > 1 && row.requirement) hits = hits.filter(hit => hit.requirement === row.requirement);
  if (hits.length === 1) return { ...hits[0] };
  if (hits.length === 0) return { error: row.requirement ? `delta spec に ${row.requirement} / ${row.scenario} がありません` : `delta spec に ${row.scenario} がありません` };
  return { error: `delta spec の複数箇所に一致します: ${hits.map(hit => `${hit.capability} / ${hit.requirement}`).join(', ')}` };
}

// A valid derived schema counts as the integrated schema; an invalid declaration makes the input invalid.
function familyOf(repo, schema, rel) {
  const family = resolveSchemaFamily(repo, schema);
  if (family.error) throw new InvalidCoverageInputError(`${rel}: ${family.error}`);
  return family.family;
}

function readChange(repo, dir, id, order, { defaultSchema, configPath, qeSchema }) {
  const localSchema = schemaOf(repo, dir);
  const schema = familyOf(repo, localSchema ?? defaultSchema, localSchema ? `${dir}/.openspec.yaml` : configPath);
  const change = { id, dir, order, schema, rows: [], textOnly: [], unresolved: [], warnings: [], skipped: schema === SCHEMA_QE || (schema === qeSchema && ![SCHEMA_INTEGRATED, SCHEMA_E2E, 'spec-driven'].includes(schema)) };
  const delta = deltaIndex(repo, dir);
  change.delta = delta;
  if (change.skipped) return change;
  if (schema && ![SCHEMA_INTEGRATED, SCHEMA_E2E, SCHEMA_QE, 'spec-driven'].includes(schema)) {
    change.warnings.push(`${localSchema ? `${dir}/.openspec.yaml` : configPath}: 未対応の schema ${schema} の test-plan は対応に使いません（delta は判定に使います）`);
    return change;
  }
  const planRel = `${dir}/test-plan.md`;
  if (!existsSync(join(repo, planRel))) {
    change.legacy = schema === SCHEMA_E2E;
    if ([SCHEMA_INTEGRATED, SCHEMA_E2E].includes(schema)) change.unresolved.push({ id: '-', requirement: '', scenario: '', reason: `${planRel} がありません` });
    return change;
  }
  const text = readText(repo, planRel);
  const legacy = schema === SCHEMA_E2E || !hasFrontmatter(text);
  change.legacy = legacy;
  let parsed;
  try { parsed = planRows(text, { legacy }); }
  catch (err) {
    if (err instanceof InvalidCoverageInputError) throw new InvalidCoverageInputError(`${planRel}: ${err.message}`);
    throw err;
  }
  change.textOnly = parsed.textOnly;
  if (!parsed.rows.length && !parsed.textOnly.length && !parsed.hasSections) {
    change.unresolved.push({ id: '-', requirement: '', scenario: '', reason: 'test-plan の対応表を解析できません（## E2E観点一覧 / ## 対象外シナリオ）' });
  }
  for (const row of parsed.rows) {
    if (!row.parsable) {
      change.unresolved.push({ ...row, reason: row.reason || 'シナリオ名がありません' });
      continue;
    }
    const target = resolveCapability(delta, row);
    if (target.error) change.unresolved.push({ ...row, reason: target.error });
    else change.rows.push({ ...row, capability: target.capability, requirement: target.requirement });
  }
  return change;
}

function key(capability, requirement, scenario) {
  return JSON.stringify([capability, requirement, scenario]);
}

function reqKey(capability, requirement) {
  return JSON.stringify([capability, requirement]);
}

export function listArchives(repo) {
  return readInput(join(repo, ARCHIVE_ROOT), () => listArchivedChanges(repo))
    .map(({ folder, id, dir }) => {
      if (!id) throw new InvalidCoverageInputError(`archive フォルダ名は YYYY-MM-DD-<id> が必要です: ${folder}`);
      return { folder, id, dir };
    });
}

function listActive(repo) {
  return readInput(join(repo, CHANGES_ROOT), () => listActiveChanges(repo));
}

// Config keys other than schema belong to other tools and may use their own tags.
function schemaTagged(doc) {
  return isCustomTag(doc?.contents) || isCustomTag(doc?.get?.('schema', true));
}

export function buildCoverage(repo, { env = process.env } = {}) {
  if (!existsSync(join(repo, 'openspec'))) throw new InvalidCoverageInputError(`openspec/ がありません: ${repo}`);
  const mainNames = new Map();
  const main = listMainScenarios(repo, mainNames);
  const schemas = validateConfig(repo, env);
  const archives = listArchives(repo).map((entry, order) => ({ ...readChange(repo, entry.dir, entry.id, order, schemas), folder: entry.folder }));
  trackArchiveNames(archives);
  const active = readActiveChanges(repo, schemas, mainNames);
  const warnings = [...archives.flatMap(change => change.warnings), ...active.warnings];

  const definitions = latestDefinitions(archives);
  const owners = scenarioOwners(archives);
  const notes = activeNotes(active.changes);
  const scenarios = main.map(entry => classifyScenario(entry, owners, notes, definitions.latest));
  const mainKeys = new Set(main.map(entry => key(entry.capability, entry.requirement, entry.scenario)));
  const orphans = collectOrphans(archives, mainKeys, definitions.gone);
  const { unresolved, legacyUnresolved } = collectUnresolved(archives);
  return { scenarios, orphans, unresolved, legacyUnresolved, archives: archives.length, warnings: [...new Set(warnings)] };
}

function validateConfig(repo, env) {
  const config = readInput('openspec/config.yaml または config.yml', () => readConfigDocument(repo));
  const configPath = relative(repo, config.located.path);
  if (config.parsed && (config.parsed.errors.length || schemaTagged(config.parsed.doc)
    || (config.parsed.data != null && !isPlainMapping(config.parsed.data))
    || (config.parsed.data?.schema != null && typeof config.parsed.data.schema !== 'string'))) {
    throw new InvalidCoverageInputError(`${configPath} が不正です: ${config.parsed.errors.join('; ') || 'schema を持つ YAML mapping が必要です'}`);
  }
  return {
    defaultSchema: asString(config.parsed?.data?.schema) || null,
    configPath, qeSchema: env.QE_SCHEMA ?? SCHEMA_QE,
  };
}

function knownNames(names, capability) {
  if (!names.has(capability)) names.set(capability, new Set());
  return names.get(capability);
}

// A MODIFIED requirement whose name differs from a known one only in case is a typo, not a new requirement.
function checkRequirementNames(change, names) {
  for (const file of change.delta) {
    const known = new Set(knownNames(names, file.capability));
    // A rename may carry a MODIFIED definition of its new name in the same delta.
    for (const rename of file.renames) {
      known.delete(rename.from);
      known.add(rename.to);
    }
    for (const req of file.requirements) {
      if (req.op === 'MODIFIED' && !known.has(req.name)) {
        const match = [...known].find(name => name.toLowerCase() === req.name.toLowerCase());
        if (match) throw new InvalidCoverageInputError(`${change.dir}/specs/${file.capability}/spec.md: MODIFIED の Requirement 名の大小文字が一致しません: ${req.name} / ${match}`);
      }
    }
  }
}

// Archive names must only be compared with names observed up to that point.
// The present-day main spec and future additions cannot diagnose historical typos.
function trackArchiveNames(archives) {
  const names = new Map();
  for (const change of archives) {
    checkRequirementNames(change, names);
    for (const file of change.delta) for (const rename of file.renames) {
      knownNames(names, file.capability).delete(rename.from);
      knownNames(names, file.capability).add(rename.to);
    }
    for (const file of change.delta) for (const req of file.requirements) {
      const known = knownNames(names, file.capability);
      if (req.op === 'REMOVED') known.delete(req.name);
      else known.add(req.name);
    }
  }
}

// Active changes are checked against current main names, independently of other WIP.
// An active change with invalid input is left out of the notes rather than failing the map.
function readActiveChanges(repo, schemas, mainNames) {
  const names = new Map(mainNames);
  const changes = [];
  const warnings = [];
  for (const entry of listActive(repo)) {
    try {
      const change = readChange(repo, entry.dir, entry.id, Infinity, schemas);
      checkRequirementNames(change, names);
      changes.push(change);
      warnings.push(...change.warnings);
    } catch (err) {
      if (!(err instanceof InvalidCoverageInputError) || err instanceof CoverageReadError) throw err;
      warnings.push(`進行中の change ${entry.id} を注記から除外しました: ${err.message}`);
    }
  }
  return { changes, warnings };
}

// Latest change that defined each requirement, and what later removed or renamed it.
function latestDefinitions(archives) {
  const latest = new Map();
  const gone = new Map();
  for (const change of archives) {
    for (const file of change.delta) {
      for (const requirement of file.requirements) {
        const at = reqKey(file.capability, requirement.name);
        if (requirement.op === 'ADDED' || requirement.op === 'MODIFIED') {
          latest.set(at, { ...change, operation: requirement.op });
          gone.delete(at);
        } else if (requirement.op === 'REMOVED') {
          latest.delete(at);
          gone.set(at, `REMOVED（${change.id}）`);
        }
      }
      for (const rename of file.renames) {
        const from = reqKey(file.capability, rename.from);
        latest.delete(from);
        gone.set(from, `RENAMED → ${rename.to}（${change.id}）`);
        latest.set(reqKey(file.capability, rename.to), { ...change, operation: 'RENAMED' });
      }
    }
  }
  return { latest, gone };
}

// The most recently archived change with rows for a scenario owns its mapping.
function scenarioOwners(archives) {
  const owners = new Map();
  for (const change of archives) {
    for (const row of change.rows) {
      const at = key(row.capability, row.requirement, row.scenario);
      const held = owners.get(at);
      if (!held || held.change.order < change.order) owners.set(at, { change, rows: [row] });
      else if (held.change === change) held.rows.push(row);
    }
  }
  return owners;
}

function activeNotes(active) {
  const notes = new Map();
  for (const change of active) {
    for (const row of change.rows) {
      const at = key(row.capability, row.requirement, row.scenario);
      const list = notes.get(at) ?? [];
      if (!list.includes(change.id)) list.push(change.id);
      notes.set(at, list);
    }
  }
  return notes;
}

function classifyScenario(entry, owners, notes, latest) {
  const at = key(entry.capability, entry.requirement, entry.scenario);
  const held = owners.get(at);
  const row = { ...entry, classification: CLASS.none, source: null, tps: [], result: null, active: notes.get(at) ?? [] };
  if (!held) return row;
  const tps = held.rows.filter(item => item.kind === 'tp');
  const declared = held.rows.filter(item => item.kind === 'delegated');
  const def = latest.get(reqKey(entry.capability, entry.requirement));
  const staleBy = def && def.order > held.change.order ? def.id : null;
  row.source = { change: held.change.id, archive: held.change.folder };
  if (tps.length) {
    row.tps = tps.map(item => ({ change: held.change.id, id: item.id }));
    row.source.tps = tps.map(item => item.id);
  } else {
    row.source.declared = declared.map(item => ({ oracle: item.oracle, layer: item.layer, method: item.method }));
  }
  if (staleBy) {
    row.classification = CLASS.stale;
    row.source.modifiedBy = staleBy;
    row.source.operation = def.operation;
  } else row.classification = tps.length ? CLASS.e2e : CLASS.declared;
  return row;
}

function collectOrphans(archives, mainKeys, gone) {
  const orphans = [];
  for (const change of archives) {
    for (const row of change.rows) {
      if (row.kind !== 'tp') continue;
      if (mainKeys.has(key(row.capability, row.requirement, row.scenario))) continue;
      orphans.push({
        change: change.id,
        archive: change.folder,
        id: row.id,
        capability: row.capability,
        requirement: row.requirement,
        scenario: row.scenario,
        reason: gone.get(reqKey(row.capability, row.requirement)) ?? 'main spec にシナリオがありません',
      });
    }
  }
  return orphans;
}

function collectUnresolved(archives) {
  const unresolved = [];
  const legacyUnresolved = [];
  for (const change of archives) {
    const list = change.legacy ? legacyUnresolved : unresolved;
    for (const row of change.unresolved) {
      list.push({ change: change.id, archive: change.folder, id: row.id, requirement: row.requirement, scenario: row.scenario, reason: row.reason });
    }
    for (const id of change.textOnly) {
      list.push({ change: change.id, archive: change.folder, id, requirement: '', scenario: '', reason: 'TP-ID を対応表の行として解析できません（表の外、見出しまたは列名を確認）' });
    }
  }
  return { unresolved, legacyUnresolved };
}

const RANK = { fail: 3, [NOT_RUN]: 2, pass: 1 };

function bucket(status) {
  if (status === 'pass') return 'pass';
  if (status === NOT_RUN || status === 'skip') return NOT_RUN;
  return 'fail';
}

export function tpResult(flat, changeId, tpId) {
  // The substring check only narrows candidates; the bounded-token match decides.
  const matched = flat.filter(row => {
    const text = row.tagText ?? tagTextOf(row.spec);
    return text.includes(changeId) && text.includes(tpId) && specMatches(row.spec, changeId, tpId);
  });
  const run = matched.filter(row => row.attempts > 0);
  if (!run.length) return { status: NOT_RUN, bucket: NOT_RUN, flaky: false };
  let worst = null;
  for (const row of run) {
    const b = bucket(row.status);
    if (!worst || RANK[b] > RANK[worst.bucket]) worst = { status: b === NOT_RUN ? NOT_RUN : row.status, bucket: b };
  }
  return { ...worst, flaky: worst.bucket === 'pass' && run.some(row => row.flaky) };
}

export function attachResults(model, results) {
  const flat = flatten(results).map(row => ({ ...row, tagText: tagTextOf(row.spec) }));
  for (const row of model.scenarios) {
    if (!row.tps.length) continue;
    const per = row.tps.map(tp => ({ id: tp.id, ...tpResult(flat, tp.change, tp.id) }));
    const worst = per.reduce((acc, item) => (!acc || RANK[item.bucket] > RANK[acc.bucket] ? item : acc), null);
    row.result = { bucket: worst.bucket, flaky: per.some(item => item.flaky), tps: per };
  }
  model.withResults = true;
  return model;
}

function ratio(count, total) {
  if (!total) return null;
  return { count, total, percent: Math.round((count / total) * 1000) / 10 };
}

export function summarize(model) {
  const total = model.scenarios.length;
  const count = cls => model.scenarios.filter(row => row.classification === cls).length;
  const e2e = count(CLASS.e2e);
  const declared = count(CLASS.declared);
  const summary = {
    scenarios: total,
    [CLASS.e2e]: e2e,
    [CLASS.declared]: declared,
    [CLASS.none]: count(CLASS.none),
    [CLASS.stale]: count(CLASS.stale),
    [ORPHAN]: model.orphans.length,
    [UNRESOLVED]: model.unresolved.length,
    [LEGACY_UNRESOLVED]: model.legacyUnresolved.length,
    coverageE2E: ratio(e2e, total),
    coverageWithDeclared: ratio(e2e + declared, total),
  };
  if (model.withResults) {
    const protectedRows = model.scenarios.filter(row => row.classification === CLASS.e2e && row.result);
    const confirmed = protectedRows.filter(row => row.result.bucket === 'pass').length;
    summary['実行で確認済み'] = confirmed;
    summary.fail = protectedRows.filter(row => row.result.bucket === 'fail').length;
    summary[NOT_RUN] = protectedRows.filter(row => row.result.bucket === NOT_RUN).length;
    summary.coverageConfirmed = ratio(confirmed, total);
  }
  summary.needsAction = summary[CLASS.none] + summary[CLASS.stale] + summary[ORPHAN] + (summary.fail ?? 0) + (summary[NOT_RUN] ?? 0);
  return summary;
}

function sourceText(row) {
  const parts = [];
  if (row.source?.tps) parts.push(`${row.source.change} ${row.source.tps.join(', ')}`);
  else if (row.source?.declared) {
    const declared = row.source.declared.map(item => `Oracle ${item.oracle || '-'} / Layer ${item.layer || '-'} / Method ${item.method || '-'}`).join('; ');
    parts.push(`${row.source.change} 対象外: ${declared}`);
  }
  if (row.source?.modifiedBy) parts.push(`${row.source.modifiedBy} で ${row.source.operation ?? 'MODIFIED'}`);
  if (row.active.length) parts.push(`進行中: ${row.active.join(', ')}`);
  return parts.join(' ／ ') || '-';
}

function resultText(row, withResults) {
  if (row.classification === CLASS.declared) return DECLARED_RESULT;
  if (!withResults || !row.result) return '';
  const label = item => (item.bucket === 'pass' && item.flaky ? 'pass（flaky）' : item.status);
  if (row.result.tps.length === 1) return label(row.result.tps[0]);
  return row.result.tps.map(item => `${item.id}: ${label(item)}`).join(', ');
}

function ratioText(value) {
  return value ? `${value.count}/${value.total}（${value.percent}%）` : '算出しません（シナリオ 0 件）';
}

export function renderMarkdown(model, summary = summarize(model)) {
  const lines = ['# シナリオ対応表', ''];
  if (!model.scenarios.length) {
    lines.push('openspec/specs にシナリオが 0 件です。');
  } else {
    lines.push('| capability | Requirement | Scenario | 分類 | 出所 | 結果 |');
    lines.push('|------------|-------------|----------|------|------|------|');
    for (const row of model.scenarios) {
      lines.push(`| ${markdownCell(row.capability)} | ${markdownCell(row.requirement)} | ${markdownCell(row.scenario)} | ${row.classification} | ${markdownCell(sourceText(row))} | ${markdownCell(resultText(row, model.withResults))} |`);
    }
  }
  if (model.orphans.length) {
    lines.push('', `## ${ORPHAN}（テストの削除または付け替えを検討）`, '');
    lines.push('| change | TP-ID | capability | Requirement | Scenario | 理由 |');
    lines.push('|--------|-------|------------|-------------|----------|------|');
    for (const row of model.orphans) {
      lines.push(`| ${markdownCell(row.change)} | ${row.id} | ${markdownCell(row.capability)} | ${markdownCell(row.requirement)} | ${markdownCell(row.scenario)} | ${markdownCell(row.reason)} |`);
    }
  }
  for (const [title, list] of [[UNRESOLVED, model.unresolved], [LEGACY_UNRESOLVED, model.legacyUnresolved]]) {
    if (!list.length) continue;
    lines.push('', `## ${title}（保護に数えません）`, '');
    lines.push('| change | 行 | Requirement | Scenario | 理由 |');
    lines.push('|--------|----|-------------|----------|------|');
    for (const row of list) {
      lines.push(`| ${markdownCell(row.change)} | ${markdownCell(row.id)} | ${markdownCell(row.requirement)} | ${markdownCell(row.scenario)} | ${markdownCell(row.reason)} |`);
    }
  }
  if (model.warnings?.length) lines.push('', '## 警告', '', ...model.warnings.map(warning => `- ${markdownCell(warning)}`));
  lines.push('', '## 集計', '');
  lines.push(`- シナリオ: ${summary.scenarios} 件（archive 済み change ${model.archives} 件から集計）`);
  for (const label of [CLASS.e2e, CLASS.declared, CLASS.none, CLASS.stale]) lines.push(`- ${label}: ${summary[label]}`);
  lines.push(`- ${ORPHAN}: ${summary[ORPHAN]} TP`);
  lines.push(`- ${UNRESOLVED}: ${summary[UNRESOLVED]} 行 / ${LEGACY_UNRESOLVED}: ${summary[LEGACY_UNRESOLVED]} 行`);
  if (model.withResults) {
    lines.push(`- 実行で確認済み: ${summary['実行で確認済み']} / fail: ${summary.fail} / ${NOT_RUN}: ${summary[NOT_RUN]}`);
  }
  lines.push(`- 保護率（E2E）: ${ratioText(summary.coverageE2E)}`);
  lines.push(`- 保護率（他層の宣言を含む）: ${ratioText(summary.coverageWithDeclared)}`);
  if (model.withResults) lines.push(`- 保護率（実行で確認済み）: ${ratioText(summary.coverageConfirmed)}`);
  lines.push(`- 要対応: ${summary.needsAction}`);
  return `${lines.join('\n')}\n`;
}

export function renderJson(model, summary = summarize(model)) {
  return `${JSON.stringify({
    scenarios: model.scenarios.map(row => ({
      capability: row.capability,
      requirement: row.requirement,
      scenario: row.scenario,
      classification: row.classification,
      source: row.source,
      active: row.active,
      result: row.classification === CLASS.declared ? DECLARED_RESULT : (row.result ?? null),
    })),
    orphans: model.orphans,
    unresolved: model.unresolved,
    legacyUnresolved: model.legacyUnresolved,
    ...(model.warnings?.length ? { warnings: model.warnings } : {}),
    summary,
  }, null, 2)}\n`;
}

export function parseCoverageArgs(argv) {
  const opts = { resultsPath: null, maxAge: null, strict: false, format: 'markdown' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => inline ?? argv[++i];
    if (flag === '--strict') {
      if (inline !== undefined && inline !== 'true' && inline !== 'false') return { error: '--strict は true または false です' };
      opts.strict = inline !== 'false';
    } else if (flag === '--results') {
      opts.resultsPath = value();
      if (!opts.resultsPath) return { error: '--results には JSON のパスが必要です' };
    } else if (flag === '--max-age') {
      const raw = value();
      opts.maxAge = Number(raw);
      if (raw == null || raw === '' || !Number.isFinite(opts.maxAge) || opts.maxAge < 0) return { error: `--max-age には 0 以上の秒数を指定してください: ${raw ?? ''}` };
    } else if (flag === '--format') {
      opts.format = value();
      if (opts.format !== 'markdown' && opts.format !== 'json') return { error: '--format は markdown または json です' };
    } else return { error: `未対応の引数です: ${arg}` };
  }
  if (opts.maxAge != null && !opts.resultsPath) return { error: '--max-age は --results と一緒に指定してください' };
  return opts;
}

// exit code: 0=出力のみ / 1=--strict で要対応あり / 2=入力不正 / 3=内部エラー
export function runCoverage(options, deps = {}) {
  try { return coverageOutput(options, deps); }
  catch (err) {
    if (err instanceof InvalidCoverageInputError) return { exitCode: 2, stdout: '', stderr: `${err.message}\n` };
    return { exitCode: 3, stdout: '', stderr: `シナリオ対応表の内部エラー:\n${err.stack ?? err}\n` };
  }
}

function coverageOutput({ repo, resultsPath = null, maxAge = null, strict = false, format = 'markdown', now = Date.now(), readResults, env = process.env }, deps) {
  let results = null;
  if (resultsPath) {
    let raw;
    try {
      raw = readResults ? readResults(resultsPath) : readFileSync(resultsPath, 'utf8');
    } catch (err) {
      return { exitCode: 2, stdout: '', stderr: `Playwright JSON レポートを読めません: ${resultsPath} (${errorCode(err)})\n` };
    }
    try {
      results = JSON.parse(raw);
    } catch {
      return { exitCode: 2, stdout: '', stderr: `Playwright JSON が不正です: ${resultsPath}\n` };
    }
    const invalid = validateResults(results);
    if (invalid) return { exitCode: 2, stdout: '', stderr: `Playwright JSON が不正です: ${resultsPath}: ${invalid}\n` };
    const freshness = resultsFreshness(results, maxAge, now);
    if (freshness.error) return { exitCode: 2, stdout: '', stderr: freshness.error };
  }
  const model = (deps.buildCoverage ?? buildCoverage)(repo, { env });
  if (results) (deps.attachResults ?? attachResults)(model, results);
  const summary = (deps.summarize ?? summarize)(model);
  const stdout = format === 'json' ? (deps.renderJson ?? renderJson)(model, summary) : (deps.renderMarkdown ?? renderMarkdown)(model, summary);
  return { exitCode: strict && summary.needsAction ? 1 : 0, stdout, stderr: model.warnings.map(warning => `警告: ${warning}\n`).join(''), summary, model };
}
