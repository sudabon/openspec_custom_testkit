import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SCHEMA_INTEGRATED } from './critical.mjs';
import { readConfigDocument } from './environment.mjs';
import { executionBlock } from './evidence-check.mjs';
import { asString, parseYamlText, splitFrontmatter, validDate } from './frontmatter.mjs';
import { byteCompare } from './hash.mjs';
import { RISK_LEVELS } from './policy.mjs';

export const EFFORT_ACTIVITIES = ['approval', 'seal', 'qa-review', 'falsification-review', 'code-review', 'manual-test', 'other'];
const LOW_RECORDING_RATE = 0.5;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// `effort` is optional. When present, every element must be a complete human record.
export function effortErrors(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ['effort は {activity, minutes, recorded_by} の配列である必要があります'];
  const errors = [];
  value.forEach((entry, index) => {
    const at = `effort[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${at} は {activity, minutes, recorded_by} のオブジェクトである必要があります`);
      return;
    }
    if (!EFFORT_ACTIVITIES.includes(entry.activity)) {
      errors.push(`${at} の activity が未知です: ${JSON.stringify(entry.activity ?? null)}（${EFFORT_ACTIVITIES.join(' / ')} から選びます）`);
    }
    if (typeof entry.minutes !== 'number' || !Number.isFinite(entry.minutes) || entry.minutes < 0) {
      errors.push(`${at} の minutes が不正です: ${JSON.stringify(entry.minutes ?? null)}（0 以上の数値を書きます）`);
    }
    if (typeof entry.recorded_by !== 'string' || !entry.recorded_by.trim()) errors.push(`${at} の recorded_by がありません`);
  });
  return errors;
}

export function parseEffortArgs(argv) {
  const opts = { since: null, format: 'table' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => inline ?? argv[++i];
    if (flag === '--since') {
      opts.since = value() ?? '';
      if (!validDate(opts.since)) return { error: `--since には YYYY-MM-DD の日付が必要です: ${opts.since}` };
    } else if (flag === '--format') {
      opts.format = value();
      if (opts.format !== 'table' && opts.format !== 'json') return { error: '--format は table または json です' };
    } else return { error: `未対応の引数です: ${arg}` };
  }
  return opts;
}

function defaultSchema(repo) {
  const config = readConfigDocument(repo);
  if (config.text == null) return { schema: null };
  const parsed = config.parsed;
  if (parsed.errors.length || parsed.alias || parsed.tagged || (parsed.data != null && !isRecord(parsed.data))
      || (parsed.data?.schema != null && typeof parsed.data.schema !== 'string')) {
    return { error: `${relative(repo, config.located.path)} を解釈できないため既定 schema を判定できません${parsed.errors[0] ? ` (${parsed.errors[0]})` : ''}` };
  }
  return { schema: asString(parsed.data?.schema) || null };
}

function schemaOf(repo, dir, fallback) {
  const path = join(repo, dir, '.openspec.yaml');
  if (!existsSync(path)) return fallback;
  const parsed = parseYamlText(readFileSync(path, 'utf8'));
  if (parsed.errors.length || parsed.alias || parsed.tagged || !isRecord(parsed.data)) {
    return { error: `.openspec.yaml を解釈できません${parsed.errors[0] ? ` (${parsed.errors[0]})` : ''}` };
  }
  if (parsed.data.schema != null && typeof parsed.data.schema !== 'string') return { error: '.openspec.yaml の schema は文字列である必要があります' };
  return asString(parsed.data.schema) ? { schema: asString(parsed.data.schema) } : fallback;
}

function riskLevelOf(repo, dir) {
  const path = join(repo, dir, 'quality.md');
  if (!existsSync(path)) return { level: 'unknown', reason: 'quality.md がありません' };
  const parsed = splitFrontmatter(readFileSync(path, 'utf8'));
  if (parsed.error) return { level: 'unknown', reason: `quality.md の frontmatter が不正です: ${parsed.error}` };
  const level = asString(parsed.data?.risk_level);
  return RISK_LEVELS.includes(level) ? { level } : { level: 'unknown', reason: `quality.md の risk_level が不正です: ${level || '(空)'}` };
}

// One archived change: recorded (with entries), unrecorded, or broken with a reason.
function readEffort(repo, dir) {
  const path = join(repo, dir, 'evidence.md');
  if (!existsSync(path)) return { broken: 'evidence.md がありません' };
  const parsed = executionBlock(readFileSync(path, 'utf8'));
  if (parsed.error) return { broken: parsed.error };
  if (!isRecord(parsed.data)) return { broken: 'Execution Records の JSON はオブジェクトである必要があります' };
  const errors = effortErrors(parsed.data.effort);
  if (errors.length) return { broken: errors.join(' / ') };
  const entries = parsed.data.effort ?? [];
  return entries.length ? { entries } : { unrecorded: true };
}

