import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli.mjs';
import { doctor } from '../payload/scripts/lib/doctor.mjs';
import { flakyFailLevels, policyIssues } from '../payload/scripts/lib/policy.mjs';
import { capture, gitRepo } from './support.mjs';

const shippedPolicy = readFileSync(new URL('../payload/openspec/quality-policy.md', import.meta.url), 'utf8');

function write(repo, rel, text) {
  const abs = join(repo.dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { flakyVerdict, quarantineFor, tpLevels } from '../payload/scripts/lib/flaky.mjs';
import { buildReport } from '../payload/scripts/lib/report.mjs';
import { checkEvidence } from '../payload/scripts/lib/evidence-check.mjs';

const QUALITY = `# Quality

## Risk Register

| ID | 壊れ方 | 影響 | 発生可能性 | Level | 関連Requirement |
|----|--------|------|------------|-------|-----------------|
| R1 | 二重課金 | 大 | 中 | high | Pay |
| R2 | 文言崩れ | 小 | 中 | low | Copy |
| R3 | 遷移 | 中 | 中 | medium | Nav |

## Test Oracles

| ID | 対象 (F* / Scenario) | 観測点 | 期待状態 (値 or 不変条件) |
|----|----------------------|--------|---------------------------|
| O1 | F1 | DB | 1 件 |
| O2 | F2 | API | 200 |
`;

function plan(rows) {
  return `---\ne2e: required\n---\n\n## E2E観点一覧\n\n| TP-ID | Requirement | Scenario | Risk | Oracle |\n|-------|-------------|----------|------|--------|\n${rows.map(([id, risk]) => `| ${id} | Req | S ${id} | ${risk} | O1 |`).join('\n')}\n`;
}

test('flaky_fail_levels: missing is empty, list values are read, invalid values are errors', () => {
  assert.deepEqual(flakyFailLevels('# policy\nmutation_threshold_high: 70\n'), { levels: [], error: null });
  assert.deepEqual(flakyFailLevels(''), { levels: [], error: null });
  assert.deepEqual(flakyFailLevels('flaky_fail_levels: [high]\n'), { levels: ['high'], error: null });
  assert.deepEqual(flakyFailLevels('x\nflaky_fail_levels: [medium, high]\n'), { levels: ['medium', 'high'], error: null });
  assert.deepEqual(flakyFailLevels('flaky_fail_levels: []\n'), { levels: [], error: null });
  for (const bad of ['flaky_fail_levels: [critical]', 'flaky_fail_levels: [high, urgent]', 'flaky_fail_levels: high', 'flaky_fail_levels:', 'flaky_fail_levels: [high,, low]', 'flaky_fail_levels: [High]']) {
    const parsed = flakyFailLevels(`${bad}\n`);
    assert.match(parsed.error ?? '', /flaky_fail_levels/, bad);
    assert.deepEqual(parsed.levels, [], bad);
  }
  assert.match(flakyFailLevels('flaky_fail_levels: [high]\nflaky_fail_levels: [low]\n').error, /複数/);
  // Only a line-leading key is a setting; prose that mentions the key is not.
  assert.deepEqual(flakyFailLevels('例: `flaky_fail_levels: [critical]` と書きます\n'), { levels: [], error: null });
});

test('TP level resolves from the Risk column through the Risk Register', () => {
  const levels = tpLevels(plan([['TP-001', 'R1'], ['TP-002', 'R2'], ['TP-003', 'R9'], ['TP-004', '']]), QUALITY);
  assert.deepEqual(levels.get('TP-001'), { level: 'high', risks: ['R1'] });
  assert.deepEqual(levels.get('TP-002'), { level: 'low', risks: ['R2'] });
  assert.match(levels.get('TP-003').error, /R9 は Risk Register にありません/);
  assert.match(levels.get('TP-004').error, /Risk 列が空/);
});

test('TP level is unresolved without quality.md or with an invalid Level', () => {
  const missing = tpLevels(plan([['TP-001', 'R1']]), null);
  assert.match(missing.get('TP-001').error, /quality\.md がありません/);
  const broken = tpLevels(plan([['TP-001', 'R1']]), QUALITY.replace('| high | Pay |', '| critical | Pay |'));
  assert.match(broken.get('TP-001').error, /R1 の Level が不正/);
});

test('a test tagged with several TPs is judged by the highest Level, and any unresolved TP fails', () => {
  const levels = tpLevels(plan([['TP-001', 'R1'], ['TP-002', 'R2'], ['TP-003', 'R3'], ['TP-004', 'R9']]), QUALITY);
  assert.deepEqual(flakyVerdict(['TP-002', 'TP-001'], levels, ['high']), { fail: true, level: 'high', reason: '' });
  assert.deepEqual(flakyVerdict(['TP-002', 'TP-003'], levels, ['high']), { fail: false, level: 'medium', reason: '' });
  assert.deepEqual(flakyVerdict(['TP-002', 'TP-003'], levels, ['medium', 'high']), { fail: true, level: 'medium', reason: '' });
  const unresolved = flakyVerdict(['TP-002', 'TP-004'], levels, ['high']);
  assert.equal(unresolved.fail, true);
  assert.equal(unresolved.level, null);
  assert.match(unresolved.reason, /TP-004: R9 は Risk Register にありません/);
});

test('the shipped policy and the doctor sample document the flaky policy without enabling it', () => {
  assert.deepEqual(flakyFailLevels(shippedPolicy), { levels: [], error: null });
  assert.match(shippedPolicy, /`flaky_fail_levels: \[high\]`/);
  const weak = shippedPolicy.replace('| Oracle の seal | 必須 | 必須 | 必須 |', '| Oracle の seal | 任意 | 必須 | 必須 |');
  const issues = policyIssues(weak);
  assert.match(issues.at(-1), /flaky_fail_levels: \[high\]/);
});

test('adding a flaky policy line leaves the seal, falsification and mutation checks unchanged', () => {
  const variants = [
    shippedPolicy,
    shippedPolicy.replace('| Oracle の seal | 必須 | 必須 | 必須 |', '| Oracle の seal | 任意 | 必須 | 必須 |'),
    shippedPolicy.replace('| Falsification レビュー | 必須 | 必須 | 必須 |', '| Falsification レビュー | 任意 | 必須 | 必須 |'),
    shippedPolicy.replace(/^mutation_threshold_high: 70\n/m, '').replace('閾値 70%', '閾値'),
  ];
  for (const text of variants) {
    for (const line of ['flaky_fail_levels: [high]', 'flaky_fail_levels: [medium, high]']) {
      assert.deepEqual(policyIssues(text.replace('e2e_lint_scope: changed\n', `e2e_lint_scope: changed\n${line}\n`)), policyIssues(text));
    }
  }
});

test('doctor accepts a valid flaky policy and fails an invalid one', async () => {
  const repo = gitRepo();
  try {
    const installed = await capture(main, ['install', '--force', '--target', repo.dir]);
    assert.equal(installed.code, 0, installed.text);
    const base = doctor(repo.dir);
    write(repo, 'openspec/quality-policy.md', `${shippedPolicy}\nflaky_fail_levels: [high]\n`);
    const valid = doctor(repo.dir);
    assert.deepEqual(valid.failures, base.failures);
    write(repo, 'openspec/quality-policy.md', `${shippedPolicy}\nflaky_fail_levels: [critical]\n`);
    const invalid = doctor(repo.dir);
    assert.equal(invalid.ok, false);
    assert.match(invalid.failures.join('\n'), /flaky_fail_levels が不正です \(critical\)/);
  } finally {
    repo.cleanup();
  }
});

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const HIGH = 'flaky_fail_levels: [high]\n';

function results(specs) {
  return {
    stats: { startTime: '2026-10-07T11:59:00.000Z', duration: 10 },
    suites: [{
      specs: specs.map(([tps, status], index) => ({
        title: `case ${index + 1}`,
        tags: ['@demo', ...tps.map(tp => `@${tp}`)],
        tests: [{
          projectName: '',
          status,
          results: status === 'flaky'
            ? [{ status: 'failed' }, { status: 'passed' }]
            : [{ status: status === 'expected' ? 'passed' : status === 'unexpected' ? 'failed' : 'skipped' }],
        }],
      })),
    }],
  };
}

const PLAN = plan([['TP-001', 'R1'], ['TP-002', 'R2'], ['TP-003', 'R9']]);

function report(over = {}) {
  return buildReport({ changeId: 'demo', planText: PLAN, now: NOW, integrated: true, policyText: HIGH, qualityText: QUALITY, ...over });
}

test('High risk TP is flaky: pass and flaky are shown with the Level, and the run fails with 3', () => {
  const run = results([[['TP-001'], 'flaky'], [['TP-002'], 'expected'], [['TP-003'], 'expected']]);
  for (const format of ['text', 'summary']) {
    const out = report({ results: run, format });
    assert.equal(out.exitCode, 3, format);
    assert.match(out.stdout, /\| pass \| ⚠ 不合格（high） \|/, format);
    assert.match(out.stdout, /フレーク不合格: TP-001 \(high\)/, format);
    assert.match(out.stdout, /flaky_fail_levels \[high\]/, format);
  }
});

test('Low risk TP is flaky: counted as coverage with a warning, not a failure', () => {
  const out = report({ results: results([[['TP-001'], 'expected'], [['TP-002'], 'flaky'], [['TP-003'], 'expected']]) });
  assert.equal(out.exitCode, 0, out.stdout);
  assert.match(out.stdout, /\| pass \| ⚠ 警告（low） \|/);
  assert.match(out.stdout, /フレーク警告: TP-002 \(low\)/);
  assert.doesNotMatch(out.stdout, /カバレッジ欠落/);
});

test('TP level cannot be resolved: the flaky test fails and the reason is shown', () => {
  const out = report({ results: results([[['TP-001'], 'expected'], [['TP-002'], 'expected'], [['TP-003'], 'flaky']]) });
  assert.equal(out.exitCode, 3);
  assert.match(out.stdout, /⚠ 不合格（Level 解決不能）/);
  assert.match(out.stdout, /TP-003: R9 は Risk Register にありません/);
  const noQuality = report({ qualityText: null, results: results([[['TP-001'], 'flaky'], [['TP-002'], 'expected'], [['TP-003'], 'expected']]) });
  assert.equal(noQuality.exitCode, 3);
  assert.match(noQuality.stdout, /quality\.md がありません/);
});

test('Invalid flaky policy value is an input error with exit code 2', () => {
  const out = report({ policyText: 'flaky_fail_levels: [critical]\n', results: results([[['TP-001'], 'expected']]) });
  assert.equal(out.exitCode, 2);
  assert.equal(out.stdout, '');
  assert.match(out.stderr, /flaky_fail_levels が不正です \(critical\)/);
});

test('Policy without flaky settings keeps the existing flaky display and exit code', () => {
  const run = results([[['TP-001'], 'flaky'], [['TP-002'], 'expected'], [['TP-003'], 'expected']]);
  const legacy = buildReport({ changeId: 'demo', planText: PLAN, now: NOW, results: run });
  for (const policyText of ['', shippedPolicy, 'flaky_fail_levels: []\n']) {
    const out = report({ policyText, results: run });
    assert.equal(out.exitCode, 0);
    assert.equal(out.stdout, legacy.stdout);
    assert.match(out.stdout, /\| pass \| ⚠ \|/);
  }
});

test('Legacy E2E change ignores the flaky policy', () => {
  const run = results([[['TP-001'], 'flaky'], [['TP-002'], 'expected'], [['TP-003'], 'expected']]);
  const legacy = buildReport({ changeId: 'demo', planText: PLAN, now: NOW, results: run });
  const out = report({ integrated: false, policyText: 'flaky_fail_levels: [critical]\n', results: run });
  assert.equal(out.exitCode, 0);
  assert.equal(out.stdout, legacy.stdout);
});

const reporterCli = fileURLToPath(new URL('../payload/scripts/e2e-report.mjs', import.meta.url));

function reporterRepo({ schema, policy = HIGH, plan: planText = PLAN, quality = QUALITY, quarantine } = {}) {
  const repo = gitRepo();
  write(repo, 'openspec/quality-policy.md', `${shippedPolicy}\n${policy}`);
  write(repo, 'openspec/changes/demo/.openspec.yaml', `schema: ${schema}\ncreated: 2026-10-01\n`);
  write(repo, 'openspec/changes/demo/test-plan.md', planText);
  if (quality != null) write(repo, 'openspec/changes/demo/quality.md', quality);
  if (quarantine != null) write(repo, 'tests/e2e/quarantine.md', quarantine);
  return repo;
}

function runReporter(repo, run, args = []) {
  write(repo, 'results.json', JSON.stringify(run));
  return spawnSync(process.execPath, [reporterCli, 'demo', 'results.json', ...args], { cwd: repo.dir, encoding: 'utf8' });
}

test('e2e-report CLI applies the flaky policy only to integrated changes', () => {
  const run = results([[['TP-001'], 'flaky'], [['TP-002'], 'expected'], [['TP-003'], 'expected']]);
  const integrated = reporterRepo({ schema: 'quality-driven-e2e' });
  const legacy = reporterRepo({ schema: 'spec-driven-e2e' });
  try {
    const failed = runReporter(integrated, run);
    assert.equal(failed.status, 3, failed.stdout + failed.stderr);
    assert.match(failed.stdout, /フレーク不合格: TP-001 \(high\)/);
    const kept = runReporter(legacy, run);
    assert.equal(kept.status, 0, kept.stdout + kept.stderr);
    assert.doesNotMatch(kept.stdout, /不合格/);
  } finally {
    integrated.cleanup();
    legacy.cleanup();
  }
});

test('install creates quarantine.md once and never rewrites the user copy, even with --force', async () => {
  for (const root of [null, 'e2e']) {
    const repo = gitRepo();
    try {
      const args = root ? ['--e2e-root', root] : [];
      const first = await capture(main, ['install', '--force', '--target', repo.dir, ...args]);
      assert.equal(first.code, 0, first.text);
      const rel = `${root ?? 'tests/e2e'}/quarantine.md`;
      const shipped = readFileSync(join(repo.dir, rel), 'utf8');
      assert.match(shipped, /\| TP-ID \| Change \| 理由 \| 担当 \| 期限 \| 代替 \|/);
      const edited = Buffer.from(`${shipped}| TP-001 | demo | 外部 SaaS の障害 | qa-team | 2026-10-31 | O2 |\r\n`);
      writeFileSync(join(repo.dir, rel), edited);
      for (const extra of [[], ['--force']]) {
        const again = await capture(main, ['install', ...extra, '--target', repo.dir, ...args]);
        assert.equal(again.code, 0, again.text);
        assert.ok(readFileSync(join(repo.dir, rel)).equals(edited), `${rel} ${extra.join(' ')}`);
      }
    } finally {
      repo.cleanup();
    }
  }
});

const shippedQuarantine = readFileSync(new URL('../payload/tests/e2e/quarantine.md', import.meta.url), 'utf8');

function quarantine(rows) {
  return `${shippedQuarantine}${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
}

const PLANNED = ['TP-001', 'TP-002', 'TP-003'];

function entries(rows, today = '2026-10-07', changeId = 'demo') {
  return quarantineFor(quarantine(rows), { changeId, plannedIds: PLANNED, qualityText: QUALITY, today });
}

test('the shipped quarantine template has no entries', () => {
  assert.deepEqual(quarantineFor(shippedQuarantine, { changeId: 'demo', plannedIds: PLANNED, qualityText: QUALITY, today: '2026-10-07' }), { active: [], invalid: [], warnings: [] });
  assert.deepEqual(quarantineFor(null, { changeId: 'demo', plannedIds: PLANNED, qualityText: QUALITY, today: '2026-10-07' }), { active: [], invalid: [], warnings: [] });
});

test('Incomplete quarantine entry is not a quarantine and names the missing columns', () => {
  const parsed = entries([
    ['TP-001', 'demo', '外部障害', '', '2026-10-31', 'O2'],
    ['TP-002', 'demo', '外部障害', 'qa', '', ''],
    ['TP-003', '', '外部障害', 'qa', '2026-10-31', 'O2'],
  ]);
  assert.deepEqual(parsed.active, []);
  assert.deepEqual(parsed.invalid.map(entry => [entry.tp, entry.problems.join(' / ')]), [
    ['TP-001', '担当 がありません'],
    ['TP-002', '期限・代替 がありません'],
    ['TP-003', 'Change がありません'],
  ]);
  const badValues = entries([
    ['TP-001', 'demo', '外部障害', 'qa', '2026/10/31', 'O2'],
    ['TP-002', 'demo', '外部障害', 'qa', '2026-10-31', 'O9'],
    ['TP-003', 'demo', '外部障害', '-', '2026-10-31', 'O2'],
  ]);
  assert.deepEqual(badValues.invalid.map(entry => entry.problems.join(' / ')), [
    '期限 2026/10/31 は YYYY-MM-DD ではありません',
    '代替 O9 は quality.md の Test Oracles にありません',
    '担当 がありません',
  ]);
  const noQuality = quarantineFor(quarantine([['TP-001', 'demo', '外部障害', 'qa', '2026-10-31', 'O2']]), { changeId: 'demo', plannedIds: PLANNED, qualityText: null, today: '2026-10-07' });
  assert.match(noQuality.invalid[0].problems[0], /quality\.md が無いため代替 O2 を確認できません/);
  const twice = entries([['TP-001', 'demo', 'a', 'qa', '2026-10-31', 'O2'], ['TP-001', 'demo', 'b', 'qa', '2026-11-30', 'O1']]);
  assert.deepEqual(twice.active, []);
  assert.match(twice.invalid[0].problems.join(), /同じ TP の行が 2 件あります/);
});

test('Same TP identifier in another change does not quarantine this change', () => {
  const parsed = entries([['TP-001', 'other-change', '外部障害', 'qa', '2026-10-31', 'O2']]);
  assert.deepEqual(parsed, { active: [], invalid: [], warnings: [] });
  const unplanned = entries([['TP-009', 'demo', '外部障害', 'qa', '2026-10-31', 'O2']]);
  assert.deepEqual(unplanned.active, []);
  assert.match(unplanned.warnings.join(), /TP-009 は demo の test-plan にありません/);
});

test('Expired quarantine fails from the next UTC day; the due date itself is valid', () => {
  const row = ['TP-001', 'demo', '外部障害', 'qa', '2026-10-07', 'RES-demo-1'];
  const today = entries([row], '2026-10-07');
  assert.deepEqual(today.active.map(entry => [entry.tp, entry.alternative]), [['TP-001', 'RES-demo-1']]);
  const tomorrow = entries([row], '2026-10-08');
  assert.deepEqual(tomorrow.active, []);
  assert.equal(tomorrow.invalid[0].expired, true);
  assert.match(tomorrow.invalid[0].problems.join(), /期限切れ（2026-10-07）/);
});

test('quarantine rows inside code fences are examples, not entries', () => {
  const text = `${shippedQuarantine}\n\`\`\`\n| TP-001 | demo | 例 | qa | 2026-10-31 | O2 |\n\`\`\`\n`;
  assert.deepEqual(quarantineFor(text, { changeId: 'demo', plannedIds: PLANNED, qualityText: QUALITY, today: '2026-10-07' }).active, []);
});

const VALID_ROW = ['TP-002', 'demo', '外部 SaaS の障害', 'qa-team', '2026-10-31', 'O2'];

test('Valid quarantine: a TP that did not run is shown as quarantined, not missing', () => {
  const run = results([[['TP-001'], 'expected'], [['TP-003'], 'expected']]);
  const missing = report({ results: run });
  assert.equal(missing.exitCode, 1);
  for (const format of ['text', 'summary']) {
    const out = report({ results: run, quarantineText: quarantine([VALID_ROW]), quarantinePath: 'tests/e2e/quarantine.md', format });
    assert.equal(out.exitCode, 0, out.stdout);
    assert.match(out.stdout, /隔離中: 1 件/);
    assert.match(out.stdout, /TP-002 担当 qa-team \/ 期限 2026-10-31 \/ 代替 O2 \/ 理由 外部 SaaS の障害/);
    assert.match(out.stdout, /tests\/e2e\/quarantine\.md/);
    assert.doesNotMatch(out.stdout, /カバレッジ欠落: TP/);
  }
});

test('Quarantined test passes: still not coverage, and release is done by editing the list', () => {
  const out = report({ results: results([[['TP-001'], 'expected'], [['TP-002'], 'expected'], [['TP-003'], 'expected']]), quarantineText: quarantine([VALID_ROW]) });
  assert.equal(out.exitCode, 0);
  assert.match(out.stdout, /隔離中: 1 件/);
  assert.match(out.stdout, /TP-002 は実行されて pass しましたが、隔離中のため coverage に数えません。解除は quarantine\.md の行を削除して行います/);
  // A flaky quarantined TP is not judged by the flaky policy: it is not coverage either way.
  const flaky = report({ policyText: 'flaky_fail_levels: [low, medium, high]\n', results: results([[['TP-001'], 'expected'], [['TP-002'], 'flaky'], [['TP-003'], 'expected']]), quarantineText: quarantine([VALID_ROW]) });
  assert.equal(flaky.exitCode, 0, flaky.stdout);
  // A quarantined test that still runs and fails is a failing test.
  const failing = report({ results: results([[['TP-001'], 'expected'], [['TP-002'], 'unexpected'], [['TP-003'], 'expected']]), quarantineText: quarantine([VALID_ROW]) });
  assert.equal(failing.exitCode, 3);
});

test('invalid, expired and other-change quarantine rows fail as missing coverage with the reason', () => {
  const run = results([[['TP-001'], 'expected'], [['TP-002'], 'expected'], [['TP-003'], 'expected']]);
  const incomplete = report({ results: run, quarantineText: quarantine([['TP-002', 'demo', '外部障害', '', '2026-10-31', '']]) });
  assert.equal(incomplete.exitCode, 1);
  assert.match(incomplete.stdout, /カバレッジ欠落: TP-002 \(隔離の行が無効: 担当・代替 がありません\)/);
  const expired = report({ results: run, quarantineText: quarantine([['TP-002', 'demo', '外部障害', 'qa-team', '2026-10-06', 'O2']]) });
  assert.equal(expired.exitCode, 1);
  assert.match(expired.stdout, /⚠ 隔離の期限切れ: TP-002 \(期限 2026-10-06 \/ 担当 qa-team\)/);
  assert.match(expired.stdout, /カバレッジ欠落: TP-002 \(隔離の期限切れ: 期限 2026-10-06 \/ 担当 qa-team\)/);
  const other = report({ results: results([[['TP-001'], 'expected'], [['TP-003'], 'expected']]), quarantineText: quarantine([['TP-002', 'other', '外部障害', 'qa-team', '2026-10-31', 'O2']]) });
  assert.equal(other.exitCode, 1);
  assert.match(other.stdout, /カバレッジ欠落: TP-002 に対応する/);
  assert.doesNotMatch(other.stdout, /隔離中/);
});

test('e2e-report CLI reads quarantine.md under the E2E root and only warns for legacy changes', () => {
  const run = results([[['TP-001'], 'expected'], [['TP-003'], 'expected']]);
  const list = quarantine([['TP-002', 'demo', '外部障害', 'qa-team', '2999-12-31', 'O2']]);
  const integrated = reporterRepo({ schema: 'quality-driven-e2e', quarantine: list });
  const legacy = reporterRepo({ schema: 'spec-driven-e2e', quarantine: list });
  try {
    const ok = runReporter(integrated, run);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /隔離中: 1 件/);
    const kept = runReporter(legacy, run);
    assert.equal(kept.status, 1, kept.stdout + kept.stderr);
    assert.match(kept.stdout, /⚠ 旧 schema の change には隔離リストを適用しません: TP-002/);
  } finally {
    integrated.cleanup();
    legacy.cleanup();
  }
});

