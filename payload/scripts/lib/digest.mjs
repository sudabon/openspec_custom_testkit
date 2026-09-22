import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileError, listFiles } from './files.mjs';
import { join } from 'node:path';
import { SCHEMA_INTEGRATED } from './critical.mjs';
import { byteCompare, sha256 } from './hash.mjs';

export function legacyDigest(repo, oraclePaths) {
  const paths = (oraclePaths ?? []).map(path => String(path).trim()).filter(Boolean);
  if (paths.length === 0) return { digest: '', empty: true };
  const files = [];
  for (const path of paths) {
    const listed = listFiles(repo, path);
    if (listed.error) return listed;
    files.push(...listed.files);
  }
  files.sort(byteCompare);
  if (files.length === 0) return { digest: '', empty: true };
  let body = '';
  for (const rel of files) {
    try { body += `${sha256(readFileSync(join(repo, rel)))}  ${rel}\n`; }
    catch (error) { return fileError(error, rel); }
  }
  return { digest: `sha256:${sha256(body)}`, files };
}

export function manifestDigest(repo, oraclePaths) {
  const paths = (oraclePaths ?? []).map(path => String(path).trim()).filter(Boolean);
  if (paths.length === 0) return { digest: '', empty: true, error: 'empty' };
  const fileSet = new Set();
  for (const path of paths) {
    const listed = listFiles(repo, path);
    if (listed.error) return listed;
    for (const file of listed.files) fileSet.add(file);
  }
  const files = [...fileSet].sort(byteCompare);
  if (files.length === 0) return { digest: '', empty: true, error: 'empty' };
  const rolling = createHash('sha256');
  for (const rel of files) {
    const pathBytes = Buffer.from(rel, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(pathBytes.length);
    let contentHash;
    try { contentHash = createHash('sha256').update(readFileSync(join(repo, rel))).digest(); }
    catch (error) { return fileError(error, rel); }
    rolling.update(length);
    rolling.update(pathBytes);
    rolling.update(contentHash);
  }
  return { digest: `manifest-sha256:${rolling.digest('hex')}`, files };
}

export function digestForSchema(repo, schema, oraclePaths) {
  if (schema === SCHEMA_INTEGRATED) return manifestDigest(repo, oraclePaths);
  return legacyDigest(repo, oraclePaths);
}
