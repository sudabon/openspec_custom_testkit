import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestForSchema, legacyDigest, manifestDigest } from '../payload/scripts/lib/digest.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { checkTestPlan } from '../payload/scripts/lib/plan-check.mjs';
import { buildReport } from '../payload/scripts/lib/report.mjs';
import { selectChanges } from '../payload/scripts/lib/select.mjs';
import { parseYamlText } from '../payload/scripts/lib/frontmatter.mjs';
import { hasBoundedToken } from '../payload/scripts/lib/markdown.mjs';
import { runCiJob } from '../payload/scripts/ci-job.mjs';
import { gitRepo } from './support.mjs';

const sample = JSON.parse(readFileSync(new URL('./fixtures/legacy-sample-results.json', import.meta.url), 'utf8'));

function write(repo, rel, text) {
  const abs = join(repo.dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}

function change(over = {}) {
  return {
    id: 'demo',
    path: 'openspec/changes/demo',
    schema: 'quality-driven-e2e',
    lifecycle: 'active',
    qe: true,
    e2e: 'required',
    scope: 'integrated',
    reason: '',
    errors: [],
    fallback: false,
    skipSpecs: false,
    pendingPlan: false,
    tasksText: null,
    ...over,
  };
}

function quality(level, extra = '') {
  return `---
risk_level: ${level}
approved_by: ""
approved_at: ""
oracle_paths: ["tests/oracle/demo"]
oracle_digest: ""
---
## Risk Register
| ID | Level |
|----|-------|
| R1 | ${level} |
## Test Oracles
| ID | 対象 |
|----|------|
| O1 | F1 |
## Test Layer Mapping
| Failure Mode | Layer |
|--------------|-------|
| F1 | Unit |
${extra}`;
}

test('yaml rejects duplicates, aliases, and custom tags', () => {
  assert.ok(parseYamlText('a: 1\na: 2\n').errors.length > 0);
  assert.equal(parseYamlText('a: &id 1\nb: *id\n').alias, true);
  assert.equal(parseYamlText('a: !local value\n').tagged, true);
  assert.equal(parseYamlText('a: "quoted: value" # comment\nlist:\n  - 1\n').errors.length, 0);
});

test('token boundaries reject prefixes and regex-like ids', () => {
  assert.equal(hasBoundedToken('add-checkout TP-001', 'add'), false);
  assert.equal(hasBoundedToken('add-checkout', 'add-checkout'), true);
  assert.equal(hasBoundedToken('@add-checkout', 'add-checkout'), true);
  assert.equal(hasBoundedToken('addXa', 'add.a'), false);
  assert.equal(hasBoundedToken('TP-0010', 'TP-001'), false);
  assert.equal(hasBoundedToken('TP-001', 'TP-001'), true);
});

test('legacy sample is a failure for add-checkout and not coverage for another id', () => {
  const plan = '## E2E観点一覧\n| TP-001 |\n| TP-002 |\n| TP-003 |\n';
  const own = buildReport({ changeId: 'add-checkout', planText: plan, results: sample, now: Date.parse('2026-09-04T05:00:00.000Z') });
  assert.equal(own.exitCode, 3);
  assert.match(own.stdout, /実行開始:/);
  const other = buildReport({ changeId: 'demo-change', planText: plan, results: sample, now: Date.parse('2026-09-04T05:00:00.000Z') });
  assert.equal(other.exitCode, 1);
  assert.match(other.stdout, /カバレッジ欠落/);
  const fresh = buildReport({ changeId: 'add-checkout', planText: plan, results: sample, maxAge: 10, now: Date.parse('2026-09-04T05:00:00.000Z') });
  assert.equal(fresh.exitCode, 2);
  assert.equal(fresh.stdout, '');
  const noAge = buildReport({ changeId: 'add-checkout', planText: 'TP-001', results: { suites: [] } });
  assert.equal(noAge.exitCode, 1);
  assert.match(noAge.stdout, /実行開始: 不明/);
});

test('digest rejects an empty set and changes when a file is renamed', () => {
  const repo = gitRepo();
  try {
    assert.equal(manifestDigest(repo.dir, []).error, 'empty');
    assert.equal(legacyDigest(repo.dir, []).digest, '');
    write(repo, 'tests/oracle/demo/a.txt', 'one');
    const first = manifestDigest(repo.dir, ['tests/oracle/demo']);
    write(repo, 'tests/oracle/demo/b.txt', 'one');
    rmSync(join(repo.dir, 'tests/oracle/demo/a.txt'));
    const second = manifestDigest(repo.dir, ['tests/oracle/demo']);
    assert.notEqual(first.digest, second.digest);
    assert.match(first.digest, /^manifest-sha256:/);
    const legacy = legacyDigest(repo.dir, ['tests/oracle/demo']);
    assert.match(legacy.digest, /^sha256:/);
    assert.equal(digestForSchema(repo.dir, 'quality-driven', ['tests/oracle/demo']).digest, legacy.digest);
  } finally {
    repo.cleanup();
  }
});

test('integrated low requires seal and ignores QE_SEAL_REQUIRED_LEVELS', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('low'));
    write(repo, 'tests/oracle/demo/oracle.test.mjs', 'test\n');
    const tasks = '- [x] 1.1 oracle\n- [x] 2.1 implement\n';
    const result = evaluateChange(repo.dir, change({ tasksText: tasks }), {
      phase: 'plan',
      env: { QE_SEAL_REQUIRED_LEVELS: '' },
    });
    assert.ok(result.failures.some(line => line.includes('seal')));
    write(repo, 'openspec/changes/legacy/quality.md', quality('low'));
    const legacy = evaluateChange(repo.dir, change({
      id: 'legacy',
      path: 'openspec/changes/legacy',
      schema: 'quality-driven',
      scope: 'legacy-qe',
      e2e: 'not-applicable',
      tasksText: tasks,
    }), { phase: 'plan', env: { QE_SEAL_REQUIRED_LEVELS: '' } });
    assert.equal(legacy.failures.some(line => line.includes('seal')), false);
  } finally {
    repo.cleanup();
  }
});

