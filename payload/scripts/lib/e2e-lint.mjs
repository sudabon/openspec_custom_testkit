// Public entry of the E2E convention lint. The implementation lives under ./e2e-lint/;
// importers and installed targets keep using this path.
export { analyzeSource, RULES, WEAK_MATCHERS } from './e2e-lint/analyze.mjs';
export { lintSource } from './e2e-lint/helpers.mjs';
export { formatLintReport, lintChange, lintRepo } from './e2e-lint/repo.mjs';
