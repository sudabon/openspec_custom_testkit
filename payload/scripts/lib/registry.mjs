import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_E2E } from './critical.mjs';
import { installedE2eRoot } from './e2e-root.mjs';
import { asString, validDate } from './frontmatter.mjs';
import { hasBoundedToken, markdownProse, parseTable, section } from './markdown.mjs';

export const FIXTURE_REGISTRY = 'fixtures/README.md';
export const MOCK_REGISTRY = 'mocks/README.md';
export const FIXTURE_HEADING = '## fixture 名 → 作られる状態';
export const MOCK_HEADING = '## モック一覧';
export const MOCK_COLUMNS = ['モック名', '対象サービス', '契約の出典', '整合の確認方法', '最終確認日'];
export const NO_FIXTURE = 'なし';
export const IDEMPOTENCY_NOTE = 'fixture の冪等性・テスト間の状態非共有は検査していません（E2E 規約と Human Code Review の観点です）';
const DAY_MS = 24 * 60 * 60 * 1000;

function unquote(value) {
  return asString(value).replaceAll('`', '').trim();
}

// Registry rows name a TP as `<change-id>:TP-NNN`. Keep the notation in one place so that a later
// permanent TP identifier can be accepted by changing only this function.
export function qualifiedTp(changeId, tpId) {
  return `${changeId}:${tpId}`;
}

// A `Fixture` cell holds elements separated by `,` or `、`. `mock:<name>` declares a mock, `なし` alone
// declares no precondition, and anything else is a fixture name. Backticks are ignored.
export function fixtureElements(cell) {
  const parts = asString(cell).split(/[,、]/).map(unquote);
  const items = parts.filter(part => part && part !== '...' && part !== '…');
  const result = { none: false, fixtures: [], mocks: [], errors: [] };
  if (parts.length > 1 && parts.some(part => !part)) result.errors.push('空の要素があります');
  if (items.includes(NO_FIXTURE)) {
    if (items.length === 1) result.none = true;
    else result.errors.push(`${NO_FIXTURE} は他の要素と併用できません`);
  }
  for (const item of items) {
    if (item === NO_FIXTURE) continue;
    if (/^mock:/i.test(item)) {
      const name = item.slice('mock:'.length).trim();
      if (!/^mock:/.test(item)) result.errors.push(`${item} の接頭辞は小文字の mock: で書きます`);
      else if (!name) result.errors.push('mock: の後にモック名がありません');
      else if (!result.mocks.includes(name)) result.mocks.push(name);
    } else if (!result.fixtures.includes(item)) result.fixtures.push(item);
  }
  return result;
}

function registryTable(text, heading) {
  const prose = markdownProse(text);
  const body = section(prose.text, heading);
  if (body == null) return null;
  return parseTable(body).rows;
}

// Fixture name -> TP-ID entries listed in "使用する TP-ID". Returns null when the heading is missing.
export function parseFixtureRegistry(text) {
  const rows = registryTable(text, FIXTURE_HEADING);
  if (!rows) return null;
  const registry = new Map();
  for (const row of rows) {
    const name = unquote(row['fixture 名']);
    if (!name) continue;
    const tps = asString(row['使用する TP-ID']).split(/[\s,、]+/).map(unquote).filter(Boolean);
    registry.set(name, [...(registry.get(name) ?? []), ...tps]);
  }
  return registry;
}

// Mock name -> row with the MOCK_COLUMNS values. Returns null when the heading is missing.
export function parseMockRegistry(text) {
  const rows = registryTable(text, MOCK_HEADING);
  if (!rows) return null;
  const registry = new Map();
  for (const row of rows) {
    const name = unquote(row['モック名']);
    if (!name) continue;
    registry.set(name, Object.fromEntries(MOCK_COLUMNS.map(column => [column, unquote(row[column])])));
  }
  return registry;
}

export function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function readRegistry(repo, root, rel, parse) {
  const path = `${root}/${rel}`;
  const abs = join(repo, path);
  if (!existsSync(abs)) return { path, missing: true };
  return { path, registry: parse(readFileSync(abs, 'utf8')) };
}

// Problems of one registered mock row; `today` (YYYY-MM-DD) rejects verification dates in the future.
export function mockRowProblems(row, today) {
  const problems = [];
  const empty = MOCK_COLUMNS.filter(column => !row[column]);
  if (empty.length) problems.push(`${empty.join('・')} が空です`);
  const date = row['最終確認日'];
  if (date && !validDate(date)) problems.push(`最終確認日 ${date} の形式が不正です（YYYY-MM-DD で書きます）`);
  else if (date && today && date > today) problems.push(`最終確認日 ${date} が将来の日付です（検査日 ${today}）`);
  return problems;
}

