import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCiJob } from '../payload/scripts/ci-job.mjs';
import { main } from '../lib/cli.mjs';
import { capture, gitRepo, tempDir, writeIn } from './support.mjs';

// Whole-output snapshots of runCiJob and the installer. They pin the order and wording of every line so that
// splitting these functions into smaller ones cannot silently reorder or drop output.

const FIXTURES = fileURLToPath(new URL('./fixtures/publishing/', import.meta.url));
const fixture = name => readFileSync(join(FIXTURES, name), 'utf8');
// Captured from the code before the split. Regenerate only for an intended output change, never to make a refactor pass.
const EXPECTED_PATH = fileURLToPath(new URL('./fixtures/output-baseline.json', import.meta.url));
// Opt in explicitly: UPDATE_OUTPUT_BASELINE=1 node --test test/output-baseline.test.mjs
const UPDATE = process.env.UPDATE_OUTPUT_BASELINE === '1';
const EXPECTED = UPDATE ? null : JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));
const generated = { ci: {} };
after(() => {
  if (UPDATE) {
    assert.equal(Object.keys(generated.ci).length, Object.keys(CI_CASES).length);
    assert.ok(generated.install, 'installer snapshot was not generated');
    writeFileSync(EXPECTED_PATH, `${JSON.stringify(generated, null, 2)}\n`);
  }
});

function normalize(text, { repo, runDir }) {
  let out = String(text);
  if (runDir) out = out.replaceAll(runDir, '<run>');
  out = out.replaceAll(realpathSync(repo), '<repo>').replaceAll(repo, '<repo>');
  return out
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<time>')
    .replace(/testkit\/[0-9a-z]+-summary/g, 'testkit/<summary>')
    .replace(/\(\d+(?:秒|分)前\)/g, '(<age>)')
    .replace(/所要 [\d.]+s/g, '所要 <dur>');
}

function ciRepo(t) {
  const repo = gitRepo(t);
  const base = repo.git(['rev-parse', 'HEAD']).trim();
  writeIn(repo.dir, 'openspec/changes/demo/.openspec.yaml', 'schema: quality-driven-e2e\n');
  writeIn(repo.dir, 'openspec/changes/demo/test-plan.md', fixture('plan.md'));
  writeIn(repo.dir, 'openspec/changes/demo/quality.md', '---\nrisk_level: high\n---\n# Quality\n');
  const runs = [{ id: 'R-test', command: 'echo test', exit_code: 0 }, { id: 'R-other', command: 'never ran', exit_code: 0 }];
  writeIn(repo.dir, 'openspec/changes/demo/evidence.md', `# Evidence\n## Execution Records\n\`\`\`json\n${JSON.stringify({ runs })}\n\`\`\`\n`);
  repo.commit('demo change');
  const env = {
    WORKING_DIRECTORY: '.', BASE_REF: base, SETUP_MODE: 'caller', GATE_PHASE: 'plan',
    GITHUB_STEP_SUMMARY: join(repo.dir, 'step-summary.md'), GITHUB_OUTPUT: join(repo.dir, 'github-output'),
  };
  return { repo, env };
}

// Fake commands: every call is logged; the E2E and regression commands write this run's JSON.
function fakeExec(calls, { failing = {} } = {}) {
  return (file, args, opts) => {
    const command = args.at(-1);
    calls.push(`${file} ${args.join(' ')}`);
    if (command === 'run-e2e') {
      const root = opts.env.TESTKIT_RUN_DIR;
      const data = JSON.parse(fixture('single-project-results.json').replaceAll('__ROOT__', root).replaceAll('__OUTSIDE__', root));
      data.stats.startTime = new Date().toISOString();
      writeFileSync(opts.env.TESTKIT_RESULTS_JSON, JSON.stringify(data));
    }
    if (command === 'run-regression') writeFileSync(opts.env.TESTKIT_RESULTS_JSON, JSON.stringify({ suites: [], stats: { startTime: new Date().toISOString() } }));
    if (failing[command]) {
      const error = new Error(`${command} failed`);
      error.status = failing[command];
      error.stdout = `${command} out\n`;
      error.stderr = `${command} err\n`;
      throw error;
    }
    return `${command} ok\n`;
  };
}

function ciSnapshot(ran, repo, calls) {
  const ctx = { repo: repo.dir, runDir: ran.runDir };
  const manifestPath = ran.runDir && join(ran.runDir, 'manifest.json');
  const manifest = manifestPath && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const strip = run => ({ id: run.id.replace(/^[0-9a-z]+-[0-9a-f]{6}-/, '<id>-'), command: run.command, exit_code: run.exit_code, ...(run.change_id ? { change_id: run.change_id } : {}) });
  return {
    code: ran.code,
    calls,
    lines: normalize(ran.lines.join('\n'), ctx).split('\n'),
    riskLevel: ran.riskLevel ?? null,
    phase: ran.phase ?? null,
    e2eRan: ran.e2eRan ?? null,
    stepSummary: normalize(ran.stepSummary, ctx),
    stepSummaryFile: normalize(readFileSync(join(repo.dir, 'step-summary.md'), 'utf8'), ctx),
    githubOutput: normalize(readFileSync(join(repo.dir, 'github-output'), 'utf8'), ctx),
    summaryTxt: normalize(readFileSync(join(ran.summaryDir, 'summary.txt'), 'utf8'), ctx),
    runFiles: ran.runDir ? execFileSync('find', ['.', '-maxdepth', '1', '-type', 'f'], { cwd: ran.runDir, encoding: 'utf8' }).split('\n').filter(Boolean).sort() : null,
    manifest: manifest && {
      run_ids: manifest.run_ids,
      runs: manifest.runs.map(strip),
      executions: manifest.executions.map(strip),
    },
  };
}

