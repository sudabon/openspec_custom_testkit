import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestForSchema } from '../payload/scripts/lib/digest.mjs';
import { doctor } from '../payload/scripts/lib/doctor.mjs';
import { checkEvidence } from '../payload/scripts/lib/evidence-check.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { splitFrontmatter } from '../payload/scripts/lib/frontmatter.mjs';
import { sha256File } from '../payload/scripts/lib/hash.mjs';
// Namespace import: a missing export fails only the tests that use it, not the whole file.
import * as policy from '../payload/scripts/lib/policy.mjs';
import { gitRepo } from './support.mjs';

const root = new URL('..', import.meta.url);
const QE_GATE = fileURLToPath(new URL('payload/scripts/qe-gate.mjs', root));
const TESTKIT_GATE = fileURLToPath(new URL('payload/scripts/testkit-gate.mjs', root));
const payload = rel => readFileSync(new URL(`payload/${rel}`, root), 'utf8');
const POLICY_BASE = 'mutation_threshold_high: 70\n| Oracle の seal | 必須 | 必須 | 必須 |\n| Falsification レビュー | 必須 | 必須 | 必須 |\n';
const STARTED = '- [x] 1.1 oracle\n- [x] 2.1 implement\n- [ ] 3.1 falsify\n';
const DONE = '- [x] 1.1 a\n- [x] 2.1 b\n- [x] 3.1 c\n- [x] 4.1 d\n- [x] 5.1 e\n';

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
    tasksText: null,
    ...over,
  };
}

function quality(level, { approved = true, digest = '', qa = null } = {}) {
  const qaLines = qa ? `qa_reviewed_by: "${qa.by ?? ''}"\nqa_reviewed_at: "${qa.at ?? ''}"\n` : '';
  return `---
risk_level: ${level}
approved_by: "${approved ? 'FIXTURE-DUMMY-APPROVAL' : ''}"
approved_at: "${approved ? '2026-10-01' : ''}"
${qaLines}oracle_paths: ["tests/oracle/demo"]
oracle_digest: "${digest}"
---
## Risk Register
| ID | Level |
|----|-------|
| R1 | ${level} |
## Non-functional Viewpoints
| 観点 | Failure Mode | 該当なし理由 |
|------|--------------|--------------|
| 全観点 | | fixture は画面を持たない |
## Test Oracles
| ID | 対象 |
|----|------|
| O1 | F1 |
## Test Layer Mapping
| Failure Mode | Layer |
|--------------|-------|
| F1 | Unit |
## Residual Risk
- なし
`;
}

function setup({ policy = POLICY_BASE, schema = 'quality-driven-e2e' } = {}) {
  const repo = gitRepo();
  write(repo, 'openspec/config.yaml', 'schema: spec-driven\n');
  write(repo, 'openspec/quality-policy.md', policy);
  write(repo, 'tests/oracle/demo/oracle.test.mjs', 'oracle\n');
  write(repo, 'openspec/changes/demo/.openspec.yaml', `schema: ${schema}\n`);
  const digest = digestForSchema(repo.dir, schema, ['tests/oracle/demo']).digest;
  return { repo, digest };
}

const qaFailures = result => result.failures.filter(line => /QA レビュー|qa_review/.test(line));
const seal = cwd => spawnSync(process.execPath, [QE_GATE, 'seal', 'demo'], { cwd, encoding: 'utf8' });

// Requirement: QA reviewer role in the quality policy

test('policy defines distinct human roles and the QA review timing', () => {
  const policy = payload('openspec/quality-policy.md');
  const roles = policy.split('## 2.')[0];
  for (const role of ['quality.md 承認者', 'Oracle seal 実施者', 'QA レビュー担当', 'コードレビュー担当']) {
    assert.match(roles, new RegExp(`^\\| ${role} \\|`, 'm'), role);
  }
  const qaRow = roles.split('\n').find(line => line.startsWith('| QA レビュー担当 |'));
  assert.match(qaRow, /quality\.md 承認前/);
  assert.match(policy, /^qa_review_required_levels: \[medium, high\]$/m);
  const forbidden = policy.split('## 4.')[1].split('## 5.')[0];
  assert.match(forbidden, /qa_reviewed_by/);
  assert.match(forbidden, /qa_reviewed_at/);
  // The integrated gates required for every risk level stay unchanged.
  assert.match(policy, /^\| quality\.md の人間承認 \| 必須 \| 必須 \| 必須 \|$/m);
  assert.match(policy, /^\| Oracle の seal \| 必須 \| 必須 \| 必須 \|$/m);
  assert.match(policy, /^\| Falsification レビュー \| 必須 \| 必須 \| 必須 \|$/m);
});

