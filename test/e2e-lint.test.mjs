import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../lib/cli.mjs';
import { doctor } from '../payload/scripts/lib/doctor.mjs';
import { lintChange, lintRepo, lintSource } from '../payload/scripts/lib/e2e-lint.mjs';
import { evaluateChange } from '../payload/scripts/lib/evaluate.mjs';
import { runCiJob } from '../payload/scripts/ci-job.mjs';
import { capture, gitRepo } from './support.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/e2e-lint/', import.meta.url));
const gate = fileURLToPath(new URL('../payload/scripts/testkit-gate.mjs', import.meta.url));
const shippedPolicy = readFileSync(new URL('../payload/openspec/quality-policy.md', import.meta.url), 'utf8');

function fixture(rel) {
  return readFileSync(join(fixtures, rel), 'utf8');
}

function lintFixture(rel) {
  return lintSource(fixture(rel), { path: rel });
}

function brief(findings) {
  return findings.map(item => `${item.rule}:${item.line}:${item.test ?? ''}`).sort();
}

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
    e2e: 'required',
    scope: 'integrated',
    reason: '',
    errors: [],
    fallback: false,
    skipSpecs: true,
    pendingPlan: false,
    tasksText: '- [ ] 1.1 plan\n',
    ...over,
  };
}

function evidence(residuals) {
  return `# Evidence

## Execution Records

\`\`\`json
${JSON.stringify({ format_version: 1, runs: [], risk_results: [], residuals }, null, 2)}
\`\`\`
`;
}

const approved = { id: 'RES-1', reason: '表示自体が要件', impact: '状態変化を観測しない', approved_by: 'qa-lead', approved_at: '2026-10-01' };
const unapproved = { id: 'RES-2', reason: 'Agent が追加', impact: '不明', approved_by: '', approved_at: '' };

const strongSpec = (title, tags) => `import { expect, test } from '@playwright/test';

test('${title}', { tag: ${JSON.stringify(tags)} }, async ({ page }) => {
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('保存しました');
});
`;

// Temporary git repo whose base..HEAD diff holds a tagged file, a changed untagged file, and an untouched file.
function scopeRepo({ policy = shippedPolicy } = {}) {
  const repo = gitRepo();
  write(repo, 'openspec/quality-policy.md', policy);
  write(repo, 'openspec/changes/archive/2026-01-01-old/.openspec.yaml', 'schema: spec-driven-e2e\n');
  write(repo, 'tests/e2e/legacy.spec.ts', `import { expect, test } from '@playwright/test';

test('古いテスト', { tag: ['@old', '@TP-009'] }, async ({ page }) => {
  await page.locator('.save').click();
  await expect(page.getByRole('status')).toHaveText('保存しました');
});
`);
  write(repo, 'tests/e2e/edited.spec.ts', strongSpec('編集される古いテスト', ['@old', '@TP-010']));
  repo.commit('base');
  const base = repo.git(['rev-parse', 'HEAD']).trim();
  write(repo, 'tests/e2e/edited.spec.ts', `import { test } from '@playwright/test';

test('編集される古いテスト', { tag: ['@old', '@TP-010'] }, async ({ page }) => {
  await page.getByRole('button', { name: '保存' }).click();
});
`);
  write(repo, 'tests/e2e/tagged.spec.ts', `import { expect, test } from '@playwright/test';

test('新しい TP', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  await expect(page.getByRole('heading')).toBeVisible();
});
`);
  repo.commit('head');
  return { repo, base };
}

function files(entries) {
  return entries.map(entry => `${entry.rule}:${entry.file}`).sort();
}

test('fixed waits are reported with rule, line, and test name', () => {
  const bad = lintFixture('rules/fixed-wait.bad.spec.ts');
  assert.equal(bad.error, null);
  assert.deepEqual(brief(bad.findings), ['fixed-wait:5:待ってから合計を見る', 'fixed-wait:6:待ってから合計を見る']);
  assert.deepEqual(lintFixture('rules/fixed-wait.good.spec.ts').findings, []);
});

test('CSS, element, and XPath locators are reported, role locators are not', () => {
  const bad = lintFixture('rules/locator.bad.spec.ts');
  assert.deepEqual(brief(bad.findings), [4, 5, 6, 7, 8].map(line => `forbidden-locator:${line}:CSS で探す`));
  assert.match(bad.findings.find(item => item.line === 8).message, /XPath/);
  assert.deepEqual(lintFixture('rules/locator.good.spec.ts').findings, []);
});

