import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_E2E, SCHEMA_INTEGRATED, STAMP_FILE } from './critical.mjs';
import { asString, parseYamlText, splitFrontmatter, validDate } from './frontmatter.mjs';
import { delegatedHeading, hasBoundedToken, markdownProse, parseTable, planSections, planTables, section, tpReferences } from './markdown.mjs';
import { listFiles } from './files.mjs';
import { installedE2eRoot, readJsonIfExists } from './e2e-root.mjs';

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

const TP_SECTION = '## E2E観点一覧';
const DELEGATED_SECTION = '## 対象外シナリオ';

// Same prose and sections as the coverage map. Only `## E2E観点一覧` holds TP rows;
// a TP-ID table anywhere else, or a TP reference under another E2E観点一覧 / 対象外
// heading, fails instead of being dropped.
function testPlanStructure(planText) {
  const prose = markdownProse(planText, { tables: true });
  const sections = planSections(prose.text);
  const tables = sections
    .filter(item => item.heading === TP_SECTION)
    .flatMap(item => planTables(item.body));
  const errors = [];
  if (prose.unclosedFence) errors.push('test-plan のコードフェンスが閉じられていません（閉じていないフェンス以降の TP 行を読めません）');
  // Tables without a delimiter row stay accepted when they start with the TP-ID header.
  const tpTable = table => table.firstCells.includes('TP-ID');
  const preamble = prose.text.slice(0, sections[0]?.start ?? prose.text.length);
  if (planTables(preamble).some(tpTable)) errors.push(`最初の見出しより前に TP-ID 列の表があります（TP 行は ${TP_SECTION} の節に置いてください）`);
  for (const { heading, body } of sections) {
    if (heading === TP_SECTION) continue;
    if (planTables(body).some(tpTable)) {
      errors.push(`見出し ${heading} の下に TP があります（TP-ID 列の表は ${TP_SECTION} の節に置いてください）`);
      continue;
    }
    if (heading === DELEGATED_SECTION) continue;
    const refs = tpReferences(body);
    if (!refs.length) continue;
    if (delegatedHeading(heading)) {
      errors.push(`見出し ${heading} は対象外の表として読めません（${DELEGATED_SECTION} の見出しが必要です。この節は TP を読まないため、${refs.join('・')} の参照があると失敗します）`);
    } else if (/^#{1,6}[^\S\r\n]*E2E観点一覧/.test(heading)) {
      errors.push(`見出し ${heading} の下に TP があります（${refs.join('・')} の参照があります。E2E観点一覧 で始まる見出しは TP を読まない別の節になるため、参照だけでも失敗します。補足は ${TP_SECTION} の中に別の名前の小見出しで書いてください）`);
    }
  }
  for (const table of tables) {
    if (!tpTable(table)) errors.push(table.separator
      ? `E2E観点一覧 に TP-ID 列の無い表があります: ${table.firstLine}（TP 以外の表は別の節に置いてください）`
      : `E2E観点一覧 に TP-ID の見出し行で始まらない表があります: ${table.firstLine}（空行やコードフェンスで表を分けないでください。分ける場合は見出し行と区切り行を付けます）`);
  }
  return { tables: tables.filter(tpTable), errors };
}

export function tpRows(planText) {
  return testPlanStructure(planText).tables.flatMap(table => table.rows).filter(row => /^TP-\d{3}$/.test(row['TP-ID']));
}

export function testPlanRowErrors(planText) {
  const { tables, errors } = testPlanStructure(planText);
  return [...errors, ...tables.flatMap(table => table.rows)
    .filter(row => !/^TP-\d{3}$/.test(row['TP-ID']))
    .map(row => `E2E観点一覧 の TP-ID ${row['TP-ID'] || '(空)'} は不正です（TP-001 のように TP- と3桁の数字を使います）`)];
}

// Reserve project-related names (including the existing Projets typo), preserving custom columns.
const PROJECT_HEADER_VARIANT = /projec?t|プロジェクト/;

export function testPlanHeaderErrors(planText) {
  const errors = [];
  for (const { headers } of testPlanStructure(planText).tables) {
    const seen = new Set();
    for (const header of headers) {
      const normalized = header.normalize('NFKC').replace(/[\p{P}\p{S}\s]/gu, '').toLowerCase();
      if (!header) errors.push('E2E観点一覧 の列 (空) は不正です（列名を指定してください）');
      else if (header !== 'Projects' && PROJECT_HEADER_VARIANT.test(normalized)) errors.push(`E2E観点一覧 の列 ${header} は不正です（project の指定には Projects を使います）`);
      if (header && seen.has(header)) errors.push(`E2E観点一覧 の列 ${header} が重複しています`);
      seen.add(header);
    }
  }
  return errors;
}

