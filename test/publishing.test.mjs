import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, parseReporterArgs } from '../payload/scripts/lib/report.mjs';
import { gitRepo } from './support.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/publishing/', import.meta.url));
const NOW = Date.parse('2026-10-06T00:10:00.000Z');
const fixture = name => readFileSync(join(FIXTURES, name), 'utf8');

// Lay out a run directory with the attachment files the fixture points at, except the one meant to be missing.
function runDir(t) {
  const base = mkdtempSync(join(tmpdir(), 'tk-pub-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'run');
  const outside = join(base, 'elsewhere');
  for (const rel of [
    'test-results/save-chromium/test-failed-1.png',
    'test-results/save-chromium/trace.zip',
    'test-results/save-chromium-retry1/test-failed-1.png',
    'test-results/retry-chromium/test-failed-1.png',
  ]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), 'x');
  }
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'video.webm'), 'x');
  return { root, outside };
}

function load(name, { root, outside }) {
  return JSON.parse(fixture(name).replaceAll('__ROOT__', root).replaceAll('__OUTSIDE__', outside));
}

const MIXED_SUMMARY = `### demo

実行開始: 2026-10-06T00:00:00.000Z (10分前) / 所要 12.3s
合計 5 件: pass 3 / fail 1 / skip 1 / フレーク 1
⚠ カバレッジ欠落: TP-002, TP-004, TP-005 に対応するテストが未実装/未実行

| TP-ID | テスト | project | 結果 | フレーク | 添付 |
|-------|--------|---------|------|----------|------|
| TP-001 | 一覧を表示する | chromium | pass |  | 添付なし |
| TP-001 | 一覧を表示する | webkit | pass |  | 添付なし |
| TP-002 | 保存に失敗する | chromium | fail |  | screenshot: <code>test-results/save-chromium/test-failed-1.png</code><br>trace: <code>test-results/save-chromium/trace.zip</code><br>screenshot: <code>test-results/save-chromium-retry1/test-failed-1.png</code><br>trace: <code>test-results/save-chromium-retry1/missing-trace.zip</code>（ファイルなし）<br>video: 公開対象外 |
| TP-003 | 再試行で通る | chromium | pass | ⚠ | screenshot: <code>test-results/retry-chromium/test-failed-1.png</code><br>server-log: 本文添付（内容は非表示） |
| TP-004 | 条件付きで省略する | chromium | skip |  | 添付なし |
`;

const SINGLE_SUMMARY = `### demo

実行開始: 2026-10-06T00:00:00.000Z (10分前) / 所要 2.0s
合計 1 件: pass 1 / fail 0 / skip 0 / フレーク 0
カバレッジ欠落: なし

| TP-ID | テスト | project | 結果 | フレーク | 添付 |
|-------|--------|---------|------|----------|------|
| TP-001 | 一覧を表示する | chromium | pass |  | 添付なし |
`;

test('summary lists each test with TP-ID, project, result, flakiness and attachments', t => {
  const dirs = runDir(t);
  const summary = buildReport({ changeId: 'demo', planText: fixture('plan.md'), results: load('results.json', dirs), now: NOW, format: 'summary', publishRoot: dirs.root });
  assert.equal(summary.stdout, MIXED_SUMMARY);
  assert.equal(summary.exitCode, 3);
});

test('summary shows the project column even for a single project', t => {
  const dirs = runDir(t);
  const summary = buildReport({ changeId: 'demo', planText: fixture('single-project-plan.md'), results: load('single-project-results.json', dirs), now: NOW, format: 'summary', publishRoot: dirs.root });
  assert.equal(summary.stdout, SINGLE_SUMMARY);
  assert.equal(summary.exitCode, 0);
});

test('summary names missing TPs and exits 1 when nothing failed', t => {
  const dirs = runDir(t);
  const results = load('results.json', dirs);
  results.suites[0].specs = results.suites[0].specs.filter(spec => spec.title !== '保存に失敗する');
  const summary = buildReport({ changeId: 'demo', planText: fixture('plan.md'), results, now: NOW, format: 'summary', publishRoot: dirs.root });
  assert.equal(summary.exitCode, 1);
  assert.match(summary.stdout, /⚠ カバレッジ欠落: TP-002, TP-004, TP-005 に対応するテストが未実装\/未実行/);
});

