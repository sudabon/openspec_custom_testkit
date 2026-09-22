import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_ROOT_DEFAULT, LEGACY_STAMPS, STAMP_FILE } from './critical.mjs';

export function readJsonIfExists(absPath) {
  if (!existsSync(absPath)) return { exists: false, data: null, broken: false };
  try {
    return { exists: true, data: JSON.parse(readFileSync(absPath, 'utf8')), broken: false, text: readFileSync(absPath) };
  } catch {
    return { exists: true, data: null, broken: true, text: readFileSync(absPath) };
  }
}

export function installedE2eRoot(repo) {
  const current = readJsonIfExists(join(repo, STAMP_FILE));
  if (current.broken) {
    const error = new Error(`${STAMP_FILE} が壊れています。黙って E2E root を移動しません。修復するか --e2e-root を指定してください。`);
    error.code = 'BROKEN_STAMP';
    throw error;
  }
  if (current.data?.e2eRoot) return String(current.data.e2eRoot);
  const legacy = readJsonIfExists(join(repo, LEGACY_STAMPS.e2e));
  if (!legacy.broken && legacy.data?.e2eRoot) return String(legacy.data.e2eRoot);
  return E2E_ROOT_DEFAULT;
}