test('qa_review_required_levels reads lists, defaults when missing and rejects invalid values', () => {
  assert.deepEqual(policy.qaReviewRequiredLevels('qa_review_required_levels: [medium, high]\n'), { levels: ['medium', 'high'], error: null, defaulted: false });
  assert.deepEqual(policy.qaReviewRequiredLevels('qa_review_required_levels: []\n'), { levels: [], error: null, defaulted: false });
  assert.deepEqual(policy.qaReviewRequiredLevels(POLICY_BASE), { levels: ['medium', 'high'], error: null, defaulted: true });
  for (const bad of ['qa_review_required_levels: [critical]', 'qa_review_required_levels: high', 'qa_review_required_levels: [high,]',
    '  qa_review_required_levels: [high]', '- qa_review_required_levels: [high]', 'qa_review_required_level: [high]',
    'qa_review_required_levels: [high]\nqa_review_required_levels: [low]']) {
    const result = policy.qaReviewRequiredLevels(`${POLICY_BASE}${bad}\n`);
    assert.ok(result.error, bad);
    assert.match(result.error, /qa_review_required_levels/);
  }
  // Prose that mentions the key mid-sentence is not a setting.
  assert.equal(policy.qaReviewRequiredLevels('文中で `qa_review_required_levels` に触れるだけの説明\n').error, null);
});

test('QA setting cannot weaken integrated approval and seal gates', () => {
  const { repo } = setup({ policy: `${POLICY_BASE}qa_review_required_levels: []\n` });
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('low', { approved: false }));
    const result = evaluateChange(repo.dir, change({ tasksText: STARTED }), { phase: 'plan', plan: false });
    assert.ok(result.failures.some(line => line.includes('未承認')), JSON.stringify(result.failures));
    assert.ok(result.failures.some(line => line.includes('seal')), JSON.stringify(result.failures));
    assert.deepEqual(qaFailures(result), []);
  } finally {
    repo.cleanup();
  }
});

test('invalid QA level setting fails doctor, gate and seal instead of meaning not required', () => {
  const { repo, digest } = setup({ policy: `${POLICY_BASE}qa_review_required_levels: [critical]\n` });
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('low', { digest, qa: {} }));
    const result = evaluateChange(repo.dir, change({ tasksText: STARTED }), { phase: 'plan', plan: false });
    assert.ok(result.failures.some(line => line.includes('qa_review_required_levels')), JSON.stringify(result.failures));
    const checked = doctor(repo.dir);
    assert.ok(checked.failures.some(line => line.includes('qa_review_required_levels が不正です')), JSON.stringify(checked.failures));
    write(repo, 'openspec/changes/demo/quality.md', quality('low', { qa: {} }));
    const sealed = seal(repo.dir);
    assert.equal(sealed.status, 1, sealed.stdout + sealed.stderr);
    assert.match(sealed.stderr, /qa_review_required_levels/);
    assert.equal(splitFrontmatter(readFileSync(join(repo.dir, 'openspec/changes/demo/quality.md'), 'utf8')).data.oracle_digest, '');
  } finally {
    repo.cleanup();
  }
});

test('doctor shows that the default QA levels apply when the policy has no setting', () => {
  const { repo } = setup({ policy: payload('openspec/quality-policy.md').replace(/^qa_review_required_levels:.*\n/m, '') });
  try {
    const checked = doctor(repo.dir);
    assert.ok(checked.notes.some(line => line.includes('qa_review_required_levels') && line.includes('[medium, high]')), JSON.stringify(checked.notes));
    assert.equal(checked.failures.some(line => line.includes('qa_review_required_levels')), false);
  } finally {
    repo.cleanup();
  }
});

// Requirement: Human-only QA review record before seal

test('seal is blocked without the required QA review', () => {
  const { repo } = setup({ policy: `${POLICY_BASE}qa_review_required_levels: [medium]\n` });
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('medium', { qa: {} }));
    const sealed = seal(repo.dir);
    assert.equal(sealed.status, 1, sealed.stdout + sealed.stderr);
    assert.match(sealed.stderr, /QA レビュー/);
    assert.match(sealed.stderr, /medium/);
    assert.equal(splitFrontmatter(readFileSync(join(repo.dir, 'openspec/changes/demo/quality.md'), 'utf8')).data.oracle_digest, '');

    write(repo, 'openspec/changes/demo/quality.md', quality('medium', { qa: { by: 'FIXTURE-DUMMY-QA', at: '2026-02-30' } }));
    const badDate = seal(repo.dir);
    assert.equal(badDate.status, 1, badDate.stdout + badDate.stderr);
    assert.match(badDate.stderr, /QA レビュー/);

    write(repo, 'openspec/changes/demo/quality.md', quality('medium', { qa: { by: 'FIXTURE-DUMMY-QA', at: '2026-10-01' } }));
    const ok = seal(repo.dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(splitFrontmatter(readFileSync(join(repo.dir, 'openspec/changes/demo/quality.md'), 'utf8')).data.oracle_digest, /^manifest-sha256:/);
  } finally {
    repo.cleanup();
  }
});

