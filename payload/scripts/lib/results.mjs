import { hasBoundedToken } from './markdown.mjs';

// Shared by the per-change reporter and the coverage map so both classify attempts identically.
export const STATUS_LABEL = { expected: 'pass', unexpected: 'fail', flaky: 'pass', skipped: 'skip' };

export function tagTextOf(spec) {
  return [...(spec.tags ?? []), spec.title ?? ''].join(' ');
}

export function specMatches(spec, changeId, tpId) {
  const tagText = tagTextOf(spec);
  return hasBoundedToken(tagText, changeId) && hasBoundedToken(tagText, tpId);
}

export function flatten(results) {
  const rows = [];
  function walk(suite, depth, titlePath) {
    const path = depth === 0 ? titlePath : [...titlePath, suite.title].filter(Boolean);
    for (const child of suite.suites ?? []) walk(child, depth + 1, path);
    for (const spec of suite.specs ?? []) {
      const title = [...path, spec.title].filter(Boolean).join(' › ');
      for (const test of spec.tests ?? []) {
        const attempts = test.results ?? [];
        const raw = attempts.length === 0 ? 'no-attempt' : (test.status ?? attempts.at(-1)?.status ?? 'unknown');
        const expectedStatus = test.expectedStatus ?? attempts.at(-1)?.expectedStatus ?? 'passed';
        const attemptPassed = attempts.some(attempt => expectedStatus !== 'failed' && (attempt.status === 'passed' || attempt.status === 'expected' || attempt.status === 'flaky'));
        let status = STATUS_LABEL[raw] ?? raw;
        if (status === 'pass' && expectedStatus === 'failed') status = 'expected-fail';
        else if (status === 'pass' && !attemptPassed) status = 'fail';
        rows.push({
          spec,
          title,
          project: test.projectName || '',
          status,
          flaky: raw === 'flaky',
          attempts: attempts.length,
          raw,
        });
      }
    }
  }
  for (const suite of results.suites ?? []) walk(suite, 0, []);
  return rows;
}

export function formatAge(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}分`;
  return `${(seconds / 3600).toFixed(1)}時間`;
}

// Returns { startTimeRaw, ageSec } or { error } when --max-age cannot be honoured.
export function resultsFreshness(results, maxAge, now = Date.now()) {
  const startTimeRaw = results.stats?.startTime;
  const startTime = startTimeRaw ? new Date(startTimeRaw) : null;
  const ageSec = startTime && !Number.isNaN(startTime.getTime()) ? (now - startTime.getTime()) / 1000 : null;
  if (maxAge != null) {
    if (ageSec == null) {
      return { error: '実行開始時刻(stats.startTime)がありません。鮮度を検証できないため中断します。\n' };
    }
    if (ageSec > maxAge) {
      return {
        error: `実行開始が ${formatAge(ageSec)}前で、--max-age ${maxAge} 秒を超えています。\n前の周の結果を読んでいる可能性があります。今回の Playwright 実行が JSON を書けたか確認してください。\n`,
      };
    }
  }
  return { startTimeRaw, ageSec };
}