test('skip, fixme, only, and fail on tests and describes are reported and excluded TPs are not implemented', () => {
  const bad = lintFixture('rules/excluded.bad.spec.ts');
  assert.deepEqual(brief(bad.findings), [
    'excluded-test:11:これだけ実行',
    'excluded-test:15:失敗を期待する',
    'excluded-test:20:条件つきで飛ばす',
    'excluded-test:24:飛ばしたグループ',
    'excluded-test:30:これだけのグループ',
    'excluded-test:3:飛ばした TP',
    'excluded-test:7:直す予定の TP',
  ]);
  const implemented = bad.tests.filter(item => !item.excluded).flatMap(item => item.tags).filter(tag => tag.startsWith('@TP-')).sort();
  assert.deepEqual(implemented, ['@TP-003', '@TP-007']);
});

test('tests without a change tag or a TP tag are reported per test', () => {
  const bad = lintFixture('rules/tags.bad.spec.ts');
  assert.deepEqual(brief(bad.findings), ['missing-tag:11:change タグが無い', 'missing-tag:3:タグが無い', 'missing-tag:7:TP タグが無い']);
});

test('nested describes, configure, options, and inherited tags yield the expected tests', () => {
  const good = lintFixture('rules/structure.good.spec.ts');
  assert.deepEqual(good.findings, []);
  assert.deepEqual(good.tests.map(item => ({ title: item.title, line: item.line, tags: [...item.tags].sort(), describes: item.describes })), [
    { title: '一覧に件数が出る @TP-001', line: 10, tags: ['@TP-001', '@demo'], describes: ['注文'] },
    { title: '詳細に金額が出る', line: 15, tags: ['@TP-002', '@demo'], describes: ['注文', '詳細'] },
  ]);
  const detail = good.tests[1];
  const text = fixture('rules/structure.good.spec.ts');
  assert.match(text.slice(detail.start, detail.end), /^test\('詳細に金額が出る'[\s\S]*toHaveText\('注文 1'\);\n {4}\}\)$/);
});

test('matches inside comments, strings, regex literals, and JSX text are not reported', () => {
  for (const rel of ['rules/comments-strings.good.spec.ts', 'rules/component.good.spec.tsx']) {
    const result = lintFixture(rel);
    assert.equal(result.error, null, rel);
    assert.deepEqual(result.findings, [], rel);
    assert.equal(result.tests.length, 1, rel);
  }
});

test('code inside nested template expressions is still checked', () => {
  assert.deepEqual(brief(lintFixture('rules/template.bad.spec.ts').findings), ['forbidden-locator:5:テンプレートの入れ子']);
});

test('an unterminated source is unparseable instead of clean', () => {
  const result = lintFixture('rules/unterminated.bad.spec.ts');
  assert.ok(result.error);
  assert.deepEqual(brief(result.findings), ['unparseable:4:']);
});

test('assertion-free and existence-only tests are reported with the matchers used', () => {
  const bad = lintFixture('rules/assertions.bad.spec.ts');
  assert.deepEqual(brief(bad.findings), ['missing-assertion:3:操作だけ', 'weak-assertion:13:soft と poll の存在確認だけ', 'weak-assertion:8:表示確認だけ']);
  assert.match(bad.findings.find(item => item.line === 8).message, /toBeVisible/);
  const mixed = bad.findings.find(item => item.line === 13).message;
  for (const name of ['toBeAttached', 'toBeTruthy', 'not.toBeNull', 'toBeDefined']) assert.ok(mixed.includes(name), name);
  assert.deepEqual(lintFixture('rules/assertions.good.spec.ts').findings, []);
});

test('dynamic titles and non-literal bodies are not skipped, and postfix increments are division', () => {
  const head = "import { expect, test } from '@playwright/test';\n";
  const dynamic = lintSource(`${head}for (const c of cases) test(c.name, { tag: ['@demo', '@TP-001'] }, async ({ page }) => {\n  await page.goto(c.url);\n});\n`, { path: 'a.spec.ts' });
  assert.deepEqual(brief(dynamic.findings), ['missing-assertion:2:c.name']);
  const reference = lintSource(`${head}test('参照だけ', { tag: ['@demo', '@TP-001'] }, runFlow);\n`, { path: 'a.spec.ts' });
  assert.deepEqual(brief(reference.findings), ['missing-assertion:2:参照だけ']);
  const wrapped = lintSource(`${head}test('包む', { tag: ['@demo', '@TP-001'] }, withAuth(async ({ page }) => {\n  await page.goto('/');\n}));\n`, { path: 'a.spec.ts' });
  assert.deepEqual(brief(wrapped.findings), ['missing-assertion:2:包む']);
  const postfix = lintSource(`${head}test('割り算', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {\n  let n = 1;\n  n++ / 2;\n  await expect(page).toHaveTitle('a');\n});\n`, { path: 'a.spec.ts' });
  assert.equal(postfix.error, null);
  assert.deepEqual(postfix.findings, []);
});

