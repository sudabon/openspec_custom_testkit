import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { byteCompare, sha256 } from './hash.mjs';

function listFiles(repo, oraclePath) {
  const rel = String(oraclePath).replace(/\\/g, '/').replace(/\/+$/, '');
  const abs = join(repo, rel);
  let rootStat;
  try {
    rootStat = lstatSync(abs);
  } catch {
    return { error: 'MISSING', path: rel };
  }
  const files = [];
  const addFile = fileRel => {
    files.push(fileRel.split('\\').join('/'));
  };
  const walk = (dirAbs, dirRel) => {
    for (const name of readdirSync(dirAbs)) {
      const childAbs = join(dirAbs, name);
      const childRel = `${dirRel}/${name}`;
      const listed = lstatSync(childAbs);
      if (listed.isSymbolicLink()) {
        if (statSync(childAbs).isFile()) addFile(childRel);
        continue;
      }
      if (listed.isDirectory()) walk(childAbs, childRel);
      else if (listed.isFile()) addFile(childRel);
    }
  };
  if (rootStat.isSymbolicLink()) {
    if (!statSync(abs).isFile()) return { error: 'MISSING', path: rel };
    addFile(rel);
  } else if (rootStat.isDirectory()) walk(abs, rel);
  else if (rootStat.isFile()) addFile(rel);
  else return { error: 'MISSING', path: rel };
  files.sort(byteCompare);
  return { files };
}

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
  for (const rel of files) body += `${sha256(readFileSync(join(repo, rel)))}  ${rel}\n`;
  return { digest: `sha256:${sha256(body)}`, files };
}

export function manifestDigest(repo, oraclePaths) {
  const paths = (oraclePaths ?? []).map(path => String(path).trim()).filter(Boolean);
  if (paths.length === 0) return { digest: '', empty: true, error: 'empty' };
  const files = [];
  for (const path of paths) {
    const listed = listFiles(repo, path);
    if (listed.error) return listed;
    files.push(...listed.files);
  }
  if (files.length === 0) return { digest: '', empty: true, error: 'empty' };
  const rolling = createHash('sha256');
  for (const rel of files) {
    const pathBytes = Buffer.from(rel, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(pathBytes.length);
    const contentHash = createHash('sha256').update(readFileSync(join(repo, rel))).digest();
    rolling.update(length);
    rolling.update(pathBytes);
    rolling.update(contentHash);
  }
  return { digest: `manifest-sha256:${rolling.digest('hex')}`, files };
}

export function digestForSchema(repo, schema, oraclePaths) {
  if (schema === 'quality-driven-e2e') return manifestDigest(repo, oraclePaths);
  return legacyDigest(repo, oraclePaths);
}
