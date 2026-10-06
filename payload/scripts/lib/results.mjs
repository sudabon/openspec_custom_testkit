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

// Validate the fields consumed by both reporters; omitted optional arrays remain compatible.
export function validateResults(results) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const checkObject = (value, path) => {
    if (!object(value)) throw new Error(`${path} は object が必要です`);
  };
  const array = (value, path) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${path} は配列が必要です`);
    return value;
  };
  const string = (value, path) => {
    if (value !== undefined && typeof value !== 'string') throw new Error(`${path} は文字列が必要です`);
  };
  function suite(value, path) {
    checkObject(value, path);
    string(value.title, `${path}.title`);
    array(value.suites, `${path}.suites`).forEach((child, i) => suite(child, `${path}.suites[${i}]`));
    array(value.specs, `${path}.specs`).forEach((spec, i) => {
      const at = `${path}.specs[${i}]`;
      checkObject(spec, at);
      string(spec.title, `${at}.title`);
      array(spec.tags, `${at}.tags`).forEach((tag, n) => {
        if (typeof tag !== 'string') throw new Error(`${at}.tags[${n}] は文字列が必要です`);
      });
      array(spec.tests, `${at}.tests`).forEach((test, n) => {
        const where = `${at}.tests[${n}]`;
        checkObject(test, where);
        for (const field of ['status', 'expectedStatus', 'projectName']) string(test[field], `${where}.${field}`);
        array(test.results, `${where}.results`).forEach((attempt, j) => {
          checkObject(attempt, `${where}.results[${j}]`);
          for (const field of ['status', 'expectedStatus']) string(attempt[field], `${where}.results[${j}].${field}`);
        });
      });
    });
  }
  try {
    checkObject(results, 'results');
    if (!Array.isArray(results.suites)) throw new Error('suites は配列が必要です');
    results.suites.forEach((value, i) => suite(value, `suites[${i}]`));
    if (results.stats !== undefined) {
      checkObject(results.stats, 'stats');
      string(results.stats.startTime, 'stats.startTime');
      if (results.stats.duration !== undefined && typeof results.stats.duration !== 'number') throw new Error('stats.duration は数値が必要です');
    }
    const errors = array(results.errors, 'errors');
    if (errors.length) throw new Error(`errors: Playwright の実行エラーがあります: ${errors.map(error => object(error) ? error.message ?? error.value ?? JSON.stringify(error) : String(error)).join('; ')}`);
    return null;
  } catch (err) {
    return err.message;
  }
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
