import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, normalizeE2eRoot } from '../lib/cli.mjs';
import { legacyDigest, manifestDigest } from '../payload/scripts/lib/digest.mjs';
import { doctor } from '../payload/scripts/lib/doctor.mjs';
import { installedE2eRoot } from '../payload/scripts/lib/e2e-root.mjs';
import { setFrontmatterScalar, splitFrontmatter } from '../payload/scripts/lib/frontmatter.mjs';
import { checkTagPresence, checkTestPlan, tpRows } from '../payload/scripts/lib/plan-check.mjs';
import { plannedIds, buildReport } from '../payload/scripts/lib/report.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { selectChanges } from '../payload/scripts/lib/select.mjs';
import { runCiJob } from '../payload/scripts/ci-job.mjs';
import { capture, gitRepo } from './support.mjs';

function write(repo, path, text) {
  mkdirSync(join(repo.dir, path, '..'), { recursive: true });
  writeFileSync(join(repo.dir, path), text);
}

const script = rel => fileURLToPath(new URL(`../payload/scripts/${rel}`, import.meta.url));

test('E2E root normalization handles whitespace and repeated separators without allowing escape', () => {
  assert.equal(normalizeE2eRoot(' ./x/ '), 'x');
  assert.equal(normalizeE2eRoot('a//b'), 'a/b');
  assert.equal(normalizeE2eRoot('a/./b/.'), 'a/b');
  for (const path of ['//server/share', ' /tmp/x ', 'x/../y', '.', './.', ' ./ ']) assert.throws(() => normalizeE2eRoot(path));
});

test('installer refuses the repository root as the E2E root', async () => {
  const repo = gitRepo();
  try {
    await assert.rejects(main(['install', '--dry-run', '--target', repo.dir, '--e2e-root', '.']), /リポジトリ直下/);
  } finally { repo.cleanup(); }
});

test('gates re-validate the E2E root read back from current and legacy stamps', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/a.spec.ts', 'test("@demo @TP-001", () => {});');
    write(repo, '.openspec-custom-testkit.json', JSON.stringify({ e2eRoot: './tests/e2e/' }));
    assert.equal(installedE2eRoot(repo.dir), 'tests/e2e');
    assert.deepEqual(checkTagPresence(repo.dir, { id: 'demo' }, ['TP-001']), []);
    for (const [file, e2eRoot] of [['.openspec-custom-testkit.json', '../../elsewhere'], ['.openspec-custom-testkit.json', '.'], ['.openspec-e2e-kit.json', '/etc']]) {
      rmSync(join(repo.dir, '.openspec-custom-testkit.json'), { force: true });
      write(repo, file, JSON.stringify({ e2eRoot }));
      assert.throws(() => installedE2eRoot(repo.dir), error => error.code === 'BROKEN_STAMP' && error.message.includes(file));
      assert.match(checkTagPresence(repo.dir, { id: 'demo' }, ['TP-001']).join('\n'), /e2eRoot が不正です/);
    }
  } finally { repo.cleanup(); }
});

test('an invalid recorded E2E root blocks doctor and install until --e2e-root rewrites the stamp', async () => {
  const repo = gitRepo();
  const legacyOnly = gitRepo();
  try {
    write(repo, '.openspec-custom-testkit.json', JSON.stringify({ e2eRoot: '.' }));
    assert.match(doctor(repo.dir).failures.join('\n'), /\.openspec-custom-testkit\.json の e2eRoot が不正です/);
    const blocked = await capture(main, ['install', '--dry-run', '--target', repo.dir]);
    assert.equal(blocked.code, 1, blocked.text);
    assert.match(blocked.text, /\.openspec-custom-testkit\.json の e2eRoot が不正です/);
    const repaired = await capture(main, ['install', '--force', '--target', repo.dir, '--e2e-root', 'tests/e2e']);
    assert.equal(repaired.code, 0, repaired.text);
    assert.match(repaired.text, /不正なため使いません/);
    assert.equal(installedE2eRoot(repo.dir), 'tests/e2e');

    write(legacyOnly, '.openspec-e2e-kit.json', JSON.stringify({ version: '0.2.0', e2eRoot: '/abs/e2e' }));
    assert.equal((await capture(main, ['install', '--dry-run', '--target', legacyOnly.dir])).code, 1);
    const legacy = await capture(main, ['install', '--dry-run', '--target', legacyOnly.dir, '--e2e-root', 'e2e']);
    assert.equal(legacy.code, 0, legacy.text);
    assert.match(legacy.text, /\.openspec-e2e-kit\.json の e2eRoot は不正なため使いません/);
  } finally {
    repo.cleanup();
    legacyOnly.cleanup();
  }
});

