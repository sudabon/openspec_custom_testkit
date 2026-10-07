import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATE = fileURLToPath(new URL('../payload/scripts/testkit-gate.mjs', import.meta.url));

export function writeIn(dir, rel, text) {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}

export function tempDir(prefix = 'tk-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function runGate(cwd, args, opts = {}) {
  return spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: 'utf8', ...opts });
}

// Defaults follow gates.test.mjs. Each test file passes its own differences as `over`:
//
// | file        | id / path    | e2e            | skipSpecs | tasksText              | fallback |
// |-------------|--------------|----------------|-----------|------------------------|----------|
// | gates       | demo         | required       | false     | null                   | false    |
// | contract    | demo         | not-applicable | true      | '- [x] 1.1 a ... 5.1 e' | false    |
// | viewpoints  | demo         | required       | true      | null                   | false    |
// | qa-review   | demo         | not-applicable | true      | null                   | false    |
// | e2e-lint    | demo         | required       | true      | '- [ ] 1.1 plan\n'     | false    |
// | registry    | add-checkout | required       | true      | '- [ ] 1.1 plan\n'     | (absent) |
//
// registry's own helper had no `fallback` key; it now gets `false`, which nothing reads differently from absent.
export function changeFixture(over = {}) {
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
    skipSpecs: false,
    pendingPlan: false,
    tasksText: null,
    ...over,
  };
}

// Pass the test context `t` to remove the repository after the test. cleanup() is safe to call again.
export function gitRepo(t) {
  const dir = tempDir('tk-');
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', dir, 'init'], { encoding: 'utf8' });
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init']);
  const repo = {
    dir,
    git,
    commit(message = 'change') {
      git(['add', '-A']);
      git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', message]);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  t?.after(() => repo.cleanup());
  return repo;
}

export function capture(main, args) {
  const lines = [];
  return main(args, {
    log: message => lines.push(String(message)),
    error: message => lines.push(String(message)),
    stdin: { isTTY: false },
  }).then(code => ({ code, text: lines.join('\n') }));
}