test('text and summary formats exit with the same code for the same input', t => {
  const dirs = runDir(t);
  const failing = load('results.json', dirs);
  const missing = load('results.json', dirs);
  missing.suites[0].specs = missing.suites[0].specs.filter(spec => spec.title !== '保存に失敗する');
  const cases = [
    ['plan.md', failing, 3],
    ['plan.md', missing, 1],
    ['single-project-plan.md', load('single-project-results.json', dirs), 0],
    ['plan.md', { suites: 'broken' }, 2],
    ['---\ne2e: maybe\n---\n', failing, 2],
  ];
  for (const [plan, results, expected] of cases) {
    const planText = plan.endsWith('.md') ? fixture(plan) : plan;
    const text = buildReport({ changeId: 'demo', planText, results, now: NOW });
    const summary = buildReport({ changeId: 'demo', planText, results, now: NOW, format: 'summary', publishRoot: dirs.root });
    assert.equal(text.exitCode, expected);
    assert.equal(summary.exitCode, expected);
    assert.equal(summary.stderr, text.stderr);
  }
});

test('the default format is byte-identical to the pre-change golden', () => {
  // Goldens were captured before the summary format existed; attachments never reach the text format.
  const dirs = { root: '/runner/work/run', outside: '/runner/elsewhere' };
  for (const [name, plan, results] of [['mixed', 'plan.md', 'results.json'], ['single', 'single-project-plan.md', 'single-project-results.json']]) {
    const report = buildReport({ changeId: 'demo', planText: fixture(plan), results: load(results, dirs), now: NOW });
    assert.equal(`exit ${report.exitCode}\n${report.stdout}`, fixture(`golden/${name}.text.txt`), name);
    const explicit = buildReport({ changeId: 'demo', planText: fixture(plan), results: load(results, dirs), now: NOW, format: 'text' });
    assert.deepEqual(explicit, report);
  }
});

test('reporter arguments accept --format text|summary and reject other values', () => {
  const base = parseReporterArgs(['demo', 'r.json', '--max-age', '60']);
  assert.deepEqual(base, { help: false, maxAge: 60, changeId: 'demo', resultsPath: 'r.json', format: 'text' });
  assert.equal(parseReporterArgs(['demo']).resultsPath, 'test-results/e2e-results.json');
  assert.equal(parseReporterArgs(['demo', '--format', 'summary']).format, 'summary');
  assert.equal(parseReporterArgs(['demo', '--format=text']).format, 'text');
  for (const bad of [['demo', '--format', 'html'], ['demo', '--format'], ['demo', '--format=']]) {
    assert.match(parseReporterArgs(bad).error, /--format/, bad.join(' '));
  }
});

test('summary never leaks runner absolute paths or inline attachment bodies', t => {
  const dirs = runDir(t);
  const summary = buildReport({ changeId: 'demo', planText: fixture('plan.md'), results: load('results.json', dirs), now: NOW, format: 'summary', publishRoot: dirs.root });
  assert.ok(!summary.stdout.includes(dirs.root), 'publish root');
  assert.ok(!summary.stdout.includes(dirs.outside), 'outside directory');
  assert.ok(!summary.stdout.includes(tmpdir()), 'tmpdir');
  assert.ok(!summary.stdout.includes('U0VDUkVULVRPS0VOLTEyMzQ='), 'base64 body');
  assert.ok(!summary.stdout.includes('SECRET-TOKEN-1234'), 'decoded body');
  // A relative path that climbs out of the root and a path given without a publish root are both unpublished.
  const results = load('results.json', dirs);
  results.suites[0].specs[1].tests[0].results[0].attachments = [{ name: 'trace', path: '../elsewhere/video.webm' }];
  const climbed = buildReport({ changeId: 'demo', planText: fixture('plan.md'), results, now: NOW, format: 'summary', publishRoot: dirs.root });
  assert.match(climbed.stdout, /\| fail \|  \| trace: 公開対象外<br>/);
  const rootless = buildReport({ changeId: 'demo', planText: fixture('plan.md'), results: load('results.json', dirs), now: NOW, format: 'summary' });
  assert.ok(!rootless.stdout.includes(dirs.root));
  assert.match(rootless.stdout, /screenshot: 公開対象外/);
});