test('plan and final gates fail on a missing or invalid required QA review', () => {
  const { repo, digest } = setup({ policy: `${POLICY_BASE}qa_review_required_levels: [medium, high]\n` });
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('medium', { digest }));
    const started = evaluateChange(repo.dir, change({ tasksText: STARTED }), { phase: 'plan', plan: false });
    assert.equal(qaFailures(started).length, 1, JSON.stringify(started.failures));
    assert.match(qaFailures(started)[0], /medium/);
    const final = evaluateChange(repo.dir, change({ tasksText: DONE }), { phase: 'final', plan: false });
    assert.equal(qaFailures(final).length, 1, JSON.stringify(final.failures));

    write(repo, 'openspec/changes/demo/quality.md', quality('medium', { digest, qa: { by: 'FIXTURE-DUMMY-QA', at: '2026/10/01' } }));
    const planning = evaluateChange(repo.dir, change(), { phase: 'plan', plan: false });
    assert.equal(qaFailures(planning).length, 1, JSON.stringify(planning.failures));

    write(repo, 'openspec/changes/demo/quality.md', quality('medium', { digest, qa: { at: '2026-10-01' } }));
    const noReviewer = evaluateChange(repo.dir, change({ tasksText: STARTED }), { phase: 'plan', plan: false });
    assert.equal(qaFailures(noReviewer).length, 1, JSON.stringify(noReviewer.failures));

    write(repo, 'openspec/changes/demo/quality.md', quality('medium', { digest, qa: { by: 'FIXTURE-DUMMY-QA', at: '2026-10-01' } }));
    const reviewed = evaluateChange(repo.dir, change({ tasksText: STARTED }), { phase: 'plan', plan: false });
    assert.deepEqual(qaFailures(reviewed), []);
    assert.ok(reviewed.oks.some(line => line.includes('QA レビュー済み')), JSON.stringify(reviewed.oks));
  } finally {
    repo.cleanup();
  }
});

test('a missing QA review before implementation is a warning, like a missing approval', () => {
  const { repo } = setup();
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('high', { approved: false }));
    const result = evaluateChange(repo.dir, change(), { phase: 'plan', plan: false });
    assert.deepEqual(qaFailures(result), []);
    assert.ok(result.warnings.some(line => line.includes('QA レビュー')), JSON.stringify(result.warnings));
  } finally {
    repo.cleanup();
  }
});

test('QA review is not required for a level outside the policy', () => {
  const { repo, digest } = setup({ policy: `${POLICY_BASE}qa_review_required_levels: [high]\n` });
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('low', { digest, qa: {} }));
    const result = evaluateChange(repo.dir, change({ tasksText: DONE }), { phase: 'plan', plan: false });
    assert.deepEqual(qaFailures(result), []);
    assert.deepEqual(result.warnings.filter(line => line.includes('QA レビュー')), []);
    write(repo, 'openspec/changes/demo/quality.md', quality('low', { qa: {} }));
    const sealed = seal(repo.dir);
    assert.equal(sealed.status, 0, sealed.stdout + sealed.stderr);
    // Other human gates are still checked.
    write(repo, 'openspec/changes/demo/quality.md', quality('low', { approved: false, digest, qa: {} }));
    const unapproved = evaluateChange(repo.dir, change({ tasksText: STARTED }), { phase: 'plan', plan: false });
    assert.ok(unapproved.failures.some(line => line.includes('未承認')), JSON.stringify(unapproved.failures));
  } finally {
    repo.cleanup();
  }
});

test('adding empty QA fields keeps an existing seal valid', () => {
  const { repo, digest } = setup({ policy: `${POLICY_BASE}qa_review_required_levels: []\n` });
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('medium', { digest }));
    const before = evaluateChange(repo.dir, change({ tasksText: STARTED }), { phase: 'plan', plan: false });
    assert.ok(before.oks.includes('Oracle は seal 時から変更されていません'), JSON.stringify(before));
    write(repo, 'openspec/changes/demo/quality.md', quality('medium', { digest, qa: {} }));
    assert.equal(digestForSchema(repo.dir, 'quality-driven-e2e', ['tests/oracle/demo']).digest, digest);
    const after = evaluateChange(repo.dir, change({ tasksText: STARTED }), { phase: 'plan', plan: false });
    assert.ok(after.oks.includes('Oracle は seal 時から変更されていません'), JSON.stringify(after));
    assert.deepEqual(after.failures, []);
  } finally {
    repo.cleanup();
  }
});

test('legacy schemas are not asked for the QA review', () => {
  const { repo, digest } = setup({ schema: 'quality-driven' });
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('high', { digest }));
    const legacy = evaluateChange(repo.dir, change({ schema: 'quality-driven', scope: 'legacy-qe', tasksText: DONE }), { phase: 'plan', plan: false });
    assert.deepEqual(qaFailures(legacy), []);
    assert.deepEqual(legacy.warnings.filter(line => line.includes('QA レビュー')), []);
    write(repo, 'openspec/changes/demo/quality.md', quality('high'));
    const sealed = seal(repo.dir);
    assert.equal(sealed.status, 0, sealed.stdout + sealed.stderr);

    write(repo, 'openspec/changes/e2e/.openspec.yaml', 'schema: spec-driven-e2e\n');
    const e2e = evaluateChange(repo.dir, change({ id: 'e2e', path: 'openspec/changes/e2e', schema: 'spec-driven-e2e', scope: 'legacy-e2e', qe: false, e2e: 'required', tasksText: DONE }), { phase: 'plan', plan: false });
    assert.deepEqual(qaFailures(e2e), []);
  } finally {
    repo.cleanup();
  }
});

