#!/usr/bin/env node
import { isE2eRequired } from './lib/critical.mjs';
import { parseCoverageArgs, runCoverage } from './lib/coverage-map.mjs';
import { doctor } from './lib/doctor.mjs';
import { runEffort } from './lib/effort.mjs';
import { formatLintReport, lintRepo } from './lib/e2e-lint.mjs';
import { appendGithubOutput, emit, processIo, resolveRepo, isMain } from './lib/entry.mjs';
import { evaluateChange, maxLevel } from './lib/evaluate.mjs';
import { selectChanges } from './lib/select.mjs';

const USAGE = `usage: testkit-gate.mjs doctor
       testkit-gate.mjs select [--base <ref>] [<change>...] --json
       testkit-gate.mjs check [--phase plan|final] [--base <ref>] [<change>...]
       testkit-gate.mjs lint [--phase plan|final] [--base <ref>] [<change>...]
       testkit-gate.mjs coverage [--results <path>] [--max-age <seconds>] [--strict] [--format markdown|json]
       testkit-gate.mjs effort [--since YYYY-MM-DD] [--format table|json]`;

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

// Runs one command and returns its exit code. `io` takes log, error and write; `io.cwd` defaults to process.cwd().
export function main(argv = process.argv.slice(2), env = process.env, io = processIo) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    io.log(USAGE);
    return 0;
  }
  const repo = resolveRepo(io.cwd ?? process.cwd());
  const returned = { ...io, exit: code => code };
  if (command === 'doctor') return commandDoctor(repo, io);
  if (command === 'coverage') {
    const opts = parseCoverageArgs(rest);
    if (opts.error) {
      io.error(opts.error);
      return 2;
    }
    return emit(returned, runCoverage({ repo, ...opts }));
  }
  if (command === 'effort') return emit(returned, runEffort({ repo, argv: rest }));
  if (command !== 'select' && command !== 'check' && command !== 'lint') {
    io.error(USAGE);
    return 2;
  }
  const args = parseTail(rest);
  if (args.error) {
    io.error(args.error);
    return 2;
  }
  if ((command === 'check' || command === 'lint') && args.phase !== 'plan' && args.phase !== 'final') {
    io.error('--phase は plan または final です');
    return 2;
  }
  const selected = selectChanges({ repo, base: args.base, names: args.names, env });
  if (command === 'select') return commandSelect(selected, io);
  if (selected.exitCode === 2) {
    io.error(selected.error);
    return 2;
  }
  if (command === 'lint') return commandLint(repo, selected, args, env, io);
  return commandCheck(repo, selected, args, env, io);
}

function commandDoctor(repo, io) {
  let result;
  try {
    result = doctor(repo);
  } catch (err) {
    io.error(err.message);
    return 1;
  }
  for (const note of result.notes) io.log(`! ${note}`);
  if (!result.ok) {
    for (const failure of result.failures) io.error(`✗ ${failure}`);
    io.error('doctor: incomplete');
    return 1;
  }
  io.log('doctor: complete');
  return 0;
}

function commandSelect(selected, io) {
  io.log(JSON.stringify({
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
  return selected.exitCode === 2 ? 2 : (selected.ok ? 0 : 1);
}

// Selection problems the lint command reports itself, since it does not run the full gate.
function lintSelectionErrors(changes) {
  return changes.flatMap(change => {
    const unknown = change.e2e === 'unknown' && !change.pendingPlan;
    const errors = unknown ? change.errors.filter(error => error !== change.reason) : change.errors;
    return [...errors.map(error => `${change.id}: ${error}`), ...(unknown ? [`${change.id}: E2E 適用状態を判定できません (${change.reason})`] : [])];
  });
}

function commandLint(repo, selected, args, env, io) {
  const changes = selected.changes.filter(isE2eRequired);
  const result = lintRepo(repo, changes, { phase: args.phase, base: selected.base, env, requireSources: true });
  const selectionErrors = lintSelectionErrors(selected.changes);
  for (const error of selectionErrors) io.error(`✗ ${error}`);
  for (const line of formatLintReport(result, changes)) io.log(line);
  return result.failed || selectionErrors.length || !selected.ok ? 1 : 0;
}

function commandCheck(repo, selected, args, env, io) {
  let failures = 0;
  const levels = [];
  const cache = {};
  for (const change of selected.changes) {
    const result = evaluateChange(repo, change, {
      phase: args.phase,
      quality: true,
      plan: true,
      tags: true,
      env,
      cache,
      base: selected.base,
    });
    io.log(`▶ ${change.id} (${change.lifecycle}/${result.phase})`);
    for (const line of result.oks) io.log(`  ✓ ${line}`);
    for (const line of result.warnings) io.log(`  ! ${line}`);
    for (const line of result.failures) io.log(`  ✗ ${line}`);
    failures += result.failures.length;
    if (result.level !== 'none') levels.push(result.level);
  }
  const level = maxLevel(levels);
  io.log('---');
  io.log(`checked: ${selected.changes.length} change(s), max risk_level: ${level}, failures: ${failures}`);
  appendGithubOutput(env, { risk_level: level });
  return failures ? 1 : 0;
}

if (isMain(import.meta.url)) {
  process.exit(main(process.argv.slice(2), process.env, processIo));
}
