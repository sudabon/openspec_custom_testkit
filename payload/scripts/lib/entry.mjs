import { appendFileSync } from 'node:fs';
import { toplevel } from './git.mjs';

// Console and exit of an entry point. Callers may pass their own io instead.
export const processIo = {
  log: message => console.log(message),
  error: message => console.error(message),
  write: text => process.stdout.write(text),
  exit: code => process.exit(code),
};

// The repository top level for an entry point run from `cwd`. When git cannot resolve it,
// onFailure 'cwd' uses cwd itself and 'exit2' reports that this is not a repository and exits 2.
export function resolveRepo(cwd, { onFailure = 'cwd', io = processIo } = {}) {
  try {
    return toplevel(cwd);
  } catch {
    if (onFailure === 'exit2') {
      io.error('git リポジトリではありません');
      return io.exit(2);
    }
    return cwd;
  }
}

// Appends key=value lines to $GITHUB_OUTPUT in insertion order. Does nothing without GITHUB_OUTPUT;
// write errors propagate to the caller.
export function appendGithubOutput(env, outputs) {
  if (!env.GITHUB_OUTPUT) return false;
  appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
  return true;
}

// Prints a { stdout, stderr, exitCode } result and exits with its code.
export function emit(io, result) {
  if (result.stderr) io.error(result.stderr.trimEnd());
  if (result.stdout) io.write(result.stdout);
  return io.exit(result.exitCode);
}