test('integrated quality template carries human-only QA fields; legacy template does not', () => {
  const integrated = payload('openspec/schemas/quality-driven-e2e/templates/quality.md');
  const data = splitFrontmatter(integrated).data;
  assert.equal(data.qa_reviewed_by, '');
  assert.equal(data.qa_reviewed_at, '');
  assert.match(integrated, /^qa_reviewed_by:.*Agent は編集禁止/m);
  assert.match(integrated, /^qa_reviewed_at:.*Agent は編集禁止/m);
  assert.doesNotMatch(payload('openspec/schemas/quality-driven/templates/quality.md'), /qa_reviewed/);
  const schema = payload('openspec/schemas/quality-driven-e2e/schema.yaml');
  const qualityInstruction = schema.split('  - id: quality\n')[1].split('  - id: design\n')[0];
  assert.match(qualityInstruction, /qa_reviewed_by/);
  assert.match(qualityInstruction, /qa_review_required_levels/);
  const apply = schema.split('\napply:\n')[1];
  assert.match(apply, /qa_reviewed_by/);
  assert.match(apply, /qa_review_required_levels/);
  assert.doesNotMatch(payload('openspec/schemas/quality-driven/schema.yaml'), /qa_review/);
  assert.doesNotMatch(payload('openspec/schemas/spec-driven-e2e/schema.yaml'), /qa_review/);
});

// Requirement: Test design checklist for QA review

test('QA reviewer role lists inputs, exclusions and every test design technique', () => {
  const role = payload('openspec/roles/qa-reviewer.md');
  const inputs = role.split('## 入力してよいもの')[1].split('\n## ')[0];
  for (const item of ['specs/**/*.md', 'quality.md', 'test-plan.md', 'quality-policy.md']) assert.ok(inputs.includes(item), item);
  const excluded = role.split('## 入力してはいけないもの')[1].split('\n## ')[0];
  assert.match(excluded, /design\.md/);
  assert.match(excluded, /実装/);
  for (const technique of ['同値分割', '境界値', 'デシジョンテーブル', '状態遷移', 'エラー推測', 'シナリオ']) {
    assert.match(role, new RegExp(`^### .*${technique}`, 'm'), technique);
  }
  assert.match(role, /該当しない技法/);
  assert.match(role, /理由/);
});

test('QA findings are returned as proposals and approval fields are re-entered by humans', () => {
  const role = payload('openspec/roles/qa-reviewer.md');
  const output = role.split('## 出力')[1].split('\n## ')[0];
  assert.match(output, /Failure Mode/);
  assert.match(output, /Oracle/);
  assert.match(output, /提案/);
  assert.match(role, /承認者/);
  const forbidden = role.split('## 禁止')[1];
  for (const field of ['approved_by', 'approved_at', 'oracle_digest']) assert.ok(forbidden.includes(field), field);
  assert.match(forbidden, /期待値を確定/);
  assert.match(role, /qa_reviewed_by/);
  assert.match(role, /改めて記入/);
});

// Requirement: Optional human effort records

function evidenceSetup({ effort } = {}) {
  const repo = gitRepo();
  write(repo, 'tests/oracle/demo/oracle.txt', 'oracle\n');
  write(repo, 'test-results/run.json', '{}\n');
  const revision = repo.git(['rev-parse', 'HEAD']).trim();
  write(repo, 'openspec/changes/demo/quality.md', quality('low'));
  const data = {
    format_version: 1,
    runs: [{ id: 'run-1', command: 'node --test', started_at: '2026-10-01T00:00:00.000Z', revision, exit_code: 0, source: 'test-results/run.json', source_sha256: sha256File(join(repo.dir, 'test-results/run.json')) }],
    risk_results: [{ risk: 'R1', failure_modes: ['F1'], oracles: ['O1'], layer: 'Unit', tp_ids: [], result: 'pass', run_ids: ['run-1'] }],
    falsification: { performed: true, summary: 'tried', counterexamples: [] },
    mutation: { command: '', status: 'not-required', score: null, threshold: 70 },
    reviews: [],
    oracle_changes: [],
    residuals: [],
    ...(effort === undefined ? {} : { effort }),
  };
  write(repo, 'openspec/changes/demo/evidence.md', `# Evidence\n## 追跡\n| Risk | Result |\n|------|--------|\n| R1 | pass |\n## Execution Records\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`);
  return repo;
}

test('evidence without effort is judged by the other checks only', () => {
  const repo = evidenceSetup();
  try {
    const result = checkEvidence(repo.dir, change(), { digest: '', policyText: POLICY_BASE });
    assert.deepEqual(result.errors, []);
  } finally {
    repo.cleanup();
  }
});

test('well-formed effort records pass the structure check', () => {
  const repo = evidenceSetup({ effort: [
    { activity: 'approval', minutes: 10, recorded_by: 'FIXTURE-DUMMY' },
    { activity: 'manual-test', minutes: 0, recorded_by: 'FIXTURE-DUMMY' },
    { activity: 'qa-review', minutes: 12.5, recorded_by: 'FIXTURE-DUMMY' },
  ] });
  try {
    assert.deepEqual(checkEvidence(repo.dir, change(), { digest: '', policyText: POLICY_BASE }).errors, []);
  } finally {
    repo.cleanup();
  }
});