function evidenceRepo({ quarantineRows, riskResults, residuals = [] }) {
  const repo = gitRepo();
  write(repo, 'openspec/changes/demo/quality.md', QUALITY);
  write(repo, 'openspec/changes/demo/test-plan.md', PLAN);
  write(repo, 'tests/e2e/quarantine.md', quarantine(quarantineRows));
  write(repo, 'test-results/run.log', 'ok\n');
  repo.commit('fixture');
  const data = {
    format_version: 1,
    runs: [{ id: 'run-1', command: 'npm test', started_at: '2026-10-07T00:00:00Z', revision: repo.git(['rev-parse', 'HEAD']).trim(), exit_code: 0, source: 'test-results/run.log', source_sha256: 'x' }],
    risk_results: riskResults,
    falsification: { performed: true, summary: 'done', counterexamples: [] },
    residuals,
  };
  write(repo, 'openspec/changes/demo/evidence.md', `# Evidence\n\n## Execution Records\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`);
  return repo;
}

const EVIDENCE_CHANGE = { id: 'demo', path: 'openspec/changes/demo', schema: 'quality-driven-e2e', e2e: 'required' };

function quarantineErrors(repo) {
  return checkEvidence(repo.dir, EVIDENCE_CHANGE, { digest: '', policyText: '', now: NOW }).errors.filter(error => error.includes('隔離'));
}

