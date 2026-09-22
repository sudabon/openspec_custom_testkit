import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli.mjs';
import { doctor } from '../payload/scripts/lib/doctor.mjs';
import { digestForSchema } from '../payload/scripts/lib/digest.mjs';
import { sha256File } from '../payload/scripts/lib/hash.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { checkTestPlan } from '../payload/scripts/lib/plan-check.mjs';
import { buildReport } from '../payload/scripts/lib/report.mjs';
import { selectChanges } from '../payload/scripts/lib/select.mjs';
import { runCiJob } from '../payload/scripts/ci-job.mjs';
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
    e2e: 'not-applicable',
    scope: 'integrated',
    reason: '',
    errors: [],
    fallback: false,
    skipSpecs: true,
    pendingPlan: false,
    tasksText: '- [x] 1.1 a\n- [x] 2.1 b\n- [x] 3.1 c\n- [x] 4.1 d\n- [x] 5.1 e\n',
    ...over,
  };
}

function results(specs) {
  return {
    stats: { startTime: '2026-09-22T00:00:00.000Z', duration: 10 },
    suites: [{
      specs: specs.map(spec => ({
        title: spec.title,
        tags: spec.tags ?? [],
        tests: [{
          projectName: spec.project ?? '',
          status: spec.status,
          results: spec.attempts === 0 ? [] : [{ status: spec.attemptStatus ?? spec.status }],
        }],
      })),
    }],
  };
}

const plan = '## E2E観点一覧\n| TP-ID |\n| TP-001 |\n| TP-002 |\n';

test('reporter classifies attempt status and prefers failure over a coverage gap', () => {
  const tagged = { title: 'adds one', tags: ['@add-checkout', '@TP-001'] };
  const pass = buildReport({
    changeId: 'add-checkout',
    planText: 'TP-001',
    results: results([{ ...tagged, status: 'expected' }]),
    now: Date.parse('2026-09-22T00:00:01.000Z'),
  });
  assert.equal(pass.exitCode, 0);
  assert.match(pass.stdout, /pass 1/);

  const skip = buildReport({
    changeId: 'add-checkout',
    planText: 'TP-001',
    results: results([{ ...tagged, status: 'skipped' }]),
    now: Date.parse('2026-09-22T00:00:01.000Z'),
  });
  assert.equal(skip.exitCode, 1);
  assert.match(skip.stdout, /skip 1/);

  const none = buildReport({
    changeId: 'add-checkout',
    planText: 'TP-001',
    results: results([{ ...tagged, status: 'expected', attempts: 0 }]),
    now: Date.parse('2026-09-22T00:00:01.000Z'),
  });
  assert.equal(none.exitCode, 1);
  assert.match(none.stdout, /no-attempt/);

  const unknown = buildReport({
    changeId: 'add-checkout',
    planText: 'TP-001',
    results: results([{ ...tagged, status: 'unknown' }]),
    now: Date.parse('2026-09-22T00:00:01.000Z'),
  });
  assert.equal(unknown.exitCode, 1);
  assert.match(unknown.stdout, /unknown/);

  const flaky = buildReport({
    changeId: 'add-checkout',
    planText: 'TP-001',
    results: results([{ ...tagged, status: 'flaky' }]),
    now: Date.parse('2026-09-22T00:00:01.000Z'),
  });
  assert.equal(flaky.exitCode, 0);
  assert.match(flaky.stdout, /⚠/);

  const both = buildReport({
    changeId: 'add-checkout',
    planText: plan,
    results: results([
      { ...tagged, status: 'unexpected' },
      { title: 'other project', tags: ['@add-checkout', '@TP-001'], status: 'expected', project: 'firefox' },
    ]),
    now: Date.parse('2026-09-22T00:00:01.000Z'),
  });
  assert.equal(both.exitCode, 3);
  assert.match(both.stdout, /\[firefox\]/);
  assert.match(both.stdout, /カバレッジ欠落: TP-002/);
});

