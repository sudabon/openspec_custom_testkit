import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { byteCompare } from './hash.mjs';

export function fileError(error, path) {
  return { error: error.code === 'ENOENT' ? 'MISSING' : 'UNREADABLE', path, code: error.code ?? 'UNKNOWN' };
}

// Follow directory links while retaining logical paths for digest manifests.
// Only ancestor cycles are skipped; aliases at different paths remain distinct.
export function listFiles(repo, root, { optional = false } = {}) {
  const rel = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
  try {
    lstatSync(join(repo, rel));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return { files: [] };
    return fileError(error, rel);
  }
  const files = [];
  const ancestors = new Set();
  const walk = path => {
    const abs = join(repo, path);
    let stat, real, children;
    try {
      stat = statSync(abs);
      if (stat.isDirectory()) {
        real = realpathSync(abs);
        if (ancestors.has(real)) return null;
        children = readdirSync(abs).sort(byteCompare);
      }
    } catch (error) { return fileError(error, path); }
    if (stat.isFile()) files.push(path);
    else if (children) {
      ancestors.add(real);
      for (const child of children) {
        const error = walk(`${path}/${child}`);
        if (error) return error;
      }
      ancestors.delete(real);
    } else return { error: 'UNREADABLE', path, code: 'UNSUPPORTED_TYPE' };
    return null;
  };
  const error = walk(rel);
  return error ?? { files: files.sort(byteCompare) };
}
