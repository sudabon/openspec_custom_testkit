import { hasBoundedToken } from './markdown.mjs';
import { splitFrontmatter } from './frontmatter.mjs';
import { tpRows } from './plan-check.mjs';
import { flatten, formatAge, resultsFreshness, specMatches, tagTextOf } from './results.mjs';

export { formatAge };

export function plannedIds(planText) {
  const frontmatter = splitFrontmatter(planText);
  if (frontmatter.has) {
    if (frontmatter.error) return { error: frontmatter.error, ids: [], applicability: 'unknown' };
    const value = frontmatter.data.e2e;
    if (value !== 'required' && value !== 'not-applicable') {
      return { error: `e2e の値が不正です: ${value}`, ids: [], applicability: 'unknown' };
    }
    if (value === 'not-applicable') return { ids: [], applicability: 'not-applicable' };
    const ids = tpRows(planText).map(row => row['TP-ID']);
    return { ids: [...new Set(ids)], applicability: 'required' };
  }
  const ids = [...planText.matchAll(/TP-\d{3}(?!\d)/g)].map(match => match[0]);
  return { ids: [...new Set(ids)], applicability: 'legacy' };
}

export function buildReport({ changeId, planText, results, maxAge, now = Date.now() }) {
  if (maxAge != null && (!Number.isFinite(maxAge) || maxAge < 0)) {
    return { exitCode: 2, stdout: '', stderr: 'max-age には 0 以上の秒数を指定してください\n' };
  }
  const planned = plannedIds(planText);
  if (planned.error) return { exitCode: 2, stdout: '', stderr: planned.error + '\n' };
  if (!results || typeof results !== 'object') return { exitCode: 2, stdout: '', stderr: 'Playwright JSON が不正です\n' };

  const freshness = resultsFreshness(results, maxAge, now);
  if (freshness.error) return { exitCode: 2, stdout: '', stderr: freshness.error };
  const { startTimeRaw, ageSec } = freshness;

  const rows = flatten(results)
    .filter(row => hasBoundedToken(tagTextOf(row.spec), changeId))
    .map(row => ({
      ...row,
      matched: planned.ids.filter(id => specMatches(row.spec, changeId, id)),
    }));
  const covered = new Set();
  for (const row of rows) {
    if (row.attempts === 0) continue;
    if (row.status !== 'pass') continue;
    for (const id of row.matched) covered.add(id);
  }
  const missing = planned.applicability === 'not-applicable' ? [] : planned.ids.filter(id => !covered.has(id));
  const multiProject = new Set(rows.map(row => row.project)).size > 1;
  const durationSec = results.stats?.duration != null ? (results.stats.duration / 1000).toFixed(1) : '?';
  const lines = [];
  lines.push(`実行開始: ${startTimeRaw ?? '不明'}${ageSec != null ? ` (${formatAge(ageSec)}前)` : ''} / 所要 ${durationSec}s`);
  lines.push('');
  lines.push('| TP-ID | テスト | 結果 | フレーク |');
  lines.push('|-------|-------|------|---------|');
  for (const row of rows) {
    const title = multiProject && row.project ? `${row.title} [${row.project}]` : row.title;
    lines.push(`| ${row.matched.join(',') || '-'} | ${title} | ${row.status} | ${row.flaky ? '⚠' : ''} |`);
  }
  const count = status => rows.filter(row => row.status === status).length;
  const failed = count('fail');
  lines.push('');
  lines.push(`合計 ${rows.length} 件: pass ${count('pass')} / fail ${failed} / skip ${count('skip')} / フレーク ${rows.filter(row => row.flaky).length}`);
  if (missing.length) lines.push('', `⚠ カバレッジ欠落: ${missing.join(', ')} に対応するテストが未実装/未実行`);
  if (planned.applicability === 'required' && planned.ids.length === 0) {
    lines.push('', '⚠ カバレッジ欠落: required の TP が 0 件です');
  }
  let exitCode = 0;
  if (failed > 0) exitCode = 3;
  else if (missing.length || (planned.applicability === 'required' && planned.ids.length === 0)) exitCode = 1;
  return { exitCode, stdout: `${lines.join('\n')}\n`, stderr: '' };
}

export function parseReporterArgs(argv) {
  const positional = [];
  let maxAge = null;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') help = true;
    else if (arg === '--max-age' || arg.startsWith('--max-age=')) {
      const raw = arg.includes('=') ? arg.slice('--max-age='.length) : argv[++i];
      maxAge = Number(raw);
      if (!Number.isFinite(maxAge) || maxAge < 0) return { error: `--max-age には 0 以上の秒数を指定してください: ${raw}` };
    } else positional.push(arg);
  }
  return { help, maxAge, changeId: positional[0] ?? '', resultsPath: positional[1] ?? 'test-results/e2e-results.json' };
}
