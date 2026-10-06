import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestForSchema } from '../payload/scripts/lib/digest.mjs';
import { sha256File } from '../payload/scripts/lib/hash.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { checkTestPlan } from '../payload/scripts/lib/plan-check.mjs';
import { handoffNeed, residualHeadingErrors } from '../payload/scripts/lib/qa-handoff.mjs';
import { gitRepo } from './support.mjs';

const root = new URL('..', import.meta.url);
const TEMPLATE = readFileSync(new URL('payload/openspec/schemas/quality-driven-e2e/templates/qa-handoff.md', root), 'utf8');
const DONE = '- [x] 1.1 a\n- [x] 2.1 b\n- [x] 3.1 c\n- [x] 4.1 d\n- [x] 5.1 e\n- [x] 6.1 f\n';
const LAYER_HEADER = '| Failure Mode | Layer (Static / Unit / Integration / E2E / Monitoring / Manual) | 選定理由 |\n|--------------|------|----------|';

function setup(options = {}) {
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
    schema: options.schema ?? 'quality-driven-e2e',
    lifecycle: options.lifecycle ?? 'active',
    qe: true,
    e2e: 'not-applicable',
    scope: options.schema && options.schema !== 'quality-driven-e2e' ? 'legacy-qe' : 'integrated',
    reason: '',
    errors: [],
    skipSpecs: true,
    pendingPlan: false,
    tasksText: options.tasks ?? DONE,
  };
  mkdirSync(join(repo.dir, change.path), { recursive: true });
  writeFileSync(join(repo.dir, 'openspec/quality-policy.md'), 'mutation_threshold_high: 70\n');
  return { repo, digest, revision, change };
}

function writeQuality(ctx, { risks = ['R1'], layers = [['F1', 'Unit', '純粋関数']], residuals = ['なし'] } = {}) {
  const riskRows = risks.map(id => `| ${id} | low |`).join('\n');
  const layerRows = layers.map(cells => `| ${cells.join(' | ')} |`).join('\n');
  const residualLines = residuals.map(item => `- ${item}`).join('\n');
  writeFileSync(join(ctx.repo.dir, ctx.change.path, 'quality.md'), `---
risk_level: low
approved_by: "FIXTURE-DUMMY-APPROVAL"
approved_at: "2026-10-01"
oracle_paths: ["tests/oracle/demo"]
oracle_digest: "${ctx.digest}"
---
## Risk Register
| ID | Level |
|----|-------|
${riskRows}
## Test Oracles
| ID | 対象 |
|----|------|
| O1 | F1 |
## Test Layer Mapping
${LAYER_HEADER}
${layerRows}
## Residual Risk
${residualLines}
`);
}

