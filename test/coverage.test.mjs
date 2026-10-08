import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachResults, buildCoverage, CLASS, listMainScenarios, runCoverage, summarize } from '../payload/scripts/lib/coverage-map.mjs';
import { buildReport } from '../payload/scripts/lib/report.mjs';
import { validateResults } from '../payload/scripts/lib/results.mjs';
import { parseYamlText } from '../payload/scripts/lib/frontmatter.mjs';
import { REQUIRED_MODULES, STAMP_FILE } from '../payload/scripts/lib/critical.mjs';
import { doctor } from '../payload/scripts/lib/doctor.mjs';
import { runCiJob } from '../payload/scripts/ci-job.mjs';
import { selectChanges } from '../payload/scripts/lib/select.mjs';
import { main } from '../lib/cli.mjs';
import { gitRepo, runGate, tempDir, writeDerivedSchema, writeIn } from './support.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/coverage/repo', import.meta.url));
const RESULTS = fileURLToPath(new URL('./fixtures/coverage/regression-results.json', import.meta.url));
const GOLDEN = fileURLToPath(new URL('./fixtures/coverage/golden/', import.meta.url));
const NOW = Date.parse('2026-10-06T00:10:00.000Z');
const results = JSON.parse(readFileSync(RESULTS, 'utf8'));

// Expected classification of every main-spec scenario in the fixture repo, keyed to the spec scenarios.
const EXPECTED = [
  // capability, Requirement, Scenario, 分類, 出所, spec scenario
  ['billing/invoice', 'Invoice listing', 'Empty cart', CLASS.none, null, 'Same scenario name in two capabilities'],
  ['billing/invoice', 'Invoice export', 'Export CSV', CLASS.stale, 'add-invoice TP-001 / change-export', 'Requirement modified after the TP was written'],
  ['billing/invoice', 'Invoice print', 'Print invoice', CLASS.e2e, 'update-print TP-001', 'Requirement modified with a new TP'],
  ['billing/invoice', 'Wishlist', 'Save for later', CLASS.none, null, '対応不明は保護に数えない'],
  ['cart', 'Add item', 'Add one item', CLASS.e2e, 'add-cart TP-001', 'Scenario protected by an archived TP'],
  ['cart', 'Add item', 'Add item when out of stock', CLASS.declared, 'add-cart 対象外', 'Scenario delegated to another layer'],
  ['cart', 'Show total', 'Show subtotal', CLASS.none, '進行中: add-tax', 'Active change is not protection'],
  ['cart', 'Show total', 'Show tax', CLASS.none, '進行中: add-tax', 'Active change is not protection'],
  ['cart', 'Checkout button', 'Empty cart', CLASS.e2e, 'add-cart TP-002', 'Same scenario name in two capabilities'],
  ['cart', 'Discount code', 'Apply coupon', CLASS.none, null, 'Scenario removed or renamed'],
  ['cart', 'Wishlist', 'Save for later', CLASS.none, null, '対応不明は保護に数えない'],
  ['search', 'Search', 'Search by keyword', CLASS.stale, 'legacy-search TP-001 / legacy-qe', 'Legacy plan with a parsable table'],
  ['search', 'Search', 'Search with no results', CLASS.none, null, 'Legacy plan with free text only / 旧 quality-driven は読まない'],
];

