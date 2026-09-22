#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_INTEGRATED } from './lib/critical.mjs';
import { digestForSchema } from './lib/digest.mjs';
import { evaluateChange, maxLevel } from './lib/evaluate.mjs';
import { asList, asString, setFrontmatterScalar, splitFrontmatter, validDate } from './lib/frontmatter.mjs';
import { toplevel } from './lib/git.mjs';
import { selectChanges } from './lib/select.mjs';

const USAGE = `usage: qe-gate.mjs seal <change>
       qe-gate.mjs digest <change>
       qe-gate.mjs check [--base <ref>] [<change>...]`;

function repoFromCwd() {
  try {
    return toplevel(process.cwd());
  } catch {
    return process.cwd();
  }
}

function qualityPath(repo, id) {
  return join(repo, 'openspec/changes', id, 'quality.md');
}

function printEvaluation(change, result) {
  console.log(`▶ ${change.id} (${change.lifecycle})`);
  for (const line of result.oks) console.log(`  ✓ ${line}`);
  for (const line of result.warnings) console.log(`  ! ${line}`);
  for (const line of result.failures) console.log(`  ✗ ${line}`);
}

function commandCheck(argv) {
  const repo = repoFromCwd();
  let base = '';
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') base = argv[++i] ?? '';
    else names.push(argv[i]);
  }
  if (argv.includes('--base') && !base) {
    console.error('--base には ref が必要です');
    return 2;
  }
  const selected = selectChanges({ repo, base: base || undefined, names, env: process.env });
  if (selected.exitCode === 2) {
    console.error(selected.error);
    return 2;
  }
  let failures = 0;
  const levels = [];
  for (const change of selected.changes) {
    const result = evaluateChange(repo, change, {
      phase: 'plan',
      quality: true,
      plan: change.schema === SCHEMA_INTEGRATED || change.scope === 'integrated',
      tags: false,
      env: process.env,
    });
    printEvaluation(change, result);
    failures += result.failures.length;
    if (result.level !== 'none') levels.push(result.level);
  }
  const level = maxLevel(levels);
  console.log('---');
  console.log(`checked: ${selected.changes.length} change(s), max risk_level: ${level}, failures: ${failures}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `risk_level=${level}\n`);
  return failures || !selected.ok ? 1 : 0;
}

function commandDigest(id) {
  const repo = repoFromCwd();
  const file = qualityPath(repo, id);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`not found: ${file}`);
    return 1;
  }
  const frontmatter = splitFrontmatter(text);
  if (frontmatter.error) {
    console.error(frontmatter.error);
    return 1;
  }
  const selected = selectChanges({ repo, names: [id], env: process.env });
  const schema = selected.changes[0]?.schema === SCHEMA_INTEGRATED ? SCHEMA_INTEGRATED : 'quality-driven';
  const digest = digestForSchema(repo, schema, asList(frontmatter.data.oracle_paths));
  if (digest.error === 'MISSING') console.log(`MISSING:${digest.path}`);
  else console.log(digest.digest ?? '');
  return 0;
}

function commandSeal(id) {
  const repo = repoFromCwd();
  const file = qualityPath(repo, id);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`not found: ${file}`);
    return 1;
  }
  const frontmatter = splitFrontmatter(text);
  if (frontmatter.error) {
    console.error(frontmatter.error);
    return 1;
  }
  const selected = selectChanges({ repo, names: [id], env: process.env });
  const integrated = selected.changes[0]?.schema === SCHEMA_INTEGRATED || selected.changes[0]?.scope === 'integrated';
  if (integrated) {
    if (!asString(frontmatter.data.approved_by) || !validDate(asString(frontmatter.data.approved_at))) {
      console.error('quality.md が未承認です。approved_by と approved_at を人間が記入してから seal してください');
      return 1;
    }
  } else if (!asString(frontmatter.data.approved_by)) {
    console.error('quality.md が未承認です。approved_by を記入してから seal してください');
    return 1;
  }
  const digest = digestForSchema(repo, integrated ? SCHEMA_INTEGRATED : 'quality-driven', asList(frontmatter.data.oracle_paths));
  if (!digest.digest || digest.empty || digest.error) {
    console.error(`Oracle テストが見つかりません: ${digest.path ?? '(空)'}`);
    return 1;
  }
  writeFileSync(file, setFrontmatterScalar(text, 'oracle_digest', digest.digest));
  console.log(`sealed: ${id} → ${digest.digest}`);
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
let code = 2;
if (command === 'check') code = commandCheck(rest);
else if (command === 'digest') code = rest[0] ? commandDigest(rest[0]) : (console.error(USAGE), 2);
else if (command === 'seal') code = rest[0] ? commandSeal(rest[0]) : (console.error(USAGE), 2);
else console.error(USAGE);
process.exitCode = code;
