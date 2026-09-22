#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { evaluateChange, maxLevel } from './lib/evaluate.mjs';
import { headRevision, toplevel } from './lib/git.mjs';
import { buildReport } from './lib/report.mjs';
import { selectChanges } from './lib/select.mjs';
import { parseTasks, taskState } from './lib/tasks.mjs';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function runCiJob(env = process.env, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const execFile = deps.execFile ?? execFileSync;
  const lines = [];
  let code = 0;
  const fail = (status, message) => {
    lines.push(message);
    if (!code) code = status;
  };
  let repo;
  try {
    repo = toplevel(cwd);
  } catch (err) {
    return finish(repoOf(cwd), 2, [`git リポジトリを特定できません: ${err.message}`], null, env);
  }
  const workRel = env.WORKING_DIRECTORY || '.';
  const work = resolve(repo, workRel);
  if (work !== repo && !work.startsWith(repo + '/')) return finish(repo, 1, ['working-directory がリポジトリの外です'], null, env);

  const mode = env.SETUP_MODE || 'npm';
  if (mode === 'npm') {
    if (!existsSync(join(work, 'package-lock.json'))) {
      return finish(repo, 1, ['package-lock.json がありません。npm mode では lockfile が必要です。pnpm/yarn は setup-mode=caller と setup-command を使ってください。'], null, env);
    }
    const setup = run(execFile, 'npm', ['ci'], work, env);
    lines.push(...setup.lines);
    if (setup.code) code = code || setup.code;
    if (env.E2E_COMMAND) {
      const browser = run(execFile, 'npx', ['playwright', 'install', '--with-deps', 'chromium'], work, env);
      lines.push(...browser.lines);
      if (browser.code) code = code || browser.code;
    }
  } else if (mode === 'caller') {
    lines.push('setup-mode=caller: npm ci は実行しません。runtime・依存・browser・DB は setup-command の担当です。');
    if (env.SETUP_COMMAND) {
      const setup = run(execFile, 'bash', ['-c', env.SETUP_COMMAND], work, env);
      lines.push(...setup.lines);
      if (setup.code) code = code || setup.code;
    }
  } else {
    return finish(repo, 1, [`未対応の setup-mode です: ${mode}`], null, env);
  }

  const selected = selectChanges({ repo, base: env.BASE_REF || 'origin/main', env });
  if (selected.exitCode === 2) {
    lines.push(selected.error);
    return finish(repo, 2, lines, null, env);
  }
  if (selected.changes.length === 0) lines.push('計画ゲートは対象なしです。回帰テストと構成済み smoke は省略しません。');

  let phase = env.GATE_PHASE === 'final' ? 'final' : 'plan';
  if (selected.changes.some(change => change.lifecycle === 'archived' || change.lifecycle === 'deleted' || taskState(parseTasks(change.tasksText)).complete)) {
    phase = 'final';
  }

  const levels = [];
  for (const change of selected.changes) {
    const result = evaluateChange(repo, change, { phase, quality: true, plan: true, tags: true, env });
    lines.push(`▶ ${change.id} (${change.lifecycle}/${result.phase})`);
    for (const failure of result.failures) lines.push(`✗ ${failure}`);
    if (result.failures.length) code = code || 1;
    if (result.level !== 'none') levels.push(result.level);
  }
  const level = maxLevel(levels);
  if (phase === 'final' && !env.TEST_COMMAND) fail(1, '最終検証では test-command を空にできません');
  if (env.TEST_COMMAND) {
    const test = run(execFile, 'bash', ['-c', env.TEST_COMMAND], work, { ...env, E2E_BASE_URL: env.E2E_BASE_URL || '' });
    lines.push(...test.lines);
    if (test.code) code = code || test.code;
  }
  if (level === 'high' && !env.MUTATION_COMMAND) fail(1, 'risk_level=high では mutation-command が必要です');
  if (level === 'high' && env.MUTATION_COMMAND) {
    const mutation = run(execFile, 'bash', ['-c', env.MUTATION_COMMAND], work, env);
    lines.push(...mutation.lines);
    if (mutation.code) code = code || mutation.code;
  }
  const required = selected.changes.filter(change => change.e2e === 'required' || change.schema === 'spec-driven-e2e');
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const runDir = join(repo, 'test-results/testkit', runId);
  if (required.length && !env.E2E_COMMAND) fail(1, 'E2E required の change がありますが e2e-command がありません');
  if (env.E2E_COMMAND) {
    mkdirSync(runDir, { recursive: true });
    const resultsPath = join(runDir, 'results.json');
    const e2e = run(execFile, 'bash', ['-c', env.E2E_COMMAND], work, {
      ...env,
      E2E_BASE_URL: env.E2E_BASE_URL || 'http://localhost:3000',
      TESTKIT_RUN_DIR: runDir,
      TESTKIT_RESULTS_JSON: resultsPath,
    });
    lines.push(...e2e.lines);
    if (e2e.code) code = code || e2e.code;
    let revision = '';
    try {
      revision = headRevision(repo);
    } catch {
      revision = '';
    }
    const runIds = [];
    for (const change of required) {
      if (!existsSync(resultsPath)) {
        fail(2, `${change.id}: 今回の results.json がありません。前回の結果は使いません`);
        continue;
      }
      let results;
      let plan;
      try {
        results = JSON.parse(readFileSync(resultsPath, 'utf8'));
        plan = readFileSync(join(repo, change.path, 'test-plan.md'), 'utf8');
      } catch (err) {
        fail(2, `${change.id}: レポートを読めません (${err.message})`);
        continue;
      }
      const report = buildReport({
        changeId: change.id,
        planText: plan,
        results,
        maxAge: env.REPORT_MAX_AGE ? Number(env.REPORT_MAX_AGE) : null,
      });
      writeFileSync(join(runDir, `${change.id}.report.txt`), `${report.stdout}${report.stderr}`);
      lines.push(report.stdout.trimEnd());
      if (report.exitCode) code = code || report.exitCode;
      runIds.push(change.id);
    }
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ revision, run_ids: runIds, results: 'results.json' }, null, 2));
  }
  return finish(repo, code, lines, { riskLevel: level, phase, runDir: env.E2E_COMMAND ? runDir : null }, env);
}

function run(execFile, file, args, cwd, env) {
  try {
    const stdout = execFile(file, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, lines: stdout ? [String(stdout).trimEnd()] : [] };
  } catch (err) {
    const stdout = err.stdout?.toString?.() ?? '';
    const stderr = err.stderr?.toString?.() ?? err.message;
    return { code: err.status || 1, lines: [`${file} ${args.join(' ')} failed`, stdout.trimEnd(), String(stderr).trimEnd()].filter(Boolean) };
  }
}

function repoOf(cwd) {
  return cwd;
}

function finish(repo, code, lines, meta, env) {
  const id = `${Date.now().toString(36)}-summary`;
  const dir = join(repo, 'test-results/testkit', id);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'summary.txt'), `${lines.join('\n')}\nexit ${code}\n`);
  } catch {
    lines.push('結果ディレクトリを書けませんでした');
  }
  if (env.GITHUB_OUTPUT && meta?.riskLevel) {
    try {
      appendFileSync(env.GITHUB_OUTPUT, `risk_level=${meta.riskLevel}\n`);
    } catch { /* ignore */ }
  }
  return { code, lines, ...meta, summaryDir: dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runCiJob(process.env);
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}