// Plan-gate registry check for the TP rows of one change. Integrated `e2e: required` changes fail;
// legacy spec-driven-e2e changes only warn so that their exit code stays the same.
export function checkRegistry(repo, change, rows, { now = Date.now() } = {}) {
  const legacy = change.schema === SCHEMA_E2E;
  const column = legacy ? '前提(fixture)' : 'Fixture';
  const problems = [];
  const used = { fixtures: new Map(), mocks: new Map() };
  for (const row of rows) {
    const tp = row['TP-ID'];
    const cell = asString(row[column]);
    if (!cell) continue;
    const elements = fixtureElements(cell);
    for (const error of elements.errors) problems.push(`${tp} の ${column} 列: ${error}`);
    for (const name of elements.fixtures) used.fixtures.set(name, [...(used.fixtures.get(name) ?? []), tp]);
    for (const name of elements.mocks) used.mocks.set(name, [...(used.mocks.get(name) ?? []), tp]);
  }
  let root = null;
  if (used.fixtures.size || used.mocks.size) {
    try {
      root = installedE2eRoot(repo);
    } catch (err) {
      problems.push(`E2E ルートを特定できないため fixture・モックの登録を検査できません (${err.message})`);
    }
  }
  if (root && used.fixtures.size) {
    const { path, missing, registry } = readRegistry(repo, root, FIXTURE_REGISTRY, parseFixtureRegistry);
    if (missing) problems.push(`${path} がありません。${[...used.fixtures.keys()].join('・')} を登録する README を作成してください`);
    else if (!registry) problems.push(`${path} に ${FIXTURE_HEADING} の表がありません`);
    else {
      for (const [name, tps] of used.fixtures) {
        const listed = registry.get(name);
        for (const tp of tps) {
          const id = qualifiedTp(change.id, tp);
          if (!listed) problems.push(`${tp} の fixture ${name} が ${path} に登録されていません`);
          else if (!listed.includes(id)) {
            const bare = listed.includes(tp) ? `（${tp} は change id を含まないため数えません）` : '';
            problems.push(`${tp} の fixture ${name} は ${path} の「使用する TP-ID」に ${id} がありません。登録行に追記してください${bare}`);
          }
        }
      }
    }
  }
  const mocks = [];
  if (root && used.mocks.size) {
    const { path, missing, registry } = readRegistry(repo, root, MOCK_REGISTRY, parseMockRegistry);
    if (missing) problems.push(`${path} がありません。${[...used.mocks.keys()].join('・')} を登録する README を作成してください`);
    else if (!registry) problems.push(`${path} に ${MOCK_HEADING} の表がありません`);
    else {
      const today = utcDay(now);
      for (const [name, tps] of used.mocks) {
        const row = registry.get(name);
        if (!row) {
          problems.push(`${tps.join('・')} のモック ${name} が ${path} に登録されていません`);
          continue;
        }
        const rowProblems = mockRowProblems(row, today);
        for (const problem of rowProblems) problems.push(`${path} のモック ${name}: ${problem}`);
        if (!rowProblems.length) mocks.push({ name, verified: row['最終確認日'], path });
      }
    }
  }
  const lines = problems.map(problem => `${change.id}: ${problem}`);
  if (legacy) return { errors: [], warnings: lines.map(line => `${line}（旧 spec-driven-e2e のため警告のみ）`), mocks };
  return { errors: lines, warnings: [], mocks };
}

// Final-gate freshness of the mocks a change uses. A stale mock passes only with an approved Residual
// (approver and YYYY-MM-DD date) whose text names the mock.
export function mockFreshnessErrors(mocks, { maxAgeDays, residuals = [], now = Date.now() }) {
  const today = utcDay(now);
  const errors = [];
  for (const mock of mocks) {
    const age = daysBetween(mock.verified, today);
    if (age <= maxAgeDays) continue;
    const accepted = residuals.some(residual => asString(residual.approved_by) && validDate(residual.approved_at)
      && Object.values(residual).some(value => typeof value === 'string' && hasBoundedToken(value, mock.name)));
    if (!accepted) {
      errors.push(`モック ${mock.name} の最終確認日 ${mock.verified} から ${age} 日経過しています（上限 ${maxAgeDays} 日、検査日 ${today}）。実物と照合して最終確認日を更新するか、モック名を含む人間承認済みの Residual を evidence に記録してください`);
    }
  }
  return errors;
}