// Optional `Projects` cell: Playwright project names separated by `,` or `、`. Duplicates collapse;
// `blank` reports an empty element such as `chromium, , webkit`.
export function projectsOf(row) {
  const raw = asString(row.Projects);
  if (!raw) return { projects: [], blank: false };
  const parts = raw.split(/[,、]/).map(part => part.trim());
  return { projects: [...new Set(parts.filter(Boolean))], blank: parts.some(part => !part) };
}

export const VIEWPOINTS = ['クロスブラウザ／デバイス／レスポンシブ', '見た目の回帰', 'アクセシビリティ', '文言・多言語', '性能', '入力系セキュリティ'];
export const ALL_VIEWPOINTS = '全観点';
const VIEWPOINT_HEADING = '## Non-functional Viewpoints';
const NOT_APPLICABLE = '該当なし';

function viewpointName(cell) {
  return asString(cell).replace(/\s+/g, '').replaceAll('/', '／');
}

// Strip the optional "該当なし" marker and parentheses; the remaining text must be a concrete reason.
function reasonText(cell) {
  const reason = asString(cell).replace(/[。．.!！?？、,，…\s]+$/u, '').replace(/^該当なし[\s:：\-–—ー―]*/, '').replace(/^[(（]\s*/, '').replace(/\s*[)）]$/, '').trim();
  const content = reason.replace(/[。．.!！?？、,，…\s]+$/u, '');
  return !content || /^(<[^>]*>|[-–—ー―]|tbd|todo|未定(?:です|である)?|(?:特に)?(?:なし|無し)|n\/?a)$/i.test(content) ? '' : reason;
}

function viewpointErrors(id, text, e2e) {
  const errors = [];
  const failureIds = new Set(parseTable(section(text, '## Failure Modes')).rows.map(row => asString(row.ID)).filter(value => /^F\d+$/.test(value)));
  const tableRows = parseTable(section(text, VIEWPOINT_HEADING)).rows;
  const seen = new Set();
  const names = [];
  for (const row of tableRows) {
    const name = viewpointName(row['観点']);
    const label = asString(row['観点']) || '(観点 空)';
    if (name !== ALL_VIEWPOINTS && !VIEWPOINTS.includes(name)) {
      errors.push(`${id}: Non-functional Viewpoints の観点 ${label} は不明です（${VIEWPOINTS.join(' / ')} から選びます）`);
      continue;
    }
    if (seen.has(name)) errors.push(`${id}: Non-functional Viewpoints の ${name} が重複しています`);
    seen.add(name);
    names.push(name);
    const modeCell = asString(row['Failure Mode']);
    const modes = modeCell === NOT_APPLICABLE ? [] : modeCell.split(/[\s,、]+/).filter(Boolean);
    const reason = reasonText(row['該当なし理由']);
    if (modeCell === NOT_APPLICABLE && !reason) errors.push(`${id}: Non-functional Viewpoints の ${name} は該当なしの理由がありません`);
    else if (!modes.length && !reason) errors.push(`${id}: Non-functional Viewpoints の ${name} に Failure Mode も該当なしの理由もありません`);
    else if (modes.length && reason) errors.push(`${id}: Non-functional Viewpoints の ${name} に Failure Mode と該当なし理由の両方があります（どちらか一方にします）`);
    if (name === ALL_VIEWPOINTS && modes.length) errors.push(`${id}: Non-functional Viewpoints の ${ALL_VIEWPOINTS} には該当なしの理由だけを書きます`);
    for (const mode of modes) {
      if (!failureIds.has(mode)) errors.push(`${id}: Non-functional Viewpoints の ${name} が参照する ${mode} は Failure Modes にありません`);
    }
  }
  if (names.includes(ALL_VIEWPOINTS)) {
    if (e2e !== 'not-applicable') errors.push(`${id}: ${ALL_VIEWPOINTS} の1行にできるのは e2e: not-applicable の change だけです（現在: ${e2e || '未指定'}。それ以外は6観点すべての行が必要です）`);
    else if (names.length > 1) errors.push(`${id}: ${ALL_VIEWPOINTS} の行は他の観点の行と併用できません`);
    return errors;
  }
  for (const name of VIEWPOINTS) {
    if (!seen.has(name)) errors.push(`${id}: Non-functional Viewpoints に ${name} の行がありません`);
  }
  return errors;
}

