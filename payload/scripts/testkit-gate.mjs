#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { SCHEMA_E2E } from './lib/critical.mjs';
import { parseCoverageArgs, runCoverage } from './lib/coverage-map.mjs';
import { doctor } from './lib/doctor.mjs';
import { runEffort } from './lib/effort.mjs';
import { lintRepo } from './lib/e2e-lint.mjs';
import { evaluateChange, maxLevel } from './lib/evaluate.mjs';
import { toplevel } from './lib/git.mjs';
import { selectChanges } from './lib/select.mjs';

const USAGE = `usage: testkit-gate.mjs doctor
       testkit-gate.mjs select [--base <ref>] [<change>...] --json
       testkit-gate.mjs check [--phase plan|final] [--base <ref>] [<change>...]
       testkit-gate.mjs lint [--phase plan|final] [--base <ref>] [<change>...]
       testkit-gate.mjs coverage [--results <path>] [--max-age <seconds>] [--strict] [--format markdown|json]
       testkit-gate.mjs effort [--since YYYY-MM-DD] [--format table|json]`;

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
    if (arg === '--base' || arg === '--phase') {
      const value = argv[++i];
      if (!value) return { error: arg === '--base' ? '--base には ref が必要です' : '--phase には plan または final が必要です' };
      if (arg === '--base') base = value;
      else phase = value;
    } else names.push(arg);
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
if (command === 'coverage') {
  const opts = parseCoverageArgs(rest);
  if (opts.error) {
    console.error(opts.error);
    process.exit(2);
  }
  const result = runCoverage({ repo, ...opts });
  if (result.stderr) console.error(result.stderr.trimEnd());
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(result.exitCode);
}
if (command === 'effort') {
  const result = runEffort({ repo, argv: rest });
  if (result.stderr) console.error(result.stderr.trimEnd());
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(result.exitCode);
}
if (command !== 'select' && command !== 'check' && command !== 'lint') {
  console.error(USAGE);
  process.exit(2);
}
const args = parseTail(rest);
if (args.error) {
  console.error(args.error);
  process.exit(2);
}
if ((command === 'check' || command === 'lint') && args.phase !== 'plan' && args.phase !== 'final') {
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
if (command === 'lint') {
  const changes = selected.changes.filter(change => change.e2e === 'required' || change.schema === SCHEMA_E2E);
  const result = lintRepo(repo, changes, { phase: args.phase, base: selected.base, env: process.env, requireSources: true });
  const selectionErrors = selected.changes.flatMap(change => {
    const unknown = change.e2e === 'unknown' && !change.pendingPlan;
    const errors = unknown ? change.errors.filter(error => error !== change.reason) : change.errors;
    return [...errors.map(error => `${change.id}: ${error}`), ...(unknown ? [`${change.id}: E2E 適用状態を判定できません (${change.reason})`] : [])];
  });
  for (const error of selectionErrors) console.error(`✗ ${error}`);
  console.log(`対象 change: ${changes.map(change => change.id).join(', ') || 'なし（全ソースを警告範囲で表示）'}`);
  for (const note of result.notes) console.log(`! ${note}`);
  console.log('強制範囲:');
  for (const entry of result.enforced) console.log(`  ✗ ${entry.text}`);
  for (const entry of result.pending) console.log(`  ! ${entry.text}`);
  for (const entry of result.exceptions.filter(item => item.scope?.enforced)) console.log(`  ✓ ${entry.text}`);
  console.log('警告範囲:');
  for (const entry of result.warned) console.log(`  ! ${entry.text}`);
  for (const entry of result.exceptions.filter(item => !item.scope?.enforced)) console.log(`  ✓ ${entry.text}`);
  for (const file of result.unsupported) console.log(`対象外: ${file}（.feature は手続きを持たないため lint しません）`);
  console.log('---');
  console.log(`e2e-lint: analyzed ${result.analyzed} files, enforced failures ${result.failed}, warnings ${result.warned.length}, pending ${result.pending.length}, exceptions ${result.exceptions.length}`);
  process.exit(result.failed || selectionErrors.length || !selected.ok ? 1 : 0);
}
let failures = 0;
const levels = [];
const cache = {};
for (const change of selected.changes) {
  const result = evaluateChange(repo, change, {
    phase: args.phase,
    quality: true,
    plan: true,
    tags: true,
    env: process.env,
    cache,
    base: selected.base,
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
