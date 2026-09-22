#!/usr/bin/env node
import { SCHEMA_QE, SCHEMA_E2E } from './lib/critical.mjs';
import { evaluateChange } from './lib/evaluate.mjs';
import { toplevel } from './lib/git.mjs';
import { selectChanges } from './lib/select.mjs';

const base = process.argv[2] || 'origin/main';
let repo;
try {
  repo = toplevel(process.cwd());
} catch {
  console.error('git リポジトリではありません');
  process.exit(2);
}
const selected = selectChanges({ repo, base, env: process.env });
if (selected.exitCode === 2) {
  console.error(selected.error);
  process.exit(2);
}
if (selected.changes.length === 0 && selected.ok) {
  console.log('openspec change の差分なし。skip');
  process.exit(0);
}
let failed = selected.ok ? 0 : 1;
for (const change of selected.changes) {
  const result = evaluateChange(repo, change, {
    phase: 'plan',
    quality: false,
    plan: true,
    tags: true,
    env: process.env,
  });
  if (change.scope === 'out-of-scope' || change.schema === SCHEMA_QE) {
    console.log(`${change.id}: E2E計画の対象外 (${change.reason})`);
    continue;
  }
  for (const line of result.failures) {
    console.error(`::error::${line}`);
    failed = 1;
  }
  for (const line of result.oks) console.log(`  ${line}`);
  if (result.failures.length === 0 && (change.e2e === 'required' || change.schema === SCHEMA_E2E)) {
    console.log(`${change.id}: tag-presence pass（実行 coverage ではありません）`);
  }
}
process.exit(failed);
