#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { effectivePhase, evaluateChange, maxLevel } from './lib/evaluate.mjs';
import { headRevision, toplevel } from './lib/git.mjs';
import { buildReport } from './lib/report.mjs';
import { renderJson, runCoverage } from './lib/coverage-map.mjs';
import { selectChanges } from './lib/select.mjs';
import { isE2eRequired } from './lib/critical.mjs';
import { reportInputs } from './lib/flaky.mjs';
import { readRiskLevel } from './lib/change-metadata.mjs';
import { appendGithubOutput, isMain } from './lib/entry.mjs';
import { executionBlock } from './lib/evidence-check.mjs';
import { escapeHtml } from './lib/markdown.mjs';
import { errorCode } from './lib/files.mjs';
import { sha256File } from './lib/hash.mjs';
import { parseTasks, taskState } from './lib/tasks.mjs';

const MAX_OUTPUT_MIB = 64;
// GitHub caps one step's summary at 1 MiB. Rows beyond the count limit and sections beyond the byte budget
// point at <change-id>.summary.md in the run artifact instead.
export const STEP_SUMMARY_MAX_ROWS = 200;
export const STEP_SUMMARY_MAX_BYTES = 900 * 1024;
const STEP_SUMMARY_TITLE = '## openspec-custom-testkit E2E';

export function runCiJob(env = process.env, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  let repo;
  try {
    repo = toplevel(cwd);
  } catch (err) {
    return finish(cwd, 2, [`git リポジトリを特定できません: ${err.message}`], null, env);
  }
  const inputs = readInputs(repo, env);
  if (inputs.stop) return finish(repo, inputs.stop.code, [inputs.stop.message], null, env);
  const { selected, maxAge } = inputs;
  const job = createJob(repo, inputs.work, env, deps);
  if (selected.changes.length === 0) job.lines.push('計画ゲートは対象なしです。回帰テストと構成済み smoke は省略しません。');
  const phase = env.GATE_PHASE === 'final' ? 'final' : 'plan';

  const setupStop = runSetup(job);
  if (setupStop) return finish(repo, 1, [setupStop], null, env);
  const level = declaredRiskLevel(job, selected.changes);
  runCheckCommands(job, selected.changes, phase, level);
  const required = selected.changes.filter(isE2eRequired);
  const summaries = runE2eStage(job, required, maxAge, deps.buildReport ?? buildReport);
  runCoverageStage(job, maxAge, deps.coverage);
  const manifest = buildRunManifest(job, selected.changes);
  evaluateAll(job, selected, phase, manifest, deps.evaluateChange ?? evaluateChange);
  return finish(repo, job.code, job.lines, {
    riskLevel: level,
    phase,
    runDir: existsSync(job.runDir) ? job.runDir : null,
    e2eRan: Boolean(env.E2E_COMMAND),
    stepSummary: stepSummaryText(summaries, e2eNote(env, required)),
  }, env);
}

// Inputs checked before anything runs; a problem stops the job with { stop: { code, message } }.
function readInputs(repo, env) {
  const root = resolve(repo);
  const work = resolve(root, env.WORKING_DIRECTORY || '.');
  if (work !== root && !work.startsWith(root + sep)) return { stop: { code: 1, message: 'working-directory がリポジトリの外です' } };
  const selected = selectChanges({ repo, base: env.BASE_REF || 'origin/main', env });
  if (selected.exitCode === 2) return { stop: { code: 2, message: selected.error } };
  const maxAge = env.REPORT_MAX_AGE ? Number(env.REPORT_MAX_AGE) : null;
  if (maxAge != null && (!Number.isFinite(maxAge) || maxAge < 0)) {
    return { stop: { code: 2, message: 'report-max-age には 0 以上の秒数を指定してください' } };
  }
  return { work, selected, maxAge };
}

// Shared state of one run: the output lines, the first failing exit code, and the commands recorded for the manifest.
function createJob(repo, work, env, deps) {
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const job = {
    repo, work, env, deps, runId,
    runDir: join(repo, 'test-results/testkit', runId),
    execFile: deps.execFile ?? execFileSync,
    lines: [],
    code: 0,
    executions: [],
  };
  job.fail = (status, message) => {
    job.lines.push(message);
    if (!job.code) job.code = status;
  };
  job.step = makeStepRunner(job);
  return job;
}

