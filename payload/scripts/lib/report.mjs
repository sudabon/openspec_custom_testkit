import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { TP_ID_IN_TEXT } from './ids.mjs';
import { escapeHtml, hasBoundedToken, markdownCell } from './markdown.mjs';
import { splitFrontmatter, utcDate } from './frontmatter.mjs';
import { projectsOf, testPlanHeaderErrors, testPlanRowErrors, tpRows } from './plan-check.mjs';
import { flakyVerdict, quarantineFor, tpLevels } from './flaky.mjs';
import { flakyFailLevels } from './policy.mjs';
import { flatten, formatAge, resultsFreshness, specMatches, tagTextOf, validateResults } from './results.mjs';

export { formatAge };

export function plannedIds(planText) {
  const frontmatter = splitFrontmatter(planText);
  if (frontmatter.has) {
    if (frontmatter.error) return { error: frontmatter.error, ids: [], applicability: 'unknown' };
    const value = frontmatter.data.e2e;
    if (value !== 'required' && value !== 'not-applicable') {
      return { error: `e2e の値が不正です: ${value}`, ids: [], applicability: 'unknown' };
    }
    // Frontmatter opts into structured plan parsing regardless of the change's schema.
    const headerErrors = testPlanHeaderErrors(planText);
    if (headerErrors.length) return { error: headerErrors.join('\n'), ids: [], applicability: value };
    const rowErrors = testPlanRowErrors(planText);
    if (rowErrors.length) return { error: rowErrors.join('\n'), ids: [], applicability: value };
    const rows = tpRows(planText);
    if (value === 'not-applicable') {
      if (rows.length) return { error: 'not-applicable なのに TP があります', ids: [], applicability: value };
      return { ids: [], applicability: 'not-applicable', projects: {} };
    }
    const projects = {};
    for (const row of rows) {
      const { projects: declared, blank } = projectsOf(row);
      if (blank) return { error: `${row['TP-ID']} の Projects に空の要素があります`, ids: [], applicability: value };
      if (declared.length) projects[row['TP-ID']] = [...new Set([...(projects[row['TP-ID']] ?? []), ...declared])];
    }
    return { ids: [...new Set(rows.map(row => row['TP-ID']))], applicability: 'required', projects };
  }
  const ids = [...planText.matchAll(TP_ID_IN_TEXT)].map(match => match[0]);
  return { ids: [...new Set(ids)], applicability: 'legacy', projects: {} };
}

// `integrated` enables the flaky policy (policyText + qualityText) and the quarantine list (quarantineText).
// Without it, flaky stays pass with ⚠ and quarantine rows only produce a warning.
export function buildReport({ changeId, planText, results, maxAge, now = Date.now(), format = 'text', publishRoot, maxRows, overflowRef, integrated = false, policyText = '', qualityText = null, quarantineText = null, quarantinePath = 'quarantine.md' }) {
  const classified = classify({ changeId, planText, results, maxAge, now, integrated, policyText, qualityText, quarantineText, quarantinePath });
  if (classified.error) return { exitCode: 2, stdout: '', stderr: classified.error };
  const stdout = format === 'summary'
    ? renderSummary(classified, { changeId, publishRoot, maxRows, overflowRef })
    : renderText(classified);
  return { exitCode: classified.exitCode, stdout, stderr: '' };
}

// Projects on which each planned TP has a passing attempt.
function passedProjects(rows) {
  const passedOn = new Map();
  for (const row of rows) {
    if (row.attempts === 0 || row.status !== 'pass') continue;
    for (const id of row.matched) {
      if (!passedOn.has(id)) passedOn.set(id, new Set());
      passedOn.get(id).add(row.project);
    }
  }
  return passedOn;
}

// Planned TPs without a passing run, and hints for TPs whose declared Projects did not all pass.
// A TP with declared Projects is covered only when every declared project has a passing attempt.
function coverageGaps(planned, rows, quarantined, invalidQuarantine) {
  const passedOn = passedProjects(rows);
  const gaps = [];
  const projectHints = [];
  for (const id of planned.ids) {
    if (quarantined.has(id)) continue;
    const invalid = invalidQuarantine.get(id);
    if (invalid) {
      gaps.push(`${id} (${invalidLabel(invalid)})`);
      continue;
    }
    const declared = planned.projects[id] ?? [];
    if (!declared.length) {
      if (!passedOn.has(id)) gaps.push(id);
      continue;
    }
    const gap = projectGap(id, declared, rows, passedOn.get(id) ?? new Set());
    if (!gap) continue;
    projectHints.push(...gap.hints);
    gaps.push(gap.text);
  }
  return { gaps, projectHints };
}