test('a suppression cannot cover a whole describe and helper methods need a page object receiver', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/pages/form.ts', `import { expect } from '@playwright/test';
export class FormPage {
  constructor(page) { this.page = page; }
  async fill(value) { await expect(this.page.getByRole('status')).toHaveText(value); }
}
`);
    write(repo, 'tests/e2e/group.spec.ts', `import { expect, test } from '@playwright/test';
import { FormPage } from './pages/form';

// e2e-lint-allow fixed-wait RES-1: グループ全体
test.describe('グループ', () => {
  test('待つ', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
    await page.waitForTimeout(1);
    await expect(page.getByRole('status')).toHaveText('1');
  });
});

test('別の fill は数えない', { tag: ['@demo', '@TP-002'] }, async ({ page }) => {
  await page.getByLabel('名前').fill('a');
});

test('Page Object の fill は数える', { tag: ['@demo', '@TP-003'] }, async ({ page }) => {
  const form = new FormPage(page);
  await form.fill('a');
  await new FormPage(page).fill('b');
});
`);
    write(repo, 'openspec/changes/demo/evidence.md', evidence([approved]));
    repo.commit('describe');
    const result = lintRepo(repo.dir, [change()], { phase: 'final', env: {} });
    assert.deepEqual(brief(result.enforced), ['fixed-wait:7:待つ', 'missing-assertion:12:別の fill は数えない']);
    assert.match(result.enforced[0].text, /describe 全体は抑止できません/);
    assert.deepEqual(result.exceptions, []);
  } finally {
    repo.cleanup();
  }
});

test('assertions through exported page objects and helpers under the E2E root count', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/demo/.openspec.yaml', 'schema: spec-driven-e2e\n');
    cpSync(join(fixtures, 'root'), join(repo.dir, 'tests/e2e'), { recursive: true });
    repo.commit('fixtures');
    const result = lintRepo(repo.dir, [], { phase: 'plan', env: {} });
    const found = [...result.enforced, ...result.warned].filter(entry => entry.file === 'tests/e2e/checkout.spec.ts');
    assert.deepEqual(brief(found), [
      'missing-assertion:24:操作だけの Page Object',
      'missing-assertion:28:export されていない helper は数えない',
      'weak-assertion:20:存在確認だけの helper',
    ]);
    assert.equal([...result.enforced, ...result.warned].some(entry => entry.file !== 'tests/e2e/checkout.spec.ts'), false);
  } finally {
    repo.cleanup();
  }
});

test('scope harness: tagged and changed files fail, untouched files only warn', () => {
  const { repo, base } = scopeRepo();
  try {
    const result = lintRepo(repo.dir, [change()], { phase: 'plan', base, env: {} });
    assert.deepEqual(files(result.enforced), ['missing-assertion:tests/e2e/edited.spec.ts', 'weak-assertion:tests/e2e/tagged.spec.ts']);
    assert.deepEqual(files(result.warned), ['forbidden-locator:tests/e2e/legacy.spec.ts']);
    assert.equal(result.failed, 2);

    const local = lintRepo(repo.dir, [change()], { phase: 'plan', env: {} });
    assert.deepEqual(files(local.enforced), ['weak-assertion:tests/e2e/tagged.spec.ts']);
    assert.deepEqual(files(local.warned), ['forbidden-locator:tests/e2e/legacy.spec.ts', 'missing-assertion:tests/e2e/edited.spec.ts']);
    assert.match(local.notes.join('\n'), /タグ範囲のみ/);
  } finally {
    repo.cleanup();
  }
});

test('policy fields fall back to defaults and the integrated schema keeps tagged sources enforced', () => {
  const variants = {
    missing: shippedPolicy.replace(/^e2e_lint_(mode|scope):.*\n/gm, ''),
    invalid: shippedPolicy.replace(/^e2e_lint_mode:.*$/m, 'e2e_lint_mode: maybe').replace(/^e2e_lint_scope:.*$/m, 'e2e_lint_scope: some'),
  };
  assert.match(shippedPolicy, /^e2e_lint_mode: enforce/m);
  assert.match(shippedPolicy, /^e2e_lint_scope: changed/m);
  for (const [name, policy] of Object.entries(variants)) {
    const { repo, base } = scopeRepo({ policy });
    try {
      const result = lintRepo(repo.dir, [change()], { phase: 'plan', base, env: {} });
      assert.deepEqual(files(result.enforced), ['missing-assertion:tests/e2e/edited.spec.ts', 'weak-assertion:tests/e2e/tagged.spec.ts'], name);
      if (name === 'invalid') assert.match(result.notes.join('\n'), /既定値/);
    } finally {
      repo.cleanup();
    }
  }

  const warn = scopeRepo({ policy: shippedPolicy.replace(/^e2e_lint_mode:.*$/m, 'e2e_lint_mode: warn') });
  try {
    const result = lintRepo(warn.repo.dir, [change()], { phase: 'plan', base: warn.base, env: { QE_E2E_LINT_MODE: 'warn' } });
    assert.deepEqual(files(result.enforced), ['weak-assertion:tests/e2e/tagged.spec.ts']);
    assert.ok(files(result.warned).includes('missing-assertion:tests/e2e/edited.spec.ts'));
  } finally {
    warn.repo.cleanup();
  }

  const env = scopeRepo();
  try {
    const result = lintRepo(env.repo.dir, [change()], { phase: 'plan', base: env.base, env: { QE_E2E_LINT_MODE: 'warn', QE_E2E_LINT_SCOPE: 'changed' } });
    assert.deepEqual(files(result.enforced), ['missing-assertion:tests/e2e/edited.spec.ts', 'weak-assertion:tests/e2e/tagged.spec.ts']);
    assert.match(result.notes.join('\n'), /QE_E2E_LINT_MODE.*無視/);

    const all = shippedPolicy.replace(/^e2e_lint_scope:.*$/m, 'e2e_lint_scope: all');
    write(env.repo, 'openspec/quality-policy.md', all);
    const wide = lintRepo(env.repo.dir, [change()], { phase: 'plan', base: env.base, env: {} });
    assert.ok(files(wide.enforced).includes('forbidden-locator:tests/e2e/legacy.spec.ts'));
  } finally {
    env.repo.cleanup();
  }
});

test('legacy spec-driven-e2e changes default to warn and accept the environment override', () => {
  const { repo, base } = scopeRepo();
  try {
    const legacy = change({ schema: 'spec-driven-e2e', scope: 'legacy-e2e', qe: false });
    const warned = lintRepo(repo.dir, [legacy], { phase: 'plan', base, env: {} });
    assert.deepEqual(warned.enforced, []);
    assert.equal(warned.failed, 0);
    assert.ok(files(warned.warned).includes('weak-assertion:tests/e2e/tagged.spec.ts'));
    const enforced = lintRepo(repo.dir, [legacy], { phase: 'plan', base, env: { QE_E2E_LINT_MODE: 'enforce' } });
    assert.deepEqual(files(enforced.enforced), ['missing-assertion:tests/e2e/edited.spec.ts', 'weak-assertion:tests/e2e/tagged.spec.ts']);
  } finally {
    repo.cleanup();
  }
});

test('suppressions need a human-approved residual and only cover the next statement or test', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/quality-policy.md', shippedPolicy);
    write(repo, 'tests/e2e/banner.spec.ts', fixture('suppress/banner.spec.ts'));
    write(repo, 'openspec/changes/demo/evidence.md', evidence([approved, unapproved]));
    repo.commit('suppressions');
    const final = lintRepo(repo.dir, [change()], { phase: 'final', env: {} });
    assert.deepEqual(brief(final.exceptions), ['fixed-wait:32:効力は直後の 1 文だけ', 'missing-assertion:24:テスト単位の抑止', 'weak-assertion:3:承認済みの例外']);
    assert.ok(final.exceptions.every(entry => entry.text.includes('承認済みの例外') && entry.text.includes('RES-1')));
    assert.deepEqual(brief(final.enforced), [
      'fixed-wait:26:テスト単位の抑止',
      'fixed-wait:33:効力は直後の 1 文だけ',
      'weak-assertion:13:存在しない Residual',
      'weak-assertion:18:Residual ID が無い',
      'weak-assertion:8:承認待ちの例外',
    ]);
    assert.match(final.enforced.find(entry => entry.line === 8).text, /approved_by/);
    assert.match(final.enforced.find(entry => entry.line === 13).text, /RES-404/);
    assert.match(final.enforced.find(entry => entry.line === 18).text, /Residual ID/);

    const plan = lintRepo(repo.dir, [change()], { phase: 'plan', env: {} });
    assert.deepEqual(brief(plan.pending), ['weak-assertion:8:承認待ちの例外']);
    assert.match(plan.pending[0].text, /承認待ち/);
    assert.deepEqual(brief(plan.enforced), [
      'fixed-wait:26:テスト単位の抑止',
      'fixed-wait:33:効力は直後の 1 文だけ',
      'weak-assertion:13:存在しない Residual',
      'weak-assertion:18:Residual ID が無い',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('an unused suppression without a residual still fails in both phases', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/unused.spec.ts', `import { expect, test } from '@playwright/test';

