import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseYamlText } from '../payload/scripts/lib/frontmatter.mjs';

const workflow = parseYamlText(readFileSync(new URL('../.github/workflows/openspec-custom-testkit-gate.yml', import.meta.url), 'utf8')).data;
const steps = workflow.jobs.gate.steps;
const step = name => {
  const found = steps.find(item => item.name === name || item.id === name);
  assert.ok(found, name);
  return found;
};
const PUBLISHING = ['Save run artifacts', 'Save Playwright report', 'Link published results', 'Publish PR comment'];
const MARKER = '<!-- openspec-custom-testkit -->';

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tk-wf-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Run a step's script the way GitHub runs `shell: bash`.
function runStep(name, env) {
  const target = step(name);
  assert.equal(target.shell, 'bash', name);
  return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', target.run], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
}

test('workflow declares the publishing inputs with safe defaults', () => {
  const inputs = workflow.on.workflow_call.inputs;
  assert.deepEqual([inputs['publish-pr-comment'].type, inputs['publish-pr-comment'].default], ['boolean', false]);
  assert.deepEqual([inputs['artifact-retention-days'].type, inputs['artifact-retention-days'].default], ['string', '']);
  // The reusable workflow never raises token permissions; PR comments rely on what the caller grants.
  assert.equal(workflow.permissions, undefined);
  assert.equal(workflow.jobs.gate.permissions, undefined);
});

test('retention is validated before the gate and rejects anything but a positive integer', t => {
  const names = steps.map(item => item.name ?? item.uses);
  assert.ok(names.indexOf('Validate publishing inputs') < names.indexOf('Integrated gate'));
  assert.ok(names.indexOf('Validate publishing inputs') < names.indexOf('actions/checkout@v5'));
  const gate = step('job');
  assert.equal(gate.if, undefined, 'the gate is skipped when inputs are invalid');
  assert.equal(step('inputs').env.ARTIFACT_RETENTION_DAYS, '${{ inputs.artifact-retention-days }}');
  for (const value of ['', '1', '7', '90', '400']) {
    const ran = runStep('inputs', { ARTIFACT_RETENTION_DAYS: value });
    assert.equal(ran.status, 0, `${value}: ${ran.stdout}${ran.stderr}`);
  }
  for (const value of ['0', '-1', 'abc', '7.5', ' 7', '07', '7 days', '1e3']) {
    const ran = runStep('inputs', { ARTIFACT_RETENTION_DAYS: value });
    assert.equal(ran.status, 2, value);
    assert.match(ran.stdout, /^::error::artifact-retention-days/m, value);
  }
  for (const name of ['Save run artifacts', 'Save Playwright report']) {
    assert.equal(step(name).with['retention-days'], '${{ inputs.artifact-retention-days }}', name);
  }
});

test('publishing steps run after failures and cannot change the job result', () => {
  const gateIndex = steps.indexOf(step('job'));
  assert.equal(step('job')['continue-on-error'], undefined);
  for (const name of PUBLISHING) {
    const target = step(name);
    assert.ok(steps.indexOf(target) > gateIndex, `${name} runs after the gate`);
    assert.match(target.if, /^always\(\) && steps\.inputs\.outcome == 'success'/, name);
    assert.equal(target['continue-on-error'], true, name);
  }
  // Only the run directory of this run goes into the report artifact; the existing artifact keeps its name.
  assert.equal(step('Save Playwright report').with.path, '${{ steps.job.outputs.run_dir }}');
  assert.equal(step('Save Playwright report').with.name, 'testkit-playwright-report');
  assert.match(step('Save Playwright report').if, /steps\.job\.outputs\.e2e_ran == 'true'/);
  assert.equal(step('Save run artifacts').with.name, 'testkit-results');
  assert.match(step('Publish PR comment').if, /inputs\.publish-pr-comment/);
});

// GitHub marks a job failed when a step fails without continue-on-error; skipped steps do not count.
function jobConclusion(outcomes) {
  return steps.some(item => outcomes[item.name ?? item.uses] === 'failure' && item['continue-on-error'] !== true) ? 'failure' : 'success';
}

test('the job result follows the gate whatever happens to publishing', () => {
  const combos = [
    { gate: 'failure', publish: 'success' },
    { gate: 'failure', publish: 'failure' },
    { gate: 'success', publish: 'failure' },
    { gate: 'success', publish: 'success' },
  ];
  for (const { gate, publish } of combos) {
    const outcomes = { 'Integrated gate': gate };
    for (const name of PUBLISHING) outcomes[name] = publish;
    assert.equal(jobConclusion(outcomes), gate, `gate ${gate} / publish ${publish}`);
  }
});

test('the link step appends run and artifact links and only warns when the summary is unwritable', t => {
  const dir = sandbox(t);
  const summary = join(dir, 'summary.md');
  const env = { RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: summary, RUN_URL: 'https://github.com/o/r/actions/runs/1', REPORT_URL: 'https://github.com/o/r/actions/runs/1/artifacts/2', RESULTS_URL: 'https://github.com/o/r/actions/runs/1/artifacts/3', E2E_RAN: 'true' };
  const ran = runStep('Link published results', env);
  assert.equal(ran.status, 0, ran.stderr);
  const text = readFileSync(summary, 'utf8');
  assert.match(text, /- ワークフロー実行: https:\/\/github\.com\/o\/r\/actions\/runs\/1\n/);
  assert.match(text, /- HTML レポートと今回の結果 \(testkit-playwright-report\): https:\/\/github\.com\/o\/r\/actions\/runs\/1\/artifacts\/2\n/);
  assert.match(text, /- 実行記録 \(testkit-results\): .*artifacts\/3\n/);

  const failedUpload = runStep('Link published results', { ...env, GITHUB_STEP_SUMMARY: join(dir, 'other.md'), REPORT_URL: '' });
  assert.equal(failedUpload.status, 0);
  assert.match(readFileSync(join(dir, 'other.md'), 'utf8'), /保存されていません/);

  const unwritable = runStep('Link published results', { ...env, GITHUB_STEP_SUMMARY: join(dir, 'missing/summary.md') });
  assert.equal(unwritable.status, 0);
  assert.match(unwritable.stdout, /^::warning::step summary に公開先を書き込めません/m);
});