test('malformed effort entries fail and name the element', () => {
  const repo = evidenceSetup({ effort: [
    { activity: 'qa-review', minutes: -5, recorded_by: 'FIXTURE-DUMMY' },
    { activity: 'testing', minutes: 10, recorded_by: 'FIXTURE-DUMMY' },
    { activity: 'seal', minutes: '10', recorded_by: 'FIXTURE-DUMMY' },
    { activity: 'code-review', minutes: 5 },
    null,
  ] });
  try {
    const { errors } = checkEvidence(repo.dir, change(), { digest: '', policyText: POLICY_BASE });
    assert.ok(errors.some(line => line.includes('effort[0]') && line.includes('-5')), JSON.stringify(errors));
    assert.ok(errors.some(line => line.includes('effort[1]') && line.includes('testing')), JSON.stringify(errors));
    assert.ok(errors.some(line => line.includes('effort[2]') && line.includes('minutes')), JSON.stringify(errors));
    assert.ok(errors.some(line => line.includes('effort[3]') && line.includes('recorded_by')), JSON.stringify(errors));
    assert.ok(errors.some(line => line.includes('effort[4]')), JSON.stringify(errors));
  } finally {
    repo.cleanup();
  }
  const scalar = evidenceSetup({ effort: { activity: 'seal' } });
  try {
    const { errors } = checkEvidence(scalar.dir, change(), { digest: '', policyText: POLICY_BASE });
    assert.ok(errors.some(line => line.includes('effort') && line.includes('配列')), JSON.stringify(errors));
  } finally {
    scalar.cleanup();
  }
});

test('the untouched evidence template is still unexecuted and documents effort', () => {
  const template = payload('openspec/schemas/quality-driven-e2e/templates/evidence.md');
  for (const activity of ['approval', 'seal', 'qa-review', 'falsification-review', 'code-review', 'manual-test', 'other']) {
    assert.ok(template.includes(`\`${activity}\``), activity);
  }
  assert.match(template, /推測で埋めない/);
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('low'));
    write(repo, 'openspec/changes/demo/evidence.md', template);
    const { errors } = checkEvidence(repo.dir, change(), { digest: '', policyText: POLICY_BASE });
    assert.ok(errors.some(line => line.includes('R1 の結果が未実行')), JSON.stringify(errors));
    assert.equal(errors.some(line => line.includes('effort')), false, JSON.stringify(errors));
  } finally {
    repo.cleanup();
  }
});

// Requirement: Effort aggregation across archived changes

function archived(repo, folder, { schema = 'quality-driven-e2e', level = 'medium', effort, records = true, raw = null } = {}) {
  const dir = `openspec/changes/archive/${folder}`;
  if (schema) write(repo, `${dir}/.openspec.yaml`, `schema: ${schema}\n`);
  write(repo, `${dir}/quality.md`, quality(level));
  const data = { format_version: 1, runs: [], risk_results: [], ...(effort === undefined ? {} : { effort }) };
  const block = raw ?? JSON.stringify(data, null, 2);
  write(repo, `${dir}/evidence.md`, records ? `# Evidence\n## Execution Records\n\`\`\`json\n${block}\n\`\`\`\n` : '# Evidence\n');
}

function effortRepo() {
  const repo = gitRepo();
  write(repo, 'openspec/config.yaml', 'schema: spec-driven\n');
  archived(repo, '2026-08-01-add-cart', { level: 'medium', effort: [
    { activity: 'qa-review', minutes: 30, recorded_by: 'qa' },
    { activity: 'code-review', minutes: 20, recorded_by: 'dev' },
    { activity: 'manual-test', minutes: 60, recorded_by: 'qa' },
  ] });
  archived(repo, '2026-09-01-add-tax', { level: 'high', effort: [
    { activity: 'qa-review', minutes: 15, recorded_by: 'qa' },
    { activity: 'approval', minutes: 5, recorded_by: 'owner' },
  ] });
  archived(repo, '2026-09-15-fix-label', { level: 'low' });
  return repo;
}

const effortCli = (cwd, ...args) => spawnSync(process.execPath, [TESTKIT_GATE, 'effort', ...args], { cwd, encoding: 'utf8' });

test('unrecorded changes are counted apart and never averaged as zero', () => {
  const repo = effortRepo();
  try {
    const out = effortCli(repo.dir, '--format', 'json');
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const report = JSON.parse(out.stdout);
    assert.equal(report.targets, 3);
    assert.equal(report.recorded.count, 2);
    assert.deepEqual(report.unrecorded, { count: 1, ids: ['fix-label'] });
    assert.equal(report.total_minutes, 130);
    assert.equal(report.average_minutes_per_recorded_change, 65);
    assert.equal(report.recording_rate, 2 / 3);
    assert.deepEqual(report.broken, { count: 0, changes: [] });
    assert.deepEqual(report.by_risk_level.medium, { minutes: 110, entries: 3, changes: 1 });
    assert.deepEqual(report.by_risk_level.high, { minutes: 20, entries: 2, changes: 1 });
    assert.deepEqual(report.by_risk_level.low, { minutes: 0, entries: 0, changes: 0 });
  } finally {
    repo.cleanup();
  }
});

