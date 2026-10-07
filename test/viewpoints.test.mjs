import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    ['empty viewpoint', fullRows.map((row, index) => index === 0 ? ['', 'F1', ''] : row), /観点 空/],
    ['duplicate viewpoint', [...fullRows, ['性能', 'F1', '']], /性能.*重複/],
    ['all-viewpoints row under required', [['全観点', '', 'UI 変更なし']], /全観点/],
  ];
  for (const [label, rows, pattern] of cases) {
    const result = check({ viewpoints: table(rows) });
    assert.ok(result.errors.some(line => pattern.test(line)), `${label}: ${result.errors.join(' / ')}`);
  }
});

test('placeholder-only reasons fail for both individual and all-viewpoint rows', () => {
  for (const reason of ['<理由>', '-', '–', '—', 'TBD', 'tbd', 'N/A', 'na', '...', '…', '該当なし', '該当なし（<理由>）', '該当なし(TBD)']) {
    for (const all of [false, true]) {
      const rows = all ? [['全観点', '', reason]] : fullRows.map(row => row[0] === '性能' ? ['性能', '', reason] : row);
      const result = check({ viewpoints: table(rows), plan: all ? naPlan : requiredPlan() }, { e2e: all ? 'not-applicable' : 'required' });
      assert.ok(result.errors.some(line => /理由/.test(line)), `${reason}, all=${all}: ${result.errors.join(' / ')}`);
    }
  }
});

test('supported viewpoint spelling and separator variants pass', () => {
  const rows = [
    ['クロスブラウザ / デバイス / レスポンシブ', 'F1', ''],
    ['見た目の回帰', 'F1、F2 F3', ''],
    ['アクセシビリティ', 'F3', ''],
    ['文言・多言語', '該当なし', '文言を変更しない'],
    ['性能', '', '該当なし（一覧件数は固定 10 件）'],
    ['入力系セキュリティ', '', '該当なし(入力欄がない)'],
  ];
  assert.deepEqual(check({ viewpoints: table(rows) }).errors, []);
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
  const withId = check({ viewpoints: table([['全観点', 'F1', '']]), plan: naPlan }, { e2e: 'not-applicable' });
  assert.ok(withId.errors.some(line => /全観点.*理由だけ/.test(line)), withId.errors.join(' / '));
});

