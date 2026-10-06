import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_E2E, SCHEMA_QE } from './critical.mjs';
import { asString, parseYamlText } from './frontmatter.mjs';
import { listFiles } from './files.mjs';
import { byteCompare } from './hash.mjs';
import { parseTable, section } from './markdown.mjs';
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

const TP_ID = /^TP-\d{3}$/;
const ARCHIVE_FOLDER = /^\d{4}-\d{2}-\d{2}-(.+)$/;

function norm(value) {
  return String(value ?? '').trim();
}

// Test plans sometimes repeat the heading prefix; it is not part of the name.
function requirementName(value) {
  return norm(value).replace(/^Requirement:\s*/, '');
}

function placeholder(value) {
  return value === '' || value === '...' || value === '…';
}

function readText(repo, rel) {
  try {
    return readFileSync(join(repo, rel), 'utf8');
  } catch (err) {
    throw new Error(`ファイルを読めません: ${rel} (${err.code ?? err.message})`);
  }
}

function specFiles(repo, root) {
  const listed = listFiles(repo, root, { optional: true });
  if (listed.error) throw new Error(`ファイルを参照できません: ${listed.path} (${listed.code})`);
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
  let fence = null;
  let rename = null;
  for (const line of String(text).split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      if (rename) throw new Error('RENAMED の FROM に対応する TO がありません');
      op = heading[1].match(/^(ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/)?.[1] ?? null;
      if (delta && !op && /requirements/i.test(heading[1])) throw new Error(`delta の操作見出しが不正です: ${heading[1]}`);
      current = null;
      continue;
    }
    const requirement = line.match(/^### Requirement:\s*(.+?)\s*$/);
    if (requirement) {
      if (delta && !op) throw new Error(`delta の操作見出しがありません: ${requirement[1]}`);
      current = { name: requirement[1], op, scenarios: [] };
      requirements.push(current);
      continue;
    }
    if (/^### /.test(line)) {
      current = null;
      continue;
    }
    const scenario = line.match(/^#### Scenario:\s*(.+?)\s*$/);
    if (scenario && current) {
      current.scenarios.push(scenario[1]);
      continue;
    }
    if (op === 'RENAMED') {
      const from = line.match(/FROM:\s*`?\s*(?:###\s*)?Requirement:\s*(.+?)\s*`?\s*$/);
      const to = line.match(/TO:\s*`?\s*(?:###\s*)?Requirement:\s*(.+?)\s*`?\s*$/);
      if (from) {
        if (rename) throw new Error('RENAMED の FROM に対応する TO がありません');
        rename = { from: from[1] };
      } else if (to) {
        if (!rename) throw new Error('RENAMED の TO に対応する FROM がありません');
        renames.push({ ...rename, to: to[1] });
        rename = null;
      }
    }
  }
  if (fence) throw new Error('コードフェンスが閉じられていません');
  if (rename) throw new Error('RENAMED の FROM に対応する TO がありません');
  return { requirements, renames };
}

export function listMainScenarios(repo) {
  const scenarios = [];
  for (const { path, capability } of specFiles(repo, 'openspec/specs')) {
    for (const requirement of parseSpec(readText(repo, path)).requirements) {
      for (const scenario of requirement.scenarios) {
        scenarios.push({ capability, requirement: requirement.name, scenario });
      }
    }
  }
  return scenarios;
}

function schemaOf(repo, dir) {
  const rel = `${dir}/.openspec.yaml`;
  if (!existsSync(join(repo, rel))) return null;
  const parsed = parseYamlText(readText(repo, rel));
  if (parsed.errors.length || parsed.alias || parsed.tagged || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)
    || (parsed.data.schema != null && typeof parsed.data.schema !== 'string')) {
    throw new Error(`${rel} が不正です: ${parsed.errors.join('; ') || 'schema を持つ YAML mapping が必要です'}`);
  }
  return asString(parsed.data?.schema) || null;
}

function hasFrontmatter(text) {
  return /^---\r?\n/.test(text);
}

// Rows of a test plan in a form shared by the integrated and legacy layouts.
export function planRows(text, { legacy }) {
  const table = parseTable(section(text, '## E2E観点一覧')).rows;
  const tp = [];
  for (const row of table) {
    const id = norm(row['TP-ID']);
    if (!TP_ID.test(id)) continue;
    const scenario = norm(row.Scenario ?? row['対応シナリオ']);
    tp.push({ kind: 'tp', id, requirement: requirementName(row.Requirement), scenario, parsable: !placeholder(scenario) });
  }
  const delegated = legacy ? [] : parseTable(section(text, '## 対象外シナリオ')).rows
    .filter(row => norm(row.Scenario))
    .map(row => ({
      kind: 'delegated',
      id: '対象外',
      requirement: requirementName(row.Requirement),
      scenario: norm(row.Scenario),
      oracle: norm(row.Oracle),
      layer: norm(row.Layer),
      method: norm(row.Method),
      parsable: true,
    }));
  const tableIds = new Set(tp.map(row => row.id));
  const textOnly = [...new Set([...text.matchAll(/TP-\d{3}(?!\d)/g)].map(match => match[0]))].filter(id => !tableIds.has(id));
  return { rows: [...tp, ...delegated], textOnly };
}

function deltaIndex(repo, dir) {
  const files = specFiles(repo, `${dir}/specs`);
  return files.map(({ path, capability }) => {
    try {
      return { capability, ...parseSpec(readText(repo, path), { delta: true }) };
    } catch (err) {
      throw new Error(`${path}: ${err.message}`);
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

function readChange(repo, dir, id, order) {
  const schema = schemaOf(repo, dir);
  const change = { id, dir, order, schema, rows: [], textOnly: [], unresolved: [], skipped: schema === SCHEMA_QE };
  const delta = deltaIndex(repo, dir);
  change.delta = delta;
  if (change.skipped) return change;
  const planRel = `${dir}/test-plan.md`;
  if (!existsSync(join(repo, planRel))) {
    change.legacy = schema === SCHEMA_E2E;
    change.unresolved.push({ id: '-', requirement: '', scenario: '', reason: `${planRel} がありません` });
    return change;
  }
  const text = readText(repo, planRel);
  const legacy = schema === SCHEMA_E2E || !hasFrontmatter(text);
  change.legacy = legacy;
  const parsed = planRows(text, { legacy });
  change.textOnly = parsed.textOnly;
  if (!parsed.rows.length && !parsed.textOnly.length && !section(text, '## E2E観点一覧') && !section(text, '## 対象外シナリオ')) {
    change.unresolved.push({ id: '-', requirement: '', scenario: '', reason: 'test-plan の対応表を解析できません（## E2E観点一覧 / ## 対象外シナリオ）' });
  }
  for (const row of parsed.rows) {
    if (!row.parsable) {
      change.unresolved.push({ ...row, reason: 'シナリオ名がありません' });
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
  const root = join(repo, 'openspec/changes/archive');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    // Folders are YYYY-MM-DD-<id>, so byte order is date order with the name as the tie-breaker.
    .sort(byteCompare)
    .map(folder => {
      const id = folder.match(ARCHIVE_FOLDER)?.[1];
      if (!id) throw new Error(`archive フォルダ名は YYYY-MM-DD-<id> が必要です: ${folder}`);
      return { folder, id, dir: `openspec/changes/archive/${folder}` };
    });
}

function listActive(repo) {
  const root = join(repo, 'openspec/changes');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'archive')
    .map(entry => entry.name)
    .sort(byteCompare)
    .map(id => ({ id, dir: `openspec/changes/${id}` }));
}

export function buildCoverage(repo) {
  if (!existsSync(join(repo, 'openspec'))) throw new Error(`openspec/ がありません: ${repo}`);
  const main = listMainScenarios(repo);
  const archives = listArchives(repo).map((entry, order) => ({ ...readChange(repo, entry.dir, entry.id, order), folder: entry.folder }));
  const active = listActive(repo).map(entry => readChange(repo, entry.dir, entry.id, Infinity));

  // Latest change that defined each requirement, and what later removed or renamed it.
  const latestDef = new Map();
  const gone = new Map();
  for (const change of archives) {
    for (const file of change.delta) {
      for (const requirement of file.requirements) {
        const at = reqKey(file.capability, requirement.name);
        if (requirement.op === 'ADDED' || requirement.op === 'MODIFIED') {
          latestDef.set(at, { ...change, operation: requirement.op });
          gone.delete(at);
        } else if (requirement.op === 'REMOVED') {
          latestDef.delete(at);
          gone.set(at, `REMOVED（${change.id}）`);
        }
      }
      for (const rename of file.renames) {
        const from = reqKey(file.capability, rename.from);
        latestDef.delete(from);
        gone.set(from, `RENAMED → ${rename.to}（${change.id}）`);
        latestDef.set(reqKey(file.capability, rename.to), { ...change, operation: 'RENAMED' });
      }
    }
  }

  // The most recently archived change with rows for a scenario owns its mapping.
  const mapping = new Map();
  for (const change of archives) {
    for (const row of change.rows) {
      const at = key(row.capability, row.requirement, row.scenario);
      const held = mapping.get(at);
      if (!held || held.change.order < change.order) mapping.set(at, { change, rows: [row] });
      else if (held.change === change) held.rows.push(row);
    }
  }
  const activeNotes = new Map();
  for (const change of active) {
    for (const row of change.rows) {
      const at = key(row.capability, row.requirement, row.scenario);
      const list = activeNotes.get(at) ?? [];
      if (!list.includes(change.id)) list.push(change.id);
      activeNotes.set(at, list);
    }
  }

  const mainKeys = new Set();
  const scenarios = main.map(entry => {
    const at = key(entry.capability, entry.requirement, entry.scenario);
    mainKeys.add(at);
    const held = mapping.get(at);
    const row = { ...entry, classification: CLASS.none, source: null, tps: [], result: null, active: activeNotes.get(at) ?? [] };
    if (!held) return row;
    const tps = held.rows.filter(item => item.kind === 'tp');
    const declared = held.rows.filter(item => item.kind === 'delegated');
    const def = latestDef.get(reqKey(entry.capability, entry.requirement));
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
  });

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
  const unresolved = [];
  const legacyUnresolved = [];
  for (const change of archives) {
    for (const row of change.unresolved) {
      const item = { change: change.id, archive: change.folder, id: row.id, requirement: row.requirement, scenario: row.scenario, reason: row.reason };
      (change.legacy ? legacyUnresolved : unresolved).push(item);
    }
    for (const id of change.textOnly) {
      (change.legacy ? legacyUnresolved : unresolved).push({ change: change.id, archive: change.folder, id, requirement: '', scenario: '', reason: 'TP-ID を対応表の行として解析できません（表の外、見出しまたは列名を確認）' });
    }
  }
  return { scenarios, orphans, unresolved, legacyUnresolved, archives: archives.length };
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

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
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
      lines.push(`| ${cell(row.capability)} | ${cell(row.requirement)} | ${cell(row.scenario)} | ${row.classification} | ${cell(sourceText(row))} | ${cell(resultText(row, model.withResults))} |`);
    }
  }
  if (model.orphans.length) {
    lines.push('', `## ${ORPHAN}（テストの削除または付け替えを検討）`, '');
    lines.push('| change | TP-ID | capability | Requirement | Scenario | 理由 |');
    lines.push('|--------|-------|------------|-------------|----------|------|');
    for (const row of model.orphans) {
      lines.push(`| ${cell(row.change)} | ${row.id} | ${cell(row.capability)} | ${cell(row.requirement)} | ${cell(row.scenario)} | ${cell(row.reason)} |`);
    }
  }
  for (const [title, list] of [[UNRESOLVED, model.unresolved], [LEGACY_UNRESOLVED, model.legacyUnresolved]]) {
    if (!list.length) continue;
    lines.push('', `## ${title}（保護に数えません）`, '');
    lines.push('| change | 行 | Requirement | Scenario | 理由 |');
    lines.push('|--------|----|-------------|----------|------|');
    for (const row of list) {
      lines.push(`| ${cell(row.change)} | ${cell(row.id)} | ${cell(row.requirement)} | ${cell(row.scenario)} | ${cell(row.reason)} |`);
    }
  }
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
    summary,
  }, null, 2)}\n`;
}

export function parseCoverageArgs(argv) {
  const opts = { resultsPath: null, maxAge: null, strict: false, format: 'markdown' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => inline ?? argv[++i];
    if (flag === '--strict') opts.strict = true;
    else if (flag === '--results') {
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

// exit code: 0=出力のみ / 1=--strict で要対応あり / 2=入力の欠落・破損・鮮度違反
export function runCoverage({ repo, resultsPath = null, maxAge = null, strict = false, format = 'markdown', now = Date.now(), readResults }) {
  let results = null;
  if (resultsPath) {
    let raw;
    try {
      raw = readResults ? readResults(resultsPath) : readFileSync(resultsPath, 'utf8');
    } catch (err) {
      return { exitCode: 2, stdout: '', stderr: `Playwright JSON レポートを読めません: ${resultsPath} (${err.code ?? err.message})\n` };
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
  let model;
  try {
    model = buildCoverage(repo);
  } catch (err) {
    return { exitCode: 2, stdout: '', stderr: `${err.message}\n` };
  }
  if (results) attachResults(model, results);
  const summary = summarize(model);
  const stdout = format === 'json' ? renderJson(model, summary) : renderMarkdown(model, summary);
  return { exitCode: strict && summary.needsAction ? 1 : 0, stdout, stderr: '', summary, model };
}