function recordExecution(job, name, command, result, source) {
  mkdirSync(job.runDir, { recursive: true });
  if (!source) {
    source = join(job.runDir, `${name}.log`);
    writeFileSync(source, result.output);
  }
  job.executions.push({
    id: `${job.runId}-${name}`, command, exit_code: result.code, started_at: result.started_at,
    ...(existsSync(source) ? { source_sha256: sha256File(source) } : {}),
    ...(result.truncated ? { truncated: true } : {}),
  });
}

// Runs one command in the working directory: records it when named, keeps its output and the first failing code.
// `source` may be a function so that a results file the command writes is looked up after it ran.
function makeStepRunner(job) {
  return (file, args, { name = null, env = job.env, source } = {}) => {
    const result = run(job.execFile, file, args, job.work, env);
    if (name) recordExecution(job, name, args.at(-1), result, typeof source === 'function' ? source() : source);
    job.lines.push(...result.lines);
    if (result.code && !job.code) job.code = result.code;
    return result;
  };
}

// Returns the message that stops the job, or null.
function runSetup(job) {
  const { env, step } = job;
  const mode = env.SETUP_MODE || 'npm';
  if (mode === 'npm') {
    if (!existsSync(join(job.work, 'package-lock.json'))) {
      return 'package-lock.json がありません。npm mode では lockfile が必要です。pnpm/yarn は setup-mode=caller と setup-command を使ってください。';
    }
    step('npm', ['ci']);
    if (env.E2E_COMMAND || env.REGRESSION_COMMAND) step('npx', ['playwright', 'install', '--with-deps', 'chromium']);
    return null;
  }
  if (mode === 'caller') {
    job.lines.push('setup-mode=caller: npm ci は実行しません。runtime・依存・browser・DB は setup-command の担当です。');
    if (env.SETUP_COMMAND) step('bash', ['-c', env.SETUP_COMMAND]);
    return null;
  }
  return `未対応の setup-mode です: ${mode}`;
}

function declaredRiskLevel(job, changes) {
  return maxLevel(changes.map(change => {
    try {
      const risk = readRiskLevel(job.repo, change.path);
      // Malformed frontmatter or an invalid value must not downgrade the risk to none.
      return risk.exists ? risk.level : 'none';
    } catch (err) {
      job.fail(1, `${change.id}: quality.md を読み取れません (${errorCode(err)})`);
      return 'unknown';
    }
  }));
}

function runCheckCommands(job, changes, phase, level) {
  const { env, step } = job;
  const hasFinal = changes.some(change => effectivePhase(phase, change, taskState(parseTasks(change.tasksText))) === 'final');
  if ((phase === 'final' || hasFinal) && !env.TEST_COMMAND) job.fail(1, '最終検証では test-command を空にできません');
  if (env.TEST_COMMAND) step('bash', ['-c', env.TEST_COMMAND], { name: 'test', env: { ...env, E2E_BASE_URL: env.E2E_BASE_URL || '' } });
  if (level === 'high' && !env.MUTATION_COMMAND) job.fail(1, 'risk_level=high では mutation-command が必要です');
  if (level === 'high' && env.MUTATION_COMMAND) step('bash', ['-c', env.MUTATION_COMMAND], { name: 'mutation' });
  // Optional contract tests against the real services' contracts. Unset means nothing runs and nothing is sent;
  // a pass never updates the verification dates in the mock registry.
  if (env.CONTRACT_COMMAND) step('bash', ['-c', env.CONTRACT_COMMAND], { name: 'contract' });
}

