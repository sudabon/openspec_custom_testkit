export const CRITICAL_FILES = [
  'scripts/qe-gate.sh',
  'scripts/qe-gate.mjs',
  'scripts/check-test-plan.sh',
  'scripts/check-test-plan.mjs',
  'scripts/e2e-report.mjs',
  'scripts/testkit-gate.mjs',
  'scripts/ci-job.mjs',
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
