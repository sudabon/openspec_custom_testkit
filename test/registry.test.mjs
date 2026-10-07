import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { main } from '../lib/cli.mjs';
import { runCiJob } from '../payload/scripts/ci-job.mjs';
import { checkEvidence } from '../payload/scripts/lib/evidence-check.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { checkTestPlan } from '../payload/scripts/lib/plan-check.mjs';
import { MOCK_CONTRACT_MAX_AGE_DEFAULT, mockContractMaxAgeDays, policyIssues } from '../payload/scripts/lib/policy.mjs';
import {
  IDEMPOTENCY_NOTE, checkRegistry, fixtureElements, mockFreshnessErrors, parseFixtureRegistry, parseMockRegistry, qualifiedTp,
} from '../payload/scripts/lib/registry.mjs';
import { capture, gitRepo } from './support.mjs';

const PAYLOAD = new URL('../payload/', import.meta.url);
const read = rel => readFileSync(new URL(rel, PAYLOAD), 'utf8');
const NOW = Date.parse('2026-10-07T03:00:00.000Z');

function write(repo, rel, text) {
  const abs = join(repo.dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}

function change(over = {}) {
  return {
    id: 'add-checkout',
    path: 'openspec/changes/add-checkout',
    schema: 'quality-driven-e2e',
    lifecycle: 'active',
    qe: true,
    e2e: 'required',
    scope: 'integrated',
    reason: '',
    errors: [],
    skipSpecs: true,
    pendingPlan: false,
    tasksText: '- [ ] 1.1 plan\n',
    ...over,
  };
}

const QUALITY = `---
risk_level: low
approved_by: ""
approved_at: ""
oracle_paths: ["tests/oracle/add-checkout"]
oracle_digest: ""
---
## Risk Register
| ID | Level |
|----|-------|
| R1 | low |
## Non-functional Viewpoints
| 観点 | Failure Mode | 該当なし理由 |
|------|--------------|--------------|
| クロスブラウザ／デバイス／レスポンシブ | | fixture は画面を持たない |
| 見た目の回帰 | | fixture は画面を持たない |
| アクセシビリティ | | fixture は画面を持たない |
| 文言・多言語 | | fixture は文言を持たない |
| 性能 | | fixture は性能要件を持たない |
| 入力系セキュリティ | | fixture は入力を持たない |
## Test Oracles
| ID | 対象 |
|----|------|
| O1 | F1 |
## Test Layer Mapping
| Failure Mode | Layer |
|--------------|-------|
| F1 | E2E |
## Residual Risk
- なし
`;

function plan(...fixtures) {
  const rows = fixtures.map((cell, index) => `| TP-00${index + 1} | Checkout | S${index + 1} | R1 | O1 | ${cell} | buy | ok |`);
  return `---\ne2e: required\n---\n## E2E観点一覧\n| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

function fixtureReadme(rows) {
  return `# fixtures\n\n## fixture 名 → 作られる状態\n\n| fixture 名 | 作られる状態 | 使用する TP-ID | 方式 |\n|---|---|---|---|\n${rows.map(([name, tps]) => `| \`${name}\` | 状態 | ${tps} | シードAPI |`).join('\n')}\n`;
}

function mockReadme(rows) {
  return `# mocks\n\n## モック一覧\n\n| モック名 | 対象サービス | 契約の出典 | 整合の確認方法 | 最終確認日 |\n|---|---|---|---|---|\n${rows.map(cells => `| ${cells.join(' | ')} |`).join('\n')}\n`;
}

function repoWith({ planText, fixtures, mocks } = {}) {
  const repo = gitRepo();
  write(repo, 'openspec/changes/add-checkout/quality.md', QUALITY);
  write(repo, 'openspec/changes/add-checkout/test-plan.md', planText ?? plan('なし'));
  if (fixtures) write(repo, 'tests/e2e/fixtures/README.md', fixtures);
  if (mocks) write(repo, 'tests/e2e/mocks/README.md', mocks);
  return repo;
}

function registryErrors(repo, over = {}) {
  return checkTestPlan(repo.dir, change(over), { now: NOW }).errors.filter(line => /README|fixture|モック|mock/.test(line));
}

test('mock_contract_max_age_days reads a value, defaults to 90 and rejects invalid values', () => {
  assert.deepEqual(mockContractMaxAgeDays('mock_contract_max_age_days: 30\n'), { days: 30, error: null });
  assert.deepEqual(mockContractMaxAgeDays('mock_contract_max_age_days: 45 # 監査対応\n'), { days: 45, error: null });
  assert.deepEqual(mockContractMaxAgeDays('# policy\n'), { days: MOCK_CONTRACT_MAX_AGE_DEFAULT, error: null });
  assert.equal(MOCK_CONTRACT_MAX_AGE_DEFAULT, 90);
  assert.equal(mockContractMaxAgeDays('本文で mock_contract_max_age_days に触れる\n').error, null);
  for (const text of [
    'mock_contract_max_age_days: 0\n',
    'mock_contract_max_age_days: -1\n',
    'mock_contract_max_age_days: 90d\n',
    'mock_contract_max_age_days:\n',
    'mock_contract_max_age_days: 30\nmock_contract_max_age_days: 60\n',
    '  mock_contract_max_age_days: 30\n',
    '- mock_contract_max_age_days: 30\n',
    '`mock_contract_max_age_days: 30`\n',
    'mock_contract_max_age_day: 30\n',
  ]) {
    assert.match(mockContractMaxAgeDays(text).error ?? '', /mock_contract_max_age_days が不正/, text);
  }
  const policy = read('openspec/quality-policy.md');
  assert.deepEqual(mockContractMaxAgeDays(policy), { days: 90, error: null });
  assert.deepEqual(policyIssues(policy), []);
});

test('Fixture cells split on both separators and recognise backticks, なし and mock:', () => {
  assert.deepEqual(fixtureElements('`seed:user`, mock:payment-gateway、seed:cart'), {
    none: false, fixtures: ['seed:user', 'seed:cart'], mocks: ['payment-gateway'], errors: [],
  });
  assert.deepEqual(fixtureElements('`mock:mail`'), { none: false, fixtures: [], mocks: ['mail'], errors: [] });
  assert.deepEqual(fixtureElements('なし'), { none: true, fixtures: [], mocks: [], errors: [] });
  assert.deepEqual(fixtureElements(' `なし` '), { none: true, fixtures: [], mocks: [], errors: [] });
  assert.deepEqual(fixtureElements('seed:a, seed:a').fixtures, ['seed:a']);
  // Negatives: なし mixed with other elements, empty elements, a nameless or upper-case mock prefix.
  assert.match(fixtureElements('なし, seed:a').errors.join(), /なし は他の要素と併用できません/);
  assert.match(fixtureElements('seed:a, , seed:b').errors.join(), /空の要素/);
  assert.match(fixtureElements('mock:').errors.join(), /モック名がありません/);
  assert.match(fixtureElements('Mock:pay').errors.join(), /小文字の mock:/);
  assert.deepEqual(fixtureElements('mockup-user').fixtures, ['mockup-user']);
});

test('registry tables are read from the README headings and ignore fenced examples', () => {
  const fixtures = parseFixtureRegistry(`${fixtureReadme([['seed:a', 'add-checkout:TP-001、add-checkout:TP-002 `other:TP-001`']])}\n\`\`\`\n| \`seed:fenced\` | x | add-checkout:TP-009 | x |\n\`\`\`\n`);
  assert.deepEqual([...fixtures.keys()], ['seed:a']);
  assert.deepEqual(fixtures.get('seed:a'), ['add-checkout:TP-001', 'add-checkout:TP-002', 'other:TP-001']);
  assert.equal(parseFixtureRegistry('# no table\n'), null);
  const mocks = parseMockRegistry(mockReadme([['`pay`', '決済', 'API v2', 'sandbox 比較', '2026-09-01']]));
  assert.deepEqual(mocks.get('pay'), { モック名: 'pay', 対象サービス: '決済', 契約の出典: 'API v2', 整合の確認方法: 'sandbox 比較', 最終確認日: '2026-09-01' });
  assert.equal(parseMockRegistry('# no table\n'), null);
  assert.equal(qualifiedTp('add-checkout', 'TP-002'), 'add-checkout:TP-002');
});

test('plan gate fixture registration scenarios', () => {
  const cases = [
    {
      name: 'Unregistered fixture',
      plan: plan('seed:user-with-one-order', 'seed:cart-empty'),
      fixtures: fixtureReadme([['seed:user-with-one-order', 'add-checkout:TP-001']]),
      expected: [/^add-checkout: TP-002 の fixture seed:cart-empty が tests\/e2e\/fixtures\/README\.md に登録されていません$/],
    },
    {
      name: 'Fixture row does not list the TP',
      plan: plan('seed:user-with-one-order', 'seed:user-with-one-order'),
      fixtures: fixtureReadme([['seed:user-with-one-order', 'add-checkout:TP-001']]),
      expected: [/TP-002 の fixture seed:user-with-one-order は .*「使用する TP-ID」に add-checkout:TP-002 がありません。登録行に追記してください$/],
    },
    {
      name: 'Bare TP identifier in the registry',
      plan: plan('seed:user-with-one-order', 'seed:user-with-one-order'),
      fixtures: fixtureReadme([['seed:user-with-one-order', 'add-checkout:TP-001, TP-002']]),
      expected: [/add-checkout:TP-002 がありません.*TP-002 は change id を含まないため数えません/],
    },
    {
      name: 'Registered fixture for another change',
      plan: plan('seed:user-with-one-order'),
      fixtures: fixtureReadme([['seed:user-with-one-order', 'add-cart:TP-001']]),
      expected: [/add-checkout:TP-001 がありません/],
    },
    { name: 'TP without preconditions', plan: plan('なし', '`なし`'), fixtures: null, expected: [] },
    {
      name: 'registered fixtures pass',
      plan: plan('`seed:user-with-one-order`', 'seed:user-with-one-order、seed:cart-empty'),
      fixtures: fixtureReadme([['seed:user-with-one-order', 'add-checkout:TP-001, add-checkout:TP-002'], ['seed:cart-empty', '`add-checkout:TP-002`']]),
      expected: [],
    },
  ];
  for (const item of cases) {
    const repo = repoWith({ planText: item.plan, fixtures: item.fixtures });
    try {
      const errors = registryErrors(repo);
      assert.equal(errors.length, item.expected.length, `${item.name}: ${errors.join('\n')}`);
      item.expected.forEach((pattern, index) => assert.match(errors[index], pattern, item.name));
    } finally { repo.cleanup(); }
  }
});

test('Registry file is missing fails with the README path, under a custom E2E root too', () => {
  const repo = repoWith({ planText: plan('seed:admin') });
  try {
    assert.deepEqual(registryErrors(repo), ['add-checkout: tests/e2e/fixtures/README.md がありません。seed:admin を登録する README を作成してください']);
    write(repo, '.openspec-custom-testkit.json', JSON.stringify({ e2eRoot: 'e2e' }));
    write(repo, 'tests/e2e/fixtures/README.md', fixtureReadme([['seed:admin', 'add-checkout:TP-001']]));
    assert.match(registryErrors(repo).join('\n'), /e2e\/fixtures\/README\.md がありません/);
    write(repo, 'e2e/fixtures/README.md', fixtureReadme([['seed:admin', 'add-checkout:TP-001']]));
    assert.deepEqual(registryErrors(repo), []);
    write(repo, 'e2e/fixtures/README.md', '# 表なし\n');
    assert.match(registryErrors(repo).join('\n'), /e2e\/fixtures\/README\.md に ## fixture 名 → 作られる状態 の表がありません/);
  } finally { repo.cleanup(); }
});

test('Legacy E2E change with an unregistered fixture only warns and keeps the gate result', () => {
  const repo = gitRepo();
  try {
    const legacyPlan = read('openspec/schemas/spec-driven-e2e/templates/test-plan.md').replace('| TP-001 | ... | ... |', '| TP-001 | ... | seed:legacy-user |');
    write(repo, 'openspec/changes/add-checkout/test-plan.md', legacyPlan);
    write(repo, 'tests/e2e/checkout.spec.ts', "test('x', { tag: ['@add-checkout', '@TP-001'] }, async () => {});\n");
    const legacy = change({ schema: 'spec-driven-e2e', scope: 'legacy-e2e', qe: false, e2e: 'required' });
    const checked = checkTestPlan(repo.dir, legacy, { now: NOW });
    assert.deepEqual(checked.errors, []);
    assert.equal(checked.warnings.length, 1);
    assert.match(checked.warnings[0], /fixtures\/README\.md がありません.*旧 spec-driven-e2e のため警告のみ/);
    const evaluated = evaluateChange(repo.dir, legacy, { phase: 'plan', quality: false, plan: true, tags: true, lint: false, env: {}, now: NOW });
    assert.deepEqual(evaluated.failures, []);
    assert.ok(evaluated.planWarnings.some(line => line.includes('旧 spec-driven-e2e のため警告のみ')));
    write(repo, 'tests/e2e/fixtures/README.md', fixtureReadme([['seed:legacy-user', 'TP-001']]));
    const bare = checkTestPlan(repo.dir, legacy, { now: NOW });
    assert.deepEqual(bare.errors, []);
    assert.match(bare.warnings.join('\n'), /add-checkout:TP-001 がありません/);
  } finally { repo.cleanup(); }
});

test('legacy quality-driven and not-applicable changes are not registry checked', () => {
  const repo = repoWith({ planText: '---\ne2e: not-applicable\nreason: 画面なし\nalternative_verification:\n  - oracle: O1\n    layer: Unit\n    method: node --test\n---\n## E2E観点一覧\n' });
  try {
    const result = checkTestPlan(repo.dir, change({ e2e: 'not-applicable' }), { now: NOW });
    assert.equal(result.registryChecked, false);
    assert.deepEqual(result.errors.filter(line => /README/.test(line)), []);
    write(repo, 'openspec/changes/add-checkout/test-plan.md', plan('seed:x'));
    const qe = checkTestPlan(repo.dir, change({ schema: 'quality-driven', scope: 'legacy-qe' }), { now: NOW });
    assert.deepEqual(qe.errors, []);
  } finally { repo.cleanup(); }
});

test('plan gate mock registration scenarios', () => {
  const full = ['`payment-gateway`', '決済代行', 'API 仕様 v2', 'sandbox と応答比較', '2026-09-01'];
  const cases = [
    { name: 'Mock is not registered', mocks: mockReadme([['mail', 'メール', 'v1', '比較', '2026-09-01']]), expected: [/TP-001 のモック payment-gateway が tests\/e2e\/mocks\/README\.md に登録されていません/] },
    { name: 'mocks README missing', mocks: null, expected: [/tests\/e2e\/mocks\/README\.md がありません。payment-gateway を登録する README を作成してください/] },
    { name: 'Mock row lacks a contract source', mocks: mockReadme([full.map((cell, i) => (i === 2 ? '' : cell))]), expected: [/モック payment-gateway: 契約の出典 が空です/] },
    { name: 'several empty columns', mocks: mockReadme([[full[0], '', '', '', '']]), expected: [/対象サービス・契約の出典・整合の確認方法・最終確認日 が空です/] },
    { name: 'Malformed verification date', mocks: mockReadme([full.map((cell, i) => (i === 4 ? '2026/10/01' : cell))]), expected: [/最終確認日 2026\/10\/01 の形式が不正です/] },
    { name: 'impossible date', mocks: mockReadme([full.map((cell, i) => (i === 4 ? '2026-02-30' : cell))]), expected: [/最終確認日 2026-02-30 の形式が不正です/] },
    { name: 'future date', mocks: mockReadme([full.map((cell, i) => (i === 4 ? '2026-10-08' : cell))]), expected: [/最終確認日 2026-10-08 が将来の日付です（検査日 2026-10-07）/] },
    { name: 'checked today passes', mocks: mockReadme([full.map((cell, i) => (i === 4 ? '2026-10-07' : cell))]), expected: [] },
    { name: 'registered mock passes', mocks: mockReadme([full]), expected: [] },
  ];
  for (const item of cases) {
    const repo = repoWith({ planText: plan('mock:payment-gateway'), mocks: item.mocks });
    try {
      const errors = registryErrors(repo);
      assert.equal(errors.length, item.expected.length, `${item.name}: ${errors.join('\n')}`);
      item.expected.forEach((pattern, index) => assert.match(errors[index], pattern, item.name));
    } finally { repo.cleanup(); }
  }
});

test('template examples pass the registry checks', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/fixtures/README.md', read('tests/e2e/fixtures/README.md'));
    write(repo, 'tests/e2e/mocks/README.md', read('tests/e2e/mocks/README.md'));
    const rows = [
      { 'TP-ID': 'TP-001', Fixture: 'seed:user-with-one-order, mock:payment-gateway' },
      { 'TP-ID': 'TP-004', Fixture: '`seed:user-with-one-order`' },
      { 'TP-ID': 'TP-005', Fixture: 'なし' },
    ];
    const result = checkRegistry(repo.dir, change(), rows, { now: NOW });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.mocks.map(mock => mock.name), ['payment-gateway']);
    // The integrated template row uses なし and stays outside the registry check.
    const templatePlan = read('openspec/schemas/quality-driven-e2e/templates/test-plan.md');
    assert.match(templatePlan, /\| TP-001 \| \| \| R1 \| O1 \| なし \|/);
  } finally { repo.cleanup(); }
});