function evidenceRepo(level) {
  const repo = gitRepo();
  mkdirSync(join(repo.dir, 'tests/oracle/demo'), { recursive: true });
  writeFileSync(join(repo.dir, 'tests/oracle/demo/oracle.txt'), 'oracle\n');
  mkdirSync(join(repo.dir, 'test-results'), { recursive: true });
  writeFileSync(join(repo.dir, 'test-results/run.json'), '{}\n');
  const digest = digestForSchema(repo.dir, 'quality-driven-e2e', ['tests/oracle/demo']).digest;
  const revision = repo.git(['rev-parse', 'HEAD']).trim();
  write(repo, 'openspec/quality-policy.md', 'mutation_threshold_high: 70\n| Oracle の seal | 必須 | 必須 | 必須 |\n| Falsification レビュー | 必須 | 必須 | 必須 |\n');
  write(repo, 'openspec/changes/demo/quality.md', `---
risk_level: ${level}
approved_by: "FIXTURE-DUMMY-APPROVAL"
approved_at: "2026-09-22"
oracle_paths: ["tests/oracle/demo"]
oracle_digest: "${digest}"
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
`);
  write(repo, 'openspec/changes/demo/test-plan.md', `---
e2e: not-applicable
reason: 画面なし
alternative_verification:
  - oracle: O1
    layer: Unit
    method: node --test
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
## 対象外シナリオ
| Scenario | Reason | Oracle | Layer | Method |
`);
  const hash = sha256File(join(repo.dir, 'test-results/run.json'));
  const data = {
    format_version: 1,
    runs: [{
      id: 'run-1', command: 'node --test', started_at: '2026-09-22T00:00:00.000Z', revision,
      exit_code: 0, source: 'test-results/run.json', source_sha256: hash,
    }],
    risk_results: [{ risk: 'R1', failure_modes: ['F1'], oracles: ['O1'], layer: 'Unit', tp_ids: [], result: 'pass', run_ids: ['run-1'] }],
    falsification: { performed: true, summary: 'zero delta rejected', counterexamples: [] },
    mutation: level === 'high'
      ? { command: 'mut', status: 'passed', score: 80, threshold: 70 }
      : { command: '', status: 'not-required', score: null, threshold: 70 },
    reviews: level === 'low' ? [] : [{ reviewer: 'FIXTURE-DUMMY-APPROVAL', includes_domain_owner: level === 'high' }],
    oracle_changes: [],
    residuals: [],
  };
  return { repo, digest, revision, data };
}

function putEvidence(ctx, data, prose = '- なし') {
  write(ctx.repo, 'openspec/changes/demo/evidence.md', `# Evidence\n## 追跡\n| Risk | Result |\n|------|--------|\n| R1 | pass |\n## Execution Records\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n## Oracle Changes\n${prose}\n`);
}

test('falsification, residual, review, and mutation fail independently', () => {
  const low = evidenceRepo('low');
  try {
    low.data.falsification = { performed: false, summary: '', counterexamples: [] };
    putEvidence(low, low.data);
    const missing = evaluateChange(low.repo.dir, change(), { phase: 'final', tags: false });
    assert.ok(missing.failures.some(line => line.includes('独立反証')));
    assert.equal(missing.failures.some(line => line.includes('Mutation')), false);
  } finally {
    low.repo.cleanup();
  }

  const residual = evidenceRepo('high');
  try {
    residual.data.falsification = {
      performed: true,
      summary: 'counterexample remains',
      counterexamples: [{ id: 'C1', status: 'residual', residual_id: 'S1' }],
    };
    putEvidence(residual, residual.data);
    const unresolved = evaluateChange(residual.repo.dir, change(), { phase: 'final', tags: false });
    assert.ok(unresolved.failures.some(line => line.includes('Residual')));
    assert.equal(unresolved.failures.some(line => line.includes('Mutation')), false);
  } finally {
    residual.repo.cleanup();
  }

  const review = evidenceRepo('medium');
  try {
    review.data.reviews = [];
    putEvidence(review, review.data);
    const bare = evaluateChange(review.repo.dir, change(), { phase: 'final', tags: false });
    assert.ok(bare.failures.some(line => line.includes('Human Code Review')));
  } finally {
    review.repo.cleanup();
  }

  const mutation = evidenceRepo('high');
  try {
    mutation.data.mutation = { command: '', status: 'not-run', score: null, threshold: 70 };
    putEvidence(mutation, mutation.data);
    const absent = evaluateChange(mutation.repo.dir, change(), { phase: 'final', tags: false });
    assert.ok(absent.failures.some(line => line.includes('未指定')));
    assert.ok(absent.failures.some(line => line.includes('結果がありません')));
    mutation.data.mutation = { command: 'mut', status: 'passed', score: 10, threshold: 70 };
    putEvidence(mutation, mutation.data);
    const weak = evaluateChange(mutation.repo.dir, change(), { phase: 'final', tags: false });
    assert.ok(weak.failures.some(line => line.includes('閾値未満')));
  } finally {
    mutation.repo.cleanup();
  }
});

