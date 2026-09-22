import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileError, listFiles } from './files.mjs';
import { join } from 'node:path';
import { SCHEMA_INTEGRATED } from './critical.mjs';
import { byteCompare, sha256 } from './hash.mjs';

export function legacyDigest(repo, oraclePaths) {
  const paths = (oraclePaths ?? []).map(path => String(path).trim()).filter(Boolean);
  if (paths.length === 0) return { digest: '', empty: true };
  const listed = [];
  for (const path of paths) {
    const result = listFiles(repo, path);
    if (result.error) return result;
    listed.push(...result.files);
  }
  if (listed.length === 0) return { digest: '', empty: true };
  const hashes = new Map();
  for (const rel of listed) {
    if (hashes.has(rel)) continue;
    try { hashes.set(rel, sha256(readFileSync(join(repo, rel)))); }
    catch (error) { return fileError(error, rel); }
  }
  const digestOf = rels => `sha256:${sha256(rels.map(rel => `${hashes.get(rel)}  ${rel}\n`).join(''))}`;
  const files = [...hashes.keys()].sort(byteCompare);
  if (files.length === listed.length) return { digest: digestOf(files), files };
  // upstream qe-gate.sh hashes a file once for every oracle_path that contains it; keep accepting its seals.
  return { digest: digestOf(files), files, compatDigest: digestOf(listed.sort(byteCompare)) };
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