test('all-viewpoint diagnostic describes the allowed e2e value even when e2e is unknown', () => {
  const result = check({ viewpoints: table([['全観点', '', 'UI 変更なし']]) }, { e2e: 'unknown' });
  assert.ok(result.errors.some(line => /全観点.*e2e: not-applicable.*現在: unknown/.test(line)), result.errors.join(' / '));
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

test('metadata diagnostics distinguish missing files, malformed content and invalid dates', () => {
  const cases = [
    ['openspec/changes/demo/.openspec.yaml', null, /\.openspec.yaml がありません/],
    ['openspec/changes/demo/.openspec.yaml', 'created: [', /\.openspec.yaml が不正/],
    ['openspec/changes/demo/.openspec.yaml', 'created: &date 2026-09-30\ncopy: *date\n', /\.openspec.yaml が不正/],
    ['openspec/changes/demo/.openspec.yaml', 'created: 2026-13-01\n', /created が不正/],
    ['.openspec-custom-testkit.json', null, /\.openspec-custom-testkit.json がありません/],
    ['.openspec-custom-testkit.json', '{', /\.openspec-custom-testkit.json が不正/],
    ['.openspec-custom-testkit.json', '[]', /\.openspec-custom-testkit.json が不正/],
    ['.openspec-custom-testkit.json', '{"features":{"nonfunctionalViewpoints":{"since":"2026-13-01"}}}', /since が不正/],
  ];
  for (const [path, content, pattern] of cases) {
    const repo = setup({ viewpoints: '', created: '2026-09-30' });
    try {
      if (content == null) rmSync(join(repo.dir, path));
      else write(repo, path, content);
      const result = checkTestPlan(repo.dir, change());
      assert.ok(result.errors.some(line => pattern.test(line)), `${path}: ${result.errors.join(' / ')}`);
      assert.deepEqual(result.warnings, []);
    } finally {
      repo.cleanup();
    }
  }
});

test('plan-only evaluation fails when quality.md is missing', () => {
  const repo = setup({ viewpoints: table(fullRows) });
  try {
    rmSync(join(repo.dir, 'openspec/changes/demo/quality.md'));
    const result = evaluateChange(repo.dir, change({ tasksText: '- [ ] 1.1 a\n' }), { phase: 'plan', quality: false, tags: false });
    assert.ok(result.failures.some(line => /quality.md がありません.*Non-functional Viewpoints/.test(line)), result.failures.join(' / '));
  } finally {
    repo.cleanup();
  }
});

test('check-test-plan CLI emits only plan warnings and rejects a missing quality.md', () => {
  for (const missingQuality of [false, true]) {
    const repo = setup({ viewpoints: '', plan: naPlan, created: '2026-09-30', since: '2026-10-10' });
    try {
      write(repo, 'openspec/changes/demo/.openspec.yaml', 'schema: quality-driven-e2e\ncreated: 2026-09-30\nskip_specs: true\n');
      write(repo, 'openspec/changes/demo/tasks.md', '- [ ] 1.1 a\n');
      // This unfinished change creates an evaluateChange warning, outside checkTestPlan.
      write(repo, 'openspec/changes/pending/.openspec.yaml', 'schema: quality-driven-e2e\n');
      if (missingQuality) rmSync(join(repo.dir, 'openspec/changes/demo/quality.md'));
      repo.commit();
      const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../payload/scripts/check-test-plan.mjs', import.meta.url)), 'HEAD^'], { cwd: repo.dir, encoding: 'utf8' });
      assert.equal(cli.status, missingQuality ? 1 : 0, `${cli.stdout}\n${cli.stderr}`);
      if (missingQuality) assert.match(cli.stderr, /::error::demo: quality.md がありません/);
      else assert.match(cli.stdout, /::warning::demo: quality.md に ## Non-functional Viewpoints がありません/);
      assert.doesNotMatch(cli.stdout, /::warning::pending: 計画途中/);
    } finally {
      repo.cleanup();
    }
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
  const japanese = check({ viewpoints: table(fullRows), plan: requiredPlan('chromium、mobile-safari') });
  assert.deepEqual(japanese.errors, []);
  assert.deepEqual(japanese.projects, listed.projects);
});

test('unknown or duplicate plan headers cannot silently disable project coverage', () => {
  for (const header of ['Project', 'projects', 'Projects（任意）', 'Projets', 'Projects | Projects']) {
    const plan = requiredPlan('chromium, mobile-safari').replace(' Projects |', ` ${header} |`);
    const checked = check({ viewpoints: table(fullRows), plan });
    assert.ok(checked.errors.some(line => /E2E観点一覧.*列/.test(line)), `${header}: ${checked.errors.join(' / ')}`);
    const report = buildReport({ changeId: 'demo', planText: plan, results: results([{ tp: 'TP-001', project: 'chromium', status: 'expected' }]) });
    assert.equal(report.exitCode, 2, header);
    assert.match(report.stderr, /E2E観点一覧.*列/);
  }
});

test('reporter rejects empty Projects entries even without the plan gate', () => {
  const report = buildReport({ changeId: 'demo', planText: requiredPlan('chromium, , chromium'), results: results([]) });
  assert.equal(report.exitCode, 2);
  assert.match(report.stderr, /TP-001.*Projects.*空/);
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

test('reporter accepts Japanese project separators and diagnoses unexecuted or misspelled projects', () => {
  const run = results([{ tp: 'TP-001', project: 'chromium', status: 'expected' }, { tp: 'TP-001', project: 'mobile-safari', status: 'expected' }]);
  const passed = buildReport({ changeId: 'demo', planText: requiredPlan('chromium、mobile-safari'), results: run });
  assert.equal(passed.exitCode, 0, passed.stdout);
  const typo = buildReport({ changeId: 'demo', planText: requiredPlan('chromiun'), results: run });
  assert.equal(typo.exitCode, 1);
  assert.match(typo.stdout, /TP-001 \(chromiun 未実行\)/);
  assert.match(typo.stdout, /Projects の指定 \(chromiun\).*project 名・実行対象・skip 条件/);
  for (const attempts of [[], [{ status: 'skipped' }]]) {
    const skipped = results([{ tp: 'TP-001', project: 'chromium', status: 'skipped' }]);
    skipped.suites[0].specs[0].tests[0].results = attempts;
    const report = buildReport({ changeId: 'demo', planText: requiredPlan('chromium'), results: skipped });
    assert.equal(report.exitCode, 1);
    assert.match(report.stdout, attempts.length ? /TP-001 \(chromium 未pass\)/ : /TP-001 \(chromium 未実行\)/);
  }
});