const CI_CASES = {
  'every stage runs and the first failing exit code wins': {
    env: {
      SETUP_COMMAND: 'setup', TEST_COMMAND: 'echo test', MUTATION_COMMAND: 'mutate', CONTRACT_COMMAND: 'contract',
      E2E_COMMAND: 'run-e2e', REGRESSION_COMMAND: 'run-regression', COVERAGE_STRICT: 'true',
    },
    failing: { mutate: 4, contract: 5 },
  },
  'missing commands for a final high-risk E2E change are reported in order': {
    env: { GATE_PHASE: 'final' },
  },
  'npm setup installs the browser before the commands': {
    env: { SETUP_MODE: 'npm', TEST_COMMAND: 'echo test', MUTATION_COMMAND: 'mutate', E2E_COMMAND: 'run-e2e' },
    lockfile: true,
  },
  'an early setup failure stops before any command': {
    env: { SETUP_MODE: 'invalid', TEST_COMMAND: 'echo test' },
  },
};


for (const [name, spec] of Object.entries(CI_CASES)) {
  test(`ci-job output baseline: ${name}`, t => {
    const { repo, env } = ciRepo(t);
    if (spec.lockfile) writeIn(repo.dir, 'package-lock.json', '{}\n');
    const calls = [];
    const ran = runCiJob({ ...env, ...spec.env }, { cwd: repo.dir, execFile: fakeExec(calls, spec) });
    const snapshot = ciSnapshot(ran, repo, calls);
    if (UPDATE) { generated.ci[name] = snapshot; return; }
    assert.deepEqual(snapshot, EXPECTED.ci[name]);
  });
}

// --- installer ---

const NO_CLI = () => {
  const error = new Error('not found');
  error.code = 'ENOENT';
  throw error;
};

// Payload files grow as modules are added; the listing and the created count are not what these snapshots pin.
const PAYLOAD_COUNT = readdirSync(fileURLToPath(new URL('../payload/', import.meta.url)), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name !== '.DS_Store').length;

async function install(args, target) {
  const lines = [];
  const code = await main([...args, '--target', target], {
    log: message => lines.push(`log ${message}`),
    error: message => lines.push(`err ${message}`),
    stdin: { isTTY: false },
    execFile: NO_CLI,
    today: '2026-10-07',
  });
  const text = lines.join('\n').replaceAll(target, '<target>')
    .replace(/v\d+\.\d+\.\d+/, 'v<version>')
    .replace(/version \d+\.\d+\.\d+/, 'version <version>')
    .replace(`作成: ${PAYLOAD_COUNT} 件`, '作成: <payload> 件');
  return { code, lines: text.split('\n').filter(line => !line.startsWith('log   create  ')) };
}

function gitTarget(t) {
  const target = tempDir('tk-install-');
  t.after(() => rmSync(target, { recursive: true, force: true }));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', target, 'init'], { stdio: 'ignore' });
  return target;
}


test('installer output baseline: dry-run, install, repeat, and edited files', async t => {
  const target = gitTarget(t);
  const out = {};
  out.dryRun = await install(['install', '--dry-run', '--language', 'Japanese'], target);
  out.install = await install(['install', '--language', 'Japanese'], target);
  out.repeat = await install(['update'], target);
  writeFileSync(join(target, 'scripts/check-test-plan.sh'), '#!/usr/bin/env bash\n# edited\nexit 0\n');
  writeFileSync(join(target, 'openspec/quality-policy.md'), '# edited policy\n');
  mkdirSync(join(target, 'openspec/specs'), { recursive: true });
  out.edited = await install(['update'], target);
  out.editedDryRun = await install(['update', '--dry-run'], target);
  out.forced = await install(['update', '--force'], target);
  const { files, installedAt, version, ...stamp } = JSON.parse(readFileSync(join(target, '.openspec-custom-testkit.json'), 'utf8'));
  out.stamp = { ...stamp, fileCount: Object.keys(files).length === PAYLOAD_COUNT - 1, installedAt: typeof installedAt, version: typeof version };
  const plain = tempDir('tk-install-');
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  out.nonGit = await install(['install'], plain);
  if (UPDATE) { generated.install = out; return; }
  assert.deepEqual(out, EXPECTED.install);
});