function copyFixture() {
  const dir = tempDir('tk-cov-');
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function find(model, capability, requirement, scenario) {
  return model.scenarios.find(row => row.capability === capability && row.requirement === requirement && row.scenario === scenario);
}

function gate(cwd, args) {
  return runGate(cwd, ['coverage', ...args]);
}

const SPEC = (req, scenarios, op = 'ADDED') => `# Spec\n\n## ${op} Requirements\n\n### Requirement: ${req}\nbody\n\n${scenarios.map(name => `#### Scenario: ${name}\n- **WHEN** a\n- **THEN** b\n`).join('\n')}`;
const PLAN = rows => `---\ne2e: required\n---\n## E2E観点一覧\n| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |\n|---|---|---|---|---|---|---|---|\n${rows.map(([id, req, scn]) => `| ${id} | ${req} | ${scn} | R1 | O1 | f | i | e |`).join('\n')}\n`;

test('fixture repo classifies every main scenario as the expected table says', () => {
  const model = buildCoverage(FIXTURE);
  const actual = model.scenarios.map(row => [row.capability, row.requirement, row.scenario, row.classification]);
  assert.deepEqual(actual, EXPECTED.map(row => row.slice(0, 4)));
  const table = runCoverage({ repo: FIXTURE }).stdout.split('\n');
  for (const [capability, requirement, scenario, classification, source] of EXPECTED) {
    const line = table.find(text => text.startsWith(`| ${capability} | ${requirement} | ${scenario} | ${classification} |`));
    assert.ok(line, `${capability} / ${scenario}`);
    for (const part of source ? source.split(' / ') : ['| - |']) assert.ok(line.includes(part), `${scenario}: ${part} in ${line}`);
  }
  const outOfStock = find(model, 'cart', 'Add item', 'Add item when out of stock');
  assert.deepEqual(outOfStock.source.declared, [{ oracle: 'O2', layer: 'Unit', method: 'stock service unit test' }]);
  const csv = find(model, 'billing/invoice', 'Invoice export', 'Export CSV');
  assert.deepEqual(csv.source.tps, ['TP-001']);
  assert.equal(csv.source.change, 'add-invoice');
  assert.equal(csv.source.modifiedBy, 'change-export');
});

test('main spec enumeration keeps nested capability paths and handles zero scenarios', () => {
  const listed = listMainScenarios(FIXTURE);
  assert.deepEqual([...new Set(listed.map(row => row.capability))], ['billing/invoice', 'cart', 'search']);
  assert.equal(listed.length, 13);
  const empty = tempDir('tk-cov-empty-');
  try {
    writeIn(empty, 'openspec/specs/.gitkeep', '');
    assert.deepEqual(listMainScenarios(empty), []);
    writeIn(empty, 'openspec/specs/deep/a/b/spec.md', SPEC('R', ['S'], 'ADDED').replace('## ADDED Requirements', '## Requirements'));
    assert.deepEqual(listMainScenarios(empty), [{ capability: 'deep/a/b', requirement: 'R', scenario: 'S' }]);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('rows bind to the capability of their own delta and undecidable rows are unresolved', () => {
  const model = buildCoverage(FIXTURE);
  assert.equal(find(model, 'cart', 'Checkout button', 'Empty cart').classification, CLASS.e2e);
  assert.equal(find(model, 'billing/invoice', 'Invoice listing', 'Empty cart').classification, CLASS.none);
  assert.deepEqual(model.unresolved.map(row => [row.change, row.id]), [['add-cart', 'TP-004'], ['add-wishlist', 'TP-001']]);
  assert.match(model.unresolved[1].reason, /複数箇所/);
  for (const capability of ['cart', 'billing/invoice']) assert.equal(find(model, capability, 'Wishlist', 'Save for later').classification, CLASS.none);
});

test('modified, removed and renamed requirements become stale or orphaned and never protection', () => {
  const model = buildCoverage(FIXTURE);
  assert.equal(find(model, 'billing/invoice', 'Invoice export', 'Export CSV').classification, CLASS.stale);
  const print = find(model, 'billing/invoice', 'Invoice print', 'Print invoice');
  assert.equal(print.classification, CLASS.e2e);
  assert.equal(print.source.change, 'update-print');
  assert.deepEqual(model.orphans.map(row => [row.change, row.id, row.reason]), [
    ['add-cart', 'TP-003', 'RENAMED → Discount code（rename-coupon）'],
    ['add-invoice', 'TP-003', 'REMOVED（drop-email）'],
  ]);
  assert.equal(find(model, 'cart', 'Discount code', 'Apply coupon').classification, CLASS.none);
  const summary = summarize(model);
  assert.equal(summary[CLASS.e2e], 3);
  assert.equal(summary.coverageE2E.count, 3);
  assert.equal(summary.coverageWithDeclared.count, 4);
});

test('the latest archive wins even on the same date and an older TP is not stale after a new one', () => {
  const dir = tempDir('tk-cov-order-');
  try {
    writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('R', ['S'], 'ADDED').replace('## ADDED Requirements', '## Requirements'));
    writeIn(dir, 'openspec/changes/archive/2026-01-01-a/.openspec.yaml', 'schema: quality-driven-e2e\n');
    writeIn(dir, 'openspec/changes/archive/2026-01-01-a/specs/cap/spec.md', SPEC('R', ['S']));
    writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S']]));
    writeIn(dir, 'openspec/changes/archive/2026-01-01-b/.openspec.yaml', 'schema: quality-driven-e2e\n');
    writeIn(dir, 'openspec/changes/archive/2026-01-01-b/specs/cap/spec.md', SPEC('R', ['S'], 'MODIFIED'));
    writeIn(dir, 'openspec/changes/archive/2026-01-01-b/test-plan.md', PLAN([]));
    assert.equal(buildCoverage(dir).scenarios[0].classification, CLASS.stale);
    writeIn(dir, 'openspec/changes/archive/2026-01-02-c/.openspec.yaml', 'schema: quality-driven-e2e\n');
    writeIn(dir, 'openspec/changes/archive/2026-01-02-c/specs/cap/spec.md', SPEC('R', ['S'], 'MODIFIED'));
    writeIn(dir, 'openspec/changes/archive/2026-01-02-c/test-plan.md', PLAN([['TP-007', 'R', 'S']]));
    const row = buildCoverage(dir).scenarios[0];
    assert.equal(row.classification, CLASS.e2e);
    assert.deepEqual(row.source.tps, ['TP-007']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy spec-driven-e2e tables count, free-text TP-IDs and quality-driven plans do not', () => {
  const model = buildCoverage(FIXTURE);
  assert.equal(find(model, 'search', 'Search', 'Search by keyword').classification, CLASS.stale);
  assert.equal(find(model, 'search', 'Search', 'Search with no results').classification, CLASS.none);
  assert.deepEqual(model.legacyUnresolved.map(row => [row.change, row.id]), [['legacy-search', 'TP-002']]);
  assert.equal(model.unresolved.some(row => row.change === 'legacy-qe'), false);
  assert.equal(model.orphans.some(row => row.change === 'legacy-qe'), false);
});

test('results join on change id and TP-ID; fail and not-run are not confirmed', () => {
  const model = attachResults(buildCoverage(FIXTURE), results);
  const result = (cap, req, scn) => find(model, cap, req, scn).result;
  assert.equal(result('cart', 'Add item', 'Add one item').bucket, 'pass');
  assert.equal(result('cart', 'Checkout button', 'Empty cart').bucket, 'fail');
  const print = result('billing/invoice', 'Invoice print', 'Print invoice');
  assert.equal(print.bucket, 'pass');
  assert.equal(print.flaky, true);
  // other-change has TP-001, but legacy-search TP-001 itself never ran.
  assert.equal(result('search', 'Search', 'Search by keyword').bucket, '未実行');
  const summary = summarize(model);
  assert.equal(summary['実行で確認済み'], 2);
  assert.equal(summary.fail, 1);
  assert.equal(summary['未実行'], 0);
  assert.equal(summary.coverageConfirmed.count, 2);
});

test('a TP without any attempt is not run even when the spec is listed', () => {
  const model = attachResults(buildCoverage(FIXTURE), {
    suites: [{ title: 'x', specs: [{ title: 'zero', tags: ['add-cart', 'TP-001'], tests: [{ results: [] }] }] }],
  });
  assert.equal(find(model, 'cart', 'Add item', 'Add one item').result.bucket, '未実行');
});

test('coverage CLI: default 0, strict 1, broken or stale results 2', () => {
  const dir = copyFixture();
  try {
    const plain = gate(dir, []);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /\| cart \| Show total \| Show subtotal \| 未保護 \|/);
    assert.match(plain.stdout, /## 集計/);

    const strict = gate(dir, ['--strict']);
    assert.equal(strict.status, 1);

    const json = gate(dir, ['--format', 'json', '--results', RESULTS]);
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).summary['実行で確認済み'], 2);

    const missing = gate(dir, ['--results', join(dir, 'nope.json')]);
    assert.equal(missing.status, 2);
    assert.equal(missing.stdout, '');
    writeIn(dir, 'bad.json', '{not json');
    const malformed = gate(dir, ['--results', 'bad.json']);
    assert.equal(malformed.status, 2);
    assert.equal(malformed.stdout, '');
    const old = gate(dir, ['--results', RESULTS, '--max-age', '60']);
    assert.equal(old.status, 2);
    assert.equal(old.stdout, '');
    assert.match(old.stderr, /--max-age 60/);
    writeIn(dir, 'nostart.json', '{"suites":[]}');
    assert.equal(gate(dir, ['--results', 'nostart.json', '--max-age', '60']).status, 2);

    for (const args of [['--format', 'html'], ['--max-age', '5'], ['--results'], ['--bogus']]) {
      assert.equal(gate(dir, args).status, 2, args.join(' '));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strict mode fails on a single stale scenario and lists it; a fully protected repo passes', () => {
  const dir = tempDir('tk-cov-strict-');
  try {
    writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('R', ['S'], 'ADDED').replace('## ADDED Requirements', '## Requirements'));
    writeIn(dir, 'openspec/changes/archive/2026-01-01-a/.openspec.yaml', 'schema: quality-driven-e2e\n');
    writeIn(dir, 'openspec/changes/archive/2026-01-01-a/specs/cap/spec.md', SPEC('R', ['S']));
    writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S']]));
    assert.equal(gate(dir, ['--strict']).status, 0);
    writeIn(dir, 'openspec/changes/archive/2026-02-01-b/.openspec.yaml', 'schema: quality-driven-e2e\n');
    writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', SPEC('R', ['S'], 'MODIFIED'));
    const stale = gate(dir, ['--strict']);
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /\| cap \| R \| S \| 要再確認 \| a TP-001 ／ b で MODIFIED \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('coverage output matches the golden files, including the empty repository', () => {
  const golden = name => readFileSync(join(GOLDEN, name), 'utf8');
  assert.equal(runCoverage({ repo: FIXTURE }).stdout, golden('map.md'));
  const withResults = runCoverage({ repo: FIXTURE, resultsPath: RESULTS, maxAge: 3600, now: NOW });
  assert.equal(withResults.stdout, golden('map-results.md'));
  assert.equal(runCoverage({ repo: FIXTURE, resultsPath: RESULTS, now: NOW, format: 'json' }).stdout, golden('map-results.json'));
  const empty = tempDir('tk-cov-empty-');
  try {
    writeIn(empty, 'openspec/specs/.gitkeep', '');
    const out = runCoverage({ repo: empty, strict: true });
    assert.equal(out.exitCode, 0);
    assert.equal(out.stdout, golden('empty.md'));
    assert.doesNotMatch(out.stdout, /100%/);
    assert.equal(JSON.parse(runCoverage({ repo: empty, format: 'json' }).stdout).summary.coverageE2E, null);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

function ciRepo() {
  const repo = gitRepo();
  cpSync(FIXTURE, repo.dir, { recursive: true });
  repo.commit('fixture');
  return repo;
}

function ciEnv(over = {}) {
  return { WORKING_DIRECTORY: '.', BASE_REF: 'HEAD', SETUP_MODE: 'caller', TEST_COMMAND: 'echo test', GATE_PHASE: 'plan', ...over };
}

function regressionExec(calls, { writeJson = true, status = 0, json = results } = {}) {
  return (file, args, opts) => {
    const command = args.join(' ');
    calls.push(command);
    if (command.includes('run-regression')) {
      if (writeJson) writeFileSync(opts.env.TESTKIT_RESULTS_JSON, JSON.stringify({ ...json, stats: { startTime: new Date().toISOString() } }));
      if (status) {
        const error = new Error('regression failed');
        error.status = status;
        throw error;
      }
    }
    return '';
  };
}

test('ci job runs the regression command without change diffs and keeps the map when it fails', async () => {
  const repo = ciRepo();
  try {
    const calls = [];
    const ran = await runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', COVERAGE_STRICT: 'false' }), { cwd: repo.dir, execFile: regressionExec(calls) });
    assert.equal(ran.code, 0, ran.lines.join('\n'));
    assert.ok(calls.includes('-c run-regression'));
    assert.ok(existsSync(join(ran.runDir, 'regression-results.json')));
    assert.match(readFileSync(join(ran.runDir, 'coverage.md'), 'utf8'), /保護率（実行で確認済み）: 2\/13/);
    assert.equal(JSON.parse(readFileSync(join(ran.runDir, 'coverage.json'), 'utf8')).summary.fail, 1);

    const strict = await runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', COVERAGE_STRICT: 'true' }), { cwd: repo.dir, execFile: regressionExec([]) });
    assert.equal(strict.code, 1);
    assert.match(strict.lines.join('\n'), /coverage-strict/);

    const failed = await runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression' }), { cwd: repo.dir, execFile: regressionExec([], { status: 1 }) });
    assert.equal(failed.code, 1);
    assert.match(readFileSync(join(failed.runDir, 'coverage.md'), 'utf8'), /# シナリオ対応表/);

    const noJson = await runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression' }), { cwd: repo.dir, execFile: regressionExec([], { writeJson: false }) });
    assert.equal(noJson.code, 2);
    assert.doesNotMatch(readFileSync(join(noJson.runDir, 'coverage.md'), 'utf8'), /# シナリオ対応表/);
  } finally {
    repo.cleanup();
  }
});

test('ci job without regression inputs keeps the same commands and output', async () => {
  const repo = ciRepo();
  try {
    const before = [];
    const absent = await runCiJob(ciEnv(), { cwd: repo.dir, execFile: regressionExec(before) });
    const after = [];
    const empty = await runCiJob(ciEnv({ REGRESSION_COMMAND: '', COVERAGE_STRICT: 'false' }), { cwd: repo.dir, execFile: regressionExec(after) });
    assert.equal(absent.code, 0, absent.lines.join('\n'));
    assert.equal(empty.code, absent.code);
    assert.deepEqual(after, before);
    assert.deepEqual(empty.lines, absent.lines);
    assert.equal(empty.lines.some(line => line.includes('シナリオ対応表')), false);
    assert.equal(empty.runDir && existsSync(join(empty.runDir, 'coverage.md')), false);
  } finally {
    repo.cleanup();
  }
});

test('doctor reports an older install without the coverage modules as incomplete', async () => {
  const repo = gitRepo();
  try {
    const quiet = { log: () => {}, error: () => {}, stdin: { isTTY: false } };
    assert.equal(await main(['install', '--force', '--target', repo.dir], quiet), 0);
    for (const rel of REQUIRED_MODULES) assert.ok(existsSync(join(repo.dir, rel)), rel);
    assert.equal(doctor(repo.dir).ok, true, doctor(repo.dir).failures.join('\n'));
    const stampPath = join(repo.dir, STAMP_FILE);
    const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
    for (const rel of REQUIRED_MODULES) delete stamp.files[rel];
    writeFileSync(stampPath, JSON.stringify(stamp, null, 2));
    const old = doctor(repo.dir);
    assert.equal(old.ok, false);
    assert.match(old.failures.join('\n'), /scripts\/lib\/coverage-map\.mjs/);
    assert.match(old.failures.join('\n'), /scripts\/lib\/e2e-lint\.mjs/);
    assert.match(old.failures.join('\n'), /必須 module が導入記録にありません（旧版のままです）: scripts\/lib\/schema-family\.mjs。install を再実行してください/);
    assert.equal(await main(['install', '--force', '--target', repo.dir], quiet), 0);
    assert.equal(doctor(repo.dir).ok, true);
  } finally {
    repo.cleanup();
  }
});

function protectedRepo(t, scenarios = ['S']) {
  const dir = tempDir('tk-cov-review-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('R', scenarios).replace('ADDED Requirements', 'Requirements'));
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/.openspec.yaml', 'schema: quality-driven-e2e\n');
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/specs/cap/spec.md', SPEC('R', scenarios));
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN(scenarios.map((s, i) => [`TP-00${i + 1}`, 'R', s])));
  return dir;
}

const resultFor = tests => ({ suites: [{ specs: [{ title: '@a @TP-001', tests }] }] });
const passed = { projectName: 'chromium', status: 'expected', results: [{ status: 'passed' }] };

test('strict independently rejects orphan, fail, skip and missing execution; mixed browsers fail', async t => {
  for (const [name, data, expected, status] of [
    ['pass', resultFor([passed]), null, 0],
    ['fail', resultFor([{ status: 'unexpected', results: [{ status: 'failed' }] }]), 'fail', 1],
    ['missing', { suites: [] }, '未実行', 1],
    ['skip', resultFor([{ status: 'skipped', results: [{ status: 'skipped' }] }]), '未実行', 1],
    ['mixed browsers', resultFor([passed, { projectName: 'firefox', status: 'unexpected', results: [{ status: 'failed' }] }]), 'fail', 1],
    ['expected failure', resultFor([{ status: 'expected', expectedStatus: 'failed', results: [{ status: 'failed' }] }]), 'fail', 1],
  ]) await t.test(name, t => {
    const dir = protectedRepo(t);
    writeIn(dir, 'results.json', JSON.stringify(data));
    const out = gate(dir, ['--strict', '--results', 'results.json', '--format', 'json']);
    assert.equal(out.status, status, out.stderr);
    const { summary } = JSON.parse(out.stdout);
    assert.equal(summary.needsAction, status);
    if (expected) assert.equal(summary[expected], 1);
  });
  await t.test('orphan only', t => {
    const dir = protectedRepo(t);
    writeIn(dir, 'openspec/specs/cap/spec.md', '# Empty\n');
    const out = gate(dir, ['--strict', '--format', 'json']);
    assert.equal(out.status, 1, out.stderr);
    const { summary } = JSON.parse(out.stdout);
    assert.equal(summary.needsAction, 1);
    assert.equal(summary['孤立'], 1);
    assert.equal(summary[CLASS.none], 0);
  });
});

test('a modified requirement with partial new coverage only refreshes the mapped scenario', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', SPEC('R', ['S', 'T'], 'MODIFIED'));
  writeIn(dir, 'openspec/changes/archive/2026-02-01-b/test-plan.md', PLAN([['TP-001', 'R', 'S']]));
  const model = buildCoverage(dir);
  assert.deepEqual(model.scenarios.map(row => [row.scenario, row.classification, row.source.change]), [['S', CLASS.e2e, 'b'], ['T', CLASS.stale, 'a']]);
});

test('quality-driven deltas still record removed requirements without reading their plans', t => {
  const dir = protectedRepo(t);
  writeIn(dir, 'openspec/specs/cap/spec.md', '# Empty\n');
  writeIn(dir, 'openspec/changes/archive/2026-02-01-b/.openspec.yaml', 'schema: quality-driven\n');
  writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', SPEC('R', ['S'], 'REMOVED'));
  assert.equal(buildCoverage(dir).orphans[0].reason, 'REMOVED（b）');
  assert.equal(buildCoverage(dir).unresolved.length, 0);
});

test('invalid result structures and global errors return 2 through CLI and shared reporter', t => {
  const dir = protectedRepo(t);
  for (const data of [
    { foo: 1 }, { suites: {} }, { suites: [null] }, { suites: [{ suites: 'bad' }] },
    { suites: [{ specs: [null] }] }, { suites: [{ specs: [{ tests: {} }] }] },
    resultFor([null]), resultFor([{ results: [null] }]), resultFor([{ results: {} }]),
    { suites: [{ specs: [{ tags: '@a @TP-001' }] }] },
    { suites: [], errors: [{ message: 'global setup failed' }] }, { suites: [], stats: null },
    { suites: [], stats: { startTime: { toString: 0 } } }, { suites: [], stats: { duration: {} } },
  ]) {
    writeIn(dir, 'results.json', JSON.stringify(data));
    const out = gate(dir, ['--strict', '--results', 'results.json']);
    assert.equal(out.status, 2, JSON.stringify(data));
    assert.equal(out.stdout, '');
    assert.match(out.stderr, /Playwright JSON が不正/);
    assert.equal(buildReport({ changeId: 'a', planText: PLAN([['TP-001', 'R', 'S']]), results: data }).exitCode, 2);
  }
});

test('invalid delta headings, YAML and incomplete rename pairs cannot silently retain protection', t => {
  const dir = protectedRepo(t);
  for (const op of ['MODIFED', 'Modified']) {
    writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', SPEC('R', ['S'], op));
    const out = runCoverage({ repo: dir, strict: true });
    assert.equal(out.exitCode, 2);
    assert.match(out.stderr, /操作見出し/);
  }
  for (const delta of ['## RENAMED Requirements\n- FROM: Requirement: R\n', '## RENAMED Requirements\n- TO: Requirement: R\n', '```\nunclosed']) {
    writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', delta);
    assert.equal(runCoverage({ repo: dir }).exitCode, 2);
  }
  writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', SPEC('R', ['S'], 'MODIFIED'));
  for (const yaml of ['schema: [broken', 'schema: [quality-driven]', '- quality-driven']) {
    writeIn(dir, 'openspec/changes/archive/2026-02-01-b/.openspec.yaml', yaml);
    const out = runCoverage({ repo: dir });
    assert.equal(out.exitCode, 2);
    assert.match(out.stderr, /\.openspec.yaml が不正/);
  }
});

test('stale diagnostics name the actual operation and archive ordering requires dated folders', t => {
  const dir = protectedRepo(t);
  for (const [delta, operation] of [[SPEC('R', ['S']), 'ADDED'], ['## RENAMED Requirements\n- FROM: Requirement: Old\n- TO: Requirement: R\n', 'RENAMED']]) {
    writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', delta);
    assert.match(runCoverage({ repo: dir }).stdout, new RegExp(`b で ${operation}`));
  }
  writeIn(dir, 'openspec/changes/archive/undated/test-plan.md', PLAN([]));
  const out = runCoverage({ repo: dir });
  assert.equal(out.exitCode, 2);
  assert.match(out.stderr, /YYYY-MM-DD-<id>/);
});

test('unparsable and missing plans are diagnosed and legacy blank scenarios count once', t => {
  const dir = protectedRepo(t);
  const rel = 'openspec/changes/archive/2026-01-01-a/test-plan.md';
  for (const text of [PLAN([['TP-001', 'R', 'S']]).replace('TP-ID', 'TP ID'), PLAN([['TP-001', 'R', 'S']]).replace('E2E観点一覧', 'E2E 観点一覧')]) {
    writeIn(dir, rel, text);
    const model = buildCoverage(dir);
    assert.equal(model.unresolved.length, 1);
    assert.match(model.unresolved[0].reason, /解析できません/);
    assert.equal(model.scenarios[0].classification, CLASS.none);
  }
  rmSync(join(dir, rel));
  assert.match(buildCoverage(dir).unresolved[0].reason, /test-plan.md がありません/);
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/.openspec.yaml', 'schema: spec-driven-e2e\n');
  writeIn(dir, rel, PLAN([['TP-001', 'R', '']]));
  assert.deepEqual(buildCoverage(dir).legacyUnresolved.map(row => [row.id, row.reason]), [['TP-001', 'シナリオ名がありません']]);
});

test('CI saves invalid JSON diagnostics, summary and risk output even after a failed command', t => {
  const repo = ciRepo();
  t.after(() => repo.cleanup());
  for (const status of [0, 1]) {
    const output = join(repo.dir, 'github-output');
    const ran = runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', GITHUB_OUTPUT: output }), { cwd: repo.dir, execFile: regressionExec([], { json: { suites: [null] }, status }) });
    assert.equal(ran.code, status || 2);
    assert.match(readFileSync(join(ran.runDir, 'coverage.md'), 'utf8'), /suites\[0\]/);
    assert.match(readFileSync(join(ran.summaryDir, 'summary.txt'), 'utf8'), /suites\[0\]/);
    assert.match(readFileSync(output, 'utf8'), /risk_level=none/);
  }
  for (const strict of ['true', '1']) {
    const ran = runCiJob(ciEnv({ COVERAGE_STRICT: strict }), { cwd: repo.dir, execFile: regressionExec([]) });
    assert.equal(ran.code, 1);
    assert.match(ran.lines.join('\n'), /fail・未実行は判定しません/);
  }
});

test('workflow passes regression inputs unchanged to the CI environment', () => {
  const workflow = parseYamlText(readFileSync(new URL('../.github/workflows/openspec-custom-testkit-gate.yml', import.meta.url), 'utf8')).data;
  const inputs = workflow.on.workflow_call.inputs;
  assert.deepEqual([inputs['regression-command'].type, inputs['regression-command'].default], ['string', '']);
  assert.deepEqual([inputs['coverage-strict'].type, inputs['coverage-strict'].default], ['boolean', false]);
  const job = workflow.jobs.gate.steps.find(step => step.id === 'job');
  assert.equal(job.env.REGRESSION_COMMAND, '${{ inputs.regression-command }}');
  assert.equal(job.env.COVERAGE_STRICT, '${{ inputs.coverage-strict }}');
});

test('the documented coverage example is what the fixture actually prints', () => {
  const doc = readFileSync(new URL('../docs/workflow.md', import.meta.url), 'utf8');
  const block = doc.match(/<!-- coverage-example:start -->\n```text\n([\s\S]*?)```\n<!-- coverage-example:end -->/);
  assert.ok(block, 'docs/workflow.md の coverage-example');
  const dir = copyFixture();
  try {
    const out = gate(dir, ['--results', RESULTS]);
    assert.equal(out.status, 0, out.stderr);
    const printed = out.stdout.split('\n');
    for (const line of block[1].trimEnd().split('\n')) assert.ok(printed.includes(line), line);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only E2E schemas require a plan; all schema deltas still invalidate old mappings', t => {
  const dir = protectedRepo(t);
  const archive = 'openspec/changes/archive/2026-02-01-b';
  writeIn(dir, `${archive}/specs/cap/spec.md`, SPEC('R', ['S'], 'MODIFIED'));
  for (const schema of ['spec-driven', 'quality-driven', 'quality-driven-e2e', 'spec-driven-e2e']) {
    writeIn(dir, `${archive}/.openspec.yaml`, `schema: ${schema}\n`);
    const model = buildCoverage(dir);
    assert.equal(model.scenarios[0].classification, CLASS.stale, schema);
    assert.equal(model.unresolved.length + model.legacyUnresolved.length, schema.endsWith('-e2e') ? 1 : 0, schema);
  }
  rmSync(join(dir, archive, '.openspec.yaml'));
  assert.equal(buildCoverage(dir).unresolved.length, 0);
});

test('invalid WIP changes warn independently while valid active notes and archive protection survive', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  for (const [id, rel, text] of [
    ['bad-heading', 'specs/cap/spec.md', SPEC('R', ['S'], 'Modified')],
    ['empty-yaml', '.openspec.yaml', ''],
    ['open-fence', 'specs/cap/spec.md', '```\nunclosed'],
  ]) writeIn(dir, `openspec/changes/${id}/${rel}`, text);
  writeIn(dir, 'openspec/changes/good/specs/cap/spec.md', SPEC('R', ['S'], 'MODIFIED'));
  writeIn(dir, 'openspec/changes/good/test-plan.md', PLAN([['TP-001', 'R', 'S']]));
  const out = runCoverage({ repo: dir, strict: true });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.equal(out.model.warnings.length, 3);
  assert.deepEqual(out.model.scenarios.map(row => row.classification), [CLASS.e2e, CLASS.e2e]);
  assert.deepEqual(out.model.scenarios[0].active, ['good']);
  for (const id of ['bad-heading', 'empty-yaml', 'open-fence']) {
    assert.ok(out.stderr.includes(id));
    assert.ok(out.stdout.includes(id));
  }
  assert.deepEqual(JSON.parse(runCoverage({ repo: dir, format: 'json' }).stdout).warnings, out.model.warnings);
});

test('CI keeps running regression with malformed WIP and logs spec input errors neutrally', t => {
  const repo = ciRepo();
  t.after(() => repo.cleanup());
  writeIn(repo.dir, 'openspec/changes/wip/.openspec.yaml', '');
  const env = ciEnv({ REGRESSION_COMMAND: 'run-regression', COVERAGE_STRICT: 'false' });
  const calls = [];
  const ran = runCiJob(env, { cwd: repo.dir, execFile: regressionExec(calls) });
  assert.ok(calls.includes('-c run-regression'));
  assert.equal(ran.code, 0, ran.lines.join('\n'));
  assert.match(readFileSync(join(ran.summaryDir, 'summary.txt'), 'utf8'), /進行中の change wip を注記から除外/);
  writeIn(repo.dir, 'openspec/specs/broken/spec.md', '### requirement: R\n');
  const bad = runCiJob(env, { cwd: repo.dir, execFile: regressionExec([]) });
  assert.equal(bad.code, 2);
  assert.match(bad.lines.join('\n'), /入力エラー（詳細は上記）/);
  assert.match(bad.lines.join('\n'), /broken\/spec.md/);
  assert.doesNotMatch(bad.lines.join('\n'), /回帰結果 JSON を確認/);
});

test('malformed TP IDs and delegated rows cannot silently disappear or gain protection', t => {
  const dir = protectedRepo(t);
  const plan = 'openspec/changes/archive/2026-01-01-a/test-plan.md';
  for (const schema of ['quality-driven-e2e', 'spec-driven-e2e']) {
    writeIn(dir, 'openspec/changes/archive/2026-01-01-a/.openspec.yaml', `schema: ${schema}\n`);
    for (const id of ['TP-01', 'TP-0001', 'tp-001']) {
      writeIn(dir, plan, PLAN([[id, 'R', 'S']]));
      const model = buildCoverage(dir);
      const rows = [...model.unresolved, ...model.legacyUnresolved];
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, id);
      assert.match(rows[0].reason, /TP-ID が不正/);
      assert.equal(model.scenarios[0].classification, CLASS.none);
    }
  }
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/.openspec.yaml', 'schema: quality-driven-e2e\n');
  for (const header of ['Scenario', '対応シナリオ']) {
    const delegated = scenario => `${PLAN([])}\n## 対象外シナリオ\n| Requirement | ${header} | Oracle | Layer | Method |\n|---|---|---|---|---|\n| R | ${scenario} | O1 | Unit | unit test |\n`;
    writeIn(dir, plan, delegated('S'));
    assert.equal(buildCoverage(dir).scenarios[0].classification, CLASS.declared);
    for (const scenario of ['', '...']) {
      writeIn(dir, plan, delegated(scenario));
      const model = buildCoverage(dir);
      assert.equal(model.unresolved.length, 1);
      assert.match(model.unresolved[0].reason, /シナリオ名がありません/);
      assert.equal(model.scenarios[0].classification, CLASS.none);
    }
  }
});

test('malformed spec headings and case-only MODIFIED names fail with paths instead of overclaiming coverage', t => {
  const dir = protectedRepo(t);
  for (const spec of [
    SPEC('R', ['S']).replace('#### Scenario: S', '#### Scenario S'),
    SPEC('R', ['S']).replace('### Requirement:', '### requirement:'),
    SPEC('R', ['S']).replace('### Requirement: R', '### Requirement:'),
    SPEC('R', ['S']).replace('### Requirement:', '## Requirement:'),
    SPEC('R', ['S']).replace('#### Scenario:', '### Scenario:'),
    SPEC('R', ['S']) + '\n#### Requirement R2\n#### Scenario: S2\n',
    SPEC('R', ['S']) + '\n##### Scenario S3\n',
    SPEC('R', ['S']).replace('### Requirement:', '###Requirement:'),
    SPEC('R', ['S']) + '\n###Requirement: R2\n#### Scenario: S2\n',
    SPEC('R', ['S']).replace('#### Scenario:', '## Scenario:'),
    SPEC('R', ['S']).replace('#### Scenario:', '#### Scenaro:'),
    SPEC('R', ['S']) + '\n#Requirement: R2\n',
    SPEC('R', ['S']) + '\n###\u3000Requirement: R2\n#### Scenario: S2\n',
    SPEC('R', ['S']) + '\n###\u00a0Requirement: R2\n#### Scenario: S2\n',
    SPEC('R', ['S']).replace('#### Scenario:', '####\u3000Scenario:'),
    SPEC('R', ['S']).replace('#### Scenario:', '####\u00a0Scenario:'),
  ]) {
    writeIn(dir, 'openspec/specs/cap/spec.md', spec);
    const out = runCoverage({ repo: dir });
    assert.equal(out.exitCode, 2);
    assert.match(out.stderr, /openspec\/specs\/cap\/spec.md.*見出し/);
  }
  writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('R', ['S']));
  writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', SPEC('r', ['S'], 'MODIFIED'));
  const out = runCoverage({ repo: dir });
  assert.equal(out.exitCode, 2);
  assert.match(out.stderr, /2026-02-01-b.*大小文字/);
});

test('worst result wins regardless of project order and across every TP of a scenario', t => {
  const dir = protectedRepo(t);
  const failed = { projectName: 'firefox', status: 'unexpected', results: [{ status: 'failed' }] };
  const skipped = { status: 'skipped', results: [{ status: 'skipped' }] };
  for (const tests of [[failed, passed], [passed, failed]]) {
    const model = attachResults(buildCoverage(dir), resultFor(tests));
    assert.equal(model.scenarios[0].result.bucket, 'fail');
    assert.equal(summarize(model).needsAction, 1);
  }
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S'], ['TP-002', 'R', 'S']]));
  for (const [first, second, expected] of [
    [passed, failed, 'fail'], [failed, passed, 'fail'],
    [passed, skipped, '未実行'], [skipped, passed, '未実行'],
    [skipped, failed, 'fail'], [failed, skipped, 'fail'], [passed, passed, 'pass'],
  ]) {
    const model = attachResults(buildCoverage(dir), { suites: [{ specs: [
      { title: '@a @TP-001', tests: [first] }, { title: '@a @TP-002', tests: [second] },
    ] }] });
    assert.equal(model.scenarios[0].result.bucket, expected);
    assert.equal(model.scenarios[0].result.tps.length, 2);
    const summary = summarize(model);
    assert.equal(summary['実行で確認済み'], expected === 'pass' ? 1 : 0);
    assert.equal(summary.needsAction, expected === 'pass' ? 0 : 1);
  }
});

test('unknown schemas warn and skip plans while their deltas still invalidate protection', t => {
  const dir = protectedRepo(t);
  const archive = 'openspec/changes/archive/2026-02-01-b';
  writeIn(dir, `${archive}/.openspec.yaml`, 'schema: quality-drivn\n');
  writeIn(dir, `${archive}/specs/cap/spec.md`, SPEC('R', ['S'], 'MODIFIED'));
  writeIn(dir, `${archive}/test-plan.md`, PLAN([['TP-001', 'R', 'S']]));
  const out = runCoverage({ repo: dir });
  assert.equal(out.exitCode, 0);
  assert.equal(out.model.scenarios[0].classification, CLASS.stale);
  assert.match(out.stderr, /未対応の schema quality-drivn/);
});

test('strict boolean values are explicit and false does not enable strict', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S']]));
  assert.equal(gate(dir, ['--strict=false']).status, 0);
  assert.equal(gate(dir, ['--strict=true']).status, 1);
  assert.equal(gate(dir, ['--strict=bogus']).status, 2);
});

test('result validation does not disguise unexpected internal exceptions as malformed JSON', () => {
  const bug = new Error('unexpected internal failure');
  const data = { get suites() { throw bug; } };
  assert.throws(() => validateResults(data), err => err === bug);
  assert.match(validateResults({ suites: [null] }), /suites\[0\].*object/);
});

test('CI preserves summary and risk output if either coverage artifact cannot be written', t => {
  const repo = ciRepo();
  t.after(() => repo.cleanup());
  for (const filename of ['coverage.md', 'coverage.json']) {
    const output = join(repo.dir, 'github-output');
    const exec = regressionExec([]);
    const ran = runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', GITHUB_OUTPUT: output }), {
      cwd: repo.dir,
      execFile(file, args, opts) {
        const result = exec(file, args, opts);
        if (args.includes('run-regression')) mkdirSync(join(opts.env.TESTKIT_RUN_DIR, '..', filename));
        return result;
      },
    });
    assert.equal(ran.code, 2);
    assert.match(readFileSync(join(ran.summaryDir, 'summary.txt'), 'utf8'), /シナリオ対応表を保存できません.*EISDIR/);
    assert.match(readFileSync(output, 'utf8'), /risk_level=none/);
  }
});

test('CI includes invalid E2E JSON reasons in its summary log', t => {
  const repo = ciRepo();
  t.after(() => repo.cleanup());
  writeIn(repo.dir, 'openspec/changes/e2e/.openspec.yaml', 'schema: quality-driven-e2e\n');
  writeIn(repo.dir, 'openspec/changes/e2e/test-plan.md', PLAN([['TP-001', 'R', 'S']]));
  repo.commit('active E2E');
  const ran = runCiJob(ciEnv({ BASE_REF: 'HEAD~1', E2E_COMMAND: 'run-e2e' }), {
    cwd: repo.dir,
    execFile(file, args, opts) {
      if (args.includes('run-e2e')) writeFileSync(opts.env.TESTKIT_RESULTS_JSON, JSON.stringify({ suites: [], errors: [{ message: 'global setup failed' }] }));
      return '';
    },
    evaluateChange: () => ({ phase: 'plan', warnings: [], failures: [] }),
  });
  assert.equal(ran.code, 2, ran.lines.join('\n'));
  assert.match(readFileSync(join(ran.summaryDir, 'summary.txt'), 'utf8'), /Playwright JSON が不正.*global setup failed/);
});


test('archive name checks follow history rather than future main or archive names', t => {
  const dir = protectedRepo(t);
  const archive = 'openspec/changes/archive';
  writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('Login', ['S']));
  writeIn(dir, `${archive}/2026-01-01-a/specs/cap/spec.md`, SPEC('login', ['S'], 'MODIFIED'));
  writeIn(dir, `${archive}/2026-01-01-a/test-plan.md`, PLAN([['TP-001', 'login', 'S']]));
  writeIn(dir, `${archive}/2026-02-01-b/specs/cap/spec.md`, SPEC('login', [], 'REMOVED'));
  writeIn(dir, `${archive}/2026-03-01-c/specs/cap/spec.md`, SPEC('Login', ['S']));
  writeIn(dir, `${archive}/2026-03-01-c/test-plan.md`, PLAN([['TP-001', 'Login', 'S']]));
  writeIn(dir, `${archive}/2026-04-01-d/specs/cap/spec.md`, SPEC('Login', ['S'], 'MODIFIED'));
  const out = runCoverage({ repo: dir });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.equal(out.model.scenarios[0].classification, CLASS.stale);
  assert.equal(out.model.scenarios[0].source.modifiedBy, 'd');
  assert.equal(out.model.orphans[0].reason, 'REMOVED（b）');
  assert.deepEqual(out.model.warnings, []);
  writeIn(dir, `${archive}/2026-04-01-d/specs/cap/spec.md`, SPEC('login', ['S'], 'MODIFIED'));
  const typo = runCoverage({ repo: dir });
  assert.equal(typo.exitCode, 2);
  assert.match(typo.stderr, /2026-04-01-d.*大小文字/);
});

test('archive names added and renamed earlier remain case-sensitive for later modifications', t => {
  const dir = protectedRepo(t);
  const archive = 'openspec/changes/archive';
  writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('Renamed', ['S']));
  writeIn(dir, `${archive}/2026-02-01-b/specs/cap/spec.md`, '## RENAMED Requirements\n- FROM: Requirement: R\n- TO: Requirement: Renamed\n');
  writeIn(dir, `${archive}/2026-03-01-c/specs/cap/spec.md`, SPEC('Renamed', ['S'], 'MODIFIED'));
  assert.equal(runCoverage({ repo: dir }).exitCode, 0);
  writeIn(dir, `${archive}/2026-03-01-c/specs/cap/spec.md`, SPEC('renamed', ['S'], 'MODIFIED'));
  const bad = runCoverage({ repo: dir });
  assert.equal(bad.exitCode, 2);
  assert.match(bad.stderr, /2026-03-01-c.*renamed \/ Renamed/);
});

test('a case-only MODIFIED typo in WIP warns and does not hide valid active notes', t => {
  const dir = protectedRepo(t);
  for (const [id, req] of [['bad-case', 'r'], ['good', 'R']]) {
    writeIn(dir, `openspec/changes/${id}/specs/cap/spec.md`, SPEC(req, ['S'], 'MODIFIED'));
    writeIn(dir, `openspec/changes/${id}/test-plan.md`, PLAN([['TP-001', req, 'S']]));
  }
  const out = runCoverage({ repo: dir, strict: true });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.deepEqual(out.model.scenarios[0].active, ['good']);
  assert.equal(out.model.warnings.length, 1);
  assert.match(out.stderr, /bad-case.*大小文字/);
});

test('malformed delegated headings diagnose their rows even alongside a valid TP table', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  for (const heading of ['## 対象外シナリオ一覧', '## 対象外 シナリオ', '## 対象外のシナリオ', '## 対象外', '## E2E対象外シナリオ', '##対象外シナリオ', '### 対象外シナリオ',
    '## E2E対象外(委譲先と理由)', '## 対象外（他層で保護）', '### E2E対象外（他層で担保）']) {
    for (const rows of [[], [['TP-001', 'R', 'S']]]) {
      writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', `${PLAN(rows)}
${heading}
| Requirement | Scenario | Oracle | Layer | Method |
|---|---|---|---|---|
| R | T | O1 | Unit | unit test |
`);
      const out = runCoverage({ repo: dir });
      assert.equal(out.exitCode, 0, out.stderr);
      assert.equal(out.model.unresolved.length, 1);
      assert.equal(out.model.unresolved[0].scenario, 'T');
      assert.match(out.model.unresolved[0].reason, /対象外の表の見出しを解析できません/);
      assert.equal(out.model.scenarios[1].classification, CLASS.none);
      assert.equal(out.model.scenarios[0].classification, rows.length ? CLASS.e2e : CLASS.none);
    }
  }
});

test('WIP I/O failures and unexpected parser exceptions are not downgraded to warnings', t => {
  const dir = protectedRepo(t);
  const rel = 'openspec/changes/wip/test-plan.md';
  mkdirSync(join(dir, rel), { recursive: true });
  assert.throws(() => buildCoverage(dir), /test-plan.md.*EISDIR/);
  const out = runCoverage({ repo: dir });
  assert.equal(out.exitCode, 2);
  assert.match(out.stderr, /EISDIR/);
  assert.doesNotMatch(out.stderr, /注記から除外/);
  rmSync(join(dir, rel), { recursive: true });
  writeIn(dir, rel, PLAN([]) + '\ninternal-error');
  const original = String.prototype.matchAll;
  const bug = new TypeError('unexpected parser failure');
  t.mock.method(String.prototype, 'matchAll', function (...args) {
    if (this.includes('internal-error')) throw bug;
    return original.apply(this, args);
  });
  assert.throws(() => buildCoverage(dir), err => err === bug);
  const internal = runCoverage({ repo: dir });
  assert.equal(internal.exitCode, 3);
  assert.match(internal.stderr, /内部エラー:\nTypeError: unexpected parser failure\n\s+at /);
});

test('missing change schema uses config for missing-plan diagnostics and preserves explicit schemas', t => {
  const dir = protectedRepo(t);
  const archive = 'openspec/changes/archive/2026-02-01-b';
  writeIn(dir, `${archive}/specs/cap/spec.md`, SPEC('R', ['S'], 'MODIFIED'));
  for (const schema of ['quality-driven-e2e', 'spec-driven-e2e', 'spec-driven', 'quality-driven']) {
    writeIn(dir, 'openspec/config.yaml', `schema: ${schema}\n`);
    const out = runCoverage({ repo: dir });
    assert.equal(out.exitCode, 0, out.stderr);
    assert.equal(out.model.scenarios[0].classification, CLASS.stale);
    const unknown = [...out.model.unresolved, ...out.model.legacyUnresolved];
    assert.equal(unknown.length, schema.endsWith('-e2e') ? 1 : 0, schema);
    if (unknown.length) assert.match(unknown[0].reason, /2026-02-01-b\/test-plan.md がありません/);
  }
  writeIn(dir, 'openspec/config.yaml', 'schema: quality-driven-e2e\n');
  writeIn(dir, `${archive}/.openspec.yaml`, 'created: 2026-02-01\n');
  assert.equal(buildCoverage(dir).unresolved.length, 1);
  writeIn(dir, `${archive}/.openspec.yaml`, 'schema: spec-driven\n');
  assert.equal(buildCoverage(dir).unresolved.length, 0);
});

test('fixture paths do not create text-only TP diagnostics while standalone IDs still do', t => {
  const dir = protectedRepo(t);
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S']])
    .replace('| f |', '| fixtures/tp-001-user.json, fixtures/TP-002-user.json |') + '\nSee @TP-003 and TP-004.\n');
  const model = buildCoverage(dir);
  assert.equal(model.scenarios[0].classification, CLASS.e2e);
  assert.deepEqual(model.unresolved.map(row => row.id), ['TP-003', 'TP-004']);
});

test('missing Scenario columns are diagnosed as columns rather than blank cells', t => {
  const dir = protectedRepo(t);
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S']]).replace('| Scenario |', '| Scenerio |'));
  const model = buildCoverage(dir);
  assert.equal(model.unresolved.length, 1);
  assert.match(model.unresolved[0].reason, /シナリオ列を解析できません/);
  assert.equal(model.scenarios[0].classification, CLASS.none);
});

test('structural overview headings do not look like malformed spec declarations', t => {
  const dir = protectedRepo(t);
  writeIn(dir, 'openspec/specs/cap/spec.md', '# Requirement overview\n## Scenario overview\n' + SPEC('R', ['S']));
  const out = runCoverage({ repo: dir, strict: true });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.equal(out.model.scenarios.length, 1);
});

test('custom QE_SCHEMA excludes plans without warnings but still consumes deltas', t => {
  const dir = protectedRepo(t);
  const archive = 'openspec/changes/archive/2026-02-01-b';
  writeIn(dir, `${archive}/.openspec.yaml`, 'schema: custom-qe\n');
  writeIn(dir, `${archive}/specs/cap/spec.md`, SPEC('R', ['S'], 'MODIFIED'));
  writeIn(dir, `${archive}/test-plan.md`, PLAN([['TP-001', 'R', 'S']]));
  const out = runCoverage({ repo: dir, env: { QE_SCHEMA: 'custom-qe' } });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.deepEqual(out.model.warnings, []);
  assert.equal(out.model.scenarios[0].classification, CLASS.stale);
  assert.match(runCoverage({ repo: dir, env: {} }).stderr, /未対応の schema custom-qe/);
  const repo = ciRepo();
  t.after(() => repo.cleanup());
  writeIn(repo.dir, `${archive}/.openspec.yaml`, 'schema: custom-qe\n');
  const ran = runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', QE_SCHEMA: 'custom-qe' }), {
    cwd: repo.dir, execFile: regressionExec([]),
  });
  assert.equal(ran.code, 0, ran.lines.join('\n'));
  assert.doesNotMatch(ran.lines.join('\n'), /未対応の schema custom-qe/);
});

test('excessively nested results are input errors through CLI, reporter and CI with saved summaries', t => {
  const raw = '{"suites":['.repeat(10000) + '{}' + ']}'.repeat(10000);
  const nested = JSON.parse(raw);
  const dir = protectedRepo(t);
  writeIn(dir, 'results.json', raw);
  const out = gate(dir, ['--results', 'results.json']);
  assert.equal(out.status, 2, out.stderr);
  assert.match(out.stderr, /256 階層/);
  assert.equal(buildReport({ changeId: 'a', planText: PLAN([['TP-001', 'R', 'S']]), results: nested }).exitCode, 2);
  const atLimit = JSON.parse('{"suites":['.repeat(256) + '{}' + ']}'.repeat(256));
  assert.equal(validateResults(atLimit), null);
  assert.doesNotThrow(() => attachResults(buildCoverage(dir), atLimit));
  const repo = ciRepo();
  t.after(() => repo.cleanup());
  const output = join(repo.dir, 'github-output');
  const ran = runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', GITHUB_OUTPUT: output }), {
    cwd: repo.dir,
    execFile(file, args, opts) {
      if (args.includes('run-regression')) writeFileSync(opts.env.TESTKIT_RESULTS_JSON, raw);
      return '';
    },
  });
  assert.equal(ran.code, 2);
  for (const path of [join(ran.runDir, 'coverage.md'), join(ran.summaryDir, 'summary.txt')]) assert.match(readFileSync(path, 'utf8'), /256 階層/);
  assert.match(readFileSync(output, 'utf8'), /risk_level=none/);
});


test('a case-changing rename with its new definition is valid in archived and active changes', t => {
  const dir = protectedRepo(t);
  const delta = '## RENAMED Requirements\n- FROM: Requirement: R\n- TO: Requirement: r\n' + SPEC('r', ['S'], 'MODIFIED');
  writeIn(dir, 'openspec/changes/wip/specs/cap/spec.md', delta);
  assert.deepEqual(buildCoverage(dir).warnings, []);
  writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', delta);
  const out = runCoverage({ repo: dir });
  assert.equal(out.exitCode, 0, out.stderr);
});

test('coverage accepts empty, anchored and yml config documents', t => {
  const dir = protectedRepo(t);
  writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', SPEC('R', ['S'], 'MODIFIED'));
  for (const config of ['', '# comment only\n', 'default: &schema quality-driven-e2e\nschema: *schema\n']) {
    writeIn(dir, 'openspec/config.yaml', config);
    const out = runCoverage({ repo: dir });
    assert.equal(out.exitCode, 0, out.stderr);
    assert.equal(out.model.scenarios[0].classification, CLASS.stale);
    assert.equal(out.model.unresolved.length, config.includes('&schema') ? 1 : 0);
  }
  rmSync(join(dir, 'openspec/config.yaml'));
  writeIn(dir, 'openspec/config.yml', 'schema: quality-driven-e2e\n');
  assert.equal(buildCoverage(dir).unresolved.length, 1);
  writeIn(dir, 'openspec/config.yaml', 'schema: spec-driven\n');
  assert.equal(buildCoverage(dir).unresolved.length, 0, 'yaml takes precedence over yml');
});

test('inherited unknown schema warnings identify the config once and local overrides retain their path', t => {
  const dir = protectedRepo(t);
  for (const id of ['b', 'c']) writeIn(dir, `openspec/changes/archive/2026-02-01-${id}/specs/cap/spec.md`, SPEC('R', ['S'], 'MODIFIED'));
  for (const filename of ['config.yaml', 'config.yml']) {
    writeIn(dir, `openspec/${filename}`, 'schema: unknown-schema\n');
    const out = runCoverage({ repo: dir, format: 'json', env: {} });
    assert.equal(out.exitCode, 0, out.stderr);
    assert.equal(out.model.warnings.length, 1);
    assert.ok(out.model.warnings[0].startsWith(`openspec/${filename}: 未対応の schema unknown-schema`));
    assert.doesNotMatch(out.stderr, /\.openspec.yaml/);
    assert.deepEqual(JSON.parse(out.stdout).warnings, out.model.warnings);
    rmSync(join(dir, `openspec/${filename}`));
  }
  writeIn(dir, 'openspec/changes/archive/2026-02-01-b/.openspec.yaml', 'schema: local-unknown\n');
  assert.match(buildCoverage(dir, { env: {} }).warnings[0], /2026-02-01-b\/\.openspec.yaml: 未対応の schema local-unknown/);
});

test('duplicate and list-form delegated sections produce diagnoses instead of disappearing', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  const table = scenario => `## 対象外シナリオ\n| Scenario | Oracle | Layer | Method |\n|---|---|---|---|\n| ${scenario} | O1 | Unit | unit test |\n`;
  const path = 'openspec/changes/archive/2026-01-01-a/test-plan.md';
  writeIn(dir, path, PLAN([]) + table('S') + table('T'));
  const duplicate = buildCoverage(dir);
  assert.equal(duplicate.scenarios[0].classification, CLASS.declared);
  assert.equal(duplicate.scenarios[1].classification, CLASS.none);
  assert.equal(duplicate.unresolved.length, 1);
  assert.equal(duplicate.unresolved[0].scenario, 'T');
  assert.match(duplicate.unresolved[0].reason, /見出しが重複/);
  for (const bullet of ['- S: Unit', '* S: Unit', '1. S: Unit']) {
    writeIn(dir, path, PLAN([]) + `## 対象外シナリオ\n${bullet}\n`);
    const list = buildCoverage(dir);
    assert.equal(list.unresolved.length, 1);
    assert.match(list.unresolved[0].reason, /箇条書きではなく表/);
    assert.ok(list.scenarios.every(row => row.classification === CLASS.none));
  }
});

test('WIP name checks include main requirements without scenarios', t => {
  const dir = protectedRepo(t);
  writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('R', ['S']) + '\n### Requirement: Empty\nNo scenarios yet.\n');
  writeIn(dir, 'openspec/changes/wip/specs/cap/spec.md', SPEC('empty', [], 'MODIFIED'));
  const out = runCoverage({ repo: dir });
  assert.equal(out.exitCode, 0);
  assert.match(out.stderr, /wip.*大小文字.*empty \/ Empty/);
});

test('CI saves internal coverage failures and stack traces even without coverage strict', t => {
  const repo = ciRepo();
  t.after(() => repo.cleanup());
  writeIn(repo.dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S']]) + '\ninternal-error');
  const original = String.prototype.matchAll;
  t.mock.method(String.prototype, 'matchAll', function (...args) {
    if (this.includes('internal-error')) throw new TypeError('coverage parser bug');
    return original.apply(this, args);
  });
  const output = join(repo.dir, 'github-output');
  const ran = runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', GITHUB_OUTPUT: output }), {
    cwd: repo.dir, execFile: regressionExec([]),
  });
  assert.equal(ran.code, 3);
  assert.doesNotMatch(ran.lines.join('\n'), /入力エラー/);
  for (const path of [join(ran.runDir, 'coverage.md'), join(ran.summaryDir, 'summary.txt')]) {
    assert.match(readFileSync(path, 'utf8'), /内部エラー:\nTypeError: coverage parser bug\n\s+at /);
  }
  assert.match(readFileSync(output, 'utf8'), /risk_level=none/);
});

test('directory traversal and config read errors remain input errors', t => {
  const dir = protectedRepo(t);
  for (const path of ['openspec/config.yaml', 'openspec/changes/archive/2026-01-01-a/.openspec.yaml']) {
    rmSync(join(dir, path), { force: true });
    mkdirSync(join(dir, path));
    const out = runCoverage({ repo: dir });
    assert.equal(out.exitCode, 2);
    assert.match(out.stderr, /EISDIR/);
    rmSync(join(dir, path), { recursive: true });
  }
  rmSync(join(dir, 'openspec/changes'), { recursive: true });
  writeIn(dir, 'openspec/changes', 'not a directory');
  const out = runCoverage({ repo: dir });
  assert.equal(out.exitCode, 2);
  assert.match(out.stderr, /ENOTDIR/);
});

test('later requirements invalidate delegated declarations until a new declaration covers them', t => {
  const dir = protectedRepo(t);
  const plan = PLAN([]) + '\n## 対象外シナリオ\n| Scenario | Oracle | Layer | Method |\n|---|---|---|---|\n| S | O1 | Unit | unit test |\n';
  const archive = 'openspec/changes/archive';
  writeIn(dir, `${archive}/2026-01-01-a/test-plan.md`, plan);
  assert.equal(buildCoverage(dir).scenarios[0].classification, CLASS.declared);
  writeIn(dir, `${archive}/2026-02-01-b/specs/cap/spec.md`, SPEC('R', ['S'], 'MODIFIED'));
  const stale = runCoverage({ repo: dir, strict: true });
  assert.equal(stale.exitCode, 1);
  assert.equal(stale.model.scenarios[0].classification, CLASS.stale);
  assert.equal(stale.model.scenarios[0].source.modifiedBy, 'b');
  assert.deepEqual(stale.model.scenarios[0].source.declared, [{ oracle: 'O1', layer: 'Unit', method: 'unit test' }]);
  writeIn(dir, `${archive}/2026-02-01-b/test-plan.md`, plan);
  const renewed = runCoverage({ repo: dir, strict: true });
  assert.equal(renewed.exitCode, 0, renewed.stderr);
  assert.equal(renewed.model.scenarios[0].classification, CLASS.declared);
  assert.equal(renewed.model.scenarios[0].source.change, 'b');
});

test('plan subheadings and code examples preserve parent tables and ignore fake declarations', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  const path = 'openspec/changes/archive/2026-01-01-a/test-plan.md';
  const delegated = '## 対象外シナリオ\n| Scenario | Oracle | Layer | Method |\n|---|---|---|---|\n| T | O1 | Unit | unit test |\n';
  for (const extra of [
    '### 正常系\n',
    '```sh\n# run\n## 対象外シナリオ\n```\n',
    '~~~sh\n# run\n### 対象外シナリオ\n~~~\n',
    '    ## 対象外シナリオ\n',
  ]) {
    writeIn(dir, path, PLAN([['TP-001', 'R', 'S']]).replace('## E2E観点一覧\n', `## E2E観点一覧\n${extra}`)
      + delegated.replace('## 対象外シナリオ\n', '## 対象外シナリオ\n### 補足\n###### 対象外 メモ\n'));
    const out = runCoverage({ repo: dir, strict: true });
    assert.equal(out.exitCode, 0, out.stderr);
    assert.deepEqual(out.model.scenarios.map(row => row.classification), [CLASS.e2e, CLASS.declared]);
    assert.deepEqual(out.model.unresolved, []);
  }
});

test('hashtags and indented code are not spec declarations', t => {
  const dir = protectedRepo(t);
  writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('R', ['S'])
    + '\n#requirement-tag は参考\n#scenario-tag は参考\n    ### Requirement: Example\n    #### Scenario: Example\n\t###Requirement: Example\n');
  const out = runCoverage({ repo: dir, strict: true });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.equal(out.summary.scenarios, 1);
});

test('header-only and mixed list declarations are diagnosed without hiding valid table rows', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  const path = 'openspec/changes/archive/2026-01-01-a/test-plan.md';
  writeIn(dir, path, PLAN([]) + '## 対象外シナリオ\n| Scenario | Oracle | Layer | Method |\n');
  const header = buildCoverage(dir);
  assert.equal(header.unresolved.length, 1);
  assert.match(header.unresolved[0].reason, /ヘッダ行/);
  writeIn(dir, path, PLAN([]) + '## 対象外シナリオ\n| Scenario | Oracle | Layer | Method |\n|---|---|---|---|\n| S | O1 | Unit | test |\n- T: Unit\n');
  const mixed = buildCoverage(dir);
  assert.deepEqual(mixed.scenarios.map(row => row.classification), [CLASS.declared, CLASS.none]);
  assert.equal(mixed.unresolved.length, 1);
  assert.match(mixed.unresolved[0].reason, /箇条書きではなく表.*T: Unit/);
});