test('testkit-gate rejects --base and --phase without a value instead of scanning every change', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/unrelated/.openspec.yaml', 'schema: quality-driven-e2e\n');
    for (const args of [['check', '--phase', 'final', '--base'], ['check', '--base', ''], ['check', '--phase'], ['select', '--base']]) {
      const result = spawnSync(process.execPath, [script('testkit-gate.mjs'), ...args], { cwd: repo.dir, encoding: 'utf8' });
      assert.equal(result.status, 2, args.join(' '));
      assert.match(result.stderr, /--(base|phase) には/);
      assert.doesNotMatch(result.stdout, /unrelated/);
    }
  } finally { repo.cleanup(); }
});

test('CI keeps large passing output and reports an output overflow as undecidable', () => {
  const repo = gitRepo();
  try {
    const large = runCiJob({ ...process.env, BASE_REF: 'HEAD', SETUP_MODE: 'caller', TEST_COMMAND: 'node -e "process.stdout.write(\'x\'.repeat(2 * 1024 * 1024))"' }, { cwd: repo.dir });
    assert.equal(large.code, 0, large.lines.join('\n').slice(0, 500));
    const buffers = [];
    const overflow = runCiJob({ BASE_REF: 'HEAD', SETUP_MODE: 'caller', TEST_COMMAND: 'noisy' }, {
      cwd: repo.dir,
      execFile: (_file, _args, options) => {
        buffers.push(options.maxBuffer);
        throw Object.assign(new Error('spawnSync bash ENOBUFS'), { code: 'ENOBUFS', status: null, stdout: 'partial', stderr: '' });
      },
    });
    assert.equal(overflow.code, 2);
    assert.match(overflow.lines.join('\n'), /64 MiB を超えた/);
    assert.ok(buffers.length && buffers.every(size => size >= 64 * 1024 * 1024));
    assert.equal(readFileSync(join(overflow.runDir, 'test.log'), 'utf8'), 'partial');
    assert.equal(existsSync(join(overflow.runDir, 'manifest.json')), false);
  } finally { repo.cleanup(); }
});

test('quality: false skips archived legacy QE evidence, and quality: true checks it once', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/archive/2026-09-22-legacy/quality.md', '| R1 | low |\n');
    write(repo, 'openspec/changes/archive/2026-09-22-legacy/evidence.md', 'R1\n');
    const legacy = {
      id: 'legacy', path: 'openspec/changes/archive/2026-09-22-legacy', schema: 'quality-driven', scope: 'legacy-qe',
      lifecycle: 'archived', qe: true, e2e: 'not-applicable', errors: [], tasksText: '- [ ] 1.1 open\n',
    };
    const skipped = evaluateChange(repo.dir, legacy, { quality: false, plan: true });
    assert.deepEqual(skipped.failures, []);
    assert.deepEqual(skipped.warnings, []);
    const checked = evaluateChange(repo.dir, legacy, { quality: true, plan: false });
    assert.equal(checked.warnings.filter(line => line === 'structure: legacy').length, 1);
    assert.equal(checked.failures.filter(line => line.includes('未完了タスク')).length, 1);
  } finally { repo.cleanup(); }
});