function projectGap(id, declared, rows, passed) {
  const lacking = declared.filter(project => !passed.has(project));
  if (!lacking.length) return null;
  const hints = [];
  const ran = new Set(rows.filter(row => row.matched.includes(id) && row.attempts > 0).map(row => row.project));
  const notRun = lacking.filter(project => !ran.has(project));
  if (notRun.length) hints.push(`${id}: Projects の指定 (${notRun.join(', ')}) と Playwright の project 名・実行対象・skip 条件を確認してください`);
  const notPassed = lacking.filter(project => ran.has(project));
  const skipped = notPassed.filter(project => {
    const attempts = rows.filter(row => row.matched.includes(id) && row.project === project && row.attempts > 0);
    return attempts.every(row => row.status === 'skip');
  });
  if (skipped.length) hints.push(`${id}: ${skipped.join(', ')} は skip のみです。skip 条件を確認してください`);
  const detail = [notPassed.length ? `${notPassed.join(', ')} 未pass` : '', notRun.length ? `${notRun.join(', ')} 未実行` : ''].filter(Boolean).join(', ');
  return { hints, text: `${id} (${detail})` };
}

// Classification and the exit code are shared by every format so that what is shown never drifts from what is judged.
function classify({ changeId, planText, results, maxAge, now, integrated, policyText, qualityText, quarantineText, quarantinePath }) {
  if (maxAge != null && (!Number.isFinite(maxAge) || maxAge < 0)) {
    return { error: 'max-age には 0 以上の秒数を指定してください\n' };
  }
  const planned = plannedIds(planText);
  if (planned.error) return { error: planned.error + '\n' };
  const flakyPolicy = integrated ? flakyFailLevels(policyText) : { levels: [], error: null };
  if (flakyPolicy.error) return { error: flakyPolicy.error + '\n' };
  const invalid = validateResults(results);
  if (invalid) return { error: `Playwright JSON が不正です: ${invalid}\n` };

  const freshness = resultsFreshness(results, maxAge, now);
  if (freshness.error) return { error: freshness.error };
  const { startTimeRaw, ageSec } = freshness;

  const rows = flatten(results)
    .filter(row => hasBoundedToken(tagTextOf(row.spec), changeId))
    .map(row => ({
      ...row,
      matched: planned.ids.filter(id => specMatches(row.spec, changeId, id)),
    }));
  const quarantine = quarantineFor(quarantineText, { changeId, plannedIds: planned.ids, qualityText, today: utcDate(now) });
  const quarantined = new Map(integrated ? quarantine.active.map(entry => [entry.tp, entry]) : []);
  const invalidQuarantine = new Map(integrated ? quarantine.invalid.map(entry => [entry.tp, entry]) : []);
  const { gaps, projectHints } = planned.applicability !== 'not-applicable'
    ? coverageGaps(planned, rows, quarantined, invalidQuarantine)
    : { gaps: [], projectHints: [] };
  const flakyLines = judgeFlaky(rows, flakyPolicy.levels, planText, qualityText, quarantined);
  const quarantineLines = integrated
    ? quarantineReport(quarantine, rows, quarantinePath)
    : legacyQuarantine(quarantine, changeId);
  const count = status => rows.filter(row => row.status === status).length;
  const failed = count('fail');
  const noRequiredTp = planned.applicability === 'required' && planned.ids.length === 0;
  let exitCode = 0;
  if (failed > 0 || rows.some(row => row.flakyVerdict?.fail)) exitCode = 3;
  else if (gaps.length || noRequiredTp) exitCode = 1;
  return {
    rows,
    missing: gaps,
    projectHints,
    flakyLines,
    quarantineLines,
    noRequiredTp,
    startTimeRaw,
    ageSec,
    durationSec: results.stats?.duration != null ? (results.stats.duration / 1000).toFixed(1) : '?',
    totals: `合計 ${rows.length} 件: pass ${count('pass')} / fail ${failed} / skip ${count('skip')} / フレーク ${rows.filter(row => row.flaky).length}`,
    exitCode,
  };
}