test('unresolved YAML aliases follow config, archive and WIP input contracts including selection and CI', t => {
  const yaml = 'schema: *missing\n';
  const parsed = parseYamlText(yaml);
  assert.equal(parsed.data, null);
  assert.equal(parsed.alias, true);
  assert.match(parsed.errors.join('\n'), /alias/i);
  const repo = ciRepo();
  t.after(() => repo.cleanup());
  for (const name of ['config.yaml', 'config.yml']) {
    writeIn(repo.dir, `openspec/${name}`, yaml);
    assert.equal(runCoverage({ repo: repo.dir }).exitCode, 2);
    assert.notEqual(selectChanges({ repo: repo.dir, base: 'HEAD', env: {} }).exitCode, 2);
    rmSync(join(repo.dir, `openspec/${name}`));
  }
  writeIn(repo.dir, 'openspec/changes/wip/.openspec.yaml', yaml);
  const wip = runCoverage({ repo: repo.dir });
  assert.equal(wip.exitCode, 0);
  assert.match(wip.stderr, /wip.*注記から除外.*alias/i);
  const output = join(repo.dir, 'github-output');
  const ci = () => runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', GITHUB_OUTPUT: output }), {
    cwd: repo.dir, execFile: regressionExec([]),
  });
  assert.equal(ci().code, 0);
  writeIn(repo.dir, 'openspec/changes/archive/2026-01-01-add-cart/.openspec.yaml', yaml);
  assert.equal(runCoverage({ repo: repo.dir }).exitCode, 2);
  const ran = ci();
  assert.equal(ran.code, 2);
  assert.match(readFileSync(join(ran.summaryDir, 'summary.txt'), 'utf8'), /alias/i);
  assert.match(readFileSync(output, 'utf8'), /risk_level=none/);
});

