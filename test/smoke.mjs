#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestForSchema } from '../payload/scripts/lib/digest.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { buildReport } from '../payload/scripts/lib/report.mjs';
import { gitRepo } from './support.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const resultsPath = join(root, '.tmp/smoke/results.json');

function run(command, args, env = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status || 1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const red = run(process.execPath, ['--test', 'test/smoke-app/oracle.test.mjs'], { COUNTER_IMPL: 'red' });
if (red.code === 0) {
  console.error('RED oracle が成功してしまいました。失敗する実装を成功扱いにしません。');
  process.exit(1);
}
const green = run(process.execPath, ['--test', 'test/smoke-app/oracle.test.mjs']);
if (green.code !== 0) {
  console.error(green.stdout);
  console.error('GREEN oracle が失敗しました。');
  process.exit(green.code);
}

const browser = run(process.execPath, [
  'node_modules/@playwright/test/cli.js',
  'test',
  '--config', 'test/smoke-app/playwright.config.mjs',
  '--reporter', 'json',
]);
mkdirSync(dirname(resultsPath), { recursive: true });
writeFileSync(resultsPath, browser.stdout || '{}\n');
if (browser.code !== 0) {
  console.error(browser.stdout);
  console.error('Playwright が失敗しました。browser が無い場合も成功にはしません。');
  process.exit(browser.code || 1);
}

const plan = `---
e2e: required
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
|-------|-------------|----------|------|--------|---------|--------|----------|
| TP-001 | counter | Visible | R1 | O1 | none | 増やす | 1 |
`;
let results;
try {
  results = JSON.parse(browser.stdout);
} catch {
  console.error('Playwright JSON を解釈できません');
  process.exit(2);
}
const report = buildReport({ changeId: 'smoke-counter', planText: plan, results });
if (report.exitCode !== 0) {
  console.error(report.stdout);
  console.error(report.stderr);
  process.exit(report.exitCode || 1);
}

const broken = structuredClone(results);
for (const suite of broken.suites ?? []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) test.status = 'unexpected';
  }
}
const failedReport = buildReport({ changeId: 'smoke-counter', planText: plan, results: broken });
if (failedReport.exitCode !== 3) {
  console.error('意図したテスト失敗が終了コード 3 になりませんでした');
  process.exit(1);
}