test('evidence separates structure from execution and keeps legacy risk-id checks', () => {
  const ctx = evidenceRepo('low');
  try {
    putEvidence(ctx, ctx.data);
    const structural = evaluateChange(ctx.repo.dir, change(), { phase: 'final', tags: false });
    assert.equal(structural.failures.length, 0, structural.failures.join('\n'));
    assert.ok(structural.warnings.includes('structure: pass'));
    assert.ok(structural.warnings.includes('execution: unverified'));

    const mismatched = evaluateChange(ctx.repo.dir, change(), {
      phase: 'final',
      tags: false,
      manifest: { revision: '0'.repeat(40), run_ids: ['run-1'] },
    });
    assert.ok(mismatched.failures.some(line => line.includes('一致しません')));
    assert.ok(mismatched.warnings.includes('structure: fail'));

    putEvidence(ctx, ctx.data, '再sealした');
    const reseal = evaluateChange(ctx.repo.dir, change(), { phase: 'final', tags: false });
    assert.ok(reseal.failures.some(line => line.includes('再sealの履歴が JSON にありません')));

    ctx.data.oracle_changes = [{
      reason: 'expected value changed',
      approved_by: 'FIXTURE-DUMMY-APPROVAL',
      approved_at: '2026-09-22',
      digest: 'deadbeef',
    }];
    putEvidence(ctx, ctx.data, '再sealした');
    const stale = evaluateChange(ctx.repo.dir, change(), { phase: 'final', tags: false });
    assert.ok(stale.failures.some(line => line.includes('digest が現在の seal と一致しません')));

    write(ctx.repo, 'openspec/changes/legacy/quality.md', '| R1 | low |\n| R2 | low |\n');
    write(ctx.repo, 'openspec/changes/legacy/evidence.md', 'R1 だけを書いた\n');
    const legacy = evaluateChange(ctx.repo.dir, change({
      id: 'legacy',
      path: 'openspec/changes/legacy',
      schema: 'quality-driven',
      qe: true,
      e2e: 'not-applicable',
      scope: 'legacy-qe',
      lifecycle: 'archived',
      tasksText: '- [x] 1.1 done\n',
    }), { phase: 'plan', tags: false, plan: false });
    assert.ok(legacy.failures.some(line => line.includes('R2')));
    assert.equal(legacy.failures.some(line => line.includes('JSON')), false);
    assert.ok(legacy.warnings.includes('structure: legacy'));
  } finally {
    ctx.repo.cleanup();
  }
});

test('archived integrated evidence is final and a non-archive rename stays a delete', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/move/.openspec.yaml', 'schema: quality-driven-e2e\n');
    repo.commit('base');
    const base = repo.git(['rev-parse', 'HEAD']).trim();
    repo.git(['mv', 'openspec/changes/move', 'openspec/changes/renamed']);
    repo.commit('rename');
    const selected = selectChanges({ repo: repo.dir, base });
    const removed = selected.changes.find(item => item.id === 'move');
    assert.equal(removed.lifecycle, 'deleted');
    assert.equal(selected.ok, false);
    const archived = evaluateChange(repo.dir, change({
      lifecycle: 'archived',
      tasksText: '- [ ] 2.1 still open\n',
    }), { phase: 'plan', tags: false });
    assert.equal(archived.phase, 'final');
    assert.ok(archived.failures.some(line => line.includes('未完了') || line.includes('evidence')));
  } finally {
    repo.cleanup();
  }
});

