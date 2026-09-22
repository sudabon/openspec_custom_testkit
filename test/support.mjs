import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'tk-'));
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', dir, 'init'], { encoding: 'utf8' });
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init']);
  return {
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
}

export function capture(main, args) {
  const lines = [];
  return main(args, {
    log: message => lines.push(String(message)),
    error: message => lines.push(String(message)),
    stdin: { isTTY: false },
  }).then(code => ({ code, text: lines.join('\n') }));
}
