import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCritical, REQUIRED_MODULES, STAMP_FILE } from './critical.mjs';
import { assessTarget } from './environment.mjs';
import { sha256File } from './hash.mjs';
import { installedE2eRoot, readJsonIfExists } from './e2e-root.mjs';
import { e2eLintPolicy, flakyFailLevels, mockContractMaxAgeDays, policyIssues, qaReviewRequiredLevels } from './policy.mjs';

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
    for (const rel of REQUIRED_MODULES) {
      if (!Object.hasOwn(files, rel)) failures.push(`必須 module が導入記録にありません（旧版のままです）: ${rel}。install を再実行してください`);
    }
    try {
      installedE2eRoot(repo);
    } catch (err) {
      failures.push(err.message);
    }
  }
  const policyPath = join(repo, 'openspec/quality-policy.md');
  if (!existsSync(policyPath)) failures.push('openspec/quality-policy.md がありません');
  else {
    const policyText = readFileSync(policyPath, 'utf8');
    const issues = policyIssues(policyText);
    if (issues.length) failures.push(...issues);
    const lint = e2eLintPolicy(policyText);
    if (lint.missing.length) {
      notes.push(`quality-policy.md に ${lint.missing.join(' / ')} がありません。既定値（e2e_lint_mode: enforce / e2e_lint_scope: changed）で動かします。設定する場合は人間が追記してください`);
    }
    failures.push(...lint.errors);
    const flaky = flakyFailLevels(policyText);
    if (flaky.error) failures.push(flaky.error);
    const mockAge = mockContractMaxAgeDays(policyText);
    if (mockAge.error) failures.push(mockAge.error);
    const qa = qaReviewRequiredLevels(policyText);
    if (qa.error) failures.push(qa.error);
    else if (qa.defaulted) notes.push('quality-policy.md に qa_review_required_levels がありません。初期値 [medium, high] で QA レビューを要求します。変える場合は人間が追記してください');
  }
  const env = assessTarget(repo, options);
  notes.push(...env.messages);
  if (!env.openspecReady) failures.push(`OpenSpec は統合 ready ではありません (${env.reason})`);
  if (!env.allowWrite) failures.push(`配置境界: ${env.reason}`);
  return { ok: failures.length === 0, failures, notes, stamp: stamp.data };
}
