export const CRITICAL_FILES = [
  'scripts/qe-gate.sh',
  'scripts/qe-gate.mjs',
  'scripts/check-test-plan.sh',
  'scripts/check-test-plan.mjs',
  'scripts/e2e-report.mjs',
  'scripts/testkit-gate.mjs',
  'scripts/ci-job.mjs',
];

// Modules added after the first release. An older stamp that does not record them means
// the target still runs a previous kit, so doctor reports it as incomplete.
export const REQUIRED_MODULES = [
  'scripts/lib/e2e-lint.mjs',
  'scripts/lib/e2e-lint/analyze.mjs',
  'scripts/lib/e2e-lint/declarations.mjs',
  'scripts/lib/e2e-lint/helpers.mjs',
  'scripts/lib/e2e-lint/lexer.mjs',
  'scripts/lib/e2e-lint/repo.mjs',
  'scripts/lib/e2e-lint/tokens.mjs',
  'scripts/lib/results.mjs',
  'scripts/lib/coverage-map.mjs',
  'scripts/lib/qa-handoff.mjs',
  'scripts/lib/flaky.mjs',
  'scripts/lib/registry.mjs',
  'scripts/lib/effort.mjs',
  'scripts/lib/changes.mjs',
  'scripts/lib/change-metadata.mjs',
  'scripts/lib/ids.mjs',
  'scripts/lib/entry.mjs',
  'scripts/lib/seal.mjs',
];

export function isCritical(rel) {
  return CRITICAL_FILES.includes(rel) || rel.startsWith('scripts/lib/');
}

export const FORK_BASE = '1.13.1';
export const STAMP_FILE = '.openspec-custom-testkit.json';
export const LEGACY_STAMPS = {
  qe: '.openspec-quality-kit.json',
  e2e: '.openspec-e2e-kit.json',
};
export const SCHEMA_INTEGRATED = 'quality-driven-e2e';
export const SCHEMA_QE = 'quality-driven';
export const SCHEMA_E2E = 'spec-driven-e2e';
export const E2E_ROOT_DEFAULT = 'tests/e2e';

export function isIntegratedChange(change) {
  return change?.schema === SCHEMA_INTEGRATED || change?.scope === 'integrated';
}

export function isE2eRequired(change) {
  return change?.e2e === 'required' || change?.schema === SCHEMA_E2E;
}