test('missing OpenSpec and file-valued spec or archive directories return input exit code 2', async t => {
  for (const path of ['openspec', 'openspec/specs', 'openspec/changes/archive']) await t.test(path, t => {
    const dir = protectedRepo(t);
    rmSync(join(dir, path), { recursive: true });
    if (path !== 'openspec') writeIn(dir, path, 'not a directory');
    const out = gate(dir, []);
    assert.equal(out.status, 2, out.stderr);
    assert.match(out.stderr, path === 'openspec' ? /openspec\/ がありません/ : /ENOTDIR/);
  });
});

test('lowercase standalone TP references do not become unresolved mappings', t => {
  const dir = protectedRepo(t);
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S']]) + '\nSee tp-002 and @tp-003.\n');
  const out = runCoverage({ repo: dir, strict: true });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(out.model.unresolved, []);
  assert.deepEqual(out.model.legacyUnresolved, []);
});

test('active names discard archived capabilities absent from current main specs', t => {
  const dir = protectedRepo(t);
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/specs/retired/spec.md', SPEC('Old', ['Historical']));
  writeIn(dir, 'openspec/changes/wip/specs/retired/spec.md', SPEC('old', ['Historical'], 'MODIFIED'));
  const out = runCoverage({ repo: dir });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(out.model.warnings, []);
});