// Only passing flaky rows with a TP are judged; the result column stays pass and the flaky column carries the verdict.
function judgeFlaky(rows, failLevels, planText, qualityText, quarantined) {
  if (!failLevels.length) return [];
  const levels = tpLevels(planText, qualityText);
  const lines = [];
  const policy = `flaky_fail_levels [${failLevels.join(', ')}]`;
  for (const row of rows) {
    // Quarantined TPs are not coverage, so their flakiness does not decide the run either.
    const judged = row.matched.filter(id => !quarantined.has(id));
    if (!row.flaky || row.status !== 'pass' || !judged.length) continue;
    const verdict = flakyVerdict(judged, levels, failLevels);
    row.flakyVerdict = verdict;
    const ids = judged.join(',');
    const label = row.project ? `${row.title} [${row.project}]` : row.title;
    if (!verdict.level) lines.push(`✗ フレーク不合格: ${ids} (Level 解決不能) ${label} — ${verdict.reason}。解決できない TP の flaky は不合格として扱います`);
    else if (verdict.fail) lines.push(`✗ フレーク不合格: ${ids} (${verdict.level}) ${label} — リトライ後に成功したため、${policy} により不合格です`);
    else lines.push(`⚠ フレーク警告: ${ids} (${verdict.level}) ${label} — ${policy} の対象外のため coverage に数えます`);
  }
  return lines;
}

function invalidLabel(entry) {
  return entry.expired ? `隔離の期限切れ: 期限 ${entry.due} / 担当 ${entry.owner}` : `隔離の行が無効: ${entry.problems.join(' / ')}`;
}

function quarantineReport({ active, invalid, warnings }, rows, path) {
  const lines = [];
  if (active.length) {
    lines.push(`隔離中: ${active.length} 件（coverage に数えません。一覧は ${path}）`);
    for (const entry of active) lines.push(`  ${entry.tp} 担当 ${entry.owner} / 期限 ${entry.due} / 代替 ${entry.alternative} / 理由 ${entry.reason}`);
    for (const entry of active) {
      if (rows.some(row => row.matched.includes(entry.tp) && row.attempts > 0 && row.status === 'pass')) {
        lines.push(`  ${entry.tp} は実行されて pass しましたが、隔離中のため coverage に数えません。解除は quarantine.md の行を削除して行います`);
      }
    }
  }
  for (const entry of invalid) {
    lines.push(entry.expired
      ? `⚠ 隔離の期限切れ: ${entry.tp} (期限 ${entry.due} / 担当 ${entry.owner})`
      : `⚠ 隔離リストの行が無効です: ${entry.tp} (${entry.problems.join(' / ')})`);
  }
  for (const warning of warnings) lines.push(`⚠ ${warning}`);
  return lines;
}

function legacyQuarantine({ active, invalid }, changeId) {
  const listed = [...active, ...invalid].filter(entry => entry.change === changeId).map(entry => entry.tp);
  return listed.length ? [`⚠ 旧 schema の change には隔離リストを適用しません: ${[...new Set(listed)].join(', ')}`] : [];
}

function flakyCell(row) {
  if (!row.flaky) return '';
  const verdict = row.flakyVerdict;
  if (!verdict) return '⚠';
  if (!verdict.level) return '⚠ 不合格（Level 解決不能）';
  return verdict.fail ? `⚠ 不合格（${verdict.level}）` : `⚠ 警告（${verdict.level}）`;
}

function startedLine({ startTimeRaw, ageSec, durationSec }) {
  return `実行開始: ${startTimeRaw ?? '不明'}${ageSec != null ? ` (${formatAge(ageSec)}前)` : ''} / 所要 ${durationSec}s`;
}

function renderText(report) {
  const { rows, missing, projectHints, noRequiredTp } = report;
  const multiProject = new Set(rows.map(row => row.project)).size > 1;
  const lines = [];
  lines.push(startedLine(report));
  lines.push('');
  lines.push('| TP-ID | テスト | 結果 | フレーク |');
  lines.push('|-------|-------|------|---------|');
  for (const row of rows) {
    const title = multiProject && row.project ? `${row.title} [${row.project}]` : row.title;
    lines.push(`| ${row.matched.join(',') || '-'} | ${title} | ${row.status} | ${flakyCell(row)} |`);
  }
  lines.push('');
  lines.push(report.totals);
  if (report.flakyLines.length) lines.push('', ...report.flakyLines);
  if (report.quarantineLines.length) lines.push('', ...report.quarantineLines);
  if (missing.length) lines.push('', `⚠ カバレッジ欠落: ${missing.join(', ')} に対応するテストが未実装/未実行`);
  for (const hint of projectHints) lines.push(`  ${hint}`);
  if (noRequiredTp) lines.push('', '⚠ カバレッジ欠落: required の TP が 0 件です');
  return `${lines.join('\n')}\n`;
}