test('理由だけの抑止', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  // e2e-lint-allow weak-assertion: 理由だけ
  await expect(page.getByRole('status')).toHaveText('1');
});
`);
    repo.commit('unused');
    for (const phase of ['plan', 'final']) {
      const result = lintRepo(repo.dir, [change()], { phase, env: {} });
      assert.deepEqual(brief(result.enforced), ['invalid-suppression:4:理由だけの抑止'], phase);
    }
  } finally {
    repo.cleanup();
  }
});

test('an unparseable file in scope fails closed', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/broken.spec.ts', fixture('rules/unterminated.bad.spec.ts'));
    write(repo, 'tests/e2e/flow.feature', 'Feature: @demo\n');
    repo.commit('broken');
    const result = lintRepo(repo.dir, [change()], { phase: 'plan', env: {} });
    assert.deepEqual(files(result.enforced), ['unparseable:tests/e2e/broken.spec.ts']);
    assert.deepEqual(result.unsupported, ['tests/e2e/flow.feature']);
  } finally {
    repo.cleanup();
  }
});

test('excluded tests do not implement a planned TP at test level', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/skip.spec.ts', fixture('rules/excluded.bad.spec.ts'));
    repo.commit('skip');
    const result = lintChange(repo.dir, change(), { phase: 'plan', env: {}, tpIds: ['TP-001', 'TP-003'] });
    const text = result.failures.join('\n');
    assert.match(text, /e2e-lint missing-tag .*TP-001/);
    assert.doesNotMatch(text, /missing-tag .*TP-003/);
  } finally {
    repo.cleanup();
  }
});

function gateRepo() {
  const { repo, base } = scopeRepo();
  write(repo, 'openspec/changes/demo/.openspec.yaml', 'schema: quality-driven-e2e\nskip_specs: true\n');
  write(repo, 'openspec/changes/demo/test-plan.md', `---