function writeEvidence(ctx, { results = [['R1', 'pass']], residuals = [] } = {}) {
  const hash = sha256File(join(ctx.repo.dir, 'test-results/run.json'));
  const data = {
    format_version: 1,
    runs: [{
      id: 'run-1', command: 'node --test', started_at: '2026-10-01T00:00:00.000Z', revision: ctx.revision,
      exit_code: results.some(([, result]) => result === 'fail') ? 1 : 0, source: 'test-results/run.json', source_sha256: hash,
    }],
    risk_results: results.map(([risk, result], index) => ({
      risk, failure_modes: [`F${index + 1}`], oracles: ['O1'], layer: 'Unit', tp_ids: [], result, run_ids: ['run-1'],
    })),
    falsification: { performed: true, summary: 'tried', counterexamples: [] },
    mutation: { command: '', status: 'not-required', score: null, threshold: 70 },
    reviews: [],
    oracle_changes: [],
    residuals,
  };
  const trace = results.map(([risk, result]) => `| ${risk} | ${result} |`).join('\n');
  writeFileSync(join(ctx.repo.dir, ctx.change.path, 'evidence.md'), `# Evidence\n## 追跡\n| Risk | Result |\n|------|--------|\n${trace}\n## Execution Records\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`);
  writeFileSync(join(ctx.repo.dir, ctx.change.path, 'test-plan.md'), `---
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
}

function handoff({ automated = ['| R1 | F1 | O1 | Unit | | run-1 |'], manual = ['| F2 | Manual | 印刷のレイアウト | 実機プリンタが必要 |'], charters = ['| C1 | 印刷崩れを探す | 請求書印刷 | 30分 |'], result = '' } = {}) {
  return `# QA Handoff

## 自動化済み範囲

| Risk | Failure Mode | Oracle | Layer | TP-ID | Run-ID |
|------|--------------|--------|-------|-------|--------|
${automated.join('\n')}

## 手動確認範囲

| ID | 種別 | 確認観点 | 理由 |
|----|------|----------|------|
${manual.join('\n')}

## 探索チャーター

| Charter-ID | 目的 | 対象 | 時間の目安 |
|------------|------|------|------------|
${charters.join('\n')}

## QA 実施結果

| 実施者 | 実施日 | 判定 | 所見 |
|--------|--------|------|------|
${result}
`;
}

function writeHandoff(ctx, text) {
  writeFileSync(join(ctx.repo.dir, ctx.change.path, 'qa-handoff.md'), text);
}

function run(ctx) {
  return evaluateChange(ctx.repo.dir, ctx.change, { phase: 'final', tags: false });
}

function manualCase(ctx, extra = {}) {
  writeQuality(ctx, { risks: ['R1'], layers: [['F1', 'Unit', '純粋関数'], ['F2', 'Manual', '実機プリンタが必要']], ...extra });
  writeEvidence(ctx);
}

function has(result, ...parts) {
  return result.failures.some(line => parts.every(part => line.includes(part)));
}

test('Manual layer without a reason fails the plan gate with the failure mode id', () => {
  const ctx = setup({ tasks: '- [ ] 1.1 a\n' });
  try {
    writeQuality(ctx, { layers: [['F1', 'Unit', '純粋関数'], ['F3', 'Manual', '']] });
    const result = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan' });
    assert.ok(has(result, 'F3', 'Manual'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('Unit and Manual with a not-applicable plan is not a layer contradiction', () => {
  const ctx = setup();
  try {
    writeQuality(ctx, { layers: [['F1', 'Unit', '純粋関数'], ['F2', 'Manual', 'E2E では実機の印刷結果を観測できない']] });
    writeEvidence(ctx);
    const plan = checkTestPlan(ctx.repo.dir, ctx.change);
    assert.deepEqual(plan.errors, []);
  } finally {
    ctx.repo.cleanup();
  }
});

test('handoff is required by each condition alone and not otherwise', () => {
  const quality = (layer, residual) => `## Test Layer Mapping\n${LAYER_HEADER}\n| F1 | ${layer} | 理由 |\n## Residual Risk\n- ${residual}\n`;
  assert.equal(handoffNeed({ qualityText: quality('Manual', 'なし'), evidence: { residuals: [] } }).required, true);
  assert.equal(handoffNeed({ qualityText: quality('Unit', 'RR1: 時刻依存は保証しない'), evidence: { residuals: [] } }).required, true);
  assert.equal(handoffNeed({ qualityText: quality('Unit', 'なし'), evidence: { residuals: [{ id: 'RES-1' }] } }).required, true);
  assert.equal(handoffNeed({ qualityText: quality('Unit', 'なし'), evidence: { residuals: [] } }).required, false);
  assert.equal(handoffNeed({ qualityText: quality('Unit', ''), evidence: null }).required, false);
});