function renderSummary(report, { changeId, publishRoot, maxRows, overflowRef }) {
  const { rows, missing, projectHints, noRequiredTp } = report;
  const lines = [`### ${cell(changeId)}`, '', startedLine(report), report.totals];
  for (const line of [...report.flakyLines, ...report.quarantineLines]) lines.push(cell(line));
  if (missing.length) lines.push(`⚠ カバレッジ欠落: ${missing.join(', ')} に対応するテストが未実装/未実行`);
  for (const hint of projectHints) lines.push(`  ${cell(hint)}`);
  if (noRequiredTp) lines.push('⚠ カバレッジ欠落: required の TP が 0 件です');
  if (!missing.length && !noRequiredTp) lines.push('カバレッジ欠落: なし');
  lines.push('');
  lines.push('| TP-ID | テスト | project | 結果 | フレーク | 添付 |');
  lines.push('|-------|--------|---------|------|----------|------|');
  const shown = maxRows != null ? rows.slice(0, maxRows) : rows;
  for (const row of shown) {
    const attachments = attachmentRefs(row, publishRoot);
    lines.push(`| ${row.matched.join(',') || '-'} | ${cell(row.title)} | ${cell(row.project) || '-'} | ${row.status} | ${flakyCell(row)} | ${attachments.join('<br>') || '添付なし'} |`);
  }
  if (shown.length < rows.length) {
    lines.push('', `残り ${rows.length - shown.length} 件は artifact 内の <code>${cell(overflowRef ?? `${changeId}.summary.md`)}</code> を参照してください。`);
  }
  return `${lines.join('\n')}\n`;
}

const FAILED_ATTEMPT = new Set(['failed', 'timedOut', 'interrupted']);

// Attachments from failed attempts and the last attempt. Only paths under the publish root are shown, relative to it;
// inline bodies are named but never printed.
function attachmentRefs(row, publishRoot) {
  const attempts = row.attemptResults ?? [];
  const picked = attempts.filter((attempt, i) => i === attempts.length - 1 || FAILED_ATTEMPT.has(attempt?.status));
  const root = publishRoot ? canonical(resolve(publishRoot)) : null;
  const refs = [];
  for (const attempt of picked) {
    for (const attachment of Array.isArray(attempt?.attachments) ? attempt.attachments : []) {
      if (!attachment || typeof attachment !== 'object') continue;
      const name = cell(typeof attachment.name === 'string' && attachment.name ? attachment.name : '添付');
      if (typeof attachment.path !== 'string' || !attachment.path) {
        if (attachment.body !== undefined) refs.push(`${name}: 本文添付（内容は非表示）`);
        continue;
      }
      const abs = root ? canonical(resolve(root, attachment.path)) : null;
      if (!abs || (abs !== root && !abs.startsWith(root + sep))) {
        refs.push(`${name}: 公開対象外`);
        continue;
      }
      const rel = `<code>${cell(relative(root, abs).split(sep).join('/'))}</code>`;
      refs.push(existsSync(abs) ? `${name}: ${rel}` : `${name}: ${rel}（ファイルなし）`);
    }
  }
  return refs;
}

// Resolve symlinks (e.g. /var -> /private/var) so containment is judged on real locations, even for missing files.
function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonical(parent), basename(path));
  }
}

// Keep untrusted titles and names inside one Markdown table cell and out of raw HTML.
function cell(value) {
  return markdownCell(escapeHtml(value).replace(/`/g, '&#96;').replace(/\s*[\r\n]+\s*/g, ' '));
}

const FORMATS = ['text', 'summary'];

export function parseReporterArgs(argv) {
  const positional = [];
  let maxAge = null;
  let help = false;
  let format = 'text';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') help = true;
    else if (arg === '--max-age' || arg.startsWith('--max-age=')) {
      const raw = arg.includes('=') ? arg.slice('--max-age='.length) : argv[++i];
      maxAge = Number(raw);
      if (!Number.isFinite(maxAge) || maxAge < 0) return { error: `--max-age には 0 以上の秒数を指定してください: ${raw}` };
    } else if (arg === '--format' || arg.startsWith('--format=')) {
      const raw = arg.includes('=') ? arg.slice('--format='.length) : argv[++i];
      if (!FORMATS.includes(raw)) return { error: `--format には ${FORMATS.join(' または ')} を指定してください: ${raw ?? ''}` };
      format = raw;
    } else positional.push(arg);
  }
  return { help, maxAge, changeId: positional[0] ?? '', resultsPath: positional[1] ?? 'test-results/e2e-results.json', format };
}
