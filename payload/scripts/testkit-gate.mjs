#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { doctor } from './lib/doctor.mjs';
import { evaluateChange, maxLevel } from './lib/evaluate.mjs';
import { toplevel } from './lib/git.mjs';
import { selectChanges } from './lib/select.mjs';

const USAGE = `usage: testkit-gate.mjs doctor
       testkit-gate.mjs select [--base <ref>] [<change>...] --json
       testkit-gate.mjs check --phase plan|final [--base <ref>] [<change>...]`;

function repoOf() {
  try {
    return toplevel(process.cwd());
  } catch {
    return process.cwd();
  }
}

function parseTail(argv) {
  let base;
  let phase = 'plan';
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') continue;
    if (arg === '--base') base = argv[++i];
    else if (arg === '--phase') phase = argv[++i];
    else names.push(arg);
  }
  return { base, phase, names };
}

const [command, ...rest] = process.argv.slice(2);
if (!command || command === '-h' || command === '--help') {
  console.log(USAGE);
  process.exit(0);
}
const repo = repoOf();
if (command === 'doctor') {
  let result;
  try {
    result = doctor(repo);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  for (const note of result.notes) console.log(`! ${note}`);
  if (!result.ok) {
    for (const failure of result.failures) console.error(`✗ ${failure}`);
    console.error('doctor: incomplete');
    process.exit(1);
  }
  console.log('doctor: complete');
  process.exit(0);
}
if (command !== 'select' && command !== 'check') {
  console.error(USAGE);
  process.exit(2);
}
const args = parseTail(rest);
if (command === 'check' && args.phase !== 'plan' && args.phase !== 'final') {
  console.error('--phase は plan または final です');
  process.exit(2);
}
const selected = selectChanges({ repo, base: args.base, names: args.names, env: process.env });
if (command === 'select') {
  console.log(JSON.stringify({
    ok: selected.ok,
    error: selected.error,
    changes: selected.changes.map(change => ({
      id: change.id,
      path: change.path,
      schema: change.schema,
      lifecycle: change.lifecycle,
      qe: change.qe,
      e2e: change.e2e,
      reason: change.reason,
      errors: change.errors,
    })),
  }, null, 2));
  process.exit(selected.exitCode === 2 ? 2 : (selected.ok ? 0 : 1));
}
if (selected.exitCode === 2) {
  console.error(selected.error);
  process.exit(2);
}
let failures = 0;
const levels = [];
for (const change of selected.changes) {
  const result = evaluateChange(repo, change, {
    phase: args.phase,
    quality: true,
    plan: true,
    tags: true,
    env: process.env,
  });
  console.log(`▶ ${change.id} (${change.lifecycle}/${result.phase})`);
  for (const line of result.oks) console.log(`  ✓ ${line}`);
  for (const line of result.warnings) console.log(`  ! ${line}`);
  for (const line of result.failures) console.log(`  ✗ ${line}`);
  failures += result.failures.length;
  if (result.level !== 'none') levels.push(result.level);
}
const level = maxLevel(levels);
console.log('---');
console.log(`checked: ${selected.changes.length} change(s), max risk_level: ${level}, failures: ${failures}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `risk_level=${level}\n`);
process.exit(failures ? 1 : 0);