test('broken integrated metadata is not treated as out of scope', () => {
  const repo = gitRepo();
  try {
    const base = repo.git(['rev-parse', 'HEAD']).trim();
    write(repo, 'openspec/changes/broken/.openspec.yaml', 'schema: quality-driven-e2e\nschema: other\n');
    repo.commit('broken');
    const selected = selectChanges({ repo: repo.dir, base });
    const broken = selected.changes.find(item => item.id === 'broken');
    assert.equal(selected.ok, false);
    assert.ok(broken.errors.length > 0);
    assert.notEqual(broken.scope, 'out-of-scope');
  } finally {
    repo.cleanup();
  }
});

test('selection keeps schemas apart and fails closed', () => {
  const repo = gitRepo();
  try {
    const base = repo.git(['rev-parse', 'HEAD']).trim();
    write(repo, 'openspec/config.yaml', 'schema: quality-driven\n');
    write(repo, 'openspec/changes/qe/.openspec.yaml', 'schema: quality-driven\n');
    write(repo, 'openspec/changes/e2e/.openspec.yaml', 'schema: spec-driven-e2e\n');
    write(repo, 'openspec/changes/integrated/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/other/.openspec.yaml', 'schema: custom\n');
    repo.commit('add');
    const selected = selectChanges({ repo: repo.dir, base, env: { QE_SCHEMA: 'quality-driven' } });
    const byId = Object.fromEntries(selected.changes.map(item => [item.id, item]));
    assert.equal(byId.qe.qe, true);
    assert.equal(byId.qe.e2e, 'not-applicable');
    assert.equal(byId.e2e.e2e, 'required');
    assert.equal(byId.e2e.qe, false);
    assert.equal(byId.integrated.qe, true);
    assert.equal(byId.other.scope, 'out-of-scope');
    const bad = selectChanges({ repo: repo.dir, base: 'refs/does-not-exist' });
    assert.equal(bad.exitCode, 2);
    const empty = selectChanges({ repo: repo.dir, base });
    assert.equal(empty.changes.length > 0, true);
  } finally {
    repo.cleanup();
  }
});

