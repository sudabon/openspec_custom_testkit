import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCritical, STAMP_FILE } from './critical.mjs';
import { assessTarget } from './environment.mjs';
import { sha256File } from './hash.mjs';
import { readJsonIfExists } from './e2e-root.mjs';
import { policyIssues } from './policy.mjs';

export function doctor(repo, options = {}) {
  const failures = [];
  const notes = [];
  const stamp = readJsonIfExists(join(repo, STAMP_FILE));
  if (!stamp.exists || stamp.broken || !stamp.data) {
    failures.push(stamp.broken ? `${STAMP_FILE} が壊れています` : `${STAMP_FILE} がありません`);
  } else {
    const migration = stamp.data.migration ?? {};
    if (migration.status !== 'complete' || (migration.pending ?? []).length) {
      failures.push(`移行状態が incomplete です: ${(migration.pending ?? []).join(', ') || 'pending'}`);
    }
    const files = stamp.data.files ?? {};
    for (const [rel, expected] of Object.entries(files)) {
      if (!isCritical(rel)) continue;
      const abs = join(repo, rel);
      if (!existsSync(abs)) failures.push(`必須ファイルがありません: ${rel}`);
      else if (sha256File(abs) !== expected) failures.push(`必須ファイルが導入内容と違います: ${rel}`);
    }
  }
  const policyPath = join(repo, 'openspec/quality-policy.md');
  if (!existsSync(policyPath)) failures.push('openspec/quality-policy.md がありません');
  else {
    const issues = policyIssues(readFileSync(policyPath, 'utf8'));
    if (issues.length) failures.push(...issues);
  }
  const env = assessTarget(repo, options);
  notes.push(...env.messages);
  if (!env.openspecReady) failures.push(`OpenSpec は統合 ready ではありません (${env.reason})`);
  if (!env.allowWrite) failures.push(`配置境界: ${env.reason}`);
  return { ok: failures.length === 0, failures, notes, stamp: stamp.data };
}