test('activity totals sit side by side so the shift between roles is visible', () => {
  const repo = effortRepo();
  try {
    const json = JSON.parse(effortCli(repo.dir, '--format', 'json').stdout);
    assert.deepEqual(json.by_activity['qa-review'], { minutes: 45, entries: 2, changes: 2 });
    assert.deepEqual(json.by_activity['manual-test'], { minutes: 60, entries: 1, changes: 1 });
    assert.deepEqual(json.by_activity['code-review'], { minutes: 20, entries: 1, changes: 1 });
    assert.deepEqual(Object.keys(json.by_activity), ['approval', 'seal', 'qa-review', 'falsification-review', 'code-review', 'manual-test', 'other']);
    const table = effortCli(repo.dir);
    assert.equal(table.status, 0, table.stderr);
    assert.match(table.stdout, /\| qa-review \| 45 \| 2 \| 2 \|/);
    assert.match(table.stdout, /\| manual-test \| 60 \| 1 \| 1 \|/);
    assert.match(table.stdout, /\| code-review \| 20 \| 1 \| 1 \|/);
    assert.match(table.stdout, /未記録: 1 件 \(fix-label\)/);
    assert.match(table.stdout, /記録率: 67%/);
  } finally {
    repo.cleanup();
  }
});

test('broken evidence is reported by id and makes the aggregation exit non-zero', () => {
  const repo = effortRepo();
  try {
    archived(repo, '2026-09-20-broken-json', { raw: '{ "format_version": 1, ' });
    archived(repo, '2026-09-21-bad-effort', { effort: [{ activity: 'testing', minutes: -1, recorded_by: 'x' }] });
    archived(repo, '2026-09-22-no-records', { records: false });
    const out = effortCli(repo.dir, '--format', 'json');
    assert.equal(out.status, 1, out.stdout + out.stderr);
    const report = JSON.parse(out.stdout);
    assert.equal(report.broken.count, 3);
    assert.deepEqual(report.broken.changes.map(item => item.id), ['broken-json', 'bad-effort', 'no-records']);
    assert.equal(report.recorded.count, 2);
    assert.equal(report.unrecorded.count, 1);
    assert.equal(report.total_minutes, 130);
    const table = effortCli(repo.dir);
    assert.equal(table.status, 1);
    assert.match(table.stdout, /破損: 3 件/);
    assert.match(table.stdout, /broken-json/);
  } finally {
    repo.cleanup();
  }
});

test('only archived changes of the integrated schema are aggregated', () => {
  const repo = effortRepo();
  try {
    archived(repo, '2026-09-10-legacy-qe', { schema: 'quality-driven', effort: [{ activity: 'seal', minutes: 999, recorded_by: 'x' }] });
    archived(repo, '2026-09-11-legacy-e2e', { schema: 'spec-driven-e2e', raw: 'broken' });
    archived(repo, '2026-09-12-no-metadata', { schema: null, effort: [{ activity: 'seal', minutes: 999, recorded_by: 'x' }] });
    write(repo, 'openspec/changes/active-one/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/active-one/evidence.md', '# Evidence\n## Execution Records\n```json\n{"format_version":1,"effort":[{"activity":"seal","minutes":999,"recorded_by":"x"}]}\n```\n');
    const out = effortCli(repo.dir, '--format', 'json');
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const report = JSON.parse(out.stdout);
    assert.equal(report.targets, 3);
    assert.equal(report.total_minutes, 130);
  } finally {
    repo.cleanup();
  }
});

test('--since filters by archive date and arguments are validated', () => {
  const repo = effortRepo();
  try {
    const report = JSON.parse(effortCli(repo.dir, '--since', '2026-09-01', '--format', 'json').stdout);
    assert.equal(report.targets, 2);
    assert.equal(report.since, '2026-09-01');
    assert.equal(report.total_minutes, 20);
    assert.deepEqual(report.unrecorded.ids, ['fix-label']);
    const inline = JSON.parse(effortCli(repo.dir, '--since=2026-09-02', '--format=json').stdout);
    assert.equal(inline.targets, 1);
    for (const args of [['--since', '2026-13-01'], ['--since'], ['--format', 'csv'], ['--unknown']]) {
      const bad = effortCli(repo.dir, ...args);
      assert.equal(bad.status, 2, args.join(' '));
      assert.ok(bad.stderr.trim(), args.join(' '));
    }
  } finally {
    repo.cleanup();
  }
});

test('a low recording rate is called out in the output', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/config.yaml', 'schema: spec-driven\n');
    archived(repo, '2026-09-01-one', { effort: [{ activity: 'seal', minutes: 5, recorded_by: 'x' }] });
    archived(repo, '2026-09-02-two', {});
    archived(repo, '2026-09-03-three', {});
    const table = effortCli(repo.dir);
    assert.equal(table.status, 0, table.stderr);
    assert.match(table.stdout, /記録率が低い/);
    const empty = gitRepo();
    try {
      write(empty, 'openspec/config.yaml', 'schema: spec-driven\n');
      const none = effortCli(empty.dir, '--format', 'json');
      assert.equal(none.status, 0, none.stderr);
      const report = JSON.parse(none.stdout);
      assert.equal(report.targets, 0);
      assert.equal(report.recording_rate, null);
      assert.equal(report.average_minutes_per_recorded_change, null);
    } finally {
      empty.cleanup();
    }
  } finally {
    repo.cleanup();
  }
});

// Requirement: QA ownership example

test('CODEOWNERS example assigns QA owners and states the identity limit', () => {
  const owners = payload('.github/CODEOWNERS.example');
  for (const path of ['/openspec/changes/*/quality.md', '/openspec/changes/*/test-plan.md', '/openspec/roles/qa-reviewer.md']) {
    const rule = owners.split('\n').find(line => line.startsWith(`${path} `));
    assert.deepEqual(rule?.trim().split(/\s+/).slice(1), ['@your-org/qa-team'], path);
  }
  assert.match(owners, /Require review from Code Owners/);
  assert.match(owners, /本人確認/);
});

