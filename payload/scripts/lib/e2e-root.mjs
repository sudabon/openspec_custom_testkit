import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_ROOT_DEFAULT, LEGACY_STAMPS, STAMP_FILE } from './critical.mjs';

export function readJsonIfExists(absPath) {
  if (!existsSync(absPath)) return { exists: false, data: null, broken: false };
  const text = readFileSync(absPath);
  try {
    return { exists: true, data: JSON.parse(text.toString('utf8')), broken: false, text };
  } catch {
    return { exists: true, data: null, broken: true, text };
  }
}

export function normalizeE2eRoot(value) {
  const slashed = String(value).trim().replace(/\\/g, '/');
  if (!slashed) throw new Error('E2E ルートが空です');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    throw new Error(`E2E ルートは target 相対で指定してください: ${value}`);
  }
  const parts = slashed.split('/').filter(part => part && part !== '.');
  if (parts.includes('..')) throw new Error(`E2E ルートに '..' は使えません: ${value}`);
  if (!parts.length) throw new Error(`E2E ルートにリポジトリ直下は指定できません: ${value}`);
  return parts.join('/');
}

function brokenStamp(message) {
  const error = new Error(message);
  error.code = 'BROKEN_STAMP';
  return error;
}

function storedRoot(file, value) {
  try {
    return normalizeE2eRoot(value);
  } catch (err) {
    throw brokenStamp(`${file} の e2eRoot が不正です (${err.message})。修復するか --e2e-root を指定して再導入してください。`);
  }
}

export function installedE2eRoot(repo) {
  const current = readJsonIfExists(join(repo, STAMP_FILE));
  if (current.broken) {
    throw brokenStamp(`${STAMP_FILE} が壊れています。黙って E2E root を移動しません。修復するか --e2e-root を指定してください。`);
  }
  if (current.data?.e2eRoot) return storedRoot(STAMP_FILE, current.data.e2eRoot);
  const legacy = readJsonIfExists(join(repo, LEGACY_STAMPS.e2e));
  if (!legacy.broken && legacy.data?.e2eRoot) return storedRoot(LEGACY_STAMPS.e2e, legacy.data.e2eRoot);
  return E2E_ROOT_DEFAULT;
}