test('plan negatives cover layer conflict, duplicate TP, and an unassigned scenario', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/demo/quality.md', `---
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
## Test Oracles
| ID | 対象 |
|----|------|
| O1 | F1 |
## Test Layer Mapping
| Failure Mode | Layer |
|--------------|-------|
| F1 | E2E |
`);
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
| TP-001 | demo | Visible | R1 | O1 | app | click | 1 |
| TP-001 | demo | Visible | R1 | O1 | app | click | 1 |
## 対象外シナリオ
| Scenario | Reason | Oracle | Layer | Method |
| Hidden | 内部 | O1 | Unit | node --test |
`);
    const conflict = checkTestPlan(repo.dir, change({ e2e: 'not-applicable', skipSpecs: false, tasksText: null }));
    assert.ok(conflict.errors.some(line => line.includes('E2E 層')));
    assert.ok(conflict.errors.some(line => line.includes('重複')));
    write(repo, 'openspec/changes/demo/test-plan.md', `---
e2e: required
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
| TP-001 | demo | Visible | R1 | O1 | app | click | 1 |
## 対象外シナリオ
| Scenario | Reason | Oracle | Layer | Method |
`);
    const missing = checkTestPlan(repo.dir, change({ e2e: 'required', skipSpecs: false, tasksText: null }));
    assert.ok(missing.errors.some(line => line.includes('未割当')));
  } finally {
    repo.cleanup();
  }
});

function execOk() {
  return () => '';
}