test('summary distinguishes no attachments from unpublished ones and escapes table cells', t => {
  const dirs = runDir(t);
  const results = load('single-project-results.json', dirs);
  const spec = results.suites[0].specs[0];
  spec.title = 'a | b <!-- c -->\nd';
  spec.tests[0].results[0].attachments = [null, 'x', { name: 'trace', path: join(dirs.outside, 'video.webm') }];
  const summary = buildReport({ changeId: 'demo', planText: fixture('single-project-plan.md'), results, now: NOW, format: 'summary', publishRoot: dirs.root });
  assert.match(summary.stdout, /\| TP-001 \| a \\\| b &lt;!-- c --&gt; d \| chromium \| pass \|  \| trace: 公開対象外 \|/);
  assert.doesNotMatch(summary.stdout, /添付なし/);
});

test('summary rows beyond the limit point at the full summary file', t => {
  const dirs = runDir(t);
  const results = load('single-project-results.json', dirs);
  const spec = results.suites[0].specs[0];
  results.suites[0].specs = Array.from({ length: 5 }, (_, i) => ({ ...spec, title: `case ${i}` }));
  const summary = buildReport({ changeId: 'demo', planText: fixture('single-project-plan.md'), results, now: NOW, format: 'summary', publishRoot: dirs.root, maxRows: 2, overflowRef: 'demo.summary.md' });
  const rows = summary.stdout.split('\n').filter(line => line.startsWith('| TP-001'));
  assert.deepEqual(rows.map(line => line.split(' | ')[1]), ['case 0', 'case 1']);
  assert.match(summary.stdout, /残り 3 件は artifact 内の <code>demo\.summary\.md<\/code> を参照してください/);
  assert.match(summary.stdout, /合計 5 件/);
});

test('e2e-report CLI prints the summary relative to the results directory and rejects unknown formats', t => {
  const repo = gitRepo();
  t.after(() => repo.cleanup());
  const dirs = { root: join(repo.dir, 'run'), outside: join(repo.dir, 'elsewhere') };
  mkdirSync(join(repo.dir, 'openspec/changes/demo'), { recursive: true });
  writeFileSync(join(repo.dir, 'openspec/changes/demo/test-plan.md'), fixture('plan.md'));
  mkdirSync(join(dirs.root, 'test-results/save-chromium'), { recursive: true });
  writeFileSync(join(dirs.root, 'test-results/save-chromium/trace.zip'), 'x');
  writeFileSync(join(dirs.root, 'results.json'), JSON.stringify(load('results.json', dirs)));
  const cli = fileURLToPath(new URL('../payload/scripts/e2e-report.mjs', import.meta.url));
  const run = args => spawnSync(process.execPath, [cli, 'demo', 'run/results.json', ...args], { cwd: repo.dir, encoding: 'utf8' });
  const summary = run(['--format', 'summary']);
  assert.equal(summary.status, 3, summary.stderr);
  assert.match(summary.stdout, /trace: <code>test-results\/save-chromium\/trace\.zip<\/code><br>/);
  assert.ok(!summary.stdout.includes(repo.dir));
  const text = run([]);
  assert.equal(text.status, 3);
  assert.match(text.stdout, /\| TP-ID \| テスト \| 結果 \| フレーク \|/);
  const bad = run(['--format', 'html']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--format/);
  assert.equal(bad.stdout, '');
});

// --- ci-job: per-change summary files, the step summary and the run_dir output ---

function e2eRepo(t, { required = true } = {}) {
  const repo = gitRepo();
  t.after(() => repo.cleanup());
  const base = repo.git(['rev-parse', 'HEAD']).trim();
  mkdirSync(join(repo.dir, 'openspec/changes/demo'), { recursive: true });
  writeFileSync(join(repo.dir, 'openspec/changes/demo/.openspec.yaml'), 'schema: quality-driven-e2e\n');
  writeFileSync(join(repo.dir, 'openspec/changes/demo/test-plan.md'), required ? fixture('plan.md') : '---\ne2e: not-applicable\nreason: 画面なし\n---\n## E2E観点一覧\n| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |\n');
  repo.commit('demo change');
  const summary = join(repo.dir, 'step-summary.md');
  const output = join(repo.dir, 'github-output');
  const env = { WORKING_DIRECTORY: '.', BASE_REF: base, SETUP_MODE: 'caller', TEST_COMMAND: 'echo test', GATE_PHASE: 'plan', GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output };
  return { repo, env, summary, output };
}