test('all coverage processing stages return internal exit code 3 and CI retains summary and risk', async t => {
  for (const stage of ['buildCoverage', 'attachResults', 'summarize', 'renderMarkdown', 'renderJson']) await t.test(stage, t => {
    const repo = ciRepo();
    t.after(() => repo.cleanup());
    let triggered = 0;
    const coverage = { [stage]() {
      triggered++;
      throw new TypeError(`${stage} failure`);
    } };
    const out = runCoverage({ repo: repo.dir, resultsPath: RESULTS, format: stage === 'renderJson' ? 'json' : 'markdown' }, coverage);
    assert.equal(out.exitCode, 3, out.stderr);
    assert.match(out.stderr, new RegExp(`内部エラー:\\nTypeError: ${stage} failure\\n\\s+at `));
    const output = join(repo.dir, 'github-output');
    const ran = runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', GITHUB_OUTPUT: output }), {
      cwd: repo.dir, execFile: regressionExec([]), coverage,
    });
    assert.equal(ran.code, 3, ran.lines.join('\n'));
    assert.match(readFileSync(join(ran.summaryDir, 'summary.txt'), 'utf8'), new RegExp(`${stage} failure`));
    assert.match(readFileSync(output, 'utf8'), /risk_level=none/);
    assert.equal(triggered, 2);
  });
});

