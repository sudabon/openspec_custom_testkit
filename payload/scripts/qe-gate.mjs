#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { isIntegratedChange, SCHEMA_INTEGRATED, SCHEMA_QE } from './lib/critical.mjs';
import { digestForSchema } from './lib/digest.mjs';
import { appendGithubOutput, resolveRepo } from './lib/entry.mjs';
import { evaluateChange, maxLevel } from './lib/evaluate.mjs';
import { asList, setFrontmatterScalar } from './lib/frontmatter.mjs';
import { readPolicyText } from './lib/policy.mjs';
import { loadQuality, sealBlockers } from './lib/seal.mjs';
import { isChangeName, schemaLine, selectChanges } from './lib/select.mjs';

const USAGE = `usage: qe-gate.mjs seal <change>
       qe-gate.mjs digest <change>
       qe-gate.mjs check [--base <ref>] [<change>...]`;

function printEvaluation(change, result) {
  console.log(`▶ ${change.id} (${change.lifecycle})`);
  const shown = schemaLine(change);
  if (shown) console.log(`  ${shown}`);
  for (const line of result.oks) console.log(`  ✓ ${line}`);
  for (const line of result.warnings) console.log(`  ! ${line}`);
  for (const line of result.failures) console.log(`  ✗ ${line}`);
}

function commandCheck(argv) {
  const repo = resolveRepo(process.cwd());
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
      plan: isIntegratedChange(change),
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
  appendGithubOutput(process.env, { risk_level: level });
  return failures || !selected.ok ? 1 : 0;
}

function commandDigest(id) {
  const repo = resolveRepo(process.cwd());
  const quality = loadQuality(repo, id);
  if (quality.error) {
    console.error(quality.error);
    return 1;
  }
  const selected = selectChanges({ repo, names: [id], env: process.env });
  const schema = isIntegratedChange(selected.changes[0]) ? SCHEMA_INTEGRATED : SCHEMA_QE;
  const digest = digestForSchema(repo, schema, asList(quality.data.oracle_paths));
  if (digest.error === 'UNREADABLE') {
    console.error(`Oracle を読み取れません: ${digest.path} (${digest.code})`);
    return 1;
  }
  if (digest.error === 'MISSING') console.log(`MISSING:${digest.path}`);
  else console.log(digest.digest ?? '');
  return 0;
}

function commandSeal(id) {
  const repo = resolveRepo(process.cwd());
  const quality = loadQuality(repo, id);
  if (quality.error) {
    console.error(quality.error);
    return 1;
  }
  const selected = selectChanges({ repo, names: [id], env: process.env });
  const change = selected.changes[0];
  const integrated = isIntegratedChange(change);
  const [blocker] = sealBlockers(change, quality.data, () => readPolicyText(repo) ?? '');
  if (blocker) {
    console.error(blocker);
    return 1;
  }
  const digest = digestForSchema(repo, integrated ? SCHEMA_INTEGRATED : SCHEMA_QE, asList(quality.data.oracle_paths));
  if (!digest.digest || digest.empty || digest.error) {
    console.error(digest.error === 'UNREADABLE'
      ? `Oracle を読み取れません: ${digest.path} (${digest.code})`
      : `Oracle テストが見つかりません: ${digest.path ?? '(空)'}`);
    return 1;
  }
  writeFileSync(quality.file, setFrontmatterScalar(quality.text, 'oracle_digest', digest.digest));
  console.log(`sealed: ${id} → ${digest.digest}`);
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
let code = 2;
if (command === 'check') code = commandCheck(rest);
else if ((command === 'digest' || command === 'seal') && rest[0] && !isChangeName(rest[0])) console.error(`change 名が不正です: ${rest[0]}`);
else if (command === 'digest') code = rest[0] ? commandDigest(rest[0]) : (console.error(USAGE), 2);
else if (command === 'seal') code = rest[0] ? commandSeal(rest[0]) : (console.error(USAGE), 2);
else console.error(USAGE);
process.exitCode = code;