test('integrated seal is enforced for unnumbered and CRLF implementation tasks; legacy keeps the numbered rule', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/oracle/demo/oracle.test.mjs', 'test\n');
    write(repo, 'openspec/changes/demo/quality.md', '---\nrisk_level: low\napproved_by: "FIXTURE-DUMMY-APPROVAL"\napproved_at: "2026-09-22"\noracle_paths: ["tests/oracle/demo"]\noracle_digest: ""\n---\n## Risk Register\n| ID | Level |\n|----|-------|\n| R1 | low |\n');
    const failures = (tasksText, schema = 'quality-driven-e2e') => evaluateChange(repo.dir, {
      id: 'demo', path: 'openspec/changes/demo', schema, scope: schema === 'quality-driven' ? 'legacy-qe' : 'integrated',
      lifecycle: 'active', qe: true, e2e: 'not-applicable', errors: [], tasksText,
    }, { phase: 'plan', plan: false, env: { QE_SEAL_REQUIRED_LEVELS: 'low medium high' } }).failures.join('\n');
    for (const tasks of [
      '- [x] Implement the handler\n',
      '- [x] 1.1 oracle\r\n- [x] 2.1 impl\r\n',
      '## 2. Implementation\n- [x] Implement the handler\n',
      '## 1. Oracle\n- [ ] 1.1 oracle\n## Notes\n- [x] Implement the handler\n',
    ]) {
      assert.match(failures(tasks), /seal が必要/, JSON.stringify(tasks));
    }
    for (const tasks of ['## 1. Oracle\n- [x] Write the oracle\n- [ ] 2.1 impl\n', '# Tasks\n## 1. Oracle\n### Unit\n- [x] Write the oracle\n- [ ] 2.1 impl\n']) {
      assert.doesNotMatch(failures(tasks), /seal/, JSON.stringify(tasks));
    }
    assert.doesNotMatch(failures('- [x] Implement the handler\n', 'quality-driven'), /seal/);
    assert.match(failures('- [x] 2.1 impl\n', 'quality-driven'), /seal が必要/);
  } finally { repo.cleanup(); }
});

test('legacy digest ignores oracle_paths overlap and still accepts seals written by upstream qe-gate.sh', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/oracle/a.test.mjs', 'a');
    write(repo, 'tests/oracle/core/b.test.mjs', 'b');
    const merged = legacyDigest(repo.dir, ['tests/oracle']);
    const overlapping = legacyDigest(repo.dir, ['tests/oracle/core', 'tests/oracle']);
    assert.equal(overlapping.digest, merged.digest);
    assert.deepEqual(overlapping.files, merged.files);
    assert.equal(merged.compatDigest, undefined);
    const quality = recorded => `---\nrisk_level: medium\napproved_by: "FIXTURE-DUMMY-APPROVAL"\noracle_paths: ["tests/oracle", "tests/oracle/core"]\noracle_digest: "${recorded}"\n---\n## Risk Register\n| ID | Level |\n|----|-------|\n| R1 | medium |\n`;
    write(repo, 'openspec/changes/legacy/quality.md', quality(''));
    const upstreamGate = fileURLToPath(new URL('../upstream/baselines/qe/payload/scripts/qe-gate.sh', import.meta.url));
    const upstream = execFileSync('bash', [upstreamGate, 'digest', 'legacy'], { cwd: repo.dir, encoding: 'utf8' }).trim();
    assert.equal(overlapping.compatDigest, upstream);
    assert.notEqual(upstream, merged.digest);
    const legacy = {
      id: 'legacy', path: 'openspec/changes/legacy', schema: 'quality-driven', scope: 'legacy-qe',
      lifecycle: 'active', qe: true, e2e: 'not-applicable', errors: [], tasksText: '- [x] 2.1 impl\n- [ ] 3.1 evidence\n',
    };
    for (const recorded of [upstream, merged.digest]) {
      write(repo, 'openspec/changes/legacy/quality.md', quality(recorded));
      assert.deepEqual(evaluateChange(repo.dir, legacy, { phase: 'plan', env: {} }).failures, []);
    }
    write(repo, 'openspec/changes/legacy/quality.md', quality('sha256:deadbeef'));
    assert.match(evaluateChange(repo.dir, legacy, { phase: 'plan', env: {} }).failures.join('\n'), /再 seal/);
  } finally { repo.cleanup(); }
});

