import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { PathError, UsageError, decideAction, exitCodeFor, loadLegacyIndex, main, transformBytes } from '../lib/cli.mjs';
import { mergeConfig } from '../lib/config-merge.mjs';
import { capture, tempDir } from './support.mjs';

const root = new URL('..', import.meta.url);

test('dry-run does not create a missing target', async () => {
  const target = join(tmpdir(), `tk-missing-${process.pid}-${Date.now()}`);
  const result = await capture(main, ['install', '--dry-run', '--target', target, '--language', 'Japanese']);
  assert.equal(result.code, 0);
  assert.equal(existsSync(target), false);
  assert.match(result.text, /書き込みは行っていません/);
  assert.match(result.text, /openspec init --tools/);
});

test('repeat install keeps bytes, mode, and installedAt', async () => {
  const target = tempDir('tk-install-');
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
  const target = tempDir('tk-install-');
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

test('quoted schema keys and flow mappings are kept', () => {
  for (const original of [
    '"schema": spec-driven\ncontext: |\n  keep\n',
    "'schema': spec-driven\n",
    '{schema: spec-driven, context: hello}\n',
    'schema: spec-driven\n"context": hello\n',
  ]) {
    const merged = mergeConfig(original);
    assert.equal(merged.blocked, true, original);
    assert.equal(merged.text, null);
    assert.match(merged.warnings.join('\n'), /元ファイルを保持します/);
  }
  const plain = mergeConfig('schema: spec-driven\n');
  assert.equal(plain.blocked, false);
  assert.match(plain.text, /^schema: quality-driven-e2e\n/);
});

test('unsafe yaml is kept', async () => {
  const target = tempDir('tk-install-');
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
  const target = tempDir('tk-install-');
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
  const known = tempDir('tk-install-');
  mkdirSync(join(known, 'scripts'), { recursive: true });
  writeFileSync(join(known, 'scripts/qe-gate.sh'), baseline);
  writeFileSync(join(known, '.openspec-quality-kit.json'), JSON.stringify({ version: '0.1.2', installedAt: '2000-01-01T00:00:00.000Z' }));
  const beforeStamp = readFileSync(join(known, '.openspec-quality-kit.json'));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', known, 'init'], { stdio: 'ignore' });
  const migrated = await capture(main, ['install', '--target', known]);
  assert.equal(migrated.code, 0, migrated.text);
  assert.match(readFileSync(join(known, 'scripts/qe-gate.sh'), 'utf8'), /exec node/);
  assert.equal(Buffer.compare(readFileSync(join(known, '.openspec-quality-kit.json')), beforeStamp), 0);

  const edited = tempDir('tk-install-');
  mkdirSync(join(edited, 'scripts'), { recursive: true });
  writeFileSync(join(edited, 'scripts/qe-gate.sh'), `${baseline.toString('utf8')}\n# user edit\n`);
  writeFileSync(join(edited, '.openspec-quality-kit.json'), JSON.stringify({ version: '0.1.2' }));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', edited, 'init'], { stdio: 'ignore' });
  const kept = await capture(main, ['install', '--target', edited]);
  assert.equal(kept.code, 0, kept.text);
  assert.match(readFileSync(join(edited, 'scripts/qe-gate.sh'), 'utf8'), /user edit/);
  assert.match(kept.text, /移行状態: incomplete/);
  assert.match(kept.text, /統合完了ではありません/);

  const unknown = tempDir('tk-install-');
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
  const e2eOnly = tempDir('tk-install-');
  mkdirSync(join(e2eOnly, 'scripts'), { recursive: true });
  writeFileSync(join(e2eOnly, 'scripts/check-test-plan.sh'), e2eBaseline);
  writeFileSync(join(e2eOnly, '.openspec-e2e-kit.json'), JSON.stringify({ version: '0.2.0', e2eRoot: 'tests/e2e' }));
  const e2eStamp = readFileSync(join(e2eOnly, '.openspec-e2e-kit.json'));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', e2eOnly, 'init'], { stdio: 'ignore' });
  const migrated = await capture(main, ['install', '--target', e2eOnly]);
  assert.equal(migrated.code, 0, migrated.text);
  assert.match(readFileSync(join(e2eOnly, 'scripts/check-test-plan.sh'), 'utf8'), /exec node/);
  assert.equal(Buffer.compare(readFileSync(join(e2eOnly, '.openspec-e2e-kit.json')), e2eStamp), 0);

  const both = tempDir('tk-install-');
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
  const target = tempDir('tk-install-');
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
  const target = tempDir('tk-install-');
  const outside = tempDir('tk-install-');
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
  const target = tempDir('tk-install-');
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
  const target = tempDir('tk-install-');
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
  const target = tempDir('tk-install-');
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
  // The shared project settings are tracked; every other root agent file stays local.
  assert.throws(
    () => execFileSync('git', ['check-ignore', '--', '.claude/settings.json'], { cwd: repo, encoding: 'utf8' }),
    err => err.status === 1,
  );
  const rootClaude = execFileSync('git', ['check-ignore', '--', '.claude/settings.local.json'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(rootClaude, '.claude/settings.local.json');
});


test('legacy transform option preserves non-transformable paths and remaps E2E files', () => {
  const bytes = Buffer.from('tests/e2e');
  for (let i = 0; i < 2; i++) {
    assert.equal(transformBytes('openspec/quality-policy.md', bytes, 'custom/e2e', { legacy: true }).toString(), 'tests/e2e');
    assert.equal(transformBytes('playwright.config.example.ts', bytes, 'custom/e2e', { legacy: true }).toString(), 'custom/e2e');
  }
});

test('update overwrites files the stamp recorded as unmodified and keeps user edits', async () => {
  const target = tempDir('tk-install-');
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', target, 'init'], { stdio: 'ignore' });
  const first = await capture(main, ['install', '--force', '--target', target]);
  assert.equal(first.code, 0, first.text);
  const stampPath = join(target, '.openspec-custom-testkit.json');
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  // Simulate an older kit version: the stamp records the bytes the kit wrote back then.
  const older = Buffer.from('#!/bin/sh\n# older kit version\n');
  writeFileSync(join(target, 'scripts/qe-gate.mjs'), older);
  stamp.files['scripts/qe-gate.mjs'] = createHash('sha256').update(older).digest('hex');
  writeFileSync(join(target, 'scripts/ci-job.mjs'), '// user edit\n');
  writeFileSync(stampPath, JSON.stringify(stamp));
  const result = await capture(main, ['update', '--target', target]);
  assert.equal(result.code, 0, result.text);
  assert.equal(Buffer.compare(readFileSync(join(target, 'scripts/qe-gate.mjs')), readFileSync(new URL('./payload/scripts/qe-gate.mjs', root))), 0);
  assert.equal(readFileSync(join(target, 'scripts/ci-job.mjs'), 'utf8'), '// user edit\n');
  const after = JSON.parse(readFileSync(stampPath, 'utf8'));
  assert.deepEqual(after.migration.pending, ['scripts/ci-job.mjs']);
  rmSync(target, { recursive: true, force: true });
});

test('switching --e2e-root leaves critical scripts untouched and migration complete', async () => {
  const target = tempDir('tk-install-');
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', target, 'init'], { stdio: 'ignore' });
  const first = await capture(main, ['install', '--force', '--target', target]);
  assert.equal(first.code, 0, first.text);
  const before = JSON.parse(readFileSync(join(target, '.openspec-custom-testkit.json'), 'utf8')).migration;
  const second = await capture(main, ['install', '--target', target, '--e2e-root', 'e2e']);
  assert.equal(second.code, 0, second.text);
  const stamp = JSON.parse(readFileSync(join(target, '.openspec-custom-testkit.json'), 'utf8'));
  assert.equal(stamp.e2eRoot, 'e2e');
  assert.deepEqual(stamp.migration, before);
  assert.match(readFileSync(join(target, 'scripts/lib/critical.mjs'), 'utf8'), /E2E_ROOT_DEFAULT = 'tests\/e2e'/);
  assert.doesNotMatch(second.text, /skip\(差分あり\) scripts\//);
  rmSync(target, { recursive: true, force: true });
});

test('install places nested scripts/lib modules and records them in the stamp', async () => {
  const target = tempDir('tk-install-');
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', target, 'init'], { stdio: 'ignore' });
  const result = await capture(main, ['install', '--force', '--target', target]);
  assert.equal(result.code, 0, result.text);
  const stamp = JSON.parse(readFileSync(join(target, '.openspec-custom-testkit.json'), 'utf8'));
  const lib = new URL('./payload/scripts/lib/', root);
  const nested = readdirSync(lib, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== '.DS_Store')
    .map(entry => relative(fileURLToPath(lib), join(entry.parentPath ?? entry.path, entry.name)).split(sep).join('/'))
    .filter(rel => rel.includes('/'));
  assert.ok(nested.length > 0, 'payload/scripts/lib has no subdirectory files');
  for (const rel of nested.map(name => `scripts/lib/${name}`)) {
    const bytes = readFileSync(new URL(`./payload/${rel}`, root));
    assert.equal(Buffer.compare(readFileSync(join(target, rel)), bytes), 0, rel);
    assert.equal(stamp.files[rel], createHash('sha256').update(bytes).digest('hex'), rel);
  }
  rmSync(target, { recursive: true, force: true });
});

test('critical scripts are never rewritten for a custom E2E root', () => {
  const bytes = Buffer.from("export const E2E_ROOT_DEFAULT = 'tests/e2e';");
  assert.equal(transformBytes('scripts/lib/critical.mjs', bytes, 'custom/e2e').toString(), bytes.toString());
  assert.equal(transformBytes('scripts/check-test-plan.sh', bytes, 'custom/e2e').toString(), bytes.toString());
  assert.match(transformBytes('scripts/check-test-plan.sh', bytes, 'custom/e2e', { legacy: true }).toString(), /custom\/e2e/);
});

test('install ships the screenshot and axe conventions without adding dependencies or touching a real config', async () => {
  const target = tempDir('tk-install-');
  const pkg = '{\n  "name": "app",\n  "devDependencies": { "@playwright/test": "1.55.1" }\n}\n';
  const playwright = 'export default { testDir: "./tests/e2e" };\n';
  writeFileSync(join(target, 'package.json'), pkg);
  writeFileSync(join(target, 'playwright.config.ts'), playwright);
  const result = await capture(main, ['install', '--force', '--target', target]);
  assert.equal(result.code, 0, result.text);
  assert.equal(readFileSync(join(target, 'package.json'), 'utf8'), pkg);
  assert.equal(readFileSync(join(target, 'playwright.config.ts'), 'utf8'), playwright);
  assert.match(readFileSync(join(target, 'playwright.config.example.ts'), 'utf8'), /mobile-safari/);
  const skill = readFileSync(join(target, '.claude/skills/e2e-conventions/SKILL.md'), 'utf8');
  for (const api of ['toHaveScreenshot', 'AxeBuilder']) {
    const example = skill.split('```ts').find(block => block.includes(api));
    assert.ok(example, api);
    assert.match(example, /tag: \['@[a-z0-9-]+', '@TP-\d{3}'\]/, api);
  }
  assert.match(skill, /mask/);
  assert.match(skill, /npm install -D @axe-core\/playwright/);
  rmSync(target, { recursive: true, force: true });
});

test('decideAction: protected beats force, the stamp record and legacy baselines migrate, and force only overwrites what is left', () => {
  const base = { exists: true, same: false, protectedFile: false, recorded: false, legacyMatch: false, force: false };
  assert.equal(decideAction({ ...base, exists: false, force: true }), 'create');
  assert.equal(decideAction({ ...base, same: true, protectedFile: true }), 'same');
  for (const force of [false, true]) {
    assert.equal(decideAction({ ...base, protectedFile: true, recorded: true, legacyMatch: true, force }), 'keep');
    assert.equal(decideAction({ ...base, recorded: true, force }), 'migrate');
    assert.equal(decideAction({ ...base, legacyMatch: true, force }), 'migrate');
  }
  assert.equal(decideAction(base), 'skip');
  assert.equal(decideAction({ ...base, force: true }), 'overwrite');
  // The baseline comparison runs only when nothing earlier decided.
  let compared = 0;
  const legacyMatch = () => { compared += 1; return true; };
  assert.equal(decideAction({ ...base, recorded: true, legacyMatch }), 'migrate');
  assert.equal(decideAction({ ...base, protectedFile: true, legacyMatch }), 'keep');
  assert.equal(compared, 0);
  assert.equal(decideAction({ ...base, legacyMatch }), 'migrate');
  assert.equal(compared, 1);
});

test('exitCodeFor maps usage to 2, path and stamp problems to 1, and leaves other errors to the caller', () => {
  assert.equal(exitCodeFor(new UsageError('x')), 2);
  assert.equal(exitCodeFor(new PathError('x')), 1);
  assert.equal(exitCodeFor(Object.assign(new Error('x'), { code: 'BROKEN_STAMP' })), 1);
  assert.equal(exitCodeFor(Object.assign(new Error('x'), { code: 'PATH' })), 1);
  assert.equal(exitCodeFor(new Error('bug')), null);
  assert.equal(exitCodeFor('thrown string'), null);
});

test('loadLegacyIndex rejects a baseline that drifted from the manifest', t => {
  const copy = tempDir('tk-baselines-');
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  cpSync(fileURLToPath(new URL('upstream', root)), join(copy, 'upstream'), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(copy, 'upstream/manifest.json'), 'utf8'));
  const [source] = manifest.sources;
  const [file] = source.files;
  assert.ok(loadLegacyIndex(copy).byPath.get(file.path).length >= 1);
  writeFileSync(join(copy, 'upstream/baselines', source.id, 'payload', file.path), 'drifted\n');
  assert.throws(() => loadLegacyIndex(copy), new RegExp(`baseline drift: ${source.id}/${file.path}`));
});

test('io.now stamps installedAt and the viewpoint date', async t => {
  const target = tempDir('tk-install-');
  t.after(() => rmSync(target, { recursive: true, force: true }));
  const now = () => new Date(2026, 0, 2, 3, 4, 5);
  const code = await main(['install', '--force', '--target', target], { log: () => {}, error: () => {}, stdin: { isTTY: false }, now });
  assert.equal(code, 0);
  const stamp = JSON.parse(readFileSync(join(target, '.openspec-custom-testkit.json'), 'utf8'));
  assert.equal(stamp.installedAt, now().toISOString());
  assert.equal(stamp.features.nonfunctionalViewpoints.since, '2026-01-02');
});
