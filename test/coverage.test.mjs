import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachResults, buildCoverage, CLASS, listMainScenarios, runCoverage, summarize } from '../payload/scripts/lib/coverage-map.mjs';
import { REQUIRED_MODULES, STAMP_FILE } from '../payload/scripts/lib/critical.mjs';
import { doctor } from '../payload/scripts/lib/doctor.mjs';
import { runCiJob } from '../payload/scripts/ci-job.mjs';
import { main } from '../lib/cli.mjs';
import { gitRepo } from './support.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/coverage/repo', import.meta.url));
const RESULTS = fileURLToPath(new URL('./fixtures/coverage/regression-results.json', import.meta.url));
const GOLDEN = fileURLToPath(new URL('./fixtures/coverage/golden/', import.meta.url));
const GATE = fileURLToPath(new URL('../payload/scripts/testkit-gate.mjs', import.meta.url));
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
  ['search', 'Search', 'Search by keyword', CLASS.e2e, 'legacy-search TP-001', 'Legacy plan with a parsable table'],
  ['search', 'Search', 'Search with no results', CLASS.none, null, 'Legacy plan with free text only / 旧 quality-driven は読まない'],
];

function copyFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tk-cov-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function write(dir, rel, text) {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}

function find(model, capability, requirement, scenario) {
  return model.scenarios.find(row => row.capability === capability && row.requirement === requirement && row.scenario === scenario);
}

function gate(cwd, args) {
  return spawnSync(process.execPath, [GATE, 'coverage', ...args], { cwd, encoding: 'utf8' });
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
  const empty = mkdtempSync(join(tmpdir(), 'tk-cov-empty-'));
  try {
    write(empty, 'openspec/specs/.gitkeep', '');
    assert.deepEqual(listMainScenarios(empty), []);
    write(empty, 'openspec/specs/deep/a/b/spec.md', SPEC('R', ['S'], 'ADDED').replace('## ADDED Requirements', '## Requirements'));
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
  assert.equal(summary[CLASS.e2e], 4);
  assert.equal(summary.coverageE2E.count, 4);
  assert.equal(summary.coverageWithDeclared.count, 5);
});

test('the latest archive wins even on the same date and an older TP is not stale after a new one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-cov-order-'));
  try {
    write(dir, 'openspec/specs/cap/spec.md', SPEC('R', ['S'], 'ADDED').replace('## ADDED Requirements', '## Requirements'));
    write(dir, 'openspec/changes/archive/2026-01-01-a/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(dir, 'openspec/changes/archive/2026-01-01-a/specs/cap/spec.md', SPEC('R', ['S']));
    write(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S']]));
    write(dir, 'openspec/changes/archive/2026-01-01-b/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(dir, 'openspec/changes/archive/2026-01-01-b/specs/cap/spec.md', SPEC('R', ['S'], 'MODIFIED'));
    write(dir, 'openspec/changes/archive/2026-01-01-b/test-plan.md', PLAN([]));
    assert.equal(buildCoverage(dir).scenarios[0].classification, CLASS.stale);
    write(dir, 'openspec/changes/archive/2026-01-02-c/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(dir, 'openspec/changes/archive/2026-01-02-c/specs/cap/spec.md', SPEC('R', ['S'], 'MODIFIED'));
    write(dir, 'openspec/changes/archive/2026-01-02-c/test-plan.md', PLAN([['TP-007', 'R', 'S']]));
    const row = buildCoverage(dir).scenarios[0];
    assert.equal(row.classification, CLASS.e2e);
    assert.deepEqual(row.source.tps, ['TP-007']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy spec-driven-e2e tables count, free-text TP-IDs and quality-driven plans do not', () => {
  const model = buildCoverage(FIXTURE);
  assert.equal(find(model, 'search', 'Search', 'Search by keyword').classification, CLASS.e2e);
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
  assert.equal(summary['未実行'], 1);
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
    write(dir, 'bad.json', '{not json');
    const malformed = gate(dir, ['--results', 'bad.json']);
    assert.equal(malformed.status, 2);
    assert.equal(malformed.stdout, '');
    const old = gate(dir, ['--results', RESULTS, '--max-age', '60']);
    assert.equal(old.status, 2);
    assert.equal(old.stdout, '');
    assert.match(old.stderr, /--max-age 60/);
    write(dir, 'nostart.json', '{"suites":[]}');
    assert.equal(gate(dir, ['--results', 'nostart.json', '--max-age', '60']).status, 2);

    for (const args of [['--format', 'html'], ['--max-age', '5'], ['--results'], ['--bogus']]) {
      assert.equal(gate(dir, args).status, 2, args.join(' '));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strict mode fails on a single stale scenario and lists it; a fully protected repo passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-cov-strict-'));
  try {
    write(dir, 'openspec/specs/cap/spec.md', SPEC('R', ['S'], 'ADDED').replace('## ADDED Requirements', '## Requirements'));
    write(dir, 'openspec/changes/archive/2026-01-01-a/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(dir, 'openspec/changes/archive/2026-01-01-a/specs/cap/spec.md', SPEC('R', ['S']));
    write(dir, 'openspec/changes/archive/2026-01-01-a/test-plan.md', PLAN([['TP-001', 'R', 'S']]));
    assert.equal(gate(dir, ['--strict']).status, 0);
    write(dir, 'openspec/changes/archive/2026-02-01-b/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(dir, 'openspec/changes/archive/2026-02-01-b/specs/cap/spec.md', SPEC('R', ['S'], 'MODIFIED'));
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
  const empty = mkdtempSync(join(tmpdir(), 'tk-cov-empty-'));
  try {
    write(empty, 'openspec/specs/.gitkeep', '');
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

function regressionExec(calls, { writeJson = true, status = 0 } = {}) {
  return (file, args, opts) => {
    const command = args.join(' ');
    calls.push(command);
    if (command.includes('run-regression')) {
      if (writeJson) writeFileSync(opts.env.TESTKIT_RESULTS_JSON, JSON.stringify({ ...results, stats: { startTime: new Date().toISOString() } }));
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
    assert.equal(await main(['install', '--force', '--target', repo.dir], quiet), 0);
    assert.equal(doctor(repo.dir).ok, true);
  } finally {
    repo.cleanup();
  }
});

test('the documented coverage example is what the fixture actually prints', () => {
  const doc = readFileSync(new URL('../docs/workflow.md', import.meta.url), 'utf8');
  const block = doc.match(/<!-- coverage-example:start -->\n```text\n([\s\S]*?)```\n<!-- coverage-example:end -->/);
  assert.ok(block, 'docs/workflow.md の coverage-example');
  const dir = copyFixture();
  try {
    const out = spawnSync(process.execPath, [GATE, 'coverage', '--results', RESULTS], { cwd: dir, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const printed = out.stdout.split('\n');
    for (const line of block[1].trimEnd().split('\n')) assert.ok(printed.includes(line), line);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