test('reporter resolves plans from the repository root, including archives, and rejects path-like ids', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/archive/2026-09-22-shop/test-plan.md', '---\ne2e: required\n---\n## E2E観点一覧\n| TP-ID |\n|-------|\n| TP-001 |\n');
    write(repo, 'app/results.json', JSON.stringify({
      stats: { startTime: new Date().toISOString() },
      suites: [{ specs: [{ title: 'buy', tags: ['@shop', '@TP-001'], tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }] }],
    }));
    const cwd = join(repo.dir, 'app');
    const ok = spawnSync(process.execPath, [script('e2e-report.mjs'), 'shop', 'results.json'], { cwd, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    for (const id of ['../../..', 'archive', 'shop/../../x']) {
      const bad = spawnSync(process.execPath, [script('e2e-report.mjs'), id, 'results.json'], { cwd, encoding: 'utf8' });
      assert.equal(bad.status, 2, id);
      assert.match(bad.stderr, /change が存在しません/);
    }
  } finally { repo.cleanup(); }
});

test('qe-gate seal and digest reject path-like change names before touching files', () => {
  const repo = gitRepo();
  try {
    const quality = '---\napproved_by: "FIXTURE-DUMMY-APPROVAL"\noracle_paths: ["outside"]\noracle_digest: ""\n---\n';
    write(repo, 'outside/quality.md', quality);
    for (const command of ['seal', 'digest']) {
      const result = spawnSync(process.execPath, [script('qe-gate.mjs'), command, '../../outside'], { cwd: repo.dir, encoding: 'utf8' });
      assert.equal(result.status, 2, command);
      assert.match(result.stderr, /change 名が不正です/);
    }
    assert.equal(readFileSync(join(repo.dir, 'outside/quality.md'), 'utf8'), quality);
  } finally { repo.cleanup(); }
});

test('reporter and gate read TP-IDs from the same table column', () => {
  const repo = gitRepo();
  try {
    const change = { id: 'demo', path: 'openspec/changes/demo', schema: 'quality-driven-e2e', scope: 'integrated', e2e: 'required', skipSpecs: true };
    const plan = '---\ne2e: required\n---\n## E2E観点一覧\n| ID | Requirement |\n|----|-------------|\n| TP-001 | demo |\n';
    for (const [text, expected] of [[plan, []], [plan.replace('| ID |', '| TP-ID |'), ['TP-001']]]) {
      write(repo, 'openspec/changes/demo/test-plan.md', text);
      assert.deepEqual(plannedIds(text).ids, expected);
      assert.deepEqual(tpRows(text).map(row => row['TP-ID']), expected);
      assert.deepEqual(checkTestPlan(repo.dir, change).requiredTags, expected);
    }
    const report = buildReport({ changeId: 'demo', planText: plan, results: { suites: [] } });
    assert.equal(report.exitCode, 1);
    assert.match(report.stdout, /required の TP が 0 件です/);
  } finally { repo.cleanup(); }
});

test('tag presence reads only test sources once per gate run', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/README.md', '@demo @TP-001');
    write(repo, 'tests/e2e/trace.zip', Buffer.from([0, 0xff, 0xfe, 0x40]));
    assert.match(checkTagPresence(repo.dir, { id: 'demo' }, ['TP-001']).join('\n'), /@demo が tests\/e2e にありません/);
    write(repo, 'tests/e2e/demo.spec.ts', 'test("x", { tag: ["@demo", "@TP-001"] }, () => {});');
    const cache = {};
    assert.deepEqual(checkTagPresence(repo.dir, { id: 'demo' }, ['TP-001'], cache), []);
    const corpus = cache.tagCorpus;
    assert.equal(corpus.texts.length, 1);
    checkTagPresence(repo.dir, { id: 'other' }, ['TP-001'], cache);
    assert.equal(cache.tagCorpus, corpus);
  } finally { repo.cleanup(); }
});