// Runs the E2E command and reports each E2E-required change from this run's results. Returns the step summary sections.
function runE2eStage(job, required, maxAge, reportFor) {
  const { env, repo, runDir } = job;
  const summaries = [];
  if (required.length && !env.E2E_COMMAND) job.fail(1, 'E2E required の change がありますが e2e-command がありません');
  if (!env.E2E_COMMAND) return summaries;
  mkdirSync(runDir, { recursive: true });
  const resultsPath = join(runDir, 'results.json');
  job.step('bash', ['-c', env.E2E_COMMAND], {
    name: 'e2e',
    source: resultsPath,
    env: { ...env, E2E_BASE_URL: env.E2E_BASE_URL || 'http://localhost:3000', TESTKIT_RUN_DIR: runDir, TESTKIT_RESULTS_JSON: resultsPath },
  });
  let results;
  let resultsError;
  try {
    results = JSON.parse(readFileSync(resultsPath, 'utf8'));
  } catch (err) {
    resultsError = err;
  }
  for (const change of required) {
    if (!existsSync(resultsPath)) {
      job.fail(2, `${change.id}: 今回の results.json がありません。前回の結果は使いません`);
      summaries.push({ id: change.id, text: `### ${change.id}\n\n今回の results.json がありません。E2E コマンドの出力を job ログで確認してください。\n` });
      continue;
    }
    let plan;
    let inputs;
    try {
      if (resultsError) throw resultsError;
      plan = readFileSync(join(repo, change.path, 'test-plan.md'), 'utf8');
      inputs = reportInputs(repo, change);
    } catch (err) {
      job.fail(2, `${change.id}: レポートを読めません (${err.message})`);
      summaries.push({ id: change.id, text: unreadable(change.id) });
      continue;
    }
    const input = { ...inputs, changeId: change.id, planText: plan, results, maxAge };
    const report = reportFor(input);
    writeFileSync(join(runDir, `${change.id}.report.txt`), `${report.stdout}${report.stderr}`);
    job.lines.push(...[report.stdout.trimEnd(), report.stderr.trimEnd()].filter(Boolean));
    if (report.exitCode && !job.code) job.code = report.exitCode;
    summaries.push({ id: change.id, text: publishSummary(input, runDir, job.lines, reportFor) ?? unreadable(change.id) });
  }
  return summaries;
}

// Why the step summary has no E2E table, or null when it has one.
function e2eNote(env, required) {
  if (!env.E2E_COMMAND) {
    return required.length
      ? `E2E は実行していません。E2E required の change (${required.map(change => change.id).join(', ')}) がありますが、e2e-command が空です。`
      : 'E2E は実行していません。E2E required の change がなく、e2e-command も空です。';
  }
  if (!required.length) return 'E2E を実行しましたが、E2E required の change はありません。結果は job ログと artifact を参照してください。';
  return null;
}

function runCoverageStage(job, maxAge, coverageDeps) {
  const { env, repo, runDir } = job;
  const coverageStrict = env.COVERAGE_STRICT === 'true' || env.COVERAGE_STRICT === '1';
  if (!env.REGRESSION_COMMAND && !coverageStrict) return;
  if (coverageStrict && !env.REGRESSION_COMMAND) job.lines.push('coverage-strict: regression-command が無いため宣言上の対応だけを検査します。fail・未実行は判定しません。');
  mkdirSync(runDir, { recursive: true });
  let resultsPath = null;
  if (env.REGRESSION_COMMAND) {
    resultsPath = join(runDir, 'regression-results.json');
    const regressionDir = join(runDir, 'regression');
    mkdirSync(regressionDir, { recursive: true });
    // The command's failure code is kept while the map and the final summary are still saved below.
    job.step('bash', ['-c', env.REGRESSION_COMMAND], {
      name: 'regression',
      source: () => (existsSync(resultsPath) ? resultsPath : undefined),
      env: { ...env, E2E_BASE_URL: env.E2E_BASE_URL || 'http://localhost:3000', TESTKIT_RUN_DIR: regressionDir, TESTKIT_RESULTS_JSON: resultsPath },
    });
  }
  const coverage = runCoverage({ repo, resultsPath, maxAge, strict: true, env }, coverageDeps);
  job.lines.push(...[coverage.stdout.trimEnd(), coverage.stderr.trimEnd()].filter(Boolean));
  try {
    writeFileSync(join(runDir, 'coverage.md'), `${coverage.stdout}${coverage.stderr}`);
  } catch (err) {
    job.fail(2, `シナリオ対応表を保存できません: ${err.code ?? err.name}: ${err.message}`);
  }
  if (coverage.model) {
    let json;
    try { json = (coverageDeps?.renderJson ?? renderJson)(coverage.model, coverage.summary); }
    catch (err) { job.fail(3, `シナリオ対応表の内部エラー:\n${err.stack ?? err}`); }
    if (json !== undefined) try { writeFileSync(join(runDir, 'coverage.json'), json); }
    catch (err) { job.fail(2, `シナリオ対応表を保存できません: ${err.code ?? err.name}: ${err.message}`); }
  }
  if (coverage.exitCode === 2) job.fail(2, 'シナリオ対応表を作れません。入力エラー（詳細は上記）');
  else if (coverage.exitCode === 3) job.fail(3, 'シナリオ対応表を作れません。内部エラー（スタックトレースは上記）');
  else if (coverage.exitCode === 1 && coverageStrict) job.fail(1, 'coverage-strict: 対応表に要対応があります');
}

