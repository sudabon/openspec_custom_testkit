import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../lib/cli.mjs';
import { mergeConfig } from '../lib/config-merge.mjs';
import { capture } from './support.mjs';

const root = new URL('..', import.meta.url);

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'tk-install-'));
}

test('dry-run does not create a missing target', async () => {
  const target = join(tmpdir(), `tk-missing-${process.pid}-${Date.now()}`);
  const result = await capture(main, ['install', '--dry-run', '--target', target, '--language', 'Japanese']);
  assert.equal(result.code, 0);
  assert.equal(existsSync(target), false);
  assert.match(result.text, /書き込みは行っていません/);
  assert.match(result.text, /openspec init --tools/);
});

test('repeat install keeps bytes, mode, and installedAt', async () => {
  const target = tempDir();
  const first = await capture(main, ['install', '--force', '--target', target, '--language', 'Japanese']);
  assert.equal(first.code, 0, first.text);
  const stamp = readFileSync(join(target, '.openspec-custom-testkit.json'), 'utf8');
  const script = readFileSync(join(target, 'scripts/qe-gate.sh'));
  const mode = statSync(join(target, 'scripts/qe-gate.sh')).mode & 0o777;
  assert.equal(mode, 0o755);
  assert.match(readFileSync(join(target, 'openspec/config.yaml'), 'utf8'), /Language: Japanese/);
  assert.match(readFileSync(join(target, 'openspec/config.yaml'), 'utf8'), /schema: quality-driven-e2e/);
  const second = await capture(main, ['update', '--force', '--target', target]);
  assert.equal(second.code, 0, second.text);
  assert.match(second.text, /既に最新です/);
  assert.equal(readFileSync(join(target, '.openspec-custom-testkit.json'), 'utf8'), stamp);
  assert.equal(Buffer.compare(readFileSync(join(target, 'scripts/qe-gate.sh')), script), 0);
  assert.equal(statSync(join(target, 'scripts/qe-gate.sh')).mode & 0o777, mode);
  rmSync(target, { recursive: true, force: true });
});

test('custom schema and in-flight metadata stay', async () => {
  const target = tempDir();
  mkdirSync(join(target, 'openspec/changes/old-change'), { recursive: true });
  const config = 'schema: my-schema\ncontext: |\n  Language: Japanese\n  利用者メモ\nrules:\n  proposal:\n    - keep\n';
  const meta = 'schema: quality-driven\n';
  writeFileSync(join(target, 'openspec/config.yaml'), config);
  writeFileSync(join(target, 'openspec/changes/old-change/.openspec.yaml'), meta);
  const result = await capture(main, ['install', '--force', '--target', target]);
  assert.equal(result.code, 0, result.text);
  const next = readFileSync(join(target, 'openspec/config.yaml'), 'utf8');
  assert.match(next, /schema: my-schema/);
  assert.match(next, /利用者メモ/);
  assert.match(next, /proposal:/);
  assert.match(result.text, /自動変更しません/);
  assert.equal(readFileSync(join(target, 'openspec/changes/old-change/.openspec.yaml'), 'utf8'), meta);
  rmSync(target, { recursive: true, force: true });
});