test('Stale mock contract fails at final unless an approved residual names the mock', () => {
  const mocks = [{ name: 'payment-gateway', verified: '2026-06-09' }];
  const stale = mockFreshnessErrors(mocks, { maxAgeDays: 90, now: NOW });
  assert.equal(stale.length, 1);
  assert.match(stale[0], /モック payment-gateway の最終確認日 2026-06-09 から 120 日経過しています（上限 90 日、検査日 2026-10-07）/);
  assert.deepEqual(mockFreshnessErrors([{ name: 'payment-gateway', verified: '2026-07-09' }], { maxAgeDays: 90, now: NOW }), []);
  assert.equal(mockFreshnessErrors([{ name: 'payment-gateway', verified: '2026-07-08' }], { maxAgeDays: 90, now: NOW }).length, 1);
  const approved = { id: 'RES-1', reason: 'payment-gateway の sandbox が停止中', impact: '決済の契約変更を検知できない', approved_by: 'qa-lead', approved_at: '2026-10-01' };
  assert.deepEqual(mockFreshnessErrors(mocks, { maxAgeDays: 90, residuals: [approved], now: NOW }), []);
  for (const residual of [
    { ...approved, approved_by: '' },
    { ...approved, approved_at: '2026/10/01' },
    { ...approved, reason: 'payment-gateway-v2 の停止', impact: '' },
    { ...approved, reason: 'mail の停止', impact: '' },
  ]) {
    assert.equal(mockFreshnessErrors(mocks, { maxAgeDays: 90, residuals: [residual], now: NOW }).length, 1, JSON.stringify(residual));
  }
});

