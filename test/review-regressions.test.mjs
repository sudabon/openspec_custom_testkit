import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeE2eRoot } from '../lib/cli.mjs';
import { manifestDigest } from '../payload/scripts/lib/digest.mjs';
import { setFrontmatterScalar } from '../payload/scripts/lib/frontmatter.mjs';
import { checkTagPresence, checkTestPlan } from '../payload/scripts/lib/plan-check.mjs';
import { plannedIds, buildReport } from '../payload/scripts/lib/report.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { runCiJob } from '../payload/scripts/ci-job.mjs';
import { gitRepo } from './support.mjs';

function write(repo, path, text) {
  mkdirSync(join(repo.dir, path, '..'), { recursive: true });
  writeFileSync(join(repo.dir, path), text);
}

test('E2E root normalization handles whitespace and repeated separators without allowing escape', () => {
  assert.equal(normalizeE2eRoot(' ./x/ '), 'x');
  assert.equal(normalizeE2eRoot('a//b'), 'a/b');
  for (const path of ['//server/share', ' /tmp/x ', 'x/../y']) assert.throws(() => normalizeE2eRoot(path));
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