// The revision and the commands this run executed, matched to the runs each change's evidence records.
function buildRunManifest(job, changes) {
  const { repo, executions } = job;
  if (!executions.length) return undefined;
  const matched = [];
  for (const change of changes) {
    const evidencePath = join(repo, change.path, 'evidence.md');
    if (!existsSync(evidencePath)) continue;
    let data;
    try { data = executionBlock(readFileSync(evidencePath, 'utf8')).data; }
    catch (err) { job.fail(1, `${change.id}: evidence.md を読み取れません (${errorCode(err)})`); continue; }
    for (const evidence of Array.isArray(data?.runs) ? data.runs : []) {
      const execution = executions.find(run => !run.truncated && run.source_sha256 && run.command === evidence.command && run.exit_code === evidence.exit_code);
      if (execution) matched.push({ ...execution, id: evidence.id, change_id: change.id });
    }
  }
  // A manifest whose file cannot be written is still used for this run's verdict.
  let manifest;
  try {
    manifest = { revision: headRevision(repo), run_ids: [...new Set(matched.map(run => run.id))], runs: matched, executions };
    writeFileSync(join(job.runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  } catch (err) {
    job.fail(2, `CI の revision・実行記録を保存できません: ${err.message}`);
  }
  return manifest;
}

function evaluateAll(job, selected, phase, manifest, evaluate) {
  const { lines, env } = job;
  const cache = {};
  for (const change of selected.changes) {
    let result;
    try {
      result = evaluate(job.repo, change, { phase, quality: true, plan: true, tags: true, env, manifest, cache, base: selected.base });
    } catch (err) {
      job.fail(1, `${change.id}: gate 評価中にエラーが発生しました (${err.code ?? err.name}: ${err.message})`);
      if (err.stack) lines.push(err.stack);
      continue;
    }
    lines.push(`▶ ${change.id} (${change.lifecycle}/${result.phase})`);
    for (const warning of result.warnings) lines.push(`! ${warning}`);
    for (const failure of result.failures) lines.push(`✗ ${failure}`);
    if (result.failures.length && !job.code) job.code = 1;
  }
}

function unreadable(id) {
  return `### ${id}\n\nレポートを作れません。詳細は job ログを参照してください。\n`;
}

// Writes the full summary next to the results and returns the row-limited text for the step summary.
// Publishing problems are warnings only; the gate verdict comes from the text report above.
function publishSummary(input, runDir, lines, reportFor) {
  try {
    const overflowRef = `${input.changeId}.summary.md`;
    const full = reportFor({ ...input, format: 'summary', publishRoot: runDir });
    if (full.exitCode === 2) return null;
    try {
      writeFileSync(join(runDir, overflowRef), full.stdout);
    } catch (err) {
      lines.push(`::warning::${overflowRef} を保存できません (${errorCode(err)})。ゲートの判定には影響しません`);
    }
    return reportFor({ ...input, format: 'summary', publishRoot: runDir, maxRows: STEP_SUMMARY_MAX_ROWS, overflowRef }).stdout;
  } catch (err) {
    lines.push(`::warning::${input.changeId} の要約を生成できません (${errorCode(err)})。ゲートの判定には影響しません`);
    return null;
  }
}

function stepSummaryText(summaries, note) {
  const parts = [`${STEP_SUMMARY_TITLE}\n`];
  if (note) parts.push(`${note}\n`);
  let bytes = Buffer.byteLength(parts.join('\n'));
  for (const { id, text } of summaries) {
    let section = text;
    if (bytes + Buffer.byteLength(section) + 1 > STEP_SUMMARY_MAX_BYTES) {
      section = `### ${id}\n\n要約が step summary の上限を超えるため省略しました。artifact 内の <code>${id}.summary.md</code> を参照してください。\n`;
    }
    if (bytes + Buffer.byteLength(section) + 1 > STEP_SUMMARY_MAX_BYTES) break;
    parts.push(section);
    bytes += Buffer.byteLength(section) + 1;
  }
  return parts.join('\n');
}

function run(execFile, file, args, cwd, env) {
  const started_at = new Date().toISOString();
  try {
    const stdout = execFile(file, args, { cwd, env, encoding: 'utf8', maxBuffer: MAX_OUTPUT_MIB * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, started_at, output: String(stdout ?? ''), lines: stdout ? [String(stdout).trimEnd()] : [] };
  } catch (err) {
    const stdout = err.stdout?.toString?.() ?? '';
    const stderr = err.stderr?.toString?.() ?? err.message;
    if (err.code === 'ENOBUFS') {
      const message = `${file} ${args.join(' ')}: 出力が ${MAX_OUTPUT_MIB} MiB を超えたため中断しました。終了コードを判定できません`;
      return { code: 2, started_at, truncated: true, output: stdout + stderr, lines: [message, stdout.trimEnd(), String(stderr).trimEnd()].filter(Boolean) };
    }
    return { code: err.status || 1, started_at, output: stdout + stderr, lines: [`${file} ${args.join(' ')} failed`, stdout.trimEnd(), String(stderr).trimEnd()].filter(Boolean) };
  }
}

function finish(repo, code, lines, meta, env) {
  const id = `${Date.now().toString(36)}-summary`;
  const dir = join(repo, 'test-results/testkit', id);
  // Early input/setup failures have no run metadata, but their reason must still reach both summaries.
  const stepSummary = meta?.stepSummary ?? `${STEP_SUMMARY_TITLE}\n\n入力・セットアップの確認で停止しました（終了コード ${code}）。E2E は実行していません。\n\n<pre>${escapeHtml(lines.join('\n'))}</pre>\n`;
  // The step summary and its copy for the PR comment are publishing only: failures warn and never change `code`.
  const summaryFile = writeSummaryFiles(dir, stepSummary, lines);
  writeGithubOutputs(env, { stepSummary, summaryFile, meta }, lines);
  // Written last so that the saved log carries every publishing warning above.
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'summary.txt'), `${lines.join('\n')}\nexit ${code}\n`);
  } catch {
    lines.push('結果ディレクトリを書けませんでした');
  }
  return { code, lines, ...meta, stepSummary, summaryDir: dir };
}

// Saves the step summary for the PR comment step and returns its path, or '' when it cannot be written.
function writeSummaryFiles(dir, stepSummary, lines) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'step-summary.md'), stepSummary);
    return join(dir, 'step-summary.md');
  } catch (err) {
    lines.push(`::warning::E2E の要約を保存できません (${errorCode(err)})。ゲートの判定には影響しません`);
    return '';
  }
}

function writeGithubOutputs(env, { stepSummary, summaryFile, meta }, lines) {
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, stepSummary);
    } catch (err) {
      lines.push(`::warning::step summary に書き込めません (${errorCode(err)})。ゲートの判定には影響しません`);
    }
  }
  try {
    appendGithubOutput(env, {
      ...(meta?.riskLevel ? { risk_level: meta.riskLevel } : {}),
      run_dir: meta?.runDir ?? '',
      e2e_ran: meta?.e2eRan ?? false,
      summary_file: summaryFile,
    });
  } catch (err) {
    lines.push(`::warning::GITHUB_OUTPUT に書き込めません (${errorCode(err)})。artifact・PR コメントの公開情報を渡せません。ゲートの判定には影響しません`);
  }
}

if (isMain(import.meta.url)) {
  const result = runCiJob(process.env);
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}