test('final evidence check applies the policy limit to registered mocks with a fixed date', () => {
  const repo = repoWith({
    planText: plan('mock:payment-gateway'),
    mocks: mockReadme([['payment-gateway', '決済代行', 'API v2', 'sandbox 比較', '2026-06-09']]),
  });
  try {
    const evidence = residuals => `## Execution Records\n\`\`\`json\n${JSON.stringify({ format_version: 1, runs: [], risk_results: [], falsification: { performed: true, summary: 'x', counterexamples: [] }, residuals })}\n\`\`\`\n`;
    write(repo, 'openspec/changes/add-checkout/evidence.md', evidence([]));
    const stale = line => /モック payment-gateway/.test(line);
    const run = policyText => checkEvidence(repo.dir, change(), { digest: '', policyText, now: NOW }).errors;
    assert.equal(run('').filter(stale).length, 1, 'default 90 days');
    assert.equal(run('mock_contract_max_age_days: 120\n').filter(stale).length, 0);
    assert.match(run('mock_contract_max_age_days: 0\n').join('\n'), /mock_contract_max_age_days が不正/);
    write(repo, 'openspec/changes/add-checkout/evidence.md', evidence([{ id: 'RES-1', reason: 'payment-gateway の契約照合を延期', impact: 'API 変更を検知できない', approved_by: 'qa-lead', approved_at: '2026-10-01' }]));
    assert.equal(run('').filter(stale).length, 0);
    assert.equal(checkEvidence(repo.dir, change(), { digest: '', policyText: '', now: Date.parse('2026-09-01T00:00:00Z') }).errors.filter(stale).length, 0);
    assert.equal(checkEvidence(repo.dir, change({ e2e: 'not-applicable' }), { digest: '', policyText: '', now: NOW }).errors.filter(stale).length, 0);
  } finally { repo.cleanup(); }
});