e2e: required
---
## E2E観点一覧
| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
|-------|-------------|----------|------|--------|---------|--------|----------|
| TP-001 | r | s | R1 | O1 | none | i | e |
`);
  write(repo, 'openspec/changes/na/.openspec.yaml', 'schema: quality-driven-e2e\nskip_specs: true\n');
  write(repo, 'openspec/changes/na/test-plan.md', '---\ne2e: not-applicable\nreason: 画面なし\n---\n');
  repo.commit('changes');
  return { repo, base };
}

test('check runs the lint once per file for required changes and not for not-applicable ones', () => {
  const { repo, base } = gateRepo();
  try {
    const cache = {};
    const options = { phase: 'plan', tags: true, env: {}, cache, base };
    const required = evaluateChange(repo.dir, change(), options);
    assert.ok(required.failures.some(line => /^e2e-lint weak-assertion tests\/e2e\/tagged\.spec\.ts:3 「新しい TP」/.test(line)), required.failures.join('\n'));
    assert.ok(required.failures.some(line => line.startsWith('e2e-lint missing-assertion tests/e2e/edited.spec.ts:3')));
    assert.equal(required.failures.some(line => line.includes('legacy.spec.ts')), false);
    assert.ok(required.warnings.some(line => /e2e-lint.*1 件/.test(line)), required.warnings.join('\n'));
    const second = evaluateChange(repo.dir, change({ id: 'demo2', path: 'openspec/changes/demo' }), options);
    assert.ok(second.failures.length > 0);
    assert.equal(cache.e2eLint.analyzed, 3);
    const na = evaluateChange(repo.dir, change({ id: 'na', path: 'openspec/changes/na', e2e: 'not-applicable' }), options);
    assert.equal([...na.failures, ...na.warnings, ...na.oks].some(line => line.includes('e2e-lint')), false);
  } finally {
    repo.cleanup();
  }
});

test('testkit-gate lint separates enforced and warned findings and keeps exit codes', () => {
  const { repo, base } = gateRepo();
  try {
    const run = args => spawnSync(process.execPath, [gate, ...args], { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, QE_E2E_LINT_MODE: '' } });
    const failed = run(['lint', '--base', base]);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stdout, /強制範囲[\s\S]*✗ e2e-lint weak-assertion tests\/e2e\/tagged\.spec\.ts:3[\s\S]*警告範囲[\s\S]*! e2e-lint forbidden-locator tests\/e2e\/legacy\.spec\.ts:4/);
    const local = run(['lint']);
    assert.equal(local.status, 1);
    assert.match(local.stdout, /タグ範囲のみ/);
    assert.equal(run(['lint', '--base']).status, 2);
    assert.equal(run(['lint', '--base', 'refs/does-not-exist']).status, 2);

    write(repo, 'tests/e2e/tagged.spec.ts', strongSpec('新しい TP', ['@demo', '@TP-001']));
    write(repo, 'tests/e2e/edited.spec.ts', strongSpec('編集される古いテスト', ['@old', '@TP-010']));
    repo.commit('fix');
    const clean = run(['lint', '--base', base]);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /警告範囲[\s\S]*legacy\.spec\.ts/);

    const check = run(['check', '--phase', 'plan', '--base', base]);
    assert.doesNotMatch(check.stdout, /✗ e2e-lint/);
  } finally {
    repo.cleanup();
  }
});

test('the CI job passes the merge-base so changed files are enforced', async () => {
  const { repo, base } = gateRepo();
  try {
    write(repo, 'package-lock.json', '{}\n');
    write(repo, 'openspec/changes/demo/tasks.md', '- [ ] 1.1 plan\n');
    repo.commit('lock');
    const result = await runCiJob({
      WORKING_DIRECTORY: '.',
      BASE_REF: base,
      SETUP_MODE: 'npm',
      TEST_COMMAND: 'echo test',
      E2E_COMMAND: 'echo e2e',
      GATE_PHASE: 'plan',
    }, { cwd: repo.dir, execFile: () => '' });
    const text = result.lines.join('\n');
    assert.match(text, /✗ e2e-lint missing-assertion tests\/e2e\/edited\.spec\.ts:3/);
    assert.doesNotMatch(text, /タグ範囲のみ/);
  } finally {
    repo.cleanup();
  }
});

test('install ships the lint without touching package.json or an edited policy, and doctor notes missing fields', async () => {
  const repo = gitRepo();
  try {
    const pkg = '{\n  "name": "target",\n  "private": true\n}\n';
    const policy = shippedPolicy.replace(/^e2e_lint_(mode|scope):.*\n/gm, '').replace('# AI Quality Policy', '# AI Quality Policy (edited)');
    write(repo, 'package.json', pkg);
    write(repo, 'openspec/quality-policy.md', policy);
  write(repo, 'openspec/changes/archive/2026-01-01-old/.openspec.yaml', 'schema: spec-driven-e2e\n');
    const installed = await capture(main, ['install', '--force', '--target', repo.dir]);
    assert.equal(installed.code, 0, installed.text);
    assert.equal(readFileSync(join(repo.dir, 'package.json'), 'utf8'), pkg);
    assert.equal(readFileSync(join(repo.dir, 'openspec/quality-policy.md'), 'utf8'), policy);
    assert.match(readFileSync(join(repo.dir, 'scripts/lib/e2e-lint.mjs'), 'utf8'), /export function lintRepo/);
    const stamp = JSON.parse(readFileSync(join(repo.dir, '.openspec-custom-testkit.json'), 'utf8'));
    assert.ok(stamp.files['scripts/lib/e2e-lint.mjs']);
    const result = doctor(repo.dir);
    assert.match(result.notes.join('\n'), /e2e_lint_mode \/ e2e_lint_scope がありません/);
    assert.equal(result.failures.some(line => line.includes('e2e_lint')), false);
  } finally {
    repo.cleanup();
  }
});

test('review regressions: TS non-null division, control regex, TSX generics, and locator values', () => {
  const good = lintFixture('rules/review.good.spec.tsx');
  assert.equal(good.error, null);
  assert.deepEqual(good.findings, []);
  const aliases = lintFixture('rules/aliases.bad.spec.ts');
  assert.equal(aliases.error, null);
  assert.deepEqual(brief(aliases.findings), ['excluded-test:3:', 'missing-assertion:4:別名でも検査 @demo @TP-001']);
  assert.equal(aliases.tests[0].excluded, true);
  const imported = lintSource("import { test as it2 } from '@playwright/test'; it2('no assertions @demo @TP-001', () => {});");
  assert.equal(imported.findings[0].rule, 'missing-assertion');
  const smoke = lintSource("test('smoke @smoke @TP-001', () => expect(1).toBe(1));", { changeIds: ['demo'] });
  assert.equal(smoke.findings[0].rule, 'missing-tag');
});

test('fixture-injected Page Objects resolve through test imports, aliases, and chained extend', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/pages/checkout.ts', `import { expect } from '@playwright/test';
export class CheckoutPage {
  verifyTotal() { expect(10).toBe(10); }
  verifyVisible() { expect(true).toBeTruthy(); }
  submit() { this.page.getByRole('button').click(); }
}
`);
    write(repo, 'tests/e2e/fixtures/base.ts', `import { test as base } from '@playwright/test';