test('full-width punctuation in later spec declarations is rejected rather than omitted', t => {
  const dir = protectedRepo(t);
  for (const heading of ['#### Scenario：U', '### Requirement（X）', '### Requirement：X', '#### Scenario（U）']) {
    for (const path of ['openspec/specs/cap/spec.md', 'openspec/changes/archive/2026-01-01-a/specs/cap/spec.md']) {
      writeIn(dir, path, SPEC('R', ['S']) + `\n${heading}\n`);
      const out = runCoverage({ repo: dir, strict: true });
      assert.equal(out.exitCode, 2, `${path}: ${heading}`);
      assert.ok(out.stderr.includes(path));
      assert.match(out.stderr, /見出し/);
      writeIn(dir, path, SPEC('R', ['S']));
    }
  }
});

test('inline backtick runs do not hide spec scenarios or plan tables', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  const archive = 'openspec/changes/archive/2026-01-01-a';
  const spec = SPEC('R', ['S']) + '\n```npm test```\n\n### Requirement: Hidden\n#### Scenario: T\n\n```sh\n# run\n```\n';
  for (const path of ['openspec/specs/cap/spec.md', `${archive}/specs/cap/spec.md`]) writeIn(dir, path, spec);
  writeIn(dir, `${archive}/test-plan.md`, '---\ne2e: required\n---\n```npm test```\n'
    + PLAN([['TP-001', 'R', 'S']])
    + '\n## 対象外シナリオ\n| Requirement | Scenario | Oracle | Layer | Method |\n|---|---|---|---|---|\n| Hidden | T | O1 | Unit | test |\n');
  const out = runCoverage({ repo: dir, strict: true });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.equal(out.summary.scenarios, 2);
  assert.deepEqual(out.model.scenarios.map(row => row.classification), [CLASS.e2e, CLASS.declared]);
  assert.deepEqual(out.model.orphans, []);
  assert.deepEqual(out.model.unresolved, []);
});