test('plan gate output says fixture idempotency is not checked', () => {
  const repo = repoWith({ planText: plan('seed:a'), fixtures: fixtureReadme([['seed:a', 'add-checkout:TP-001']]) });
  try {
    write(repo, 'openspec/changes/add-checkout/.openspec.yaml', 'schema: quality-driven-e2e\ncreated: 2026-10-01\n');
    write(repo, 'openspec/changes/add-checkout/tasks.md', '- [ ] 1.1 plan\n');
    repo.commit('change');
    let output;
    try {
      output = execFileSync(process.execPath, [new URL('../payload/scripts/testkit-gate.mjs', import.meta.url).pathname, 'check', '--base', 'HEAD~1', 'add-checkout'], { cwd: repo.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      output = err.stdout;
    }
    assert.ok(output.split('\n').includes(`  ✓ ${IDEMPOTENCY_NOTE}`), output);
    assert.doesNotMatch(output, /fixtures\/README\.md/);
  } finally { repo.cleanup(); }
});

test('contract-command runs only when set, is recorded and fails the job after saving', () => {
  const repo = gitRepo();
  try {
    write(repo, 'README.md', 'x\n');
    repo.commit('base');
    const env = { BASE_REF: 'HEAD', SETUP_MODE: 'caller', TEST_COMMAND: 'unit' };
    const commands = [];
    const quiet = runCiJob(env, { cwd: repo.dir, execFile(file, args) { commands.push(args.at(-1)); return 'ok'; } });
    assert.equal(quiet.code, 0, quiet.lines.join('\n'));
    assert.deepEqual(commands, ['unit']);
    commands.length = 0;
    const failed = runCiJob({ ...env, CONTRACT_COMMAND: 'npm run test:contract' }, {
      cwd: repo.dir,
      execFile(file, args) {
        commands.push(args.at(-1));
        if (args.at(-1) !== 'npm run test:contract') return 'ok';
        const err = new Error('contract failed');
        Object.assign(err, { status: 4, stdout: 'pact mismatch\n', stderr: 'provider drift\n' });
        throw err;
      },
    });
    assert.deepEqual(commands, ['unit', 'npm run test:contract']);
    assert.equal(failed.code, 4);
    assert.ok(failed.runDir);
    assert.equal(readFileSync(join(failed.runDir, 'contract.log'), 'utf8'), 'pact mismatch\nprovider drift\n');
    assert.match(readFileSync(join(failed.summaryDir, 'summary.txt'), 'utf8'), /pact mismatch[\s\S]*exit 4/);
    const passed = runCiJob({ ...env, CONTRACT_COMMAND: 'contract' }, { cwd: repo.dir, execFile: () => 'ok' });
    assert.equal(passed.code, 0);
    assert.ok(existsSync(join(passed.runDir, 'contract.log')));
  } finally { repo.cleanup(); }
});

test('reusable workflow passes contract-command through the environment with an empty default', () => {
  const workflow = readFileSync(new URL('../.github/workflows/openspec-custom-testkit-gate.yml', import.meta.url), 'utf8');
  assert.match(workflow, /contract-command:\n\s+description: .+\n\s+type: string\n\s+default: ""/);
  assert.match(workflow, /CONTRACT_COMMAND: \$\{\{ inputs\.contract-command \}\}/);
  assert.doesNotMatch(workflow, /run:.*inputs\.contract-command/);
});

test('fixtures README documents both column names that the test-plan templates use', () => {
  const readme = read('tests/e2e/fixtures/README.md');
  assert.match(readme, /`Fixture` 列/);
  assert.match(readme, /「前提\(fixture\)」列/);
  assert.match(read('openspec/schemas/quality-driven-e2e/templates/test-plan.md'), /\| Fixture \|/);
  assert.match(read('openspec/schemas/spec-driven-e2e/templates/test-plan.md'), /\| 前提\(fixture\) \|/);
  assert.match(readme, /add-checkout:TP-001, add-checkout:TP-004/);
  assert.doesNotMatch(readme, /\| TP-001, TP-004 \|/);
});

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'tk-registry-'));
}