test('legacy context marker keeps foreign lines and is idempotent', () => {
  const original = `# --- openspec-e2e-kit ---
schema: spec-driven

context: |
  Language: Japanese
  All artifacts must be written in Japanese.
  E2Eテスト: Playwright。実装規約は .claude/skills/e2e-conventions/SKILL.md に従う。
  利用者の独自行です
# --- /openspec-e2e-kit ---
rules:
  proposal:
    - keep me
`;
  const once = mergeConfig(original, 'Japanese');
  assert.equal(once.blocked, false);
  assert.match(once.text, /schema: quality-driven-e2e/);
  assert.match(once.text, /Language: Japanese/);
  assert.match(once.text, /利用者の独自行です/);
  assert.match(once.text, /keep me/);
  assert.match(once.text, /# --- openspec-custom-testkit ---/);
  assert.doesNotMatch(once.text, /openspec-e2e-kit ---/);
  const twice = mergeConfig(once.text, 'Japanese');
  assert.equal(twice.text, null);
});

test('unsafe yaml is kept', async () => {
  const target = tempDir();
  mkdirSync(join(target, 'openspec'), { recursive: true });
  const config = 'schema: spec-driven\nschema: other\n';
  writeFileSync(join(target, 'openspec/config.yaml'), config);
  const result = await capture(main, ['install', '--force', '--target', target]);
  assert.equal(result.code, 0, result.text);
  assert.equal(readFileSync(join(target, 'openspec/config.yaml'), 'utf8'), config);
  assert.match(result.text, /統合完了ではありません/);
  rmSync(target, { recursive: true, force: true });
});

test('force keeps policy and real playwright config', async () => {
  const target = tempDir();
  assert.equal((await capture(main, ['install', '--force', '--target', target])).code, 0);
  const policy = 'project policy stays\n';
  const playwright = 'export default { testDir: "./tests/e2e" };\n';
  writeFileSync(join(target, 'openspec/quality-policy.md'), policy);
  writeFileSync(join(target, 'playwright.config.ts'), playwright);
  writeFileSync(join(target, 'scripts/qe-gate.mjs'), 'export const edited = true\n');
  const result = await capture(main, ['update', '--force', '--target', target]);
  assert.equal(result.code, 0, result.text);
  assert.equal(readFileSync(join(target, 'openspec/quality-policy.md'), 'utf8'), policy);
  assert.equal(readFileSync(join(target, 'playwright.config.ts'), 'utf8'), playwright);
  assert.match(readFileSync(join(target, 'scripts/qe-gate.mjs'), 'utf8'), /selectChanges/);
  assert.match(result.text, /上書きしません/);
  rmSync(target, { recursive: true, force: true });
});

test('known legacy file migrates and unknown or edited files stay', async () => {
  const baseline = readFileSync(new URL('./upstream/baselines/qe/payload/scripts/qe-gate.sh', root));
  const known = tempDir();
  mkdirSync(join(known, 'scripts'), { recursive: true });
  writeFileSync(join(known, 'scripts/qe-gate.sh'), baseline);
  writeFileSync(join(known, '.openspec-quality-kit.json'), JSON.stringify({ version: '0.1.2', installedAt: '2000-01-01T00:00:00.000Z' }));
  const beforeStamp = readFileSync(join(known, '.openspec-quality-kit.json'));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', known, 'init'], { stdio: 'ignore' });
  const migrated = await capture(main, ['install', '--target', known]);
  assert.equal(migrated.code, 0, migrated.text);
  assert.match(readFileSync(join(known, 'scripts/qe-gate.sh'), 'utf8'), /exec node/);
  assert.equal(Buffer.compare(readFileSync(join(known, '.openspec-quality-kit.json')), beforeStamp), 0);

  const edited = tempDir();
  mkdirSync(join(edited, 'scripts'), { recursive: true });
  writeFileSync(join(edited, 'scripts/qe-gate.sh'), `${baseline.toString('utf8')}\n# user edit\n`);
  writeFileSync(join(edited, '.openspec-quality-kit.json'), JSON.stringify({ version: '0.1.2' }));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', edited, 'init'], { stdio: 'ignore' });
  const kept = await capture(main, ['install', '--target', edited]);
  assert.equal(kept.code, 0, kept.text);
  assert.match(readFileSync(join(edited, 'scripts/qe-gate.sh'), 'utf8'), /user edit/);
  assert.match(kept.text, /移行状態: incomplete/);
  assert.match(kept.text, /統合完了ではありません/);

  const unknown = tempDir();
  mkdirSync(join(unknown, 'scripts'), { recursive: true });
  writeFileSync(join(unknown, 'scripts/qe-gate.sh'), baseline);
  writeFileSync(join(unknown, '.openspec-quality-kit.json'), JSON.stringify({ version: '9.9.9' }));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', unknown, 'init'], { stdio: 'ignore' });
  const held = await capture(main, ['install', '--target', unknown]);
  assert.equal(held.code, 0, held.text);
  assert.equal(Buffer.compare(readFileSync(join(unknown, 'scripts/qe-gate.sh')), baseline), 0);
  assert.match(held.text, /incomplete/);
  rmSync(known, { recursive: true, force: true });
  rmSync(edited, { recursive: true, force: true });
  rmSync(unknown, { recursive: true, force: true });
});

test('e2e-only and combined legacy stamps migrate known files only', async () => {
  const e2eBaseline = readFileSync(new URL('./upstream/baselines/e2e/payload/scripts/check-test-plan.sh', root));
  const qeBaseline = readFileSync(new URL('./upstream/baselines/qe/payload/scripts/qe-gate.sh', root));
  const e2eOnly = tempDir();
  mkdirSync(join(e2eOnly, 'scripts'), { recursive: true });
  writeFileSync(join(e2eOnly, 'scripts/check-test-plan.sh'), e2eBaseline);
  writeFileSync(join(e2eOnly, '.openspec-e2e-kit.json'), JSON.stringify({ version: '0.2.0', e2eRoot: 'tests/e2e' }));
  const e2eStamp = readFileSync(join(e2eOnly, '.openspec-e2e-kit.json'));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', e2eOnly, 'init'], { stdio: 'ignore' });
  const migrated = await capture(main, ['install', '--target', e2eOnly]);
  assert.equal(migrated.code, 0, migrated.text);
  assert.match(readFileSync(join(e2eOnly, 'scripts/check-test-plan.sh'), 'utf8'), /exec node/);
  assert.equal(Buffer.compare(readFileSync(join(e2eOnly, '.openspec-e2e-kit.json')), e2eStamp), 0);

  const both = tempDir();
  mkdirSync(join(both, 'scripts'), { recursive: true });
  writeFileSync(join(both, 'scripts/qe-gate.sh'), qeBaseline);
  writeFileSync(join(both, 'scripts/check-test-plan.sh'), e2eBaseline);
  writeFileSync(join(both, '.openspec-quality-kit.json'), JSON.stringify({ version: '0.1.2' }));
  writeFileSync(join(both, '.openspec-e2e-kit.json'), JSON.stringify({ version: '0.2.0', e2eRoot: 'tests/e2e' }));
  const qeStamp = readFileSync(join(both, '.openspec-quality-kit.json'));
  const bothE2eStamp = readFileSync(join(both, '.openspec-e2e-kit.json'));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', both, 'init'], { stdio: 'ignore' });
  const combined = await capture(main, ['install', '--target', both]);
  assert.equal(combined.code, 0, combined.text);
  assert.match(readFileSync(join(both, 'scripts/qe-gate.sh'), 'utf8'), /exec node/);
  assert.match(readFileSync(join(both, 'scripts/check-test-plan.sh'), 'utf8'), /exec node/);
  assert.equal(Buffer.compare(readFileSync(join(both, '.openspec-quality-kit.json')), qeStamp), 0);
  assert.equal(Buffer.compare(readFileSync(join(both, '.openspec-e2e-kit.json')), bothE2eStamp), 0);
  rmSync(e2eOnly, { recursive: true, force: true });
  rmSync(both, { recursive: true, force: true });
});

test('recorded e2e root wins and old files are not deleted', async () => {
  const target = tempDir();
  const first = await capture(main, ['install', '--force', '--target', target, '--e2e-root', 'frontend/e2e']);
  assert.equal(first.code, 0, first.text);
  mkdirSync(join(target, 'tests/e2e'), { recursive: true });
  writeFileSync(join(target, 'tests/e2e/keep.txt'), 'stay');
  writeFileSync(join(target, 'playwright.config.ts'), 'export default { testDir: "./tests/e2e" }\n');
  const second = await capture(main, ['update', '--force', '--target', target]);
  assert.equal(second.code, 0, second.text);
  assert.equal(readFileSync(join(target, 'tests/e2e/keep.txt'), 'utf8'), 'stay');
  assert.match(second.text, /frontend\/e2e/);
  assert.equal(JSON.parse(readFileSync(join(target, '.openspec-custom-testkit.json'), 'utf8')).e2eRoot, 'frontend/e2e');
  rmSync(target, { recursive: true, force: true });
});

test('symlink escape writes nothing outside the target', async () => {
  const target = tempDir();
  const outside = tempDir();
  symlinkSync(outside, join(target, 'escape'));
  const before = existsSync(join(outside, 'scripts'));
  const result = await capture(main, ['install', '--force', '--target', target, '--e2e-root', 'escape/tests']);
  assert.equal(result.code, 1, result.text);
  assert.equal(existsSync(join(outside, 'scripts')), before);
  assert.equal(existsSync(join(target, '.openspec-custom-testkit.json')), false);
  rmSync(target, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test('store declaration writes neither store nor local payload', async () => {
  const target = tempDir();
  mkdirSync(join(target, 'openspec'), { recursive: true });
  writeFileSync(join(target, 'openspec/config.yaml'), 'schema: spec-driven\nstore: team-store\n');
  const result = await capture(main, ['install', '--force', '--target', target]);
  assert.equal(result.code, 1, result.text);
  assert.match(result.text, /store/);
  assert.equal(existsSync(join(target, 'scripts/qe-gate.sh')), false);
  assert.equal(existsSync(join(target, '.openspec-custom-testkit.json')), false);
  rmSync(target, { recursive: true, force: true });
});

test('multiple playwright configs are reported and not overwritten', async () => {
  const target = tempDir();
  mkdirSync(join(target, 'frontend'), { recursive: true });
  writeFileSync(join(target, 'playwright.config.ts'), 'export default { testDir: "./tests/e2e" }\n');
  writeFileSync(join(target, 'frontend/playwright.config.ts'), 'export default { testDir: "./e2e" }\n');
  const result = await capture(main, ['install', '--force', '--target', target]);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /対象外/);
  assert.equal(readFileSync(join(target, 'playwright.config.ts'), 'utf8'), 'export default { testDir: "./tests/e2e" }\n');
  assert.equal(readFileSync(join(target, 'frontend/playwright.config.ts'), 'utf8'), 'export default { testDir: "./e2e" }\n');
  rmSync(target, { recursive: true, force: true });
});

test('missing OpenSpec CLI is not reported ready', async () => {
  const target = tempDir();
  const result = await capture(main, ['install', '--force', '--target', target]);
  const missing = await main(['install', '--force', '--target', target], {
    log: () => {},
    error: () => {},
    stdin: { isTTY: false },
    execFile: () => {
      const error = new Error('not found');
      error.code = 'ENOENT';
      throw error;
    },
  });
  assert.equal(missing, 0);
  assert.equal(result.code, 0);
  const stamp = JSON.parse(readFileSync(join(target, '.openspec-custom-testkit.json'), 'utf8'));
  assert.equal(stamp.openspec.ready, false);
  rmSync(target, { recursive: true, force: true });
});

test('payload claude files are not gitignored', () => {
  const repo = fileURLToPath(root);
  assert.throws(
    () => execFileSync('git', ['check-ignore', '--', 'payload/.claude/agents/qe-oracle-writer.md'], { cwd: repo, encoding: 'utf8' }),
    err => err.status === 1,
  );
  const rootClaude = execFileSync('git', ['check-ignore', '--', '.claude/settings.json'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(rootClaude, '.claude/settings.json');
});
