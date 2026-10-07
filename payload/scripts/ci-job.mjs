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
import { SCHEMA_E2E } from './lib/critical.mjs';
import { reportInputs } from './lib/flaky.mjs';
import { executionBlock } from './lib/evidence-check.mjs';
import { sha256File } from './lib/hash.mjs';
import { asString, splitFrontmatter } from './lib/frontmatter.mjs';
import { parseTasks, taskState } from './lib/tasks.mjs';
import { pathToFileURL } from 'node:url';

const MAX_OUTPUT_MIB = 64;
// GitHub caps one step's summary at 1 MiB. Rows beyond the count limit and sections beyond the byte budget
// point at <change-id>.summary.md in the run artifact instead.
export const STEP_SUMMARY_MAX_ROWS = 200;
export const STEP_SUMMARY_MAX_BYTES = 900 * 1024;
const STEP_SUMMARY_TITLE = '## openspec-custom-testkit E2E';

export function runCiJob(env = process.env, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const execFile = deps.execFile ?? execFileSync;
  const evaluate = deps.evaluateChange ?? evaluateChange;
  const reportFor = deps.buildReport ?? buildReport;
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
  const root = resolve(repo);
  const work = resolve(root, workRel);
  if (work !== root && !work.startsWith(root + sep)) return finish(repo, 1, ['working-directory がリポジトリの外です'], null, env);

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
    if (!result.truncated && existsSync(source)) executions.push({ id: `${runId}-${name}`, command, exit_code: result.code, source_sha256: sha256File(source) });
  };

  const mode = env.SETUP_MODE || 'npm';
  if (mode === 'npm') {
    if (!existsSync(join(work, 'package-lock.json'))) {
      return finish(repo, 1, ['package-lock.json がありません。npm mode では lockfile が必要です。pnpm/yarn は setup-mode=caller と setup-command を使ってください。'], null, env);
    }
    const setup = run(execFile, 'npm', ['ci'], work, env);
    lines.push(...setup.lines);
    if (setup.code) code = code || setup.code;
    if (env.E2E_COMMAND || env.REGRESSION_COMMAND) {
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

  const level = maxLevel(selected.changes.map(change => {
    const path = join(repo, change.path, 'quality.md');
    try {
      if (!existsSync(path)) return 'none';
      // Malformed frontmatter or an invalid value must not downgrade the risk to none.
      const declared = asString(splitFrontmatter(readFileSync(path, 'utf8')).data?.risk_level);
      return ['high', 'medium', 'low'].includes(declared) ? declared : 'unknown';
    } catch (err) {
      fail(1, `${change.id}: quality.md を読み取れません (${err.code ?? err.message})`);
      return 'unknown';
    }
  }));
  const hasFinal = selected.changes.some(change => effectivePhase(phase, change, taskState(parseTasks(change.tasksText))) === 'final');
  if ((phase === 'final' || hasFinal) && !env.TEST_COMMAND) fail(1, '最終検証では test-command を空にできません');
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
  const summaries = [];
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
        fail(2, `${change.id}: レポートを読めません (${err.message})`);
        summaries.push({ id: change.id, text: unreadable(change.id) });
        continue;
      }
      const input = { ...inputs, changeId: change.id, planText: plan, results, maxAge };
      const report = reportFor(input);
      writeFileSync(join(runDir, `${change.id}.report.txt`), `${report.stdout}${report.stderr}`);
      lines.push(...[report.stdout.trimEnd(), report.stderr.trimEnd()].filter(Boolean));
      if (report.exitCode) code = code || report.exitCode;
      summaries.push({ id: change.id, text: publishSummary(input, runDir, lines, reportFor) ?? unreadable(change.id) });
    }
  }
  let e2eNote = null;
  if (!env.E2E_COMMAND) {
    e2eNote = required.length
      ? `E2E は実行していません。E2E required の change (${required.map(change => change.id).join(', ')}) がありますが、e2e-command が空です。`
      : 'E2E は実行していません。E2E required の change がなく、e2e-command も空です。';
  } else if (!required.length) {
    e2eNote = 'E2E を実行しましたが、E2E required の change はありません。結果は job ログと artifact を参照してください。';
  }
  const coverageStrict = env.COVERAGE_STRICT === 'true' || env.COVERAGE_STRICT === '1';
  if (env.REGRESSION_COMMAND || coverageStrict) {
    if (coverageStrict && !env.REGRESSION_COMMAND) lines.push('coverage-strict: regression-command が無いため宣言上の対応だけを検査します。fail・未実行は判定しません。');
    mkdirSync(runDir, { recursive: true });
    let regressionCode = 0;
    let resultsPath = null;
    if (env.REGRESSION_COMMAND) {
      resultsPath = join(runDir, 'regression-results.json');
      const regressionDir = join(runDir, 'regression');
      mkdirSync(regressionDir, { recursive: true });
      const regression = run(execFile, 'bash', ['-c', env.REGRESSION_COMMAND], work, {
        ...env,
        E2E_BASE_URL: env.E2E_BASE_URL || 'http://localhost:3000',
        TESTKIT_RUN_DIR: regressionDir,
        TESTKIT_RESULTS_JSON: resultsPath,
      });
      record('regression', env.REGRESSION_COMMAND, regression, existsSync(resultsPath) ? resultsPath : undefined);
      lines.push(...regression.lines);
      regressionCode = regression.code;
    }
    const coverage = runCoverage({ repo, resultsPath, maxAge, strict: true, env }, deps.coverage);
    // Preserve the command's failure code while still saving the map and final summary.
    lines.push(...[coverage.stdout.trimEnd(), coverage.stderr.trimEnd()].filter(Boolean));
    if (regressionCode) code = code || regressionCode;
    try {
      writeFileSync(join(runDir, 'coverage.md'), `${coverage.stdout}${coverage.stderr}`);
    } catch (err) {
      fail(2, `シナリオ対応表を保存できません: ${err.code ?? err.name}: ${err.message}`);
    }
    if (coverage.model) {
      let json;
      try { json = (deps.coverage?.renderJson ?? renderJson)(coverage.model, coverage.summary); }
      catch (err) { fail(3, `シナリオ対応表の内部エラー:\n${err.stack ?? err}`); }
      if (json !== undefined) try { writeFileSync(join(runDir, 'coverage.json'), json); }
      catch (err) { fail(2, `シナリオ対応表を保存できません: ${err.code ?? err.name}: ${err.message}`); }
    }
    if (coverage.exitCode === 2) fail(2, 'シナリオ対応表を作れません。入力エラー（詳細は上記）');
    else if (coverage.exitCode === 3) fail(3, 'シナリオ対応表を作れません。内部エラー（スタックトレースは上記）');
    else if (coverage.exitCode === 1 && coverageStrict) fail(1, 'coverage-strict: 対応表に要対応があります');
  }
  let manifest;
  if (executions.length) {
    const matched = [];
    for (const change of selected.changes) {
      const evidencePath = join(repo, change.path, 'evidence.md');
      if (!existsSync(evidencePath)) continue;
      let data;
      try { data = executionBlock(readFileSync(evidencePath, 'utf8')).data; }
      catch (err) { fail(1, `${change.id}: evidence.md を読み取れません (${err.code ?? err.message})`); continue; }
      for (const evidence of Array.isArray(data?.runs) ? data.runs : []) {
        const execution = executions.find(run => run.command === evidence.command && run.exit_code === evidence.exit_code);
        if (execution) matched.push({ ...execution, id: evidence.id, change_id: change.id });
      }
    }
    try {
      manifest = { revision: headRevision(repo), run_ids: [...new Set(matched.map(run => run.id))], runs: matched, executions };
      writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    } catch (err) {
      fail(2, `CI の revision・実行記録を保存できません: ${err.message}`);
    }
  }
  const cache = {};
  for (const change of selected.changes) {
    let result;
    try {
      result = evaluate(repo, change, { phase, quality: true, plan: true, tags: true, env, manifest, cache, base: selected.base });
    } catch (err) {
      fail(1, `${change.id}: gate 評価中にエラーが発生しました (${err.code ?? err.name}: ${err.message})`);
      if (err.stack) lines.push(err.stack);
      continue;
    }
    lines.push(`▶ ${change.id} (${change.lifecycle}/${result.phase})`);
    for (const warning of result.warnings) lines.push(`! ${warning}`);
    for (const failure of result.failures) lines.push(`✗ ${failure}`);
    if (result.failures.length) code = code || 1;
  }
  return finish(repo, code, lines, {
    riskLevel: level,
    phase,
    runDir: existsSync(runDir) ? runDir : null,
    e2eRan: Boolean(env.E2E_COMMAND),
    stepSummary: stepSummaryText(summaries, e2eNote),
  }, env);
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
      lines.push(`::warning::${overflowRef} を保存できません (${err.code ?? err.message})。ゲートの判定には影響しません`);
    }
    return reportFor({ ...input, format: 'summary', publishRoot: runDir, maxRows: STEP_SUMMARY_MAX_ROWS, overflowRef }).stdout;
  } catch (err) {
    lines.push(`::warning::${input.changeId} の要約を生成できません (${err.code ?? err.message})。ゲートの判定には影響しません`);
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
  try {
    const stdout = execFile(file, args, { cwd, env, encoding: 'utf8', maxBuffer: MAX_OUTPUT_MIB * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output: String(stdout ?? ''), lines: stdout ? [String(stdout).trimEnd()] : [] };
  } catch (err) {
    const stdout = err.stdout?.toString?.() ?? '';
    const stderr = err.stderr?.toString?.() ?? err.message;
    if (err.code === 'ENOBUFS') {
      const message = `${file} ${args.join(' ')}: 出力が ${MAX_OUTPUT_MIB} MiB を超えたため中断しました。終了コードを判定できません`;
      return { code: 2, truncated: true, output: stdout + stderr, lines: [message, stdout.trimEnd(), String(stderr).trimEnd()].filter(Boolean) };
    }
    return { code: err.status || 1, output: stdout + stderr, lines: [`${file} ${args.join(' ')} failed`, stdout.trimEnd(), String(stderr).trimEnd()].filter(Boolean) };
  }
}

function finish(repo, code, lines, meta, env) {
  const id = `${Date.now().toString(36)}-summary`;
  const dir = join(repo, 'test-results/testkit', id);
  // Early input/setup failures have no run metadata, but their reason must still reach both summaries.
  const stepSummary = meta?.stepSummary ?? `${STEP_SUMMARY_TITLE}\n\n入力・セットアップの確認で停止しました（終了コード ${code}）。E2E は実行していません。\n\n<pre>${lines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>\n`;
  // The step summary and its copy for the PR comment are publishing only: failures warn and never change `code`.
  let summaryFile = '';
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'step-summary.md'), stepSummary);
    summaryFile = join(dir, 'step-summary.md');
  } catch (err) {
    lines.push(`::warning::E2E の要約を保存できません (${err.code ?? err.message})。ゲートの判定には影響しません`);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, stepSummary);
    } catch (err) {
      lines.push(`::warning::step summary に書き込めません (${err.code ?? err.message})。ゲートの判定には影響しません`);
    }
  }
  if (env.GITHUB_OUTPUT) {
    try {
      const outputs = [`run_dir=${meta?.runDir ?? ''}`, `e2e_ran=${meta?.e2eRan ?? false}`, `summary_file=${summaryFile}`];
      if (meta?.riskLevel) outputs.unshift(`risk_level=${meta.riskLevel}`);
      appendFileSync(env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
    } catch (err) {
      lines.push(`::warning::GITHUB_OUTPUT に書き込めません (${err.code ?? err.message})。artifact・PR コメントの公開情報を渡せません。ゲートの判定には影響しません`);
    }
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'summary.txt'), `${lines.join('\n')}\nexit ${code}\n`);
  } catch {
    lines.push('結果ディレクトリを書けませんでした');
  }
  return { code, lines, ...meta, stepSummary, summaryDir: dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runCiJob(process.env);
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}