test('seal updates CRLF frontmatter preserving line endings and body', () => {
  assert.equal(setFrontmatterScalar('---\r\noracle_digest: ""\r\n---\r\nbody\r\n', 'oracle_digest', 'hash'),
    '---\r\noracle_digest: "hash"\r\n---\r\nbody\r\n');
});

test('reporter rejects malformed or incomplete frontmatter instead of treating it as legacy', () => {
  for (const fm of ['e2e: required\ne2e: dup', 'other: value']) {
    const result = plannedIds(`---\n${fm}\n---\nprose TP-099`);
    assert.equal(result.applicability, 'unknown');
    assert.ok(result.error);
  }
  assert.deepEqual(plannedIds('TP-001').ids, ['TP-001']);
});

test('report freshness rejects invalid numeric limits at the library boundary', () => {
  for (const maxAge of [NaN, -1, Infinity]) {
    assert.equal(buildReport({ changeId: 'demo', planText: 'TP-001', results: {}, maxAge }).exitCode, 2);
  }
});

test('manifest digest describes a file set independent of order and overlap', () => {
  const repo = gitRepo();
  try {
    write(repo, 'oracle/a', 'a');
    write(repo, 'oracle/b', 'b');
    const canonical = manifestDigest(repo.dir, ['oracle']);
    assert.deepEqual(manifestDigest(repo.dir, ['oracle/b', 'oracle/a']), canonical);
    assert.deepEqual(manifestDigest(repo.dir, ['oracle', 'oracle/a']), canonical);
  } finally { repo.cleanup(); }
});

test('dangling links produce actionable gate failures in Oracle, specs and E2E trees', () => {
  const repo = gitRepo();
  try {
    mkdirSync(join(repo.dir, 'tests/e2e'), { recursive: true });
    symlinkSync('missing', join(repo.dir, 'tests/e2e/dangling'));
    const digest = manifestDigest(repo.dir, ['tests/e2e']);
    assert.equal(digest.error, 'MISSING');
    assert.match(digest.path, /dangling/);
    const errors = checkTagPresence(repo.dir, { id: 'demo' }, ['TP-001']);
    assert.match(errors.join('\n'), /dangling/);
    write(repo, 'openspec/changes/demo/test-plan.md', '---\ne2e: required\n---\n');
    mkdirSync(join(repo.dir, 'openspec/changes/demo/specs'), { recursive: true });
    symlinkSync('missing', join(repo.dir, 'openspec/changes/demo/specs/dangling'));
    const plan = checkTestPlan(repo.dir, { id: 'demo', path: 'openspec/changes/demo', schema: 'quality-driven-e2e', e2e: 'required' });
    assert.match(plan.errors.join('\n'), /dangling/);
  } finally { repo.cleanup(); }
});

test('missing test-plan is reported once per change', () => {
  const repo = gitRepo();
  try {
    const result = evaluateChange(repo.dir, {
      id: 'demo', path: 'openspec/changes/demo', schema: 'quality-driven-e2e', scope: 'integrated',
      lifecycle: 'active', e2e: 'unknown', pendingPlan: true, tasksText: '- [ ] 1.1 todo', errors: [],
    });
    assert.equal(result.failures.filter(line => line.includes('test-plan.md')).length, 1);
  } finally { repo.cleanup(); }
});