test('ci job keeps repo selection, saves failures, and does not reuse an older report', async () => {
  const repo = gitRepo();
  try {
    const base = repo.git(['rev-parse', 'HEAD']).trim();
    mkdirSync(join(repo.dir, 'packages/app'), { recursive: true });
    write(repo, 'packages/app/package-lock.json', '{}\n');
    write(repo, 'openspec/changes/docs/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/docs/test-plan.md', '---\ne2e: not-applicable\nreason: 画面なし\n---\n');
    write(repo, 'openspec/changes/docs/tasks.md', '- [x] 1.1 a\n- [x] 2.1 b\n');
    write(repo, 'openspec/changes/ship/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/ship/quality.md', `---
risk_level: high
approved_by: ""
approved_at: ""
oracle_paths: []
oracle_digest: ""
---
## Risk Register
| ID | Level |
|----|-------|
| R1 | high |
`);
    repo.commit('changes');
    const calls = [];
    const unsupported = await runCiJob({
      WORKING_DIRECTORY: 'packages/app',
      BASE_REF: base,
      SETUP_MODE: 'pnpm',
      TEST_COMMAND: 'echo test',
    }, { cwd: join(repo.dir, 'packages/app'), execFile: execOk() });
    assert.equal(unsupported.code, 1);
    assert.match(unsupported.lines.join('\n'), /未対応の setup-mode/);

    const scoped = await runCiJob({
      WORKING_DIRECTORY: 'packages/app',
      BASE_REF: base,
      SETUP_MODE: 'npm',
      TEST_COMMAND: 'echo test',
      GATE_PHASE: 'plan',
    }, {
      cwd: join(repo.dir, 'packages/app'),
      execFile: (file, args, options) => {
        calls.push({ file, args: args.join(' '), cwd: options.cwd });
        return '';
      },
    });
    assert.ok(calls.some(call => call.file === 'npm' && call.cwd.endsWith('/packages/app')));
    assert.match(scoped.lines.join('\n'), /docs \(active\/final\)/);
    assert.match(scoped.lines.join('\n'), /mutation-command/);
    assert.ok(existsSync(scoped.summaryDir));

    const fresh = gitRepo();
    const freshBase = fresh.git(['rev-parse', 'HEAD']).trim();
    write(fresh, 'openspec/changes/ui/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(fresh, 'openspec/changes/ui/test-plan.md', `---
e2e: required
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
| TP-001 | demo | Visible | R1 | O1 | app | click | 1 |
`);
    fresh.commit('ui');
    mkdirSync(join(fresh.dir, 'test-results/testkit/old'), { recursive: true });
    write(fresh, 'test-results/testkit/old/results.json', '{"stats":{"startTime":"2020-01-01T00:00:00.000Z"},"suites":[]}\n');
    const stale = await runCiJob({
      WORKING_DIRECTORY: '.',
      BASE_REF: freshBase,
      SETUP_MODE: 'caller',
      TEST_COMMAND: 'echo test',
      E2E_COMMAND: 'echo ran',
      GATE_PHASE: 'plan',
    }, { cwd: fresh.dir, execFile: execOk() });
    assert.equal(stale.code, 2, stale.lines.join('\n'));
    assert.match(stale.lines.join('\n'), /前回の結果は使いません/);
    assert.notEqual(stale.runDir, join(fresh.dir, 'test-results/testkit/old'));
    assert.ok(existsSync(join(stale.summaryDir, 'summary.txt')));
    fresh.cleanup();

    const failedCommand = await runCiJob({
      WORKING_DIRECTORY: '.',
      BASE_REF: 'HEAD',
      SETUP_MODE: 'caller',
      TEST_COMMAND: 'echo test',
      E2E_COMMAND: 'echo fail',
    }, {
      cwd: repo.dir,
      execFile: (file, args) => {
        if (args.join(' ').includes('echo fail')) {
          const error = new Error('e2e failed');
          error.status = 1;
          throw error;
        }
        return '';
      },
    });
    assert.notEqual(failedCommand.code, 0);
    assert.match(readFileSync(join(failedCommand.summaryDir, 'summary.txt'), 'utf8'), /exit [1-9]/);
  } finally {
    repo.cleanup();
  }
});

test('a dynamic Playwright config is not executed', async () => {
  const repo = gitRepo();
  try {
    write(repo, 'playwright.config.ts', 'export default async () => ({ testDir: process.env.DIR })\n');
    mkdirSync(join(repo.dir, 'tests/e2e'), { recursive: true });
    const lines = [];
    const code = await main(['install', '--force', '--target', repo.dir], {
      log: message => lines.push(String(message)),
      error: message => lines.push(String(message)),
      stdin: { isTTY: false },
    });
    assert.equal(code, 0, lines.join('\n'));
    assert.match(lines.join('\n'), /実行していません/);
    assert.equal(readFileSync(join(repo.dir, 'playwright.config.ts'), 'utf8').includes('async'), true);
  } finally {
    repo.cleanup();
  }
});

test('an older OpenSpec is installed but not reported ready', async () => {
  const repo = gitRepo();
  try {
    const root = realpathSync(repo.dir);
    const code = await main(['install', '--force', '--target', repo.dir], {
      log: () => {},
      error: () => {},
      stdin: { isTTY: false },
      execFile: (_cmd, args) => {
        if (args[0] === '--version') return '1.12.0\n';
        if (args[0] === 'context') return JSON.stringify({ root: { path: root, source: 'nearest' } });
        return '';
      },
    });
    assert.equal(code, 0);
    const stamp = JSON.parse(readFileSync(join(repo.dir, '.openspec-custom-testkit.json'), 'utf8'));
    assert.equal(stamp.openspec.ready, false);
    assert.equal(stamp.openspec.reason, 'version');
    assert.equal(existsSync(join(repo.dir, 'scripts/qe-gate.mjs')), true);
  } finally {
    repo.cleanup();
  }
});

test('invalid approval is rejected and an unfinished plan stays a warning', () => {
  const repo = gitRepo();
  try {
    const pending = evaluateChange(repo.dir, change({
      tasksText: null,
      pendingPlan: true,
      e2e: 'unknown',
    }), { phase: 'plan', tags: false, plan: false });
    assert.ok(pending.warnings.some(line => line.includes('計画途中')));
    assert.equal(pending.failures.length, 0);
    write(repo, 'openspec/changes/demo/quality.md', `---
risk_level: low
approved_by: "FIXTURE-DUMMY-APPROVAL"
approved_at: "2026/09/22"
oracle_paths: []
oracle_digest: ""
---
## Risk Register
| ID | Level |
|----|-------|
| R1 | low |
`);
    const invalid = evaluateChange(repo.dir, change({ tasksText: '- [x] 2.1 impl\n' }), { phase: 'plan', tags: false, plan: false });
    assert.ok(invalid.failures.some(line => line.includes('approved_at')));
  } finally {
    repo.cleanup();
  }
});

test('each ci failure is still a failed job after the summary is saved', async () => {
  const repo = gitRepo();
  try {
    const base = repo.git(['rev-parse', 'HEAD']).trim();
    write(repo, 'openspec/changes/oracle/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/oracle/tasks.md', '- [x] 2.1 impl\n');
    write(repo, 'openspec/changes/oracle/quality.md', `---
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
`);
    repo.commit('oracle');
    const oracle = await runCiJob({
      WORKING_DIRECTORY: '.',
      BASE_REF: base,
      SETUP_MODE: 'caller',
      GATE_PHASE: 'plan',
      TEST_COMMAND: 'echo test',
    }, { cwd: repo.dir, execFile: () => '' });
    assert.notEqual(oracle.code, 0);
    assert.match(oracle.lines.join('\n'), /空の Oracle/);
    assert.match(readFileSync(join(oracle.summaryDir, 'summary.txt'), 'utf8'), /exit [1-9]/);

    const reportRepo = gitRepo();
    const reportBase = reportRepo.git(['rev-parse', 'HEAD']).trim();
    write(reportRepo, 'openspec/changes/ui/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(reportRepo, 'openspec/changes/ui/test-plan.md', `---
e2e: required
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
| TP-001 | demo | Visible | R1 | O1 | app | click | 1 |
`);
    reportRepo.commit('ui');
    const reported = await runCiJob({
      WORKING_DIRECTORY: '.',
      BASE_REF: reportBase,
      SETUP_MODE: 'caller',
      GATE_PHASE: 'plan',
      TEST_COMMAND: 'echo test',
      E2E_COMMAND: 'echo report',
    }, {
      cwd: reportRepo.dir,
      execFile: (_file, _args, options) => {
        const resultsPath = options.env.TESTKIT_RESULTS_JSON;
        if (resultsPath) {
          writeFileSync(resultsPath, JSON.stringify(results([{
            title: 'adds one',
            tags: ['@ui', '@TP-001'],
            status: 'unexpected',
          }])));
        }
        return '';
      },
    });
    assert.equal(reported.code, 3, reported.lines.join('\n'));
    assert.ok(existsSync(join(reported.runDir, 'ui.report.txt')));
    assert.match(readFileSync(join(reported.summaryDir, 'summary.txt'), 'utf8'), /exit 3/);
    reportRepo.cleanup();
  } finally {
    repo.cleanup();
  }
});

test('doctor rejects an incomplete migration and passes after force repair', async () => {
  const repo = gitRepo();
  try {
    const baseline = readFileSync(new URL('../upstream/baselines/qe/payload/scripts/qe-gate.sh', import.meta.url));
    write(repo, 'scripts/qe-gate.sh', baseline);
    write(repo, '.openspec-quality-kit.json', JSON.stringify({ version: '9.9.9' }));
    const lines = [];
    const first = await main(['install', '--target', repo.dir], {
      log: message => lines.push(String(message)),
      error: message => lines.push(String(message)),
      stdin: { isTTY: false },
    });
    assert.equal(first, 0, lines.join('\n'));
    const blocked = doctor(repo.dir);
    assert.equal(blocked.ok, false);
    assert.match(blocked.failures.join('\n'), /incomplete/);
    const repaired = await main(['install', '--force', '--target', repo.dir], {
      log: () => {},
      error: () => {},
      stdin: { isTTY: false },
    });
    assert.equal(repaired, 0);
    const done = doctor(repo.dir);
    assert.equal(done.ok, true, done.failures.join('\n'));
    assert.equal(readdirSync(repo.dir).includes('.openspec-custom-testkit.json'), true);
  } finally {
    repo.cleanup();
  }
});