const sha = text => createHash('sha256').update(text).digest('hex');

test('install places mocks README under the E2E root and never overwrites an existing one', async () => {
  for (const root of [null, 'e2e']) {
    const target = tempDir();
    try {
      const args = ['install', '--force', '--target', target, ...(root ? ['--e2e-root', root] : [])];
      const first = await capture(main, args);
      assert.equal(first.code, 0, first.text);
      const base = root ?? 'tests/e2e';
      assert.equal(readFileSync(join(target, base, 'mocks/README.md'), 'utf8'), read('tests/e2e/mocks/README.md').replaceAll('tests/e2e', base));
      assert.ok(existsSync(join(target, base, 'fixtures/README.md')));
      writeFileSync(join(target, base, 'mocks/README.md'), '# 利用者のモック一覧\n');
      const again = await capture(main, ['update', '--force', '--target', target]);
      assert.equal(again.code, 0, again.text);
      assert.equal(readFileSync(join(target, base, 'mocks/README.md'), 'utf8'), '# 利用者のモック一覧\n');
      assert.match(again.text, new RegExp(`保持: ${base}/mocks/README\\.md`));
    } finally { rmSync(target, { recursive: true, force: true }); }
  }
  const existing = tempDir();
  try {
    mkdirSync(join(existing, 'tests/e2e/mocks'), { recursive: true });
    writeFileSync(join(existing, 'tests/e2e/mocks/README.md'), '# 既存\n');
    const result = await capture(main, ['install', '--force', '--target', existing]);
    assert.equal(result.code, 0, result.text);
    assert.equal(readFileSync(join(existing, 'tests/e2e/mocks/README.md'), 'utf8'), '# 既存\n');
  } finally { rmSync(existing, { recursive: true, force: true }); }
});