test('final gate requires a handoff when a Manual layer exists', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    const result = run(ctx);
    assert.ok(has(result, 'qa-handoff.md がありません'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('final gate names a Manual failure mode missing from the handoff', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff({ manual: ['| F9 | Manual | 別物 | 理由 |'] }));
    const result = run(ctx);
    assert.ok(has(result, '手動確認範囲', 'F2'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('final gate names residual ids missing from the handoff and residuals without an id', () => {
  const ctx = setup();
  try {
    writeQuality(ctx, { residuals: ['RR1: 時刻依存は保証しない', '外部APIの遅延'] });
    writeEvidence(ctx, { residuals: [{ id: 'RES-demo-001', reason: 'r', impact: 'i', approved_by: 'FIXTURE', approved_at: '2026-10-01' }] });
    writeHandoff(ctx, handoff({ manual: ['| RR1 | Residual | 時刻 | 保証外 |'] }));
    const result = run(ctx);
    assert.ok(has(result, '手動確認範囲', 'RES-demo-001'), JSON.stringify(result.failures));
    assert.ok(has(result, 'Residual Risk', 'ID', '外部APIの遅延'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('the unfilled template is not a handoff', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeHandoff(ctx, TEMPLATE);
    const result = run(ctx);
    assert.ok(has(result, '記入例'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('the template marks the QA result as human only', () => {
  const qa = TEMPLATE.slice(TEMPLATE.indexOf('## QA 実施結果'));
  assert.match(qa, /人間/);
  assert.match(qa, /Agent は記入しない/);
});

test('charter rows need purpose, target, and time box', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff({ charters: ['| C1 | 印刷崩れを探す |  | 30分 |'] }));
    const result = run(ctx);
    assert.ok(has(result, '探索チャーター', 'C1', '対象'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('automated scope accepts only passing risk results', () => {
  const ctx = setup();
  try {
    writeQuality(ctx, { risks: ['R1', 'R2'], layers: [['F1', 'Unit', '純粋関数'], ['F2', 'Manual', '実機が必要']] });
    writeEvidence(ctx, { results: [['R1', 'pass'], ['R2', 'fail']] });
    writeHandoff(ctx, handoff({ automated: ['| R1 | F1 | O1 | Unit | | run-1 |', '| R2 | F2 | O1 | Unit | | run-1 |'] }));
    const result = run(ctx);
    assert.ok(has(result, '自動化済み範囲', 'R2'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('automated scope must list every passing risk', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff({ automated: [] }));
    const result = run(ctx);
    assert.ok(has(result, '自動化済み範囲', 'R1'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('a correct handoff passes and an empty QA result is only a warning before archive', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff());
    const result = run(ctx);
    assert.deepEqual(result.failures, []);
    assert.ok(result.warnings.some(line => line.includes('QA 実施結果')), JSON.stringify(result.warnings));
  } finally {
    ctx.repo.cleanup();
  }
});

test('archive requires a QA result and rejects a fail verdict', () => {
  const ctx = setup({ lifecycle: 'archived' });
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff());
    const empty = run(ctx);
    assert.ok(has(empty, 'QA 実施結果'), JSON.stringify(empty.failures));
    writeHandoff(ctx, handoff({ result: '| QA-担当 | 2026/10/05 | pass | なし |' }));
    const badDate = run(ctx);
    assert.ok(has(badDate, 'QA 実施結果'), JSON.stringify(badDate.failures));
    writeHandoff(ctx, handoff({ result: '| QA-担当 | 2026-10-05 | fail | 印刷崩れ |' }));
    const failed = run(ctx);
    assert.ok(has(failed, 'QA 判定が fail', 'Residual'), JSON.stringify(failed.failures));
    writeHandoff(ctx, handoff({ result: '| QA-担当 | 2026-10-05 | pass | 問題なし |' }));
    const passed = run(ctx);
    assert.deepEqual(passed.failures, []);
  } finally {
    ctx.repo.cleanup();
  }
});

test('nothing left for manual testing needs no handoff', () => {
  const ctx = setup({ lifecycle: 'archived' });
  try {
    writeQuality(ctx, { residuals: ['なし'] });
    writeEvidence(ctx);
    const result = run(ctx);
    assert.deepEqual(result.failures, []);
    assert.equal(result.warnings.some(line => line.includes('QA')), false);
  } finally {
    ctx.repo.cleanup();
  }
});

test('legacy quality-driven change with residual risk does not need a handoff', () => {
  const ctx = setup({ schema: 'quality-driven' });
  try {
    writeQuality(ctx, { layers: [['F1', 'Manual', '']], residuals: ['外部APIの遅延'] });
    writeEvidence(ctx);
    const result = run(ctx);
    assert.equal(result.failures.some(line => line.includes('qa-handoff') || line.includes('Manual') || line.includes('Residual Risk')), false, JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('quality template and instruction offer the same layers and the tasks end with a QA handoff', () => {
  const schema = readFileSync(new URL('payload/openspec/schemas/quality-driven-e2e/schema.yaml', root), 'utf8');
  const quality = readFileSync(new URL('payload/openspec/schemas/quality-driven-e2e/templates/quality.md', root), 'utf8');
  const tasks = readFileSync(new URL('payload/openspec/schemas/quality-driven-e2e/templates/tasks.md', root), 'utf8');
  const layers = text => text.match(/\((Static \/ [^)]*)\)/)[1].split('/').map(item => item.trim());
  assert.deepEqual(layers(schema), layers(quality));
  assert.ok(layers(quality).includes('Manual'));
  assert.match(schema, /## 6\. QA Handoff/);
  assert.match(schema, /人間が実施。Agent は記入しない/);
  assert.match(tasks, /## 6\. QA Handoff[\s\S]*人間が実施。Agent は記入しない/);
});

test('QA handoff tasks alone count as an implementation start before seal', () => {
  const ctx = setup({ tasks: '## 1. Oracle\n- [ ] 1.1 a\n## 6. QA Handoff\n- [x] 6.1 handoff\n' });
  try {
    writeQuality(ctx);
    const quality = join(ctx.repo.dir, ctx.change.path, 'quality.md');
    writeFileSync(quality, readFileSync(quality, 'utf8').replace(`oracle_digest: "${ctx.digest}"`, 'oracle_digest: ""'));
    const result = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan' });
    assert.ok(has(result, 'seal'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('the shipped tasks template, fully checked, reaches the final handoff check before QA', () => {
  const template = readFileSync(new URL('payload/openspec/schemas/quality-driven-e2e/templates/tasks.md', root), 'utf8');
  const ctx = setup({ tasks: template.replaceAll('- [ ]', '- [x]') });
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff());
    const result = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan', tags: false });
    assert.equal(result.phase, 'final');
    assert.deepEqual(result.failures, []);
    assert.ok(result.warnings.some(line => line.includes('QA 実施結果が未記入')), JSON.stringify(result.warnings));
  } finally {
    ctx.repo.cleanup();
  }
});

test('apply does not wait for the handoff', () => {
  const schema = readFileSync(new URL('payload/openspec/schemas/quality-driven-e2e/schema.yaml', root), 'utf8');
  assert.match(schema, /^apply:\n {2}requires: \[ tasks \]$/m);
  assert.doesNotMatch(schema, /^\s+- id: qa-handoff$/m);
});

test('the last filled QA result row is the current verdict', () => {
  const ctx = setup({ lifecycle: 'archived' });
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff({ result: '| QA-担当 | 2026-10-05 | pass | なし |\n| QA-担当 | 2026-10-06 | fail | 印刷崩れ |' }));
    assert.ok(has(run(ctx), 'QA 判定が fail'));
    writeHandoff(ctx, handoff({ result: '| QA-担当 | 2026-10-05 | fail | 印刷崩れ |\n| QA-担当 | 2026-10-06 | pass | 再実施で解消 |' }));
    assert.deepEqual(run(ctx).failures, []);
  } finally {
    ctx.repo.cleanup();
  }
});

test('an invalid QA result names the bad field', () => {
  const ctx = setup({ lifecycle: 'archived' });
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff({ result: '| QA-担当 | 2026/10/06 | 合格 | なし |' }));
    const result = run(ctx);
    assert.ok(has(result, '2026/10/06', 'YYYY-MM-DD'), JSON.stringify(result.failures));
    assert.ok(has(result, '合格', 'pass / fail'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
  const active = setup();
  try {
    manualCase(active);
    writeHandoff(active, handoff({ result: '| QA-担当 | 2026-10-06 | 合格 | なし |' }));
    const result = run(active);
    assert.deepEqual(result.failures, []);
    assert.ok(result.warnings.some(line => line.includes('不正') && line.includes('合格')), JSON.stringify(result.warnings));
  } finally {
    active.repo.cleanup();
  }
});

test('residual items are read from numbered and indented lists but not from bold notes', () => {
  const quality = body => `## Test Layer Mapping\n${LAYER_HEADER}\n| F1 | Unit | 理由 |\n## Residual Risk\n${body}\n`;
  const ids = body => handoffNeed({ qualityText: quality(body), evidence: null }).quality.map(item => item.id);
  assert.deepEqual(ids('1. RR1: 時刻\n2) RR2: 端末'), ['RR1', 'RR2']);
  assert.deepEqual(ids('  - RR1: 時刻\n+ RR2: 端末'), ['RR1', 'RR2']);
  assert.deepEqual(ids('**注:** 下記以外は保証する\n- なし'), []);
  assert.deepEqual(residualHeadingErrors(quality('- なし')), []);
});

test('nested list items are notes on the residual above them', () => {
  const quality = body => `## Residual Risk\n${body}\n`;
  const items = body => handoffNeed({ qualityText: quality(body), evidence: null }).quality;
  assert.deepEqual(items('- RR1: 日付をまたぐ表示\n  - 理由: Green では保証しない\n    1. 補足\n- RR2: 端末差').map(item => item.id), ['RR1', 'RR2']);
  assert.deepEqual(items('  - RR1: 時刻\n    - 理由: 保証外\n  - RR2: 端末').map(item => item.id), ['RR1', 'RR2']);
  assert.deepEqual(items('- なし\n  - 補足: 将来検討'), []);
});

test('residuals grouped under a label are still read', () => {
  const quality = body => `## Residual Risk\n${body}\n`;
  const items = body => handoffNeed({ qualityText: quality(body), evidence: null }).quality;
  assert.deepEqual(items('- 表示系\n  - RR1: 日付をまたぐ表示\n  - RR2: 端末差').map(item => item.id), [null, 'RR1', 'RR2']);
  assert.deepEqual(items('- RR0: 表示系\n  - RR1: 日付をまたぐ表示\n    - 理由: 保証外\n  - RR2：端末差').map(item => item.id), ['RR0', 'RR1', 'RR2']);
});

test('a nested residual id in another form is kept without an id', () => {
  const quality = body => `## Residual Risk\n${body}\n`;
  const items = body => handoffNeed({ qualityText: quality(body), evidence: null }).quality;
  for (const nested of ['RR1 日付をまたぐ表示', 'RR1- 日付をまたぐ表示', '**RR1**: 日付をまたぐ表示', '[RR1] 日付をまたぐ表示']) {
    assert.deepEqual(items(`- RR0: 表示系\n  - ${nested}`), [{ id: 'RR0', text: 'RR0: 表示系' }, { id: null, text: nested }], nested);
  }
  assert.deepEqual(items('- RR0: 表示系\n  - 理由: RR1 と同じ').map(item => item.id), ['RR0']);
});

test('final gate fails on a nested residual id without a colon', () => {
  const ctx = setup();
  try {
    writeQuality(ctx, { residuals: ['RR0: 表示系\n  - RR1 日付をまたぐ表示'] });
    writeEvidence(ctx);
    writeHandoff(ctx, handoff({ manual: ['| RR0 | Residual | 表示系 | 保証外 |'] }));
    const result = run(ctx);
    assert.ok(has(result, 'Residual Risk に ID', 'RR1 日付をまたぐ表示'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('final gate requires every residual grouped under a label', () => {
  const ctx = setup();
  try {
    writeQuality(ctx, { residuals: ['RR0: 表示系\n  - RR1: 日付をまたぐ表示\n  - RR2: 端末差'] });
    writeEvidence(ctx);
    writeHandoff(ctx, handoff({ manual: ['| RR0 | Residual | 表示系 | 保証外 |'] }));
    const result = run(ctx);
    assert.ok(has(result, '手動確認範囲', 'RR1'), JSON.stringify(result.failures));
    assert.ok(has(result, '手動確認範囲', 'RR2'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('a nested note under a residual does not fail the final gate', () => {
  const ctx = setup();
  try {
    writeQuality(ctx, { residuals: ['RR1: 日付をまたぐ表示\n  - 理由: Green では保証しない'] });
    writeEvidence(ctx);
    writeHandoff(ctx, handoff({ manual: ['| RR1 | Residual | 日付をまたぐ表示 | 保証外 |'] }));
    const result = run(ctx);
    assert.deepEqual(result.failures, []);
  } finally {
    ctx.repo.cleanup();
  }
});

test('a Residual Risk heading in another form fails the plan gate', () => {
  for (const heading of ['### Residual Risk', '## Residual Risks', '## Residual Risk（残存リスク）', '## Residual Risk:', '## Residual Risk (RR)', '## Residual-Risk', '## 残存リスク']) {
    const ctx = setup({ tasks: '- [ ] 1.1 a\n' });
    try {
      writeQuality(ctx);
      const path = join(ctx.repo.dir, ctx.change.path, 'quality.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace('## Residual Risk', heading));
      const result = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan' });
      assert.ok(has(result, heading, '## Residual Risk'), JSON.stringify(result.failures));
    } finally {
      ctx.repo.cleanup();
    }
  }
});

test('a quality.md without a Residual Risk heading fails the plan gate', () => {
  const ctx = setup({ tasks: '- [ ] 1.1 a\n' });
  try {
    writeQuality(ctx);
    const path = join(ctx.repo.dir, ctx.change.path, 'quality.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/## Residual Risk\n- なし\n/, ''));
    const result = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan' });
    assert.ok(has(result, '`## Residual Risk` がありません'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('a Test Layer Mapping without a Layer column or with an empty Layer fails the plan gate', () => {
  for (const header of ['| Failure Mode | 層 | 選定理由 |', '| Failure Mode | Test Layer | 選定理由 |']) {
    const ctx = setup({ tasks: '- [ ] 1.1 a\n' });
    try {
      writeQuality(ctx, { layers: [['F1', 'Unit', '純粋関数'], ['F2', '手動', '実機が必要']] });
      const path = join(ctx.repo.dir, ctx.change.path, 'quality.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace(LAYER_HEADER.split('\n')[0], header));
      const result = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan' });
      assert.ok(has(result, 'Test Layer Mapping', 'Layer 列がありません'), `${header}: ${JSON.stringify(result.failures)}`);
    } finally {
      ctx.repo.cleanup();
    }
  }
  const ctx = setup({ tasks: '- [ ] 1.1 a\n' });
  try {
    writeQuality(ctx, { layers: [['F1', 'Unit', '純粋関数'], ['F2', '', '未定']] });
    const result = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan' });
    assert.ok(has(result, 'F2', 'Layer が空'), JSON.stringify(result.failures));
    assert.equal(result.failures.some(line => line.includes('F1')), false, JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('unknown layer values and Manual rows without a failure mode fail the plan gate', () => {
  const ctx = setup({ tasks: '- [ ] 1.1 a\n' });
  try {
    writeQuality(ctx, { layers: [['F1', 'Unit / e2e', '理由'], ['F2', '手動', '理由'], ['F3', 'Manaul', '理由'], ['', 'Manual', '実機が必要']] });
    const result = evaluateChange(ctx.repo.dir, ctx.change, { phase: 'plan' });
    assert.ok(has(result, 'F2', '手動', 'Layer'), JSON.stringify(result.failures));
    assert.ok(has(result, 'F3', 'Manaul', 'Layer'), JSON.stringify(result.failures));
    assert.equal(result.failures.some(line => line.includes('F1')), false, JSON.stringify(result.failures));
    assert.ok(has(result, 'Manual 層の行に Failure Mode の ID がありません'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('each missing handoff section is reported', () => {
  for (const heading of ['自動化済み範囲', '手動確認範囲', '探索チャーター', 'QA 実施結果']) {
    const ctx = setup();
    try {
      manualCase(ctx);
      writeHandoff(ctx, handoff().replace(`## ${heading}`, `## ${heading}（旧）`));
      const result = run(ctx);
      assert.ok(has(result, `## ${heading} がありません`), JSON.stringify(result.failures));
    } finally {
      ctx.repo.cleanup();
    }
  }
});

test('empty required cells in the automated and manual scopes are reported', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff({ automated: ['| R1 | F1 |  | Unit | |  |'], manual: ['| F2 | Manual |  | 実機プリンタが必要 |'] }));
    const result = run(ctx);
    assert.ok(has(result, '自動化済み範囲', 'R1', 'Oracle', '空'), JSON.stringify(result.failures));
    assert.ok(has(result, '自動化済み範囲', 'R1', 'Run-ID', '空'), JSON.stringify(result.failures));
    assert.ok(has(result, '手動確認範囲', 'F2', '確認観点', '空'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('a manual id does not match a longer id with the same prefix', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff({ manual: ['| F20 | Manual | 別物 | 理由 |'] }));
    const result = run(ctx);
    assert.ok(has(result, '手動確認範囲に F2 がありません'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('automated oracle and run ids must come from the evidence of that risk', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff({ automated: ['| R1 | F1 | O9 | Unit | | run-9 |'] }));
    const result = run(ctx);
    assert.ok(has(result, 'R1', 'O9', 'oracles'), JSON.stringify(result.failures));
    assert.ok(has(result, 'R1', 'run-9', 'run_ids'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});

test('unreadable evidence gives one warning instead of an error per automated row', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeFileSync(join(ctx.repo.dir, ctx.change.path, 'evidence.md'), '# Evidence\n## Execution Records\n```json\n{broken\n```\n');
    writeHandoff(ctx, handoff());
    const result = run(ctx);
    assert.equal(result.failures.some(line => line.includes('qa-handoff.md の自動化済み範囲')), false, JSON.stringify(result.failures));
    assert.equal(result.warnings.filter(line => line.includes('照合していません')).length, 1, JSON.stringify(result.warnings));
  } finally {
    ctx.repo.cleanup();
  }
});

test('manual kinds, charter count, and duplicate ids are checked', () => {
  const ctx = setup();
  try {
    manualCase(ctx);
    writeHandoff(ctx, handoff({
      automated: ['| R1 | F1 | O1 | Unit | | run-1 |', '| R1 | F1 | O1 | Unit | | run-1 |'],
      manual: ['| F2 | 手動 | 印刷 | 実機が必要 |', '| F2 | Manual | 印刷 | 実機が必要 |'],
      charters: [],
    }));
    const result = run(ctx);
    assert.ok(has(result, '種別', '手動'), JSON.stringify(result.failures));
    assert.ok(has(result, '探索チャーターが 0 件'), JSON.stringify(result.failures));
    assert.ok(has(result, '自動化済み範囲で R1 が重複'), JSON.stringify(result.failures));
    assert.ok(has(result, '手動確認範囲で F2 が重複'), JSON.stringify(result.failures));
  } finally {
    ctx.repo.cleanup();
  }
});