// PR #12 regression coverage. All approval/review identities below are isolated fixture data.

test('approved plans require QA even before the first completed task, including scope-only integration', () => {
  const { repo } = setup();
  try {
    write(repo, 'openspec/changes/demo/quality.md', quality('medium'));
    for (const schema of ['quality-driven-e2e', 'custom-schema']) {
      const result = evaluateChange(repo.dir, change({ schema, qe: false }), { phase: 'plan', plan: false });
      assert.equal(qaFailures(result).length, 1, JSON.stringify(result));
      assert.match(qaFailures(result)[0], /qa_reviewed_by が空/);
    }
  } finally { repo.cleanup(); }
});

test('gate and seal require the QA date to precede or equal approval', () => {
  const { repo } = setup();
  try {
    for (const at of ['2026-09-30', '2026-10-01', '2026-10-02']) {
      const text = quality('medium', { qa: { by: 'FIXTURE-DUMMY-QA', at } });
      write(repo, 'openspec/changes/demo/quality.md', text);
      for (const phase of ['plan', 'final']) {
        const result = evaluateChange(repo.dir, change(), { phase, plan: false });
        assert.equal(qaFailures(result).length, at === '2026-10-02' ? 1 : 0, JSON.stringify(result));
        if (at === '2026-10-02') assert.match(qaFailures(result)[0], /qa_reviewed_at <= approved_at/);
      }
      const out = seal(repo.dir);
      assert.equal(out.status, at === '2026-10-02' ? 1 : 0, out.stdout + out.stderr);
      if (at === '2026-10-02') {
        assert.match(out.stderr, /qa_reviewed_at <= approved_at/);
        assert.equal(readFileSync(join(repo.dir, 'openspec/changes/demo/quality.md'), 'utf8'), text);
      }
    }
  } finally { repo.cleanup(); }
});

test('seal does not bypass required QA when risk_level is invalid', () => {
  const { repo } = setup();
  try {
    for (const level of ['', 'critical']) {
      const text = quality(level);
      write(repo, 'openspec/changes/demo/quality.md', text);
      const out = seal(repo.dir);
      assert.equal(out.status, 1, out.stdout + out.stderr);
      assert.match(out.stderr, /QA レビュー/);
      assert.equal(readFileSync(join(repo.dir, 'openspec/changes/demo/quality.md'), 'utf8'), text);
    }
  } finally { repo.cleanup(); }
});

test('QA, flaky and mock policy keys reject hyphens and uppercase without rejecting prose', () => {
  for (const [key, value, parse] of [
    ['qa_review_required_levels', '[high]', policy.qaReviewRequiredLevels],
    ['flaky_fail_levels', '[high]', policy.flakyFailLevels],
    ['mock_contract_max_age_days', '90', policy.mockContractMaxAgeDays],
  ]) {
    for (const malformed of [key.replaceAll('_', '-'), key.toUpperCase(), key.replace('_', '-')]) {
      assert.ok(parse(`${malformed}: ${value}`).error, malformed);
    }
    assert.equal(parse(`文中で ${key}: ${value} に触れる説明`).error, null);
  }
});

test('empty effort arrays pass evidence checks and count as unrecorded, while null fails', () => {
  for (const effort of [[], null]) {
    const repo = evidenceSetup({ effort });
    try {
      const { errors } = checkEvidence(repo.dir, change(), { digest: '', policyText: POLICY_BASE });
      assert.equal(errors.some(line => line.includes('effort')), effort === null, errors.join('\n'));
      archived(repo, '2026-10-01-empty', { effort });
      const out = effortCli(repo.dir, '--format', 'json');
      assert.equal(out.status, effort === null ? 1 : 0, out.stderr);
      const report = JSON.parse(out.stdout);
      assert.equal(report.unrecorded.count, effort === null ? 0 : 1);
      assert.equal(report.recorded.count, 0);
      assert.equal(report.total_minutes, 0);
      assert.equal(report.average_minutes_per_recorded_change, null);
    } finally { repo.cleanup(); }
  }
});

test('effort uses the integrated config default and counts repeated activities once per change', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/config.yaml', 'schema: quality-driven-e2e\n');
    archived(repo, '2026-10-01-default', { schema: null, effort: [
      { activity: 'qa-review', minutes: 10, recorded_by: 'x' },
      { activity: 'qa-review', minutes: 20, recorded_by: 'y' },
    ] });
    const out = effortCli(repo.dir, '--format', 'json');
    assert.equal(out.status, 0, out.stderr);
    const report = JSON.parse(out.stdout);
    assert.equal(report.targets, 1);
    assert.equal(report.recorded.count, 1);
    assert.deepEqual(report.by_activity['qa-review'], { minutes: 30, entries: 2, changes: 1 });
  } finally { repo.cleanup(); }
});