test('fences only close with matching symbols, sufficient length and no info string', t => {
  const dir = protectedRepo(t);
  const archive = 'openspec/changes/archive/2026-01-01-a';
  for (const [open, falseClose, close] of [
    ['```sh', '```info', '```'],
    ['~~~sh', '~~~info', '~~~'],
    ['```sh', '~~~', '```'],
    ['~~~sh', '```', '~~~'],
    ['````sh', '```', '````'],
    ['~~~~sh', '~~~', '~~~~~'],
    ['   ```sh', '   ```info', '   ````  '],
  ]) {
    const example = `${open}\n${falseClose}\n### Requirement：Example\n#### Scenario：Example\n## E2E観点一覧\n| TP-ID | Scenario |\n|---|---|\n| TP-999 | Example |\n${close}\n`;
    for (const path of ['openspec/specs/cap/spec.md', `${archive}/specs/cap/spec.md`]) writeIn(dir, path, example + SPEC('R', ['S']));
    writeIn(dir, `${archive}/test-plan.md`, `---\ne2e: required\n---\n${example}` + PLAN([['TP-001', 'R', 'S']]));
    const out = runCoverage({ repo: dir, strict: true });
    assert.equal(out.exitCode, 0, `${open} / ${falseClose}: ${out.stderr}`);
    assert.equal(out.summary.scenarios, 1);
    assert.equal(out.model.scenarios[0].classification, CLASS.e2e);
    assert.deepEqual(out.model.unresolved, []);
    assert.deepEqual(out.model.legacyUnresolved, []);
  }
});

test('unclosed spec and plan fences fail archives but warn and exclude only the affected WIP', t => {
  const dir = protectedRepo(t);
  for (const fence of ['```sh', '~~~sh']) {
    for (const file of ['specs/cap/spec.md', 'test-plan.md']) {
      const content = file.endsWith('test-plan.md') ? PLAN([['TP-001', 'R', 'S']]) : SPEC('R', ['S']);
      const archive = `openspec/changes/archive/2026-01-01-a/${file}`;
      writeIn(dir, archive, content + `\n${fence}\nunfinished\n`);
      const invalid = runCoverage({ repo: dir });
      assert.equal(invalid.exitCode, 2);
      assert.ok(invalid.stderr.includes(archive));
      assert.match(invalid.stderr, /コードフェンスが閉じられていません/);
      writeIn(dir, archive, content);
      const wip = `openspec/changes/wip/${file}`;
      writeIn(dir, wip, content + `\n${fence}\nunfinished\n`);
      const warning = runCoverage({ repo: dir, strict: true });
      assert.equal(warning.exitCode, 0, warning.stderr);
      assert.match(warning.stderr, /wip.*注記から除外.*コードフェンス/);
      assert.equal(warning.model.scenarios[0].classification, CLASS.e2e);
      rmSync(join(dir, 'openspec/changes/wip'), { recursive: true });
    }
    writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('R', ['S']) + `\n${fence}\nunfinished\n`);
    const main = runCoverage({ repo: dir });
    assert.equal(main.exitCode, 2);
    assert.match(main.stderr, /openspec\/specs\/cap\/spec.md.*コードフェンス/);
    writeIn(dir, 'openspec/specs/cap/spec.md', SPEC('R', ['S']));
  }
});

