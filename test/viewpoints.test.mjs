import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { checkTestPlan, VIEWPOINTS } from '../payload/scripts/lib/plan-check.mjs';
import { buildReport } from '../payload/scripts/lib/report.mjs';
import { gitRepo } from './support.mjs';

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
    skipSpecs: true,
    pendingPlan: false,
    tasksText: null,
    ...over,
  };
}

function table(rows) {
  return `## Non-functional Viewpoints
| 観点 | Failure Mode | 該当なし理由 |
|------|--------------|--------------|
${rows.map(([name, ids, reason]) => `| ${name} | ${ids} | ${reason} |`).join('\n')}
`;
}

const fullRows = [
  ['クロスブラウザ／デバイス／レスポンシブ', 'F1', ''],
  ['見た目の回帰', 'F1, F2', ''],
  ['アクセシビリティ', 'F3', ''],
  ['文言・多言語', '', '文言を変更しない'],
  ['性能', '', '一覧件数は固定 10 件'],
  ['入力系セキュリティ', '', '入力欄がない'],
];

function quality(viewpoints, layer = 'E2E') {
  return `---
risk_level: low
approved_by: ""
approved_at: ""
oracle_paths: []
oracle_digest: ""
---
## Risk Register
| ID | Level |
|----|-------|
| R1 | low |
## Failure Modes
| ID | Failure Mode | Risk | 観点 |
|----|--------------|------|------|
| F1 | 崩れる | R1 | 表示 |
| F2 | 色が変わる | R1 | 表示 |
| F3 | 読み上げられない | R1 | a11y |
${viewpoints}## Test Oracles
| ID | 対象 |
|----|------|
| O1 | F1 |
## Test Layer Mapping
| Failure Mode | Layer |
|--------------|-------|
| F1 | ${layer} |
| F2 | ${layer} |
| F3 | ${layer} |
## Residual Risk
- なし
`;
}

const requiredPlan = (projects = null) => `---
e2e: required
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |${projects == null ? '' : ' Projects |'}
|-------|-------------|----------|------|--------|---------|--------|----------|${projects == null ? '' : '----------|'}
| TP-001 | demo | Visible | R1 | O1 | app | click | 1 |${projects == null ? '' : ` ${projects} |`}
`;

const naPlan = `---
e2e: not-applicable
reason: 画面がない
alternative_verification:
  - oracle: O1
    layer: Unit
    method: node --test
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
`;

function stamp(repo, since) {
  const features = since === 'none' ? {} : { features: { nonfunctionalViewpoints: since == null ? {} : { since } } };
  write(repo, '.openspec-custom-testkit.json', JSON.stringify({ version: '0.1.0', e2eRoot: 'tests/e2e', ...features }));
}

function setup({ viewpoints, plan = requiredPlan(), created = '2026-10-10', since = '2026-10-01' }) {
  const layer = plan.includes('e2e: not-applicable') ? 'Unit' : 'E2E';
  const repo = gitRepo();
  write(repo, 'openspec/changes/demo/.openspec.yaml', `schema: quality-driven-e2e\n${created == null ? '' : `created: ${created}\n`}`);
  write(repo, 'openspec/changes/demo/quality.md', quality(viewpoints, layer));
  write(repo, 'openspec/changes/demo/test-plan.md', plan);
  stamp(repo, since);
  return repo;
}

function check(options, over = {}) {
  const repo = setup(options);
  try {
    return checkTestPlan(repo.dir, change(over));
  } finally {
    repo.cleanup();
  }
}

test('the six viewpoints are fixed', () => {
  assert.deepEqual(VIEWPOINTS, fullRows.map(row => row[0]));
});