const passing = (oracles, layer = 'Integration', result = 'pass') => ({ risk: 'R1', failure_modes: ['F1'], oracles, layer, tp_ids: ['TP-001'], result, run_ids: ['run-1'] });

test('Alternative oracle has no passing result: the final gate fails with the TP and the Oracle', () => {
  const rows = [['TP-002', 'demo', '外部障害', 'qa-team', '2026-10-31', 'O2']];
  for (const riskResults of [[passing(['O1'])], [passing(['O2'], 'Integration', 'fail')], [passing(['O2'], 'E2E')]]) {
    const repo = evidenceRepo({ quarantineRows: rows, riskResults });
    try {
      const errors = quarantineErrors(repo);
      assert.equal(errors.length, 1, JSON.stringify(riskResults));
      assert.match(errors[0], /隔離中の TP-002 の代替 Oracle O2 に、E2E 以外の層の pass の結果が evidence にありません/);
    } finally {
      repo.cleanup();
    }
  }
  const ok = evidenceRepo({ quarantineRows: rows, riskResults: [passing(['O1', 'O2'], 'Unit / Integration')] });
  try {
    assert.deepEqual(quarantineErrors(ok), []);
  } finally {
    ok.cleanup();
  }
});

test('Residual is not approved: the final gate asks for human approval', () => {
  const rows = [['TP-002', 'demo', '外部障害', 'qa-team', '2026-10-31', 'RES-demo-1']];
  const cases = [
    [[], /代替 Residual RES-demo-1 が evidence の residuals にありません/],
    [[{ id: 'RES-demo-1', reason: 'r', impact: 'i', approved_by: '', approved_at: '2026-10-01' }], /代替 Residual RES-demo-1 に承認者または承認日がありません。人間の承認が必要です/],
    [[{ id: 'RES-demo-1', reason: 'r', impact: 'i', approved_by: 'owner', approved_at: '' }], /人間の承認が必要です/],
  ];
  for (const [residuals, expected] of cases) {
    const repo = evidenceRepo({ quarantineRows: rows, riskResults: [passing(['O1'])], residuals });
    try {
      const errors = quarantineErrors(repo);
      assert.equal(errors.length, 1);
      assert.match(errors[0], expected);
    } finally {
      repo.cleanup();
    }
  }
  const ok = evidenceRepo({ quarantineRows: rows, riskResults: [passing(['O1'])], residuals: [{ id: 'RES-demo-1', reason: 'r', impact: 'i', approved_by: 'owner', approved_at: '2026-10-01' }] });
  try {
    assert.deepEqual(quarantineErrors(ok), []);
  } finally {
    ok.cleanup();
  }
});

