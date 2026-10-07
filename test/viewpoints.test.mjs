import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  for (const reason of ['<理由>', '-', '–', '—', 'TBD', 'tbd', 'TODO', 'todo', '未定', 'なし', 'N/A', 'na', '...', '…', '特になし', 'TBD。', '未定です', '?', '？？', '未定です。', '該当なし', '該当なし（<理由>）', '該当なし(TBD)', '該当なし（TODO）', '該当なし（未定）', '該当なし（なし）', '該当なし（特になし）。', '該当なし（TBD。）']) {
    for (const all of [false, true]) {
      const rows = all ? [['全観点', '', reason]] : fullRows.map(row => row[0] === '性能' ? ['性能', '', reason] : row);
      const result = check({ viewpoints: table(rows), plan: all ? naPlan : requiredPlan() }, { e2e: all ? 'not-applicable' : 'required' });
      assert.ok(result.errors.some(line => /理由/.test(line)), `${reason}, all=${all}: ${result.errors.join(' / ')}`);
    }
  }
});

test('placeholder reasons count as empty when a Failure Mode is assigned', () => {
  for (const reason of ['-', '<理由>', 'TBD', 'TODO', '未定', 'なし', '特になし', 'TBD。', '未定です', '?', '該当なし（N/A）']) {
    const rows = fullRows.map(row => row[0] === '性能' ? ['性能', 'F1', reason] : row);
    assert.deepEqual(check({ viewpoints: table(rows) }).errors, [], reason);
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
  for (const reason of ['入力欄がない。', '対象となる入力は特になし。', '未定項目は表示に影響しない。', '該当なし（画面を変更しない）。']) {
    assert.deepEqual(check({ viewpoints: table([['全観点', '', reason]]), plan: naPlan }, { e2e: 'not-applicable' }).errors, [], reason);
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
    ['openspec/changes/demo/.openspec.yaml', 'schema: quality-driven-e2e\n', /\.openspec.yaml の created がありません/],
    ['openspec/changes/demo/.openspec.yaml', 'created: !custom 2026-09-30\n', /\.openspec.yaml が不正/],
    ['openspec/changes/demo/.openspec.yaml', '- 2026-09-30\n', /\.openspec.yaml が不正/],
    ['openspec/changes/demo/.openspec.yaml', '2026-09-30\n', /\.openspec.yaml が不正/],
    ['openspec/changes/demo/.openspec.yaml', '', /\.openspec.yaml が不正/],
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

test('missing quality.md is reported once with either or both gates enabled', () => {
  const repo = setup({ viewpoints: table(fullRows) });
  try {
    rmSync(join(repo.dir, 'openspec/changes/demo/quality.md'));
    for (const phase of ['plan', 'final']) {
      for (const options of [{}, { quality: false }, { plan: false }]) {
        const result = evaluateChange(repo.dir, change({ tasksText: '- [ ] 1.1 a\n' }), { phase, tags: false, ...options });
        assert.equal(result.failures.filter(line => /quality\.md が/.test(line)).length, 1, JSON.stringify({ phase, options, failures: result.failures }));
        if (phase === 'final' && options.quality !== false) assert.ok(result.failures.includes('未完了タスクが残っています'));
      }
    }
    for (const options of [{}, { quality: false }, { plan: false }]) {
      const result = evaluateChange(repo.dir, change(), { phase: 'final', tags: false, ...options });
      assert.equal(result.failures.filter(line => /quality\.md が/.test(line)).length, 1, JSON.stringify({ options, failures: result.failures }));
      if (options.quality !== false) assert.ok(result.failures.includes('未完了タスクが残っています'));
    }
    rmSync(join(repo.dir, 'openspec/changes/demo/test-plan.md'));
    const missingBoth = evaluateChange(repo.dir, change({ tasksText: '- [ ] 1.1 a\n' }), { phase: 'plan', tags: false });
    assert.equal(missingBoth.failures.filter(line => /quality\.md が/.test(line)).length, 1);
    assert.ok(missingBoth.failures.some(line => /test-plan\.md がありません/.test(line)));
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

test('project spelling variants, duplicate and empty headers are rejected', () => {
  for (const header of ['Project', 'projects', 'PROJECTS', 'Projects（任意）', 'Project (optional)', 'Projets', 'プロジェクト', 'Project名', 'Playwright Projects', 'Target Projects', 'Project names', 'Projects:', 'Projects 任意', 'Ｐｒｏｊｅｃｔｓ', '`Projects`', '**Projects**', 'Ｐｒｏｊｅｃｔｓ：', 'Pro_jects', 'Projects | Projects', 'Notes | Notes', '']) {
    const plan = requiredPlan('chromium, mobile-safari').replace(' Projects |', ` ${header} |`);
    const checked = check({ viewpoints: table(fullRows), plan });
    assert.ok(checked.errors.some(line => /E2E観点一覧.*列/.test(line)), `${header}: ${checked.errors.join(' / ')}`);
    const report = buildReport({ changeId: 'demo', planText: plan, results: results([{ tp: 'TP-001', project: 'chromium', status: 'expected' }]) });
    assert.equal(report.exitCode, 2, header);
    assert.match(report.stderr, /E2E観点一覧.*列/);
    if (!header) {
      assert.ok(checked.errors.some(line => /列 \(空\)/.test(line)));
      assert.match(report.stderr, /列 \(空\)/);
    }
  }
});

test('two empty headers report two empty-column errors without a duplicate error', () => {
  const plan = requiredPlan('chromium').replace(' Projects |', ' | |');
  const checked = check({ viewpoints: table(fullRows), plan });
  assert.equal(checked.errors.length, 2);
  assert.ok(checked.errors.every(line => /列 \(空\)/.test(line)));
  const report = buildReport({ changeId: 'demo', planText: plan, results: results([]) });
  assert.equal(report.exitCode, 2);
  assert.equal(report.stderr.trim().split('\n').length, 2);
  assert.doesNotMatch(report.stderr, /重複/);
});

test('malformed TP IDs cannot disappear behind a passing TP', () => {
  for (const id of ['TP-01', 'tp-003', '`TP-002`', '', 'TP-0001']) {
    const plan = requiredPlan() + `| ${id} | demo | Hidden | R1 | O1 | app | click | 2 |\n`;
    const checked = check({ viewpoints: table(fullRows), plan });
    assert.ok(checked.errors.some(line => /TP-ID.*不正/.test(line)), `${id}: ${checked.errors.join(' / ')}`);
    const report = buildReport({ changeId: 'demo', planText: plan, results: results([{ tp: 'TP-001', project: 'chromium', status: 'expected' }]) });
    assert.equal(report.exitCode, 2, id);
    assert.match(report.stderr, /TP-ID.*不正/);
    assert.ok(report.stderr.includes(id || '(空)'));
  }
});

test('standalone reporter rejects TP rows under not-applicable', () => {
  for (const id of ['TP-001', 'TP-01']) {
    const plan = requiredPlan().replace('e2e: required', 'e2e: not-applicable').replace('TP-001', id);
    const report = buildReport({ changeId: 'demo', planText: plan, results: results([]) });
    assert.equal(report.exitCode, 2, report.stdout);
    assert.match(report.stderr, id === 'TP-001' ? /not-applicable.*TP/ : /TP-ID.*不正/);
  }
  assert.equal(buildReport({ changeId: 'demo', planText: naPlan, results: results([]) }).exitCode, 0);
});

test('custom plan columns preserve coverage with and without Projects', () => {
  for (const projects of [null, 'chromium, mobile-safari']) {
    for (const header of ['備考', 'Notes', '優先度']) {
      const plan = requiredPlan(projects).replace(' Expected |', ` Expected | ${header} |`).replace('| app | click | 1 |', '| app | click | 1 | memo |');
      const checked = check({ viewpoints: table(fullRows), plan });
      assert.deepEqual(checked.errors, [], header);
      assert.deepEqual(checked.projects, projects ? { 'TP-001': ['chromium', 'mobile-safari'] } : {});
      const run = results([{ tp: 'TP-001', project: 'chromium', status: 'expected' }]);
      const report = buildReport({ changeId: 'demo', planText: plan, results: run });
      assert.equal(report.exitCode, projects ? 1 : 0, report.stderr || report.stdout);
      if (projects) assert.match(report.stdout, /mobile-safari 未実行/);
      const all = results([{ tp: 'TP-001', project: 'chromium', status: 'expected' }, { tp: 'TP-001', project: 'mobile-safari', status: 'expected' }]);
      assert.equal(buildReport({ changeId: 'demo', planText: plan, results: all }).exitCode, 0);
    }
  }
});

test('report header validation follows frontmatter even for legacy-schema tables', () => {
  const legacy = readFileSync(new URL('../payload/openspec/schemas/spec-driven-e2e/templates/test-plan.md', import.meta.url), 'utf8');
  const run = results([{ tp: 'TP-001', project: 'chromium', status: 'expected' }]);
  for (const prefix of ['', '---\ne2e: required\n---\n']) {
    const plan = prefix + legacy;
    const checked = check({ viewpoints: '', plan }, { schema: 'spec-driven-e2e', scope: 'legacy-e2e' });
    assert.deepEqual(checked.errors, []);
    assert.equal(buildReport({ changeId: 'demo', planText: plan, results: run }).exitCode, 0);
    const variant = plan.replace(' リスク |', ' Project |');
    // The plan gate uses schema; the standalone reporter uses the explicit frontmatter contract.
    assert.deepEqual(check({ viewpoints: '', plan: variant }, { schema: 'spec-driven-e2e', scope: 'legacy-e2e' }).errors, []);
    const report = buildReport({ changeId: 'demo', planText: variant, results: run });
    assert.equal(report.exitCode, prefix ? 2 : 0);
    if (prefix) assert.match(report.stderr, /列 Project.*Projects/);
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
  assert.doesNotMatch(all.stdout, /skip 条件/);

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
    if (attempts.length) {
      assert.match(report.stdout, /TP-001: chromium は skip のみです。skip 条件を確認してください/);
      assert.doesNotMatch(report.stdout, /Projects の指定/);
    } else {
      assert.match(report.stdout, /TP-001: Projects の指定 \(chromium\).*skip 条件を確認してください/);
      assert.doesNotMatch(report.stdout, /skip のみ/);
    }
  }
});

test('skip-only hints do not mask a failure or a pass on the same project', () => {
  for (const status of ['unexpected', 'expected']) {
    const run = results([{ tp: 'TP-001', project: 'chromium', status: 'skipped' }, { tp: 'TP-001', project: 'chromium', status }]);
    run.suites[0].specs[0].tests[0].results = [{ status: 'skipped' }];
    const report = buildReport({ changeId: 'demo', planText: requiredPlan('chromium'), results: run });
    assert.equal(report.exitCode, status === 'unexpected' ? 3 : 0);
    assert.doesNotMatch(report.stdout, /skip 条件/);
  }
});