test('broken config reports dependent archives without excluding explicit schemas', () => {
  const repo = gitRepo();
  try {
    archived(repo, '2026-10-01-default', { schema: null });
    archived(repo, '2026-10-02-explicit');
    archived(repo, '2026-10-03-legacy', { schema: 'quality-driven' });
    for (const config of ['schema: [', '- invalid', 'schema: [quality-driven-e2e]', 'schema: &s quality-driven-e2e\nother: *s']) {
      write(repo, 'openspec/config.yaml', config);
      const out = effortCli(repo.dir, '--format', 'json');
      assert.equal(out.status, 1, out.stderr);
      const report = JSON.parse(out.stdout);
      assert.equal(report.targets, 2);
      assert.deepEqual(report.unrecorded.ids, ['explicit']);
      assert.equal(report.broken.count, 1);
      assert.equal(report.broken.changes[0].id, 'default');
      assert.match(report.broken.changes[0].reason, /config.yaml.*既定 schema/);
      assert.match(out.stderr, /default/);
    }
  } finally { repo.cleanup(); }
});

test('since excludes old broken metadata and folder names before validation', () => {
  const repo = gitRepo();
  try {
    archived(repo, '2026-09-01-old');
    write(repo, 'openspec/changes/archive/2026-09-01-old/.openspec.yaml', 'schema: [');
    archived(repo, '2026-09-02-');
    archived(repo, '2026-10-01-current');
    const all = effortCli(repo.dir, '--format', 'json');
    assert.equal(all.status, 1, all.stderr);
    assert.equal(JSON.parse(all.stdout).broken.count, 2);
    const filtered = effortCli(repo.dir, '--since', '2026-10-01', '--format', 'json');
    assert.equal(filtered.status, 0, filtered.stderr);
    assert.deepEqual(JSON.parse(filtered.stdout).unrecorded.ids, ['current']);
    // An unreadable date cannot establish that a folder lies outside the requested period.
    archived(repo, 'bad-folder');
    archived(repo, '2026-02-30-bad-date');
    const unknown = effortCli(repo.dir, '--since', '2026-10-01', '--format', 'json');
    assert.equal(unknown.status, 1, unknown.stderr);
    const broken = JSON.parse(unknown.stdout).broken.changes;
    assert.equal(broken.length, 2);
    assert.ok(broken.every(item => /フォルダ名/.test(item.reason)));
  } finally { repo.cleanup(); }
});

test('missing evidence is broken and unknown risk levels retain effort with a reason in both formats', () => {
  const repo = gitRepo();
  try {
    const effort = [{ activity: 'seal', minutes: 10, recorded_by: 'x' }];
    archived(repo, '2026-10-01-missing-evidence');
    rmSync(join(repo.dir, 'openspec/changes/archive/2026-10-01-missing-evidence/evidence.md'));
    for (const [id, text] of [['missing-quality', null], ['bad-risk', quality('critical')], ['bad-quality', '---\nrisk_level: [\n---\n']]) {
      const folder = `2026-10-02-${id}`;
      archived(repo, folder, { effort });
      const path = `openspec/changes/archive/${folder}/quality.md`;
      if (text === null) rmSync(join(repo.dir, path));
      else write(repo, path, text);
    }
    const json = effortCli(repo.dir, '--format', 'json');
    assert.equal(json.status, 1, json.stderr);
    const report = JSON.parse(json.stdout);
    assert.equal(report.broken.count, 1);
    assert.match(report.broken.changes[0].reason, /evidence.md がありません/);
    assert.deepEqual(report.by_risk_level.unknown, { minutes: 30, entries: 3, changes: 3 });
    assert.equal(report.total_minutes, 30);
    assert.equal(report.warnings.length, 3);
    const table = effortCli(repo.dir);
    for (const warning of report.warnings) assert.ok(table.stdout.includes(warning), warning);
    for (const id of ['missing-quality', 'bad-risk', 'bad-quality']) assert.ok(report.warnings.some(line => line.includes(id)));
  } finally { repo.cleanup(); }
});

test('JSON effort output includes the low recording rate warning', () => {
  const repo = gitRepo();
  try {
    archived(repo, '2026-10-01-empty', { effort: [] });
    const out = effortCli(repo.dir, '--format', 'json');
    assert.equal(out.status, 0, out.stderr);
    assert.ok(JSON.parse(out.stdout).warnings.some(line => line.includes('記録率が低い')));
  } finally { repo.cleanup(); }
});

test('evidence reports I/O failures but propagates programming errors from quarantine and freshness', t => {
  for (const stage of ['quarantine', 'freshness']) {
    const repo = evidenceSetup();
    try {
      const path = stage === 'quarantine' ? 'tests/e2e/quarantine.md' : 'openspec/changes/demo/test-plan.md';
      mkdirSync(join(repo.dir, path), { recursive: true });
      const selected = change({ e2e: 'required' });
      const options = { digest: '', policyText: POLICY_BASE };
      const { errors } = checkEvidence(repo.dir, selected, options);
      assert.ok(errors.some(line => /確認できません.*EISDIR/.test(line)), errors.join('\n'));
      rmSync(join(repo.dir, path), { recursive: true });
      write(repo, path, '# parser-failure-fixture\n');
      const original = String.prototype.split;
      const bug = new TypeError(`${stage} parser failure`);
      const mocked = t.mock.method(String.prototype, 'split', function (...args) {
        if (this.includes('parser-failure-fixture')) throw bug;
        return original.apply(this, args);
      });
      try { assert.throws(() => checkEvidence(repo.dir, selected, options), err => err === bug); }
      finally { mocked.mock.restore(); }
    } finally { repo.cleanup(); }
  }
});