// Fake E2E command: writes this run's Playwright JSON and the attachment files under TESTKIT_RUN_DIR.
function e2eExec({ results = name => load('results.json', name) } = {}) {
  return (file, args, opts) => {
    if (!args.join(' ').includes('run-e2e')) return '';
    const root = opts.env.TESTKIT_RUN_DIR;
    for (const rel of ['test-results/save-chromium/trace.zip', 'test-results/save-chromium/test-failed-1.png']) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), 'x');
    }
    const data = results({ root, outside: join(root, '..', '..', 'elsewhere') });
    data.stats.startTime = new Date().toISOString();
    writeFileSync(opts.env.TESTKIT_RESULTS_JSON, JSON.stringify(data));
    return '';
  };
}

const noGate = () => ({ phase: 'plan', warnings: [], failures: [] });

test('ci-job writes <change-id>.summary.md and appends it to the step summary', async t => {
  const { runCiJob } = await import('../payload/scripts/ci-job.mjs');
  const { repo, env, summary, output } = e2eRepo(t);
  const ran = runCiJob({ ...env, E2E_COMMAND: 'run-e2e' }, { cwd: repo.dir, execFile: e2eExec(), evaluateChange: noGate });
  assert.equal(ran.code, 3, ran.lines.join('\n'));
  const file = readFileSync(join(ran.runDir, 'demo.summary.md'), 'utf8');
  assert.match(file, /^### demo\n/);
  assert.match(file, /trace: <code>test-results\/save-chromium\/trace\.zip<\/code>/);
  const step = readFileSync(summary, 'utf8');
  assert.match(step, /^## openspec-custom-testkit E2E\n/);
  assert.ok(step.includes(file), 'step summary carries the change summary');
  assert.ok(!step.includes(repo.dir) && !step.includes(ran.runDir), 'no runner paths');
  // The same text is kept for the PR comment step, and its location is an output.
  const outputs = readFileSync(output, 'utf8');
  const summaryFile = outputs.match(/^summary_file=(.+)$/m)[1];
  assert.equal(readFileSync(summaryFile, 'utf8'), step);
  assert.match(outputs, /^e2e_ran=true$/m);
});

test('ci-job step summary states why E2E did not run and prints no empty table', async t => {
  const { runCiJob } = await import('../payload/scripts/ci-job.mjs');
  const notApplicable = e2eRepo(t, { required: false });
  const skipped = runCiJob(notApplicable.env, { cwd: notApplicable.repo.dir, execFile: () => '', evaluateChange: noGate });
  assert.equal(skipped.code, 0, skipped.lines.join('\n'));
  const step = readFileSync(notApplicable.summary, 'utf8');
  assert.match(step, /E2E は実行していません。E2E required の change がなく、e2e-command も空です。/);
  assert.doesNotMatch(step, /\| TP-ID/);
  assert.match(readFileSync(notApplicable.output, 'utf8'), /^e2e_ran=false$/m);

  const missing = e2eRepo(t);
  const failed = runCiJob(missing.env, { cwd: missing.repo.dir, execFile: () => '', evaluateChange: noGate });
  assert.equal(failed.code, 1);
  const reason = readFileSync(missing.summary, 'utf8');
  assert.match(reason, /E2E は実行していません。E2E required の change \(demo\) がありますが、e2e-command が空です。/);
  assert.doesNotMatch(reason, /\| TP-ID/);
});

test('a step summary that cannot be written is a warning and keeps the exit code', async t => {
  const { runCiJob } = await import('../payload/scripts/ci-job.mjs');
  const { repo, env } = e2eRepo(t);
  const baseline = runCiJob({ ...env, E2E_COMMAND: 'run-e2e', GITHUB_STEP_SUMMARY: '' }, { cwd: repo.dir, execFile: e2eExec(), evaluateChange: noGate });
  for (const target of [repo.dir, join(repo.dir, 'no-such-dir/summary.md')]) {
    const ran = runCiJob({ ...env, E2E_COMMAND: 'run-e2e', GITHUB_STEP_SUMMARY: target }, { cwd: repo.dir, execFile: e2eExec(), evaluateChange: noGate });
    assert.equal(ran.code, baseline.code, target);
    assert.ok(ran.lines.some(line => /^::warning::step summary に書き込めません/.test(line)), ran.lines.join('\n'));
    assert.match(readFileSync(join(ran.summaryDir, 'summary.txt'), 'utf8'), /step summary に書き込めません/);
  }
  // A passing gate stays passing when the summary cannot be written.
  writeFileSync(join(repo.dir, 'openspec/changes/demo/test-plan.md'), fixture('single-project-plan.md'));
  const green = runCiJob({ ...env, E2E_COMMAND: 'run-e2e', GITHUB_STEP_SUMMARY: repo.dir }, {
    cwd: repo.dir,
    execFile: e2eExec({ results: dirs => load('single-project-results.json', dirs) }),
    evaluateChange: noGate,
  });
  assert.equal(green.code, 0, green.lines.join('\n'));
});

test('large suites stay under the step summary limit and point at the artifact summary', async t => {
  const { runCiJob, STEP_SUMMARY_MAX_BYTES, STEP_SUMMARY_MAX_ROWS } = await import('../payload/scripts/ci-job.mjs');
  assert.ok(STEP_SUMMARY_MAX_BYTES <= 1024 * 1024);
  const { repo, env, summary } = e2eRepo(t);
  const many = (count, titleLength) => dirs => {
    const data = load('single-project-results.json', dirs);
    const spec = data.suites[0].specs[0];
    data.suites[0].specs = Array.from({ length: count }, (_, i) => ({ ...spec, title: `case ${i} ${'x'.repeat(titleLength)}` }));
    return data;
  };
  const rows = STEP_SUMMARY_MAX_ROWS + 50;
  const ran = runCiJob({ ...env, E2E_COMMAND: 'run-e2e' }, { cwd: repo.dir, execFile: e2eExec({ results: many(rows, 10) }), evaluateChange: noGate });
  const step = readFileSync(summary, 'utf8');
  assert.equal(step.split('\n').filter(line => line.startsWith('| TP-001')).length, STEP_SUMMARY_MAX_ROWS);
  assert.match(step, /残り 50 件は artifact 内の <code>demo\.summary\.md<\/code> を参照してください/);
  const file = readFileSync(join(ran.runDir, 'demo.summary.md'), 'utf8');
  assert.equal(file.split('\n').filter(line => line.startsWith('| TP-001')).length, rows);

  // Rows within the count limit but too large in bytes are replaced by a pointer as a whole.
  rmSync(summary, { force: true });
  runCiJob({ ...env, E2E_COMMAND: 'run-e2e' }, { cwd: repo.dir, execFile: e2eExec({ results: many(STEP_SUMMARY_MAX_ROWS, 8000) }), evaluateChange: noGate });
  const capped = readFileSync(summary);
  assert.ok(capped.length <= STEP_SUMMARY_MAX_BYTES, `${capped.length} bytes`);
  assert.match(capped.toString('utf8'), /### demo\n\n要約が step summary の上限を超えるため省略しました。artifact 内の <code>demo\.summary\.md<\/code> を参照してください。/);
});

test('run_dir output names only this run even when an earlier run directory remains', async t => {
  const { runCiJob } = await import('../payload/scripts/ci-job.mjs');
  const { repo, env, output } = e2eRepo(t);
  const old = join(repo.dir, 'test-results/testkit/old-run');
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'results.json'), JSON.stringify(load('results.json', { root: old, outside: old })));
  const ran = runCiJob({ ...env, E2E_COMMAND: 'run-e2e' }, { cwd: repo.dir, execFile: e2eExec(), evaluateChange: noGate });
  const lines = readFileSync(output, 'utf8').split('\n').filter(line => line.startsWith('run_dir='));
  assert.deepEqual(lines, [`run_dir=${ran.runDir}`]);
  assert.notEqual(ran.runDir, old);
  assert.ok(existsSync(join(ran.runDir, 'results.json')));
});
