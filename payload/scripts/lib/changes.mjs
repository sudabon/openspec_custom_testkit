import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { byteCompare } from './hash.mjs';

export const CHANGES_ROOT = 'openspec/changes';
export const ARCHIVE_ROOT = 'openspec/changes/archive';

// Archive folders are YYYY-MM-DD-<id>. `date` is the leading date even when the id is missing, and `id` is
// null unless the whole form matches. Neither checks that the date exists on the calendar.
export function parseArchiveFolder(folder) {
  const date = folder.match(/^(\d{4}-\d{2}-\d{2})(?=-|$)/)?.[1] ?? null;
  const id = folder.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)?.[1] ?? null;
  return { date, id };
}

// Directory names in byte order. Read errors propagate to the caller.
function directories(repo, rel) {
  const root = join(repo, rel);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort(byteCompare);
}

export function listActiveChanges(repo) {
  return directories(repo, CHANGES_ROOT)
    .filter(name => name !== 'archive')
    .map(id => ({ id, dir: `${CHANGES_ROOT}/${id}` }));
}

// Byte order of YYYY-MM-DD-<id> folders is date order with the name as the tie-breaker.
export function listArchivedChanges(repo) {
  return directories(repo, ARCHIVE_ROOT)
    .map(folder => ({ folder, ...parseArchiveFolder(folder), dir: `${ARCHIVE_ROOT}/${folder}` }));
}