function createdOf(repo, dir) {
  const path = join(repo, dir, '.openspec.yaml');
  if (!existsSync(path)) return { error: '.openspec.yaml がありません' };
  const parsed = parseYamlText(readFileSync(path, 'utf8'));
  if (parsed.errors.length || parsed.alias || parsed.tagged || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return { error: `.openspec.yaml が不正です: ${parsed.errors[0] || 'alias・独自 tag のない YAML mapping が必要です'}` };
  }
  const value = parsed.data?.created;
  const created = value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : asString(value);
  if (!created) return { error: '.openspec.yaml の created がありません' };
  if (!validDate(created)) return { error: `.openspec.yaml の created が不正です: ${created}（YYYY-MM-DD が必要です）` };
  return { created };
}

// A quality.md without the register is tolerated (warning) only for changes created before the kit
// recorded the feature. Missing or unreadable dates fail closed.
function missingViewpoints(repo, change) {
  const label = `${change.id}: quality.md に ${VIEWPOINT_HEADING} がありません`;
  const metadata = createdOf(repo, change.path);
  if (metadata.error) return { error: `${label}（${metadata.error}。導入前の change として扱えません）` };
  const { created } = metadata;
  const stamp = readJsonIfExists(join(repo, STAMP_FILE));
  if (!stamp.exists) return { error: `${label}（${STAMP_FILE} がありません。導入前の change として扱えません）` };
  if (stamp.broken || !stamp.data || typeof stamp.data !== 'object' || Array.isArray(stamp.data)) return { error: `${label}（${STAMP_FILE} が不正です。導入前の change として扱えません）` };
  const since = asString(stamp.data?.features?.nonfunctionalViewpoints?.since);
  if (!validDate(since)) return { error: `${label}（${STAMP_FILE} の features.nonfunctionalViewpoints.since が${since ? `不正です: ${since}（YYYY-MM-DD が必要です）` : 'ありません'}。導入前の change として扱えません）` };
  if (created < since) return { warning: `${label}（${created} 作成で導入日 ${since} より前のため警告のみ）` };
  return { error: `${label}（${created} 作成で導入日 ${since} 以降です）` };
}

export function checkTestPlan(repo, change) {
  const errors = [];
  const notes = [];
  const warnings = [];
  const projects = {};
  if (![SCHEMA_INTEGRATED, SCHEMA_E2E].includes(change.schema) && change.scope !== 'integrated') {
    return { errors, notes, warnings, projects, requiredTags: [] };
  }
  const planPath = join(repo, change.path, 'test-plan.md');
  if (!existsSync(planPath)) {
    errors.push(`${change.id}: test-plan.md がありません`);
    return { errors, notes, warnings, projects, requiredTags: [] };
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
  if (change.schema === SCHEMA_INTEGRATED) {
    errors.push(...testPlanHeaderErrors(text).map(error => `${change.id}: ${error}`));
    errors.push(...testPlanRowErrors(text).map(error => `${change.id}: ${error}`));
    for (const row of tp) {
      const declared = projectsOf(row);
      if (declared.blank) errors.push(`${change.id}: ${row['TP-ID']} の Projects に空の要素があります`);
      if (declared.projects.length) projects[row['TP-ID']] = declared.projects;
    }
  }

  if (change.schema === SCHEMA_INTEGRATED && change.e2e === 'required' && tp.length === 0) {
    errors.push(`${change.id}: required なのに TP が 0 件です`);
  }
  if (change.schema === SCHEMA_INTEGRATED && change.e2e === 'not-applicable' && tp.length > 0) {
    errors.push(`${change.id}: not-applicable なのに TP があります`);
  }

  const qualityPath = join(repo, change.path, 'quality.md');
  let model = null;
  if (change.schema === SCHEMA_INTEGRATED && !existsSync(qualityPath)) {
    errors.push(`${change.id}: quality.md がありません（Non-functional Viewpoints と Risk / Oracle の参照を検査できません）`);
  }
  if (change.schema === SCHEMA_INTEGRATED && existsSync(qualityPath)) {
    const qualityText = readFileSync(qualityPath, 'utf8');
    model = qualityModel(qualityText);
    // Examples in code fences cannot satisfy the viewpoint register.
    const qualityProse = markdownProse(qualityText);
    if (qualityProse.unclosedFence) errors.push(`${change.id}: quality.md のコードフェンスが閉じられていません（閉じていないフェンス以降の ${VIEWPOINT_HEADING} を読めません）`);
    if (section(qualityProse.text, VIEWPOINT_HEADING) == null) {
      const missing = missingViewpoints(repo, change);
      if (missing.error) errors.push(missing.error);
      else warnings.push(missing.warning);
    } else errors.push(...viewpointErrors(change.id, qualityProse.text, change.e2e));
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
  return { errors, notes, warnings, projects, requiredTags: [...new Set(legacyIds)] };
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