test('one to three spaces before spec and plan headings preserve mappings and delta operations', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  const archive = 'openspec/changes/archive/2026-01-01-a';
  for (const count of [1, 2, 3]) {
    const indent = text => text.replace(/^#/gm, ' '.repeat(count) + '#');
    for (const path of ['openspec/specs/cap/spec.md', `${archive}/specs/cap/spec.md`]) writeIn(dir, path, indent(SPEC('R', ['S', 'T'])));
    writeIn(dir, `${archive}/test-plan.md`, indent(PLAN([['TP-001', 'R', 'S']])
      + '\n## 対象外シナリオ\n### 補足\n| Scenario | Layer |\n|---|---|\n| T | Unit |\n'));
    const out = runCoverage({ repo: dir, strict: true });
    assert.equal(out.exitCode, 0, out.stderr);
    assert.equal(out.summary.scenarios, 2);
    assert.deepEqual(out.model.scenarios.map(row => row.classification), [CLASS.e2e, CLASS.declared]);
    assert.deepEqual(out.model.unresolved, []);
    writeIn(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', indent(SPEC('R', ['S', 'T'], 'MODIFIED')));
    const changed = runCoverage({ repo: dir, strict: true });
    assert.equal(changed.exitCode, 1);
    assert.ok(changed.model.scenarios.every(row => row.classification === CLASS.stale));
    rmSync(join(dir, 'openspec/changes/archive/2026-02-01-b'), { recursive: true });
  }
});

test('each plan table uses its own headers across subheadings and column orders', t => {
  const dir = protectedRepo(t, ['S', 'T', 'U', 'V']);
  const plan = PLAN([['TP-001', 'R', 'S']]).replace('## E2E観点一覧\n', '## E2E観点一覧\n### 正常系\n')
    + '\n### 異常系\n| Scenario | TP-ID | Requirement |\n|---|---|---|\n| T | TP-002 | R |\n'
    + '\n## 対象外シナリオ\n### 単体\n| Requirement | Scenario | Layer | Oracle | Method |\n|---|---|---|---|---|\n| R | U | Unit | O1 | unit |\n'
    + '\n### 結合\n| Layer | Method | Scenario | Oracle | Requirement |\n|---|---|---|---|---|\n| Integration | integration | V | O2 | R |\n';
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', plan);
  const out = runCoverage({ repo: dir, strict: true });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.deepEqual(out.model.scenarios.map(row => row.classification), [CLASS.e2e, CLASS.e2e, CLASS.declared, CLASS.declared]);
  assert.deepEqual(out.model.unresolved, []);
  assert.deepEqual(out.model.orphans, []);
  assert.deepEqual(out.model.scenarios[3].source.declared, [{ oracle: 'O2', layer: 'Integration', method: 'integration' }]);
});

test('delegated prose notes are allowed while recognizable list declarations are diagnosed', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  const path = 'openspec/changes/archive/2026-01-01-a/test-plan.md';
  const plan = PLAN([['TP-001', 'R', 'S']])
    + '\n## 対象外シナリオ\n- 補足: CI の時間を短縮する\n- 補足: Unit tests を別ジョブで実行\n### 補足\n- メモ: Layer: Unit を使う理由\n* Review this table later.\n'
    + '| Scenario | Layer |\n|---|---|\n| T | Unit |\n';
  writeIn(dir, path, plan);
  assert.deepEqual(buildCoverage(dir).unresolved, []);
  for (const declaration of ['- T: Unit', '- Scenario: T; Layer: Unit', '- 対応シナリオ：T、Layer：Unit']) {
    writeIn(dir, path, plan + declaration + '\n');
    const out = runCoverage({ repo: dir, strict: true });
    assert.equal(out.exitCode, 0, out.stderr);
    assert.deepEqual(out.model.scenarios.map(row => row.classification), [CLASS.e2e, CLASS.declared]);
    assert.equal(out.model.unresolved.length, 1);
    assert.match(out.model.unresolved[0].reason, /箇条書きではなく表/);
  }
});

test('indented pipe tables remain mappings, but code examples cannot create TP references', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  const path = 'openspec/changes/archive/2026-01-01-a/test-plan.md';
  for (const indent of ['    ', '\t']) {
    const plan = (PLAN([['TP-001', 'R', 'S']])
      + '\n## 対象外シナリオ\n| Scenario | Layer |\n|---|---|\n| T | Unit |\n').replace(/^\|/gm, indent + '|');
    writeIn(dir, path, plan + '\n```sh\nTP-998\n## 対象外シナリオ\n| Scenario |\n|---|\n| Example |\n```\n    TP-999\n');
    const out = runCoverage({ repo: dir, strict: true });
    assert.equal(out.exitCode, 0, out.stderr);
    assert.deepEqual(out.model.scenarios.map(row => row.classification), [CLASS.e2e, CLASS.declared]);
    assert.deepEqual(out.model.unresolved, []);
    assert.deepEqual(out.model.legacyUnresolved, []);
  }
});

test('invalid config is an input error with its actual path and CI retains diagnostics', t => {
  const repo = ciRepo();
  t.after(() => repo.cleanup());
  const output = join(repo.dir, 'github-output');
  for (const name of ['config.yaml', 'config.yml']) {
    for (const value of ['schema: [\n', 'schema: *missing\n', 'schema: [quality-driven-e2e]\n', '- quality-driven-e2e\n', 'invalid-scalar\n']) {
      writeIn(repo.dir, `openspec/${name}`, value);
      const out = runCoverage({ repo: repo.dir });
      assert.equal(out.exitCode, 2, value);
      assert.ok(out.stderr.includes(`openspec/${name} が不正です:`));
      const ran = runCiJob(ciEnv({ REGRESSION_COMMAND: 'run-regression', GITHUB_OUTPUT: output }), {
        cwd: repo.dir, execFile: regressionExec([]),
      });
      assert.equal(ran.code, 2, ran.lines.join('\n'));
      for (const path of [join(ran.runDir, 'coverage.md'), join(ran.summaryDir, 'summary.txt')]) {
        assert.ok(readFileSync(path, 'utf8').includes(`openspec/${name} が不正です:`));
      }
      assert.match(readFileSync(output, 'utf8'), /risk_level=none/);
    }
    rmSync(join(repo.dir, `openspec/${name}`));
  }
});

test('plan section headings at any level or spacing end the delegated table', t => {
  const dir = protectedRepo(t, ['S', 'T']);
  const path = 'openspec/changes/archive/2026-01-01-a/test-plan.md';
  for (const heading of ['##E2E観点一覧', '### E2E観点一覧', '# 付録']) {
    writeIn(dir, path, '---\ne2e: required\n---\n## 対象外シナリオ\n| Scenario | Layer | Reason |\n|---|---|---|\n| T | Unit | r |\n'
      + `${heading}\n| TP-ID | Requirement | Scenario |\n|---|---|---|\n| TP-001 | R | S |\n`);
    const out = runCoverage({ repo: dir });
    assert.equal(out.exitCode, 0, out.stderr);
    assert.deepEqual(out.model.scenarios.map(row => row.classification), [CLASS.none, CLASS.declared], heading);
    assert.deepEqual(out.model.unresolved.map(row => row.id), ['TP-001'], heading);
  }
});

test('plan sections that only appear inside code fences are diagnosed as unparsable', t => {
  const dir = protectedRepo(t);
  const path = 'openspec/changes/archive/2026-01-01-a/test-plan.md';
  for (const fence of ['```', '~~~']) {
    writeIn(dir, path, `---\ne2e: required\n---\n${fence}md\n## E2E観点一覧\n## 対象外シナリオ\n${fence}\n`);
    const out = runCoverage({ repo: dir });
    assert.equal(out.exitCode, 0, out.stderr);
    assert.equal(out.model.unresolved.length, 1);
    assert.match(out.model.unresolved[0].reason, /対応表を解析できません/);
  }
});

test('tilde fences open even when their info string contains backticks', t => {
  const dir = protectedRepo(t);
  const archive = 'openspec/changes/archive/2026-01-01-a';
  const example = '~~~md `example`\n### Requirement: Example\n#### Scenario: Example\n## E2E観点一覧\n| TP-ID | Scenario |\n|---|---|\n| TP-999 | Example |\n~~~\n';
  for (const path of ['openspec/specs/cap/spec.md', `${archive}/specs/cap/spec.md`]) writeIn(dir, path, example + SPEC('R', ['S']));
  writeIn(dir, `${archive}/test-plan.md`, `---\ne2e: required\n---\n${example}` + PLAN([['TP-001', 'R', 'S']]));
  const out = runCoverage({ repo: dir, strict: true });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.equal(out.summary.scenarios, 1);
  assert.equal(out.model.scenarios[0].classification, CLASS.e2e);
  assert.deepEqual(out.model.unresolved, []);
});

test('custom YAML tags only invalidate config when they apply to the schema', t => {
  const dir = protectedRepo(t);
  for (const value of ['schema: quality-driven-e2e\ncontext: !include x.md\n', 'rules: !custom\n  a: 1\n']) {
    writeIn(dir, 'openspec/config.yaml', value);
    const out = runCoverage({ repo: dir, strict: true });
    assert.equal(out.exitCode, 0, `${value}: ${out.stderr}`);
    assert.equal(out.model.scenarios[0].classification, CLASS.e2e);
  }
  for (const value of ['schema: !custom quality-driven-e2e\n', '!custom\nschema: quality-driven-e2e\n']) {
    writeIn(dir, 'openspec/config.yaml', value);
    const out = runCoverage({ repo: dir });
    assert.equal(out.exitCode, 2, value);
    assert.ok(out.stderr.includes('openspec/config.yaml が不正です:'));
  }
});

test('an archived derived-schema change protects its scenarios like an integrated one, without a warning', t => {
  const dir = protectedRepo(t);
  const integrated = buildCoverage(dir, { env: {} });
  writeDerivedSchema(dir);
  writeIn(dir, 'openspec/changes/archive/2026-01-01-a/.openspec.yaml', 'schema: quality-driven-e2e-mockup\n');
  const derived = buildCoverage(dir, { env: { QE_SCHEMA: 'quality-driven-e2e-mockup' } });
  assert.equal(derived.scenarios[0].classification, CLASS.e2e);
  assert.deepEqual(derived.scenarios, integrated.scenarios);
  assert.deepEqual(derived.warnings, []);

  // Without its declaration the same schema is unsupported again; an invalid one is an input error.
  rmSync(join(dir, 'openspec/schemas/quality-driven-e2e-mockup/testkit-compat.json'));
  assert.match(buildCoverage(dir, { env: {} }).warnings[0], /未対応の schema quality-driven-e2e-mockup/);
  writeIn(dir, 'openspec/schemas/quality-driven-e2e-mockup/testkit-compat.json', '{');
  const broken = runCoverage({ repo: dir, format: 'json', env: {} });
  assert.notEqual(broken.exitCode, 0);
  assert.match(broken.stderr, /testkit-compat.json が無効です/);
});