test('CI validates selection and max age before dependency setup', () => {
  const repo = gitRepo();
  try {
    write(repo, 'package-lock.json', '{}');
    for (const env of [{ BASE_REF: 'missing' }, { BASE_REF: 'HEAD', REPORT_MAX_AGE: '5m' }, { BASE_REF: 'HEAD', REPORT_MAX_AGE: '-1' }]) {
      const calls = [];
      const result = runCiJob({ ...env, SETUP_MODE: 'npm', E2E_COMMAND: 'e2e' }, { cwd: repo.dir, execFile: (...args) => { calls.push(args); return ''; } });
      assert.equal(result.code, 2);
      assert.equal(calls.length, 0);
    }
  } finally { repo.cleanup(); }
});

test('CI finalization of one change leaves fresh proposals in plan phase', () => {
  const repo = gitRepo();
  try {
    const base = repo.git(['rev-parse', 'HEAD']).trim();
    write(repo, 'openspec/changes/archive/2026-09-22-done/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/fresh/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/fresh/proposal.md', '# Proposal');
    repo.commit();
    const result = runCiJob({ BASE_REF: base, SETUP_MODE: 'caller', GATE_PHASE: 'plan' }, { cwd: repo.dir });
    assert.ok(result.lines.includes('▶ fresh (active/plan)'), result.lines.join('\n'));
    assert.match(result.lines.join('\n'), /test-command/);
  } finally { repo.cleanup(); }
});