test('update replaces a known unedited fixtures README and keeps an edited one', async () => {
  const previous = readFileSync(new URL('./fixtures/registry/fixtures-README.previous.md', import.meta.url), 'utf8');
  const current = read('tests/e2e/fixtures/README.md');
  for (const edited of [false, true]) {
    const target = tempDir();
    try {
      execFileSync('git', ['init', '-q', target]);
      const first = await capture(main, ['install', '--target', target]);
      assert.equal(first.code, 0, first.text);
      // Simulate the previous kit: it wrote the old README and recorded its hash in the stamp.
      const stampPath = join(target, '.openspec-custom-testkit.json');
      const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
      stamp.files['tests/e2e/fixtures/README.md'] = sha(previous);
      writeFileSync(stampPath, JSON.stringify(stamp, null, 2));
      const userText = `${previous}\n| \`seed:own\` | 利用者の行 | add-cart:TP-001 | シードAPI |\n`;
      writeFileSync(join(target, 'tests/e2e/fixtures/README.md'), edited ? userText : previous);
      const update = await capture(main, ['update', '--target', target]);
      assert.equal(update.code, 0, update.text);
      const after = readFileSync(join(target, 'tests/e2e/fixtures/README.md'), 'utf8');
      if (edited) {
        assert.equal(after, userText);
        assert.match(update.text, /差分あり\(上書きしません\): tests\/e2e\/fixtures\/README\.md/);
      } else {
        assert.equal(after, current);
      }
    } finally { rmSync(target, { recursive: true, force: true }); }
  }
});