export function buildEffort(repo, { since = null } = {}) {
  const root = join(repo, 'openspec/changes/archive');
  const folders = existsSync(root)
    ? readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(byteCompare)
    : [];
  const fallback = defaultSchema(repo);
  const recorded = [];
  const unrecorded = [];
  const broken = [];
  const warnings = [];
  for (const folder of folders) {
    // A reliable date prefix can exclude an old archive even if its metadata or id is broken.
    const date = folder.match(/^(\d{4}-\d{2}-\d{2})(?=-|$)/)?.[1];
    if (since && validDate(date) && date < since) continue;
    const dir = `openspec/changes/archive/${folder}`;
    const named = folder.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    const id = named ? named[2] : folder;
    const schema = schemaOf(repo, dir, fallback);
    if (schema.error) {
      broken.push({ id, archive: folder, reason: schema.error });
      continue;
    }
    if (schema.schema !== SCHEMA_INTEGRATED) continue;
    if (!named || !validDate(named[1])) {
      broken.push({ id, archive: folder, reason: 'archive フォルダ名は YYYY-MM-DD-<id> が必要です' });
      continue;
    }
    const read = readEffort(repo, dir);
    if (read.broken) broken.push({ id, archive: folder, reason: read.broken });
    else if (read.unrecorded) unrecorded.push(id);
    else {
      const risk = riskLevelOf(repo, dir);
      if (risk.reason) warnings.push(`${id} (${folder}): ${risk.reason}。Risk Level を unknown として集計します`);
      recorded.push({ id, archive: folder, level: risk.level, entries: read.entries });
    }
  }

  const tally = () => ({ minutes: 0, entries: 0, changes: 0 });
  const byActivity = Object.fromEntries(EFFORT_ACTIVITIES.map(activity => [activity, tally()]));
  const byLevel = Object.fromEntries(RISK_LEVELS.map(level => [level, tally()]));
  let total = 0;
  for (const change of recorded) {
    if (!byLevel[change.level]) byLevel[change.level] = tally();
    const level = byLevel[change.level];
    level.changes += 1;
    const seen = new Set();
    for (const entry of change.entries) {
      total += entry.minutes;
      level.minutes += entry.minutes;
      level.entries += 1;
      byActivity[entry.activity].minutes += entry.minutes;
      byActivity[entry.activity].entries += 1;
      if (!seen.has(entry.activity)) byActivity[entry.activity].changes += 1;
      seen.add(entry.activity);
    }
  }
  // Unrecorded changes are not zero minutes, so they stay out of the averages and the rate's numerator.
  const judged = recorded.length + unrecorded.length;
  const rate = judged ? recorded.length / judged : null;
  if (rate != null && rate < LOW_RECORDING_RATE) warnings.push(`記録率が低いため（${Math.round(rate * 100)}%）、合計と比率は人間の作業時間の一部しか表していません`);
  return {
    since,
    targets: judged + broken.length,
    recorded: { count: recorded.length, ids: recorded.map(change => change.id) },
    unrecorded: { count: unrecorded.length, ids: unrecorded },
    broken: { count: broken.length, changes: broken },
    recording_rate: rate,
    warnings,
    total_minutes: total,
    average_minutes_per_recorded_change: recorded.length ? total / recorded.length : null,
    by_activity: byActivity,
    by_risk_level: byLevel,
  };
}

function number(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function renderEffortTable(report) {
  const lines = ['# 人間の検証工数（archive 済みの統合 change）', ''];
  lines.push(`- 対象: ${report.targets} 件（${report.since ? `${report.since} 以降に archive` : '全期間'}）`);
  const average = report.average_minutes_per_recorded_change;
  lines.push(`- 記録あり: ${report.recorded.count} 件 / 合計 ${number(report.total_minutes)} 分 / 記録ありの change あたり平均 ${average == null ? '-' : `${number(average)} 分`}`);
  lines.push(`- 未記録: ${report.unrecorded.count} 件${report.unrecorded.count ? ` (${report.unrecorded.ids.join(', ')})` : ''}。0 分として合算せず、平均の分母にも入れない`);
  lines.push(`- 記録率: ${report.recording_rate == null ? '-' : `${Math.round(report.recording_rate * 100)}%`}`);
  lines.push(`- 破損: ${report.broken.count} 件`);
  for (const warning of report.warnings ?? []) lines.push('', `! ${warning}`);
  for (const [title, label, rows] of [['活動種別', '活動', report.by_activity], ['Risk Level', 'Risk Level', report.by_risk_level]]) {
    lines.push('', `## ${title}`, '', `| ${label} | 合計分 | 件数 | change 数 |`, '|---|---|---|---|');
    for (const [key, row] of Object.entries(rows)) lines.push(`| ${key} | ${number(row.minutes)} | ${row.entries} | ${row.changes} |`);
  }
  if (report.broken.count) {
    lines.push('', '## 破損（集計に含めていません）', '');
    for (const item of report.broken.changes) lines.push(`- ${item.id} (${item.archive}): ${item.reason}`);
  }
  return `${lines.join('\n')}\n`;
}

// exit code: 0=集計完了 / 1=破損があり集計が不完全 / 2=引数不正 / 3=内部エラー
export function runEffort({ repo, argv = [] }) {
  const opts = parseEffortArgs(argv);
  if (opts.error) return { exitCode: 2, stdout: '', stderr: `${opts.error}\n` };
  try {
    const report = buildEffort(repo, { since: opts.since });
    const stdout = opts.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderEffortTable(report);
    const stderr = report.broken.count ? `集計が不完全です: 集計対象を判定できない、または記録が破損した change が ${report.broken.count} 件あります (${report.broken.changes.map(item => item.id).join(', ')})\n` : '';
    return { exitCode: report.broken.count ? 1 : 0, stdout, stderr };
  } catch (err) {
    return { exitCode: 3, stdout: '', stderr: `工数集計の内部エラー:\n${err.stack ?? err}\n` };
  }
}