test('archive is paired once and a pure delete is not success', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/move/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/drop/.openspec.yaml', 'schema: quality-driven\n');
    repo.commit('base');
    const base = repo.git(['rev-parse', 'HEAD']).trim();
    mkdirSync(join(repo.dir, 'openspec/changes/archive'), { recursive: true });
    repo.git(['mv', 'openspec/changes/move', 'openspec/changes/archive/2026-09-22-move']);
    repo.git(['rm', '-r', 'openspec/changes/drop']);
    repo.commit('archive and delete');
    const selected = selectChanges({ repo: repo.dir, base });
    const move = selected.changes.filter(item => item.id === 'move');
    assert.equal(move.length, 1);
    assert.equal(move[0].lifecycle, 'archived');
    const drop = selected.changes.find(item => item.id === 'drop');
    assert.equal(drop.lifecycle, 'deleted');
    assert.equal(selected.ok, false);
  } finally {
    repo.cleanup();
  }
});

test('not-applicable plan is accepted and a required plan without TP is not', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('low', ''));
    write(repo, 'openspec/changes/demo/specs/demo/spec.md', '#### Scenario: Visible\n#### Scenario: Hidden\n');
    write(repo, 'openspec/changes/demo/test-plan.md', `---
e2e: not-applicable
reason: 画面がない
alternative_verification:
  - oracle: O1
    layer: Unit
    method: node --test
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
## 対象外シナリオ
| Scenario | Reason | Oracle | Layer | Method |
|----------|--------|--------|-------|--------|
| Visible | 画面がない | O1 | Unit | node --test |
| Hidden | 内部 | O1 | Unit | node --test |
`);
    const ok = checkTestPlan(repo.dir, change({ e2e: 'not-applicable' }));
    assert.deepEqual(ok.errors, []);
    write(repo, 'openspec/changes/demo/test-plan.md', `---
e2e: required
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
## 対象外シナリオ
| Scenario | Reason | Oracle | Layer | Method |
`);
    const empty = checkTestPlan(repo.dir, change());
    assert.ok(empty.errors.some(line => line.includes('0 件') || line.includes('E2E')));
  } finally {
    repo.cleanup();
  }
});

test('ci job does not turn an invalid ref into an empty success and still runs tests when nothing changed', async () => {
  const repo = gitRepo();
  try {
    write(repo, 'package-lock.json', '{}\n');
    repo.commit('lock');
    const calls = [];
    const execFile = (file, args) => {
      calls.push([file, args.join(' ')]);
      return '';
    };
    const invalid = await runCiJob({
      WORKING_DIRECTORY: '.',
      BASE_REF: 'refs/does-not-exist',
      SETUP_MODE: 'npm',
      TEST_COMMAND: 'echo test',
    }, { cwd: repo.dir, execFile });
    assert.equal(invalid.code, 2);
    assert.equal(calls.some(call => call[1].includes('echo test')), false);

    calls.length = 0;
    const none = await runCiJob({
      WORKING_DIRECTORY: '.',
      BASE_REF: 'HEAD',
      SETUP_MODE: 'npm',
      TEST_COMMAND: 'echo test',
      GATE_PHASE: 'plan',
    }, { cwd: repo.dir, execFile });
    assert.equal(none.code, 0, none.lines.join('\n'));
    assert.ok(calls.some(call => call[1].includes('echo test')));

    const finalGap = await runCiJob({
      WORKING_DIRECTORY: '.',
      BASE_REF: 'HEAD',
      SETUP_MODE: 'caller',
      GATE_PHASE: 'final',
      TEST_COMMAND: '',
    }, { cwd: repo.dir, execFile });
    assert.notEqual(finalGap.code, 0);
    assert.match(finalGap.lines.join('\n'), /test-command/);
  } finally {
    repo.cleanup();
  }
});
