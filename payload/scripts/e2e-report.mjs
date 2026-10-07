#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { errorCode } from './lib/files.mjs';
import { emit, processIo, resolveRepo, isMain } from './lib/entry.mjs';
import { reportInputs } from './lib/flaky.mjs';
import { buildReport, parseReporterArgs } from './lib/report.mjs';
import { changeSchema, resolveNamed } from './lib/select.mjs';

const USAGE = `usage: e2e-report.mjs <change-id> [results.json] [--max-age <seconds>] [--format text|summary]

--format summary: 人向けの Markdown 要約。添付は results.json のディレクトリからの相対パスで示す

exit code: 0=問題なし / 1=カバレッジ欠落 / 2=引数・入力エラー / 3=失敗テストあり（policy で不合格にした flaky を含む）`;

// Prints the report and returns its exit code. `io` takes log, error and write; `io.cwd` defaults to process.cwd().
// The results path is resolved from the current directory, as Node resolves any relative path.
export function main(argv = process.argv.slice(2), env = process.env, io = processIo) {
  const parsed = parseReporterArgs(argv);
  if (parsed.help) {
    io.log(USAGE);
    return 0;
  }
  if (parsed.error || !parsed.changeId) {
    io.error(parsed.error || USAGE);
    return 2;
  }
  const repo = resolveRepo(io.cwd ?? process.cwd());
  const change = resolveNamed(repo, parsed.changeId);
  if (!change) {
    io.error(`change が存在しません: ${parsed.changeId}`);
    return 2;
  }
  const inputs = readReportInputs(repo, change, parsed, io);
  if (inputs.exitCode != null) return inputs.exitCode;
  const report = buildReport({
    ...inputs.report,
    changeId: change.id,
    maxAge: parsed.maxAge,
    format: parsed.format,
    publishRoot: dirname(resolve(parsed.resultsPath)),
  });
  return emit({ ...io, exit: code => code }, report);
}

// The schema-dependent inputs, the results and the plan, or { exitCode: 2 } after printing why one is unreadable.
function readReportInputs(repo, change, parsed, io) {
  const stop = message => {
    io.error(message);
    return { exitCode: 2 };
  };
  const schema = changeSchema(repo, change.dir);
  if (schema.error) return stop(schema.error);
  let inputs;
  try {
    inputs = reportInputs(repo, { path: change.dir, ...schema });
  } catch (err) {
    return stop(`レポートの入力を読めません: ${err.message}`);
  }
  const planPath = join(repo, change.dir, 'test-plan.md');
  let planText;
  let raw;
  try {
    raw = readFileSync(parsed.resultsPath, 'utf8');
  } catch (err) {
    return stop(`Playwright JSON レポートを読めません: ${parsed.resultsPath} (${errorCode(err)})`);
  }
  try {
    planText = readFileSync(planPath, 'utf8');
  } catch (err) {
    return stop(`test-plan.md を読めません: ${planPath} (${errorCode(err)})`);
  }
  let results;
  try {
    results = JSON.parse(raw);
  } catch {
    return stop('Playwright JSON が不正です');
  }
  return { report: { ...inputs, planText, results } };
}

if (isMain(import.meta.url)) {
  process.exit(main(process.argv.slice(2), process.env, processIo));
}
