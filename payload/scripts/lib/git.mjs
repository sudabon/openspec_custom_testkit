import { execFileSync } from 'node:child_process';

export function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const error = new Error((err.stderr?.toString?.() || err.message || 'git failed').trim());
    error.status = err.status ?? 1;
    error.stdout = err.stdout?.toString?.() ?? '';
    throw error;
  }
}

export function gitOptional(repo, args) {
  try {
    return git(repo, args);
  } catch {
    return null;
  }
}

export function toplevel(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

export function headRevision(repo) {
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

export function gitShow(repo, rev, filePath) {
  try {
    return execFileSync('git', ['-C', repo, 'show', `${rev}:${filePath}`], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

export function parseNameStatus(text) {
  const parts = String(text).split('\0');
  if (parts.at(-1) === '') parts.pop();
  const entries = [];
  for (let index = 0; index < parts.length;) {
    const status = parts[index++];
    if (!status) continue;
    if (status.startsWith('R') || status.startsWith('C')) {
      entries.push({ status: status[0], score: status, oldPath: parts[index++], path: parts[index++] });
    } else {
      entries.push({ status: status[0], score: status, path: parts[index++] });
    }
  }
  return entries;
}