// Fake gh: logs each call and the JSON payload; FAKE_GH_FAIL makes the named method fail like a 403.
function fakeGh(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
method=GET
input=
while [ $# -gt 0 ]; do
  case "$1" in
    --method) method="$2"; shift ;;
    --input) input="$2"; shift ;;
  esac
  shift
done
if [ "$FAKE_GH_FAIL" = "$method" ]; then echo "HTTP 403: Resource not accessible by integration" >&2; exit 1; fi
if [ -n "$input" ]; then cp "$input" "$FAKE_GH_PAYLOAD"; fi
if [ "$method" = GET ]; then printf '%s' "$FAKE_GH_IDS"; fi
`);
  chmodSync(join(bin, 'gh'), 0o755);
  return bin;
}

function commentEnv(t, over = {}) {
  const dir = sandbox(t);
  const bin = fakeGh(dir);
  const summaryFile = join(dir, 'step-summary.md');
  writeFileSync(summaryFile, '## openspec-custom-testkit E2E\n\n### demo\n');
  writeFileSync(join(dir, 'testkit-links.md'), '\n#### 公開先\n\n- ワークフロー実行: https://example.invalid/run\n');
  return {
    dir,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: dir,
      GH_TOKEN: 'dummy',
      REPOSITORY: 'o/r',
      PR_NUMBER: '7',
      SUMMARY_FILE: summaryFile,
      FAKE_GH_LOG: join(dir, 'gh.log'),
      FAKE_GH_PAYLOAD: join(dir, 'payload.json'),
      FAKE_GH_IDS: '',
      FAKE_GH_FAIL: '',
      ...over,
    },
  };
}

test('PR comment is created once with the marker and updated on later runs', t => {
  const created = commentEnv(t);
  const first = runStep('Publish PR comment', created.env);
  assert.equal(first.status, 0, first.stderr);
  const log = readFileSync(created.env.FAKE_GH_LOG, 'utf8');
  assert.match(log, /--method POST repos\/o\/r\/issues\/7\/comments --input/);
  const body = JSON.parse(readFileSync(created.env.FAKE_GH_PAYLOAD, 'utf8')).body;
  assert.ok(body.startsWith(`${MARKER}\n## openspec-custom-testkit E2E\n`));
  assert.match(body, /#### 公開先/);

  const updated = commentEnv(t, { FAKE_GH_IDS: '42\n99\n' });
  assert.equal(runStep('Publish PR comment', updated.env).status, 0);
  const calls = readFileSync(updated.env.FAKE_GH_LOG, 'utf8');
  assert.match(calls, /--method PATCH repos\/o\/r\/issues\/comments\/42 --input/);
  assert.doesNotMatch(calls, /--method POST/);
  // Only the bot's own marked comment is a candidate for update.
  assert.match(step('Publish PR comment').run, /select\(\.user\.login == "github-actions\[bot\]" and \(\.body \| startswith\("<!-- openspec-custom-testkit -->"\)\)\)/);
});

test('PR comment without permission only warns and exits 0', t => {
  for (const [method, verb, ids] of [['GET', '取得', ''], ['POST', '投稿', ''], ['PATCH', '更新', '42']]) {
    const { env } = commentEnv(t, { FAKE_GH_FAIL: method, FAKE_GH_IDS: ids });
    const ran = runStep('Publish PR comment', env);
    assert.equal(ran.status, 0, `${method}: ${ran.stderr}`);
    assert.match(ran.stdout, new RegExp(`^::warning::PR コメントを${verb}できません`, 'm'), method);
  }
});

test('PR comment body travels as data and is shortened past the comment limit', t => {
  const { dir, env } = commentEnv(t);
  const hostile = '### $(touch pwned) `touch pwned2` ${GH_TOKEN} "quoted" \'single\'\n';
  writeFileSync(env.SUMMARY_FILE, hostile);
  assert.equal(runStep('Publish PR comment', { ...env }).status, 0);
  const body = JSON.parse(readFileSync(env.FAKE_GH_PAYLOAD, 'utf8')).body;
  assert.ok(body.includes(hostile), 'body is passed verbatim');
  assert.ok(!existsSync(join(dir, 'pwned')) && !existsSync('pwned') && !existsSync('pwned2'));
  assert.ok(!body.includes('dummy'), 'environment is not expanded into the body');

  writeFileSync(env.SUMMARY_FILE, `${'| row |\n'.repeat(9000)}`);
  assert.equal(runStep('Publish PR comment', env).status, 0);
  const short = JSON.parse(readFileSync(env.FAKE_GH_PAYLOAD, 'utf8')).body;
  assert.ok(short.length < 1000);
  assert.match(short, /PR コメントの上限を超えるため省略しました/);
  assert.match(short, /#### 公開先/);

  rmSync(env.SUMMARY_FILE);
  assert.equal(runStep('Publish PR comment', env).status, 0);
  assert.match(JSON.parse(readFileSync(env.FAKE_GH_PAYLOAD, 'utf8')).body, /要約はありません/);
});