import { CheckoutPage as PageObject } from '../pages/checkout';
export const test = base.extend<{ checkoutPage: PageObject }>({
  checkoutPage: async ({ page }, use) => {
    const checkout = new PageObject(page);
    await use(checkout);
  },
  directPage: async ({ page }, use) => { await use(new PageObject(page)); },
});
`);
    write(repo, 'tests/e2e/injected.spec.ts', `import { test as it2 } from './fixtures/base';
const extended = it2.extend({ value: 1 });
it2('strong @demo @TP-001', async ({ checkoutPage }) => checkoutPage.verifyTotal());
extended('alias @demo @TP-002', async ({ directPage: checkout }) => checkout.verifyTotal());
it2('weak @demo @TP-003', async ({ checkoutPage }) => checkoutPage.verifyVisible());
it2('action @demo @TP-004', async ({ checkoutPage }) => checkoutPage.submit());
it2('unrelated @demo @TP-005', async ({ page }) => page.verifyTotal());
const overridden = it2.extend({ checkoutPage: async ({}, use) => use({ verifyTotal() {} }) });
overridden('override @demo @TP-006', async ({ checkoutPage }) => checkoutPage.verifyTotal());
`);
    const result = lintRepo(repo.dir, [change()], { env: {} });
    assert.deepEqual(brief(result.enforced), [
      'missing-assertion:6:action @demo @TP-004',
      'missing-assertion:7:unrelated @demo @TP-005',
      'missing-assertion:9:override @demo @TP-006',
      'weak-assertion:5:weak @demo @TP-003',
    ]);
  } finally { repo.cleanup(); }
});

test('trailing suppressions never apply to the following statement', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/trailing.spec.ts', `test('trailing @demo @TP-001', async ({ page }) => {
  await page.waitForTimeout(1); // e2e-lint-allow fixed-wait RES-1: trailing
  await page.waitForTimeout(2);
  expect(1).toBe(1);
});
`);
    write(repo, 'openspec/changes/demo/evidence.md', evidence([approved]));
    const result = lintRepo(repo.dir, [change()], { env: {} });
    assert.equal(result.exceptions.length, 0);
    assert.deepEqual(result.enforced.map(entry => entry.rule), ['fixed-wait', 'fixed-wait', 'invalid-suppression']);
    assert.match(result.enforced[2].text, /独立した行/);
  } finally { repo.cleanup(); }
});

test('invalid suppressions fail outside enforced scope and in legacy warn mode', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/outside.spec.ts', `test('outside @old @TP-001', async ({ page }) => {
  // e2e-lint-allow fixed-wait RES-404: unknown
  await page.waitForTimeout(1);
  // e2e-lint-allow weak-assertion: missing
  expect(true).toBeTruthy();
  // e2e-lint-allow fixed-waait RES-1: typo
  expect(1).toBe(1);
});
`);
    for (const phase of ['plan', 'final']) {
      for (const selected of [change(), change({ schema: 'spec-driven-e2e', scope: 'legacy-e2e' })]) {
        const result = lintRepo(repo.dir, [selected], { phase, env: {} });
        assert.equal(result.failed, 3);
        assert.match(result.enforced.map(entry => entry.text).join('\n'), /RES-404[\s\S]*Residual ID[\s\S]*未知の規則/);
      }
    }
  } finally { repo.cleanup(); }
});

test('partial weak suppressions and incomplete approval never bypass final enforcement', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/weak.spec.ts', `test('weak @demo @TP-001', () => {
  // e2e-lint-allow weak-assertion RES-1: first only
  expect(1).not.toBeUndefined();
  expect(true).toBeTruthy();
});
`);
    write(repo, 'openspec/changes/demo/evidence.md', evidence([approved]));
    assert.equal(lintRepo(repo.dir, [change()], { phase: 'final', env: {} }).failed, 1);
    write(repo, 'tests/e2e/weak.spec.ts', `// e2e-lint-allow weak-assertion RES-1: test
 test('weak @demo @TP-001', () => expect(1).not.toBeUndefined());`);
    for (const residual of [{ ...approved, impact: '' }, { ...approved, approved_at: '2026-02-30' }]) {
      write(repo, 'openspec/changes/demo/evidence.md', evidence([residual]));
      assert.equal(lintRepo(repo.dir, [change()], { phase: 'plan', env: {} }).pending.length, 1);
      assert.equal(lintRepo(repo.dir, [change()], { phase: 'final', env: {} }).failed, 1);
    }
  } finally { repo.cleanup(); }
});

test('invalid environment and policy keys are visible, and all scope has an accurate note', () => {
  const { repo } = scopeRepo();
  try {
    write(repo, 'openspec/quality-policy.md', 'e2e_lint_mode: enforce\ne2e_lint_scope: ALL\ne2e_lint_scoep: all\n');
    const result = lintRepo(repo.dir, [change({ schema: 'spec-driven-e2e', scope: 'legacy-e2e' })], { env: { QE_E2E_LINT_MODE: 'ENFORCE', QE_E2E_LINT_SCOPE: 'ALL' } });
    assert.match(result.notes.join('\n'), /e2e_lint_scope が不正[\s\S]*未知のキー[\s\S]*QE_E2E_LINT_MODE が不正[\s\S]*QE_E2E_LINT_SCOPE が不正/);
    write(repo, 'openspec/quality-policy.md', 'e2e_lint_mode: enforce\ne2e_lint_scope: all\n');
    const all = lintRepo(repo.dir, [change()], { env: {} });
    assert.match(all.notes.join('\n'), /全ソースを強制/);
    assert.doesNotMatch(all.notes.join('\n'), /タグ範囲のみ/);
  } finally { repo.cleanup(); }
});

test('lint CLI fails on missing roots, zero source files, and unknown applicability', () => {
  const repo = gitRepo();
  try {
    const run = () => spawnSync(process.execPath, [gate, 'lint'], { cwd: repo.dir, encoding: 'utf8' });
    assert.equal(run().status, 1);
    mkdirSync(join(repo.dir, 'tests/e2e'), { recursive: true });
    const empty = run();
    assert.equal(empty.status, 1);
    assert.match(empty.stdout, /analyzed 0 files/);
    write(repo, 'tests/e2e/helper.ts', 'export const value = 1;');
    assert.equal(run().status, 0); // zero changes is valid when source inspection succeeded
    write(repo, 'openspec/changes/demo/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/demo/test-plan.md', '---\ne2e: typo\n---\n');
    const unknown = run();
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /E2E 適用状態を判定できません/);
  } finally { repo.cleanup(); }
});

test('unreadable policy/evidence and failed diffs are reported as failures', () => {
  const repo = gitRepo();
  try {
    write(repo, 'tests/e2e/good.spec.ts', strongSpec('good', ['@demo', '@TP-001']));
    repo.commit('base');
    const diff = lintRepo(repo.dir, [change()], { base: 'missing-ref', env: {} });
    assert.match(diff.enforced[0].text, /差分を取得できません/);
    mkdirSync(join(repo.dir, 'openspec/quality-policy.md'), { recursive: true });
    mkdirSync(join(repo.dir, 'openspec/changes/demo/evidence.md'), { recursive: true });
    const result = lintRepo(repo.dir, [change()], { env: {} });
    assert.equal(result.failed, 2);
    assert.match(result.enforced.map(entry => entry.text).join('\n'), /quality-policy.md を読み取れません[\s\S]*evidence.md を読み取れません/);
    write(repo, 'openspec/changes/demo/.openspec.yaml', 'schema: quality-driven-e2e\n');
    write(repo, 'openspec/changes/demo/tasks.md', '- [ ] 1.1 plan\n');
    write(repo, 'openspec/changes/demo/test-plan.md', '---\ne2e: required\n---\n');
    repo.commit('inputs');
    const ci = runCiJob({ BASE_REF: 'HEAD~1', SETUP_MODE: 'caller', TEST_COMMAND: 'echo ok' }, { cwd: repo.dir, execFile: () => '' });
    assert.notEqual(ci.code, 0);
    assert.match(readFileSync(join(ci.summaryDir, 'summary.txt'), 'utf8'), /evidence.md を読み取れません/);
  } finally { repo.cleanup(); }
});

test('CLI final reports pending/approved exceptions and check returns a failure', () => {
  const { repo } = gateRepo();
  try {
    write(repo, 'tests/e2e/banner.spec.ts', fixture('suppress/banner.spec.ts'));
    write(repo, 'openspec/changes/demo/evidence.md', evidence([approved, unapproved]));
    const run = (command, phase) => spawnSync(process.execPath, [gate, command, '--phase', phase, 'demo'], { cwd: repo.dir, encoding: 'utf8' });
    assert.match(run('lint', 'plan').stdout, /承認待ち RES-2/);
    const final = run('lint', 'final');
    assert.equal(final.status, 1);
    assert.match(final.stdout, /承認済みの例外 RES-1/);
    assert.match(final.stdout, /抑止は無効.*approved_by/);
    write(repo, 'openspec/changes/demo/tasks.md', '- [ ] 1.1 plan\n');
    const check = run('check', 'plan');
    assert.equal(check.status, 1);
    assert.match(check.stdout, /✗ e2e-lint/);
  } finally { repo.cleanup(); }
});


test('approved archived exceptions remain valid when linting a different change', () => {
  const repo = gitRepo();
  try {
    write(repo, 'openspec/changes/archive/2026-01-01-old/evidence.md', evidence([approved]));
    write(repo, 'tests/e2e/old.spec.ts', `test('old @old @TP-001', async ({ page }) => {
  // e2e-lint-allow fixed-wait RES-1: approved previously
  await page.waitForTimeout(1);
  expect(1).toBe(1);
});
`);
    const result = lintRepo(repo.dir, [change()], { phase: 'final', env: {} });
    assert.equal(result.failed, 0);
    assert.equal(result.exceptions.length, 1);
    assert.equal(result.exceptions[0].scope, null);
  } finally { repo.cleanup(); }
});

test('an unreadable E2E source fails instead of producing a clean root report', () => {
  const repo = gitRepo();
  try {
    mkdirSync(join(repo.dir, 'tests/e2e'), { recursive: true });
    symlinkSync('missing-target.ts', join(repo.dir, 'tests/e2e/broken.spec.ts'));
    const result = lintRepo(repo.dir, [], { env: {} });
    assert.equal(result.failed, 1);
    assert.match(result.enforced[0].text, /unreadable.*broken.spec.ts/);
  } finally { repo.cleanup(); }
});
