import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { hasBoundedToken } from './markdown.mjs';
import { splitFrontmatter } from './frontmatter.mjs';
import { projectsOf, testPlanHeaderErrors, testPlanRowErrors, tpRows } from './plan-check.mjs';
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
  const ids = [...planText.matchAll(/TP-\d{3}(?!\d)/g)].map(match => match[0]);
  return { ids: [...new Set(ids)], applicability: 'legacy', projects: {} };
}

export function buildReport({ changeId, planText, results, maxAge, now = Date.now(), format = 'text', publishRoot, maxRows, overflowRef }) {
  const classified = classify({ changeId, planText, results, maxAge, now });
  if (classified.error) return { exitCode: 2, stdout: '', stderr: classified.error };
  const stdout = format === 'summary'
    ? renderSummary(classified, { changeId, publishRoot, maxRows, overflowRef })
    : renderText(classified);
  return { exitCode: classified.exitCode, stdout, stderr: '' };
}

// Classification and the exit code are shared by every format so that what is shown never drifts from what is judged.
function classify({ changeId, planText, results, maxAge, now }) {
  if (maxAge != null && (!Number.isFinite(maxAge) || maxAge < 0)) {
    return { error: 'max-age には 0 以上の秒数を指定してください\n' };
  }
  const planned = plannedIds(planText);
  if (planned.error) return { error: planned.error + '\n' };
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
  const covered = new Set();
  const passedOn = new Map();
  for (const row of rows) {
    if (row.attempts === 0) continue;
    if (row.status !== 'pass') continue;
    for (const id of row.matched) {
      covered.add(id);
      if (!passedOn.has(id)) passedOn.set(id, new Set());
      passedOn.get(id).add(row.project);
    }
  }
  // A TP with declared Projects is covered only when every declared project has a passing attempt.
  const gaps = [];
  const projectHints = [];
  if (planned.applicability !== 'not-applicable') {
    for (const id of planned.ids) {
      const declared = planned.projects[id] ?? [];
      if (!declared.length) {
        if (!covered.has(id)) gaps.push(id);
        continue;
      }
      const passed = passedOn.get(id) ?? new Set();
      const ran = new Set(rows.filter(row => row.matched.includes(id) && row.attempts > 0).map(row => row.project));
      const lacking = declared.filter(project => !passed.has(project));
      if (!lacking.length) continue;
      const notRun = lacking.filter(project => !ran.has(project));
      if (notRun.length) projectHints.push(`${id}: Projects の指定 (${notRun.join(', ')}) と Playwright の project 名・実行対象・skip 条件を確認してください`);
      const notPassed = lacking.filter(project => ran.has(project));
      const skipped = notPassed.filter(project => {
        const attempts = rows.filter(row => row.matched.includes(id) && row.project === project && row.attempts > 0);
        return attempts.every(row => row.status === 'skip');
      });
      if (skipped.length) projectHints.push(`${id}: ${skipped.join(', ')} は skip のみです。skip 条件を確認してください`);
      const detail = [notPassed.length ? `${notPassed.join(', ')} 未pass` : '', notRun.length ? `${notRun.join(', ')} 未実行` : ''].filter(Boolean).join(', ');
      gaps.push(`${id} (${detail})`);
    }
  }
  const count = status => rows.filter(row => row.status === status).length;
  const failed = count('fail');
  const noRequiredTp = planned.applicability === 'required' && planned.ids.length === 0;
  let exitCode = 0;
  if (failed > 0) exitCode = 3;
  else if (gaps.length || noRequiredTp) exitCode = 1;
  return {
    rows,
    missing: gaps,
    projectHints,
    noRequiredTp,
    startTimeRaw,
    ageSec,
    durationSec: results.stats?.duration != null ? (results.stats.duration / 1000).toFixed(1) : '?',
    totals: `合計 ${rows.length} 件: pass ${count('pass')} / fail ${failed} / skip ${count('skip')} / フレーク ${rows.filter(row => row.flaky).length}`,
    exitCode,
  };
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
    lines.push(`| ${row.matched.join(',') || '-'} | ${title} | ${row.status} | ${row.flaky ? '⚠' : ''} |`);
  }
  lines.push('');
  lines.push(report.totals);
  if (missing.length) lines.push('', `⚠ カバレッジ欠落: ${missing.join(', ')} に対応するテストが未実装/未実行`);
  for (const hint of projectHints) lines.push(`  ${hint}`);
  if (noRequiredTp) lines.push('', '⚠ カバレッジ欠落: required の TP が 0 件です');
  return `${lines.join('\n')}\n`;
}

function renderSummary(report, { changeId, publishRoot, maxRows, overflowRef }) {
  const { rows, missing, projectHints, noRequiredTp } = report;
  const lines = [`### ${cell(changeId)}`, '', startedLine(report), report.totals];
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
    lines.push(`| ${row.matched.join(',') || '-'} | ${cell(row.title)} | ${cell(row.project) || '-'} | ${row.status} | ${row.flaky ? '⚠' : ''} | ${attachments.join('<br>') || '添付なし'} |`);
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
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '&#96;')
    .replace(/\|/g, '\\|')
    .replace(/\s*[\r\n]+\s*/g, ' ');
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
