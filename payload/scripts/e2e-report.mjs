#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toplevel } from './lib/git.mjs';
import { buildReport, parseReporterArgs } from './lib/report.mjs';
import { resolveNamed } from './lib/select.mjs';

const USAGE = `usage: e2e-report.mjs <change-id> [results.json] [--max-age <seconds>]

exit code: 0=問題なし / 1=カバレッジ欠落 / 2=引数・入力エラー / 3=失敗テストあり`;

const parsed = parseReporterArgs(process.argv.slice(2));
if (parsed.help) {
  console.log(USAGE);
  process.exit(0);
}
if (parsed.error || !parsed.changeId) {
  console.error(parsed.error || USAGE);
  process.exit(2);
}
let repo;
try {
  repo = toplevel(process.cwd());
} catch {
  repo = process.cwd();
}
const change = resolveNamed(repo, parsed.changeId);
if (!change) {
  console.error(`change が存在しません: ${parsed.changeId}`);
  process.exit(2);
}
const planPath = join(repo, change.dir, 'test-plan.md');
let planText;
let raw;
try {
  raw = readFileSync(parsed.resultsPath, 'utf8');
} catch (err) {
  console.error(`Playwright JSON レポートを読めません: ${parsed.resultsPath} (${err.code ?? err.message})`);
  process.exit(2);
}
try {
  planText = readFileSync(planPath, 'utf8');
} catch (err) {
  console.error(`test-plan.md を読めません: ${planPath} (${err.code ?? err.message})`);
  process.exit(2);
}
let results;
try {
  results = JSON.parse(raw);
} catch {
  console.error('Playwright JSON が不正です');
  process.exit(2);
}
const report = buildReport({ changeId: change.id, planText, results, maxAge: parsed.maxAge });
if (report.stderr) console.error(report.stderr.trimEnd());
if (report.stdout) process.stdout.write(report.stdout);
process.exit(report.exitCode);
