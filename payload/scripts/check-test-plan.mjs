#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { isE2eRequired, SCHEMA_QE } from './lib/critical.mjs';
import { evaluateChange } from './lib/evaluate.mjs';
import { processIo, resolveRepo } from './lib/entry.mjs';
import { selectChanges } from './lib/select.mjs';

const NOT_A_REPO = Symbol('not a repository');

// Checks the test plans of the changes in the diff and returns the exit code. `io` takes log and error;
// `io.cwd` defaults to process.cwd().
export function main(argv = process.argv.slice(2), env = process.env, io = processIo) {
  const base = argv[0] || 'origin/main';
  const repo = resolveRepo(io.cwd ?? process.cwd(), { onFailure: 'exit2', io: { ...io, exit: () => NOT_A_REPO } });
  if (repo === NOT_A_REPO) return 2;
  const selected = selectChanges({ repo, base, env });
  if (selected.exitCode === 2) {
    io.error(selected.error);
    return 2;
  }
  if (selected.changes.length === 0 && selected.ok) {
    io.log('openspec change の差分なし。skip');
    return 0;
  }
  let failed = selected.ok ? 0 : 1;
  const cache = {};
  for (const change of selected.changes) {
    const result = evaluateChange(repo, change, {
      phase: 'plan',
      quality: false,
      plan: true,
      tags: true,
      env,
      cache,
    });
    if (change.scope === 'out-of-scope' || change.schema === SCHEMA_QE) {
      io.log(`${change.id}: E2E計画の対象外 (${change.reason})`);
      continue;
    }
    for (const line of result.failures) {
      io.error(`::error::${line}`);
      failed = 1;
    }
    for (const line of result.planWarnings) io.log(`::warning::${line}`);
    for (const line of result.oks) io.log(`  ${line}`);
    if (result.failures.length === 0 && isE2eRequired(change)) {
      io.log(`${change.id}: tag-presence pass（実行 coverage ではありません）`);
    }
  }
  return failed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2), process.env, processIo));
}
