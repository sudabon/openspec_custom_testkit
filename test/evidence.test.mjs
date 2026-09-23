import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestForSchema } from '../payload/scripts/lib/digest.mjs';
import { sha256File } from '../payload/scripts/lib/hash.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { gitRepo } from './support.mjs';

function setup(level = 'low') {
  const repo = gitRepo();
  mkdirSync(join(repo.dir, 'tests/oracle/demo'), { recursive: true });
  writeFileSync(join(repo.dir, 'tests/oracle/demo/oracle.txt'), 'oracle\n');
  const digest = digestForSchema(repo.dir, 'quality-driven-e2e', ['tests/oracle/demo']).digest;
  const revision = repo.git(['rev-parse', 'HEAD']).trim();
  mkdirSync(join(repo.dir, 'test-results'), { recursive: true });
  writeFileSync(join(repo.dir, 'test-results/run.json'), '{}\n');
  const change = {
    id: 'demo',
    path: 'openspec/changes/demo',
    schema: 'quality-driven-e2e',
    lifecycle: 'active',
    qe: true,
    e2e: 'required',
    scope: 'integrated',
    reason: '',
    errors: [],
    skipSpecs: true,
    pendingPlan: false,
    tasksText: '- [x] 1.1 a\n- [x] 2.1 b\n- [x] 3.1 c\n- [x] 4.1 d\n- [x] 5.1 e\n',
  };
  mkdirSync(join(repo.dir, change.path), { recursive: true });
  writeFileSync(join(repo.dir, 'openspec/quality-policy.md'), 'mutation_threshold_high: 70\n| Oracle の seal | 必須 | 必須 | 必須 |\n| Falsification レビュー | 必須 | 必須 | 必須 |\n');
  return { repo, digest, revision, change, level };
}

function writeQuality(ctx, extra = {}) {
  const level = extra.level ?? ctx.level;
  const paths = extra.paths ?? '["tests/oracle/demo"]';
  const digest = extra.digest ?? ctx.digest;
  writeFileSync(join(ctx.repo.dir, ctx.change.path, 'quality.md'), `---
risk_level: ${level}
approved_by: "FIXTURE-DUMMY-APPROVAL"
approved_at: "2026-09-22"
oracle_paths: ${paths}
oracle_digest: "${digest}"
---
## Risk Register
| ID | Level |
|----|-------|
| R1 | ${extra.rowLevel ?? level} |
## Test Oracles
| ID | 対象 |
|----|------|
| O1 | F1 |
## Test Layer Mapping
| Failure Mode | Layer |
|--------------|-------|
| F1 | ${extra.layer ?? 'Unit'} |
`);
}

function writeEvidence(ctx, body) {
  writeFileSync(join(ctx.repo.dir, ctx.change.path, 'evidence.md'), body);
  writeFileSync(join(ctx.repo.dir, ctx.change.path, 'test-plan.md'), `---
e2e: ${ctx.change.e2e}
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
}

function evidenceJson(ctx, patch) {
  const data = {
    format_version: 1,
    runs: [{
      id: 'run-1', command: 'node --test', started_at: '2026-09-22T00:00:00.000Z', revision: ctx.revision,
      exit_code: 0, source: 'test-results/run.json', source_sha256: 'pending',
    }],
    risk_results: [{ risk: 'R1', failure_modes: ['F1'], oracles: ['O1'], layer: 'Unit', tp_ids: [], result: 'pass', run_ids: ['run-1'] }],
    falsification: { performed: true, summary: 'zero delta rejected', counterexamples: [] },
    mutation: { command: '', status: 'not-required', score: null, threshold: 70 },
    reviews: [],
    oracle_changes: [],
    residuals: [],
    ...patch,
  };
  return data;
}

test('risk understatement, empty oracle, and changed oracle fail', () => {
  const ctx = setup('medium');
  try {
    writeQuality(ctx, { rowLevel: 'high' });
    const under = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan' });
    assert.ok(under.failures.some(line => line.includes('最大値')));
    writeQuality(ctx, { paths: '[]', digest: '' });
    const empty = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan', env: { QE_SEAL_REQUIRED_LEVELS: '' } });
    assert.ok(empty.failures.some(line => line.includes('空の Oracle')));
    writeQuality(ctx);
    writeFileSync(join(ctx.repo.dir, 'tests/oracle/demo/oracle.txt'), 'changed\n');
    const changed = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan' });
    assert.ok(changed.failures.some(line => line.includes('再 seal')));
  } finally {
    ctx.repo.cleanup();
  }
});

test('final evidence rejects missing falsification, weak mutation, and unresolved counterexamples', () => {
  const ctx = setup('high');
  ctx.change.e2e = 'not-applicable';
  try {
    writeQuality(ctx, { layer: 'Unit' });
    const hash = sha256File(join(ctx.repo.dir, 'test-results/run.json'));
    const base = evidenceJson(ctx);
    base.runs[0].source_sha256 = hash;
    base.falsification = { performed: false, summary: '', counterexamples: [] };
    writeEvidence(ctx, `# Evidence\n## 追跡\n| Risk | Result |\n|------|--------|\n| R1 | pass |\n## Execution Records\n\`\`\`json\n${JSON.stringify(base)}\n\`\`\`\n## Oracle Changes\n- なし\n`);
    const missing = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'final', tags: false });
    assert.ok(missing.failures.some(line => line.includes('反証')));
    base.falsification = { performed: true, summary: 'tried', counterexamples: [{ id: 'C1', status: 'residual', residual_id: 'S1' }] };
    base.mutation = { command: '', status: 'not-run', score: null, threshold: 70 };
    writeEvidence(ctx, `# Evidence\n## 追跡\n| Risk | Result |\n|------|--------|\n| R1 | pass |\n## Execution Records\n\`\`\`json\n${JSON.stringify(base)}\n\`\`\`\n## Oracle Changes\n- なし\n`);
    const mutation = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'final', tags: false });
    assert.ok(mutation.failures.some(line => line.includes('Mutation') || line.includes('Residual') || line.includes('レビュー')));
  } finally {
    ctx.repo.cleanup();
  }
});

test('non-object Execution Records entries are structural errors, not crashes', () => {
  const ctx = setup('high');
  ctx.change.e2e = 'not-applicable';
  try {
    writeQuality(ctx, { layer: 'Unit' });
    const hash = sha256File(join(ctx.repo.dir, 'test-results/run.json'));
    const cases = [
      base => { base.reviews = [null]; },
      base => { base.risk_results = [null]; },
      base => { base.falsification.counterexamples = [null]; },
      base => { base.runs = [null]; },
      base => { base.residuals = [null]; base.oracle_changes = [null]; },
    ];
    for (const mutate of cases) {
      const base = evidenceJson(ctx);
      base.runs[0].source_sha256 = hash;
      mutate(base);
      writeEvidence(ctx, `# Evidence\n## 追跡\n| Risk | Result |\n|------|--------|\n| R1 | pass |\n## Execution Records\n\`\`\`json\n${JSON.stringify(base)}\n\`\`\`\n## Oracle Changes\n- なし\n`);
      const result = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'final', tags: false });
      assert.ok(result.failures.some(line => line.includes('不正な要素')), JSON.stringify(result.failures));
    }
    writeEvidence(ctx, '# Evidence\n## Execution Records\n```json\nnull\n```\n');
    const empty = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'final', tags: false });
    assert.ok(empty.failures.some(line => line.includes('Execution Records')), JSON.stringify(empty.failures));
  } finally {
    ctx.repo.cleanup();
  }
});