test('shipped Playwright example writes JSON to the CI-provided output path', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('..', import.meta.url));
  mkdirSync(join(root, '.tmp'), { recursive: true });
  const dir = mkdtempSync(join(root, '.tmp/reporter-'));
  try {
    const config = readFileSync(join(root, 'payload/playwright.config.example.ts'), 'utf8');
    writeFileSync(join(dir, 'playwright.config.ts'), config);
    mkdirSync(join(dir, 'tests/e2e'), { recursive: true });
    writeFileSync(join(dir, 'tests/e2e/example.spec.ts'), "import { test, expect } from '@playwright/test';\ntest('report @demo @TP-001', () => expect(1).toBe(1));\n");
    const output = join(dir, 'ci/results.json');
    execFileSync(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', join(dir, 'playwright.config.ts')], {
      cwd: dir, env: { ...process.env, TESTKIT_RESULTS_JSON: output }, stdio: 'pipe',
    });
    const report = buildReport({ changeId: 'demo', planText: 'TP-001', results: JSON.parse(readFileSync(output, 'utf8')) });
    assert.equal(report.exitCode, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('seal replaces only the scalar with mixed and CR-only line endings', () => {
  for (const text of ['---\noracle_digest: ""\n---\nbody\r\nmore\n', '---\roracle_digest: ""\r---\rbody\r']) {
    const sealed = setFrontmatterScalar(text, 'oracle_digest', 'hash');
    assert.equal(sealed, text.replace('oracle_digest: ""', 'oracle_digest: "hash"'));
    assert.equal(splitFrontmatter(sealed).data.oracle_digest, 'hash');
  }
});

test('linked directories retain E2E tags, scenarios and Oracle contents without recursion loops', () => {
  const repo = gitRepo();
  try {
    write(repo, 'shared/a.spec.ts', 'test("@demo @TP-001", () => {});');
    write(repo, 'shared/spec.md', '#### Scenario: linked scenario\n');
    mkdirSync(join(repo.dir, 'tests/e2e'), { recursive: true });
    symlinkSync('../../shared', join(repo.dir, 'tests/e2e/linked'));
    symlinkSync('.', join(repo.dir, 'shared/cycle'));
    assert.deepEqual(checkTagPresence(repo.dir, { id: 'demo' }, ['TP-001']), []);
    assert.deepEqual(manifestDigest(repo.dir, ['tests/e2e']).files, ['tests/e2e/linked/a.spec.ts', 'tests/e2e/linked/spec.md']);
    write(repo, 'openspec/changes/demo/test-plan.md', '---\ne2e: required\n---\n');
    symlinkSync('../../../shared', join(repo.dir, 'openspec/changes/demo/specs'));
    const plan = checkTestPlan(repo.dir, { id: 'demo', path: 'openspec/changes/demo', schema: 'quality-driven-e2e', e2e: 'required' });
    assert.ok(plan.errors.some(line => line.includes('シナリオ未割当: linked scenario')));
  } finally { repo.cleanup(); }
});

test('unreadable Oracle files and directories report their exact path and error code', () => {
  const repo = gitRepo();
  try {
    write(repo, 'oracle/first', 'ok');
    write(repo, 'oracle/locked/file', 'secret');
    for (const path of ['oracle/locked', 'oracle/locked/file']) {
      chmodSync(join(repo.dir, path), 0);
      try {
        const result = manifestDigest(repo.dir, ['oracle']);
        assert.equal(result.error, 'UNREADABLE');
        assert.equal(result.path, path);
        assert.equal(result.code, 'EACCES');
      } finally { chmodSync(join(repo.dir, path), 0o755); }
    }
    symlinkSync('loop', join(repo.dir, 'oracle/loop'));
    const loop = manifestDigest(repo.dir, ['oracle']);
    assert.equal(loop.error, 'UNREADABLE');
    assert.equal(loop.path, 'oracle/loop');
    assert.equal(loop.code, 'ELOOP');
  } finally { repo.cleanup(); }
});

test('blank risk levels are invalid instead of being dropped from the maximum', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/demo/quality.md', `---
risk_level: low
approved_by: "FIXTURE-DUMMY-APPROVAL"
approved_at: "2026-09-22"
oracle_paths: []
oracle_digest: ""
---
## Risk Register
| ID | Level |
|----|-------|
| R1 | low |
| R2 |  |
`);
    const result = evaluateChange(repo.dir, {
      id: 'demo', path: 'openspec/changes/demo', schema: 'quality-driven-e2e', scope: 'integrated',
      lifecycle: 'active', qe: true, e2e: 'not-applicable', errors: [], tasksText: '- [ ] 1.1 open\n', skipSpecs: true,
    }, { phase: 'plan', plan: false });
    assert.match(result.failures.join('\n'), /Risk が不正です: '\(空\)'/);
    assert.equal(result.oks.some(line => line.startsWith('risk_level:')), false);
  } finally { repo.cleanup(); }
});

test('QE_SCHEMA sends a custom schema through the legacy quality checks', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/custom/.openspec.yaml', 'schema: custom-qe\n');
    write(repo, 'openspec/changes/custom/tasks.md', '- [x] 1.1 done\n');
    const selected = selectChanges({ repo: repo.dir, names: ['custom'], env: { QE_SCHEMA: 'custom-qe' } });
    assert.equal(selected.changes[0].qe, true);
    assert.equal(selected.changes[0].scope, 'out-of-scope');
    const checked = evaluateChange(repo.dir, selected.changes[0], { phase: 'plan', quality: true, plan: false });
    assert.match(checked.failures.join('\n'), /quality\.md がないまま tasks\.md が作成されています/);
    const ignored = selectChanges({ repo: repo.dir, names: ['custom'], env: {} });
    const skipped = evaluateChange(repo.dir, ignored.changes[0], { phase: 'plan' });
    assert.deepEqual(skipped.failures, []);
    assert.match(skipped.warnings.join('\n'), /無関係な schema/);
  } finally { repo.cleanup(); }
});

test('CI preserves summaries and outputs when HEAD disappears during a command', () => {
  const repo = gitRepo();
  try {
    const output = join(repo.dir, 'github-output');
    const result = runCiJob({ ...process.env, BASE_REF: 'HEAD', SETUP_MODE: 'caller', TEST_COMMAND: 'git symbolic-ref HEAD refs/heads/unborn', GITHUB_OUTPUT: output }, { cwd: repo.dir });
    assert.equal(result.code, 2);
    assert.match(result.lines.join('\n'), /revision/);
    assert.match(readFileSync(output, 'utf8'), /risk_level=none/);
    assert.ok(readFileSync(join(result.summaryDir, 'summary.txt'), 'utf8').includes('revision'));
  } finally { repo.cleanup(); }
});