test('a complete viewpoint register passes the plan gate', () => {
  const result = check({ viewpoints: table(fullRows) });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('viewpoint register negatives each fail', () => {
  const cases = [
    ['missing row', fullRows.filter(row => row[0] !== '見た目の回帰'), /見た目の回帰/],
    ['unknown failure mode', fullRows.map(row => row[0] === '性能' ? ['性能', 'F9', ''] : row), /F9/],
    ['reason missing', fullRows.map(row => row[0] === '文言・多言語' ? ['文言・多言語', '該当なし', ''] : row), /文言・多言語.*理由/],
    ['reason without text', fullRows.map(row => row[0] === '文言・多言語' ? ['文言・多言語', '', '該当なし()'] : row), /文言・多言語.*理由/],
    ['both id and reason', fullRows.map(row => row[0] === 'アクセシビリティ' ? ['アクセシビリティ', 'F3', '対象外'] : row), /アクセシビリティ.*両方/],
    ['unknown viewpoint', [...fullRows, ['使いやすさ', 'F1', '']], /使いやすさ/],
    ['duplicate viewpoint', [...fullRows, ['性能', 'F1', '']], /性能.*重複/],
    ['all-viewpoints row under required', [['全観点', '', 'UI 変更なし']], /全観点/],
  ];
  for (const [label, rows, pattern] of cases) {
    const result = check({ viewpoints: table(rows) });
    assert.ok(result.errors.some(line => pattern.test(line)), `${label}: ${result.errors.join(' / ')}`);
  }
});

test('a not-applicable change may cover every viewpoint with one row', () => {
  const ok = check({ viewpoints: table([['全観点', '', 'UI 変更なし']]), plan: naPlan }, { e2e: 'not-applicable' });
  assert.deepEqual(ok.errors, []);
  const six = check({ viewpoints: table(fullRows), plan: naPlan }, { e2e: 'not-applicable' });
  assert.deepEqual(six.errors, []);
  const noReason = check({ viewpoints: table([['全観点', '', '']]), plan: naPlan }, { e2e: 'not-applicable' });
  assert.ok(noReason.errors.some(line => /全観点.*理由/.test(line)), noReason.errors.join(' / '));
  const mixed = check({ viewpoints: table([['全観点', '', 'UI 変更なし'], ['性能', '', '固定']]), plan: naPlan }, { e2e: 'not-applicable' });
  assert.ok(mixed.errors.some(line => /全観点/.test(line)), mixed.errors.join(' / '));
  const partial = check({ viewpoints: table(fullRows.slice(0, 3)), plan: naPlan }, { e2e: 'not-applicable' });
  assert.ok(partial.errors.some(line => /性能/.test(line)), partial.errors.join(' / '));
});

test('a missing register is a warning only for changes created before the feature date', () => {
  const legacy = check({ viewpoints: '', created: '2026-09-30', since: '2026-10-10' });
  assert.deepEqual(legacy.errors, []);
  assert.ok(legacy.warnings.some(line => line.includes('Non-functional Viewpoints')), legacy.warnings.join(' / '));

  const fresh = check({ viewpoints: '', created: '2026-10-10', since: '2026-10-10' });
  assert.ok(fresh.errors.some(line => line.includes('Non-functional Viewpoints')), fresh.errors.join(' / '));

  const noCreated = check({ viewpoints: '', created: null, since: '2026-10-10' });
  assert.ok(noCreated.errors.some(line => line.includes('created')), noCreated.errors.join(' / '));

  const badCreated = check({ viewpoints: '', created: '2026-13-01', since: '2026-10-10' });
  assert.ok(badCreated.errors.some(line => line.includes('created')), badCreated.errors.join(' / '));

  const noSince = check({ viewpoints: '', created: '2026-09-30', since: null });
  assert.ok(noSince.errors.some(line => line.includes('nonfunctionalViewpoints')), noSince.errors.join(' / '));

  const noFeatures = check({ viewpoints: '', created: '2026-09-30', since: 'none' });
  assert.ok(noFeatures.errors.some(line => line.includes('nonfunctionalViewpoints')), noFeatures.errors.join(' / '));
});

test('the legacy warning reaches the gate result', () => {
  const repo = setup({ viewpoints: '', created: '2026-09-30', since: '2026-10-10' });
  try {
    const result = evaluateChange(repo.dir, change({ tasksText: '- [ ] 1.1 a\n' }), { phase: 'plan', quality: false, tags: false });
    assert.deepEqual(result.failures, []);
    assert.ok(result.warnings.some(line => line.includes('Non-functional Viewpoints')), result.warnings.join(' / '));
  } finally {
    repo.cleanup();
  }
});

test('legacy schemas are not asked for the register', () => {
  for (const schema of ['quality-driven', 'spec-driven-e2e']) {
    const repo = setup({ viewpoints: '', created: '2026-10-10', since: '2026-10-01' });
    try {
      write(repo, 'openspec/changes/demo/.openspec.yaml', `schema: ${schema}\ncreated: 2026-10-10\n`);
      write(repo, 'openspec/changes/demo/test-plan.md', '## E2E観点一覧\n| TP-ID |\n| TP-001 |\n');
      const result = checkTestPlan(repo.dir, change({ schema, scope: schema === 'quality-driven' ? 'legacy-qe' : 'legacy-e2e' }));
      assert.ok(!result.errors.some(line => line.includes('Non-functional') || line.includes('観点')), result.errors.join(' / '));
    } finally {
      repo.cleanup();
    }
  }
});

test('Projects column is optional, rejects blank entries and merges duplicates', () => {
  const none = check({ viewpoints: table(fullRows), plan: requiredPlan() });
  assert.deepEqual(none.errors, []);
  const empty = check({ viewpoints: table(fullRows), plan: requiredPlan('') });
  assert.deepEqual(empty.errors, []);
  const listed = check({ viewpoints: table(fullRows), plan: requiredPlan('chromium, mobile-safari') });
  assert.deepEqual(listed.errors, []);
  assert.deepEqual(listed.projects, { 'TP-001': ['chromium', 'mobile-safari'] });
  const blank = check({ viewpoints: table(fullRows), plan: requiredPlan('chromium, , chromium') });
  assert.ok(blank.errors.some(line => line.includes('TP-001') && line.includes('Projects')), blank.errors.join(' / '));
  const dup = check({ viewpoints: table(fullRows), plan: requiredPlan('chromium, chromium') });
  assert.deepEqual(dup.errors, []);
  assert.deepEqual(dup.projects, { 'TP-001': ['chromium'] });
});

function results(rows) {
  return {
    stats: { startTime: '2026-10-07T00:00:00.000Z', duration: 10 },
    suites: [{
      specs: rows.map(row => ({
        title: row.title ?? 'shows the list',
        tags: ['@demo', `@${row.tp ?? 'TP-002'}`],
        tests: [{ projectName: row.project, status: row.status, results: [{ status: row.status === 'unexpected' ? 'failed' : 'passed' }] }],
      })),
    }],
  };
}

const projectPlan = `---
e2e: required
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected | Projects |
|-------|-------------|----------|------|--------|---------|--------|----------|----------|
| TP-001 | demo | A | R1 | O1 | app | a | 1 | |
| TP-002 | demo | B | R1 | O1 | app | b | 2 | chromium, mobile-safari |
`;

function report(rows) {
  return buildReport({ changeId: 'demo', planText: projectPlan, results: results(rows), now: Date.parse('2026-10-07T00:00:01.000Z') });
}

test('reporter requires a pass on every declared project', () => {
  const tp1 = { tp: 'TP-001', project: 'chromium', status: 'expected', title: 'one' };
  const missing = report([tp1, { project: 'chromium', status: 'expected' }]);
  assert.equal(missing.exitCode, 1, missing.stdout);
  assert.match(missing.stdout, /TP-002 \(mobile-safari 未実行\)/);

  const failed = report([tp1, { project: 'chromium', status: 'expected' }, { project: 'mobile-safari', status: 'unexpected' }]);
  assert.equal(failed.exitCode, 3, failed.stdout);

  const both = report([tp1, { project: 'chromium', status: 'unexpected' }]);
  assert.equal(both.exitCode, 3, both.stdout);
  assert.match(both.stdout, /TP-002 \(chromium 未pass, mobile-safari 未実行\)/);

  const all = report([tp1, { project: 'chromium', status: 'expected' }, { project: 'mobile-safari', status: 'flaky' }, { project: 'webkit', status: 'skipped' }]);
  assert.equal(all.exitCode, 0, all.stdout);
  assert.doesNotMatch(all.stdout, /カバレッジ欠落/);

  const undeclared = report([{ tp: 'TP-001', project: 'webkit', status: 'expected', title: 'one' }, { project: 'chromium', status: 'expected' }, { project: 'mobile-safari', status: 'expected' }]);
  assert.equal(undeclared.exitCode, 0, undeclared.stdout);
});
