#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { evaluateChange, maxLevel } from './lib/evaluate.mjs';
import { headRevision, toplevel } from './lib/git.mjs';
import { buildReport } from './lib/report.mjs';
import { selectChanges } from './lib/select.mjs';
import { SCHEMA_E2E } from './lib/critical.mjs';
import { executionBlock } from './lib/evidence-check.mjs';
import { sha256File } from './lib/hash.mjs';
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
    return finish(cwd, 2, [`git リポジトリを特定できません: ${err.message}`], null, env);
  }
  const workRel = env.WORKING_DIRECTORY || '.';
  const work = resolve(repo, workRel);
  if (work !== repo && !work.startsWith(repo + '/')) return finish(repo, 1, ['working-directory がリポジトリの外です'], null, env);

  const selected = selectChanges({ repo, base: env.BASE_REF || 'origin/main', env });
  if (selected.exitCode === 2) return finish(repo, 2, [selected.error], null, env);
  const maxAge = env.REPORT_MAX_AGE ? Number(env.REPORT_MAX_AGE) : null;
  if (maxAge != null && (!Number.isFinite(maxAge) || maxAge < 0)) {
    return finish(repo, 2, ['report-max-age には 0 以上の秒数を指定してください'], null, env);
  }
  if (selected.changes.length === 0) lines.push('計画ゲートは対象なしです。回帰テストと構成済み smoke は省略しません。');
  const phase = env.GATE_PHASE === 'final' ? 'final' : 'plan';
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const runDir = join(repo, 'test-results/testkit', runId);
  const executions = [];
  const record = (name, command, result, source) => {
    mkdirSync(runDir, { recursive: true });
    if (!source) {
      source = join(runDir, `${name}.log`);
      writeFileSync(source, result.output);
    }
    if (existsSync(source)) executions.push({ id: `${runId}-${name}`, command, exit_code: result.code, source_sha256: sha256File(source) });
  };

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

  const evaluations = selected.changes.map(change => evaluateChange(repo, change, { phase, quality: true, plan: true, tags: true, env }));
  const level = maxLevel(evaluations.map(result => result.level));
  if ((phase === 'final' || evaluations.some(result => result.phase === 'final')) && !env.TEST_COMMAND) fail(1, '最終検証では test-command を空にできません');
  if (env.TEST_COMMAND) {
    const test = run(execFile, 'bash', ['-c', env.TEST_COMMAND], work, { ...env, E2E_BASE_URL: env.E2E_BASE_URL || '' });
    record('test', env.TEST_COMMAND, test);
    lines.push(...test.lines);
    if (test.code) code = code || test.code;
  }
  if (level === 'high' && !env.MUTATION_COMMAND) fail(1, 'risk_level=high では mutation-command が必要です');
  if (level === 'high' && env.MUTATION_COMMAND) {
    const mutation = run(execFile, 'bash', ['-c', env.MUTATION_COMMAND], work, env);
    record('mutation', env.MUTATION_COMMAND, mutation);
    lines.push(...mutation.lines);
    if (mutation.code) code = code || mutation.code;
  }
  const required = selected.changes.filter(change => change.e2e === 'required' || change.schema === SCHEMA_E2E);
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
    record('e2e', env.E2E_COMMAND, e2e, resultsPath);
    lines.push(...e2e.lines);
    if (e2e.code) code = code || e2e.code;
    let results;
    let resultsError;
    try {
      results = JSON.parse(readFileSync(resultsPath, 'utf8'));
    } catch (err) {
      resultsError = err;
    }
    for (const change of required) {
      if (!existsSync(resultsPath)) {
        fail(2, `${change.id}: 今回の results.json がありません。前回の結果は使いません`);
        continue;
      }
      let plan;
      try {
        if (resultsError) throw resultsError;
        plan = readFileSync(join(repo, change.path, 'test-plan.md'), 'utf8');
      } catch (err) {
        fail(2, `${change.id}: レポートを読めません (${err.message})`);
        continue;
      }
      const report = buildReport({
        changeId: change.id,
        planText: plan,
        results,
        maxAge,
      });
      writeFileSync(join(runDir, `${change.id}.report.txt`), `${report.stdout}${report.stderr}`);
      lines.push(report.stdout.trimEnd());
      if (report.exitCode) code = code || report.exitCode;
    }
  }
  let manifest;
  if (executions.length) {
    const matched = [];
    for (const change of selected.changes) {
      const evidencePath = join(repo, change.path, 'evidence.md');
      if (!existsSync(evidencePath)) continue;
      const data = executionBlock(readFileSync(evidencePath, 'utf8')).data;
      for (const evidence of Array.isArray(data?.runs) ? data.runs : []) {
        const execution = executions.find(run => run.command === evidence.command && run.exit_code === evidence.exit_code && run.source_sha256 === evidence.source_sha256);
        if (execution) matched.push({ ...execution, id: evidence.id, change_id: change.id });
      }
    }
    manifest = { revision: headRevision(repo), run_ids: [...new Set(matched.map(run => run.id))], runs: matched, executions, results: env.E2E_COMMAND ? 'results.json' : null };
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  for (const [index, change] of selected.changes.entries()) {
    const result = evaluations[index].phase === 'final' && manifest
      ? evaluateChange(repo, change, { phase, quality: true, plan: true, tags: true, env, manifest })
      : evaluations[index];
    lines.push(`▶ ${change.id} (${change.lifecycle}/${result.phase})`);
    for (const warning of result.warnings) lines.push(`! ${warning}`);
    for (const failure of result.failures) lines.push(`✗ ${failure}`);
    if (result.failures.length) code = code || 1;
  }
  return finish(repo, code, lines, { riskLevel: level, phase, runDir: executions.length || env.E2E_COMMAND ? runDir : null }, env);
}

function run(execFile, file, args, cwd, env) {
  try {
    const stdout = execFile(file, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output: String(stdout ?? ''), lines: stdout ? [String(stdout).trimEnd()] : [] };
  } catch (err) {
    const stdout = err.stdout?.toString?.() ?? '';
    const stderr = err.stderr?.toString?.() ?? err.message;
    return { code: err.status || 1, output: stdout + stderr, lines: [`${file} ${args.join(' ')} failed`, stdout.trimEnd(), String(stderr).trimEnd()].filter(Boolean) };
  }
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