test('the final gate ignores quarantine rows of other changes and expired rows left to the reporter', () => {
  const repo = evidenceRepo({
    quarantineRows: [['TP-002', 'other', '外部障害', 'qa-team', '2026-10-31', 'O2'], ['TP-001', 'demo', '外部障害', 'qa-team', '2026-10-01', 'O2']],
    riskResults: [passing(['O1'])],
  });
  try {
    assert.deepEqual(quarantineErrors(repo), []);
  } finally {
    repo.cleanup();
  }
});

test('the documented quarantine and release steps reproduce on a fixture repo', () => {
  const docs = readFileSync(new URL('../docs/workflow.md', import.meta.url), 'utf8');
  const guide = docs.slice(docs.indexOf('## フレーク方針と隔離'), docs.indexOf('## E2E 規約 lint'));
  const row = guide.match(/^ *(\| TP-002 \| add-checkout \|.*\|)$/m)[1].trim();
  assert.match(guide, /--grep-invert '\(\?=\.\*@add-checkout\\b\)\(\?=\.\*@TP-002\\b\)'/);
  const tagged = run => JSON.parse(JSON.stringify(run).replaceAll('@demo', '@add-checkout'));
  const repo = gitRepo();
  try {
    write(repo, 'openspec/quality-policy.md', shippedPolicy);
    write(repo, 'openspec/changes/add-checkout/.openspec.yaml', 'schema: quality-driven-e2e\ncreated: 2026-10-01\n');
    write(repo, 'openspec/changes/add-checkout/test-plan.md', PLAN.replace('R9', 'R3'));
    write(repo, 'openspec/changes/add-checkout/quality.md', QUALITY.replace('| O2 | F2 | API | 200 |', '| O2 | F2 | API | 200 |\n| O3 | F2 | Queue | 1 件 |'));
    const cli = (run) => {
      write(repo, 'results.json', JSON.stringify(tagged(run)));
      return spawnSync(process.execPath, [reporterCli, 'add-checkout', 'results.json'], { cwd: repo.dir, encoding: 'utf8' });
    };
    // Step 2: the test is excluded from the run, so without a list entry TP-002 is missing.
    const excluded = results([[['TP-001'], 'expected'], [['TP-003'], 'expected']]);
    assert.equal(cli(excluded).status, 1);
    // Step 1: add the documented row to the installed template.
    write(repo, 'tests/e2e/quarantine.md', `${shippedQuarantine}${row.replace('2026-10-31', '2999-12-31')}\n`);
    const quarantined = cli(excluded);
    assert.equal(quarantined.status, 0, quarantined.stdout + quarantined.stderr);
    assert.match(quarantined.stdout, /隔離中: 1 件（coverage に数えません。一覧は tests\/e2e\/quarantine\.md）/);
    // Release: the test runs again and the row is removed.
    const restored = results([[['TP-001'], 'expected'], [['TP-002'], 'expected'], [['TP-003'], 'expected']]);
    assert.match(cli(restored).stdout, /TP-002 は実行されて pass しましたが、隔離中/);
    write(repo, 'tests/e2e/quarantine.md', shippedQuarantine);
    const released = cli(restored);
    assert.equal(released.status, 0);
    assert.doesNotMatch(released.stdout, /隔離/);
  } finally {
    repo.cleanup();
  }
});