const repo = gitRepo();
try {
  mkdirSync(join(repo.dir, 'tests/oracle/demo'), { recursive: true });
  writeFileSync(join(repo.dir, 'tests/oracle/demo/oracle.test.mjs'), 'export {}\n');
  const digest = digestForSchema(repo.dir, 'quality-driven-e2e', ['tests/oracle/demo']);
  const quality = `---
risk_level: low
approved_by: "FIXTURE-DUMMY-APPROVAL"
approved_at: "2026-09-22"
oracle_paths: ["tests/oracle/demo"]
oracle_digest: "${digest.digest}"
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
`;
  mkdirSync(join(repo.dir, 'openspec/changes/smoke-counter'), { recursive: true });
  writeFileSync(join(repo.dir, 'openspec/changes/smoke-counter/.openspec.yaml'), 'schema: quality-driven-e2e\n');
  writeFileSync(join(repo.dir, 'openspec/changes/smoke-counter/quality.md'), quality);
  writeFileSync(join(repo.dir, 'openspec/changes/smoke-counter/test-plan.md'), plan);
  writeFileSync(join(repo.dir, 'openspec/changes/smoke-counter/tasks.md'), '- [x] 1.1 oracle\n- [x] 2.1 impl\n- [x] 3.1 e2e\n- [x] 4.1 falsify\n- [x] 5.1 evidence\n');
  writeFileSync(join(repo.dir, 'openspec/quality-policy.md'), readFileSync(join(root, 'payload/openspec/quality-policy.md')));
  const source = 'test-results/smoke/results.json';
  mkdirSync(join(repo.dir, 'test-results/smoke'), { recursive: true });
  writeFileSync(join(repo.dir, source), browser.stdout);
  const { sha256File } = await import('../payload/scripts/lib/hash.mjs');
  repo.commit('tested inputs');
  const revision = repo.git(['rev-parse', 'HEAD']).trim();
  const evidence = `# Evidence

FIXTURE-DUMMY-APPROVAL は人間の承認ではありません。

## 追跡

| Risk | Failure Mode | Oracle | Layer | TP-ID | Result | Run-ID |
|------|--------------|--------|-------|-------|--------|--------|
| R1 | F1 | O1 | E2E | TP-001 | pass | run-smoke |

## Execution Records

\`\`\`json
{
  "format_version": 1,
  "runs": [{
    "id": "run-smoke",
    "command": "playwright test",
    "started_at": "2026-09-22T00:00:00.000Z",
    "revision": "${revision}",
    "exit_code": 0,
    "source": "${source}",
    "source_sha256": "${sha256File(join(repo.dir, source))}"
  }],
  "risk_results": [{
    "risk": "R1",
    "failure_modes": ["F1"],
    "oracles": ["O1"],
    "layer": "E2E",
    "tp_ids": ["TP-001"],
    "result": "pass",
    "run_ids": ["run-smoke"]
  }],
  "falsification": { "performed": true, "summary": "zero delta is rejected", "counterexamples": [] },
  "mutation": { "command": "", "status": "not-required", "score": null, "threshold": 70 },
  "reviews": [],
  "oracle_changes": [],
  "residuals": []
}
\`\`\`

## Oracle Changes

- なし
`;
  writeFileSync(join(repo.dir, 'openspec/changes/smoke-counter/evidence.md'), evidence);
  repo.commit('record evidence');
  const change = {
    id: 'smoke-counter',
    path: 'openspec/changes/smoke-counter',
    schema: 'quality-driven-e2e',
    lifecycle: 'active',
    qe: true,
    e2e: 'required',
    scope: 'integrated',
    reason: '',
    errors: [],
    skipSpecs: false,
    pendingPlan: false,
    tasksText: readFileSync(join(repo.dir, 'openspec/changes/smoke-counter/tasks.md'), 'utf8'),
  };
  const manifest = {
    revision: repo.git(['rev-parse', 'HEAD']).trim(),
    run_ids: ['run-smoke'],
    runs: [{ id: 'run-smoke', change_id: 'smoke-counter', command: 'playwright test', exit_code: browser.code, source_sha256: sha256File(join(repo.dir, source)) }],
  };
  const happy = evaluateChange(repo.dir, change, { phase: 'final', tags: false, manifest });
  if (happy.failures.length) {
    console.error(happy.failures.join('\n'));
    process.exit(1);
  }
  if (!happy.warnings.some(line => line.includes('structure: pass')) || !happy.warnings.some(line => line.includes('execution: verified'))) {
    console.error(happy.warnings.join('\n'));
    process.exit(1);
  }

  const mismatched = structuredClone(manifest);
  mismatched.runs[0].source_sha256 = '0'.repeat(64);
  const unverified = evaluateChange(repo.dir, change, { phase: 'final', tags: false, manifest: mismatched });
  if (unverified.failures.length || !unverified.warnings.includes('execution: unverified')) {
    console.error('異なる実行出力を verified として扱いました');
    process.exit(1);
  }

  mkdirSync(join(repo.dir, 'openspec/changes/docs-only'), { recursive: true });
  writeFileSync(join(repo.dir, 'openspec/changes/docs-only/.openspec.yaml'), 'schema: quality-driven-e2e\nskip_specs: true\n');
  writeFileSync(join(repo.dir, 'openspec/changes/docs-only/quality.md'), quality.replace('E2E', 'Unit'));
  writeFileSync(join(repo.dir, 'openspec/changes/docs-only/test-plan.md'), `---
e2e: not-applicable
reason: 画面変更なし
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
  writeFileSync(join(repo.dir, 'openspec/changes/docs-only/tasks.md'), '- [ ] 1.1 wait\n');
  const sibling = evaluateChange(repo.dir, {
    ...change,
    id: 'docs-only',
    path: 'openspec/changes/docs-only',
    e2e: 'not-applicable',
    skipSpecs: true,
    tasksText: '- [ ] 1.1 wait\n',
  }, { phase: 'plan', tags: false });
  if (sibling.failures.length) {
    console.error(sibling.failures.join('\n'));
    process.exit(1);
  }
  const again = evaluateChange(repo.dir, change, { phase: 'final', tags: false, manifest });
  if (again.failures.length) {
    console.error('not-applicable が required change の最終検査を壊しました');
    process.exit(1);
  }
} finally {
  repo.cleanup();
}

console.log('smoke ok');
console.log('FIXTURE-DUMMY-APPROVAL は人間の承認ではありません。');
