import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isIntegratedChange } from './critical.mjs';
import { asString, splitFrontmatter, validDate } from './frontmatter.mjs';
import { qaReviewRequiredLevels, RISK_LEVELS } from './policy.mjs';

// QA review fields are human-only, like approval. A half-filled record or a malformed date is invalid.
export function qaReviewOf(data) {
  const by = asString(data?.qa_reviewed_by);
  const at = asString(data?.qa_reviewed_at);
  if (!by && !at) return 'empty';
  if (!by || !validDate(at)) return 'invalid';
  return 'ok';
}

export function qaReviewOrderError(data) {
  const reviewedAt = asString(data?.qa_reviewed_at);
  const approvedAt = asString(data?.approved_at);
  return validDate(reviewedAt) && validDate(approvedAt) && reviewedAt > approvedAt
    ? 'QA レビュー日は承認日以前である必要があります (qa_reviewed_at <= approved_at)'
    : null;
}

// An unreadable risk_level cannot prove that QA review is unnecessary, so it needs review whenever any level does.
export function qaReviewNeeded(level, levels) {
  return levels.includes(level) || (!RISK_LEVELS.includes(level) && levels.length > 0);
}

// The change's quality.md and its frontmatter, or { file, error } with the message the CLI prints.
export function loadQuality(repo, id) {
  const file = join(repo, 'openspec/changes', id, 'quality.md');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { file, error: `not found: ${file}` };
  }
  const frontmatter = splitFrontmatter(text);
  if (frontmatter.error) return { file, error: frontmatter.error };
  return { file, text, data: frontmatter.data };
}

// Reasons the seal must stop before the Oracle digest, in check order; the CLI stops at the first one, so at most one
// is returned. `policyText` may be a function so that the policy is read only once approval has been checked.
export function sealBlockers(change, data, policyText) {
  if (!isIntegratedChange(change)) {
    return asString(data.approved_by) ? [] : ['quality.md が未承認です。approved_by を記入してから seal してください'];
  }
  if (!asString(data.approved_by) || !validDate(asString(data.approved_at))) {
    return ['quality.md が未承認です。approved_by と approved_at を人間が記入してから seal してください'];
  }
  const qa = qaReviewRequiredLevels(typeof policyText === 'function' ? policyText() : policyText);
  if (qa.error) return [qa.error];
  const level = asString(data.risk_level);
  if (!qaReviewNeeded(level, qa.levels)) return [];
  if (qaReviewOf(data) !== 'ok') {
    return [`risk_level=${level || '(空)'} は quality-policy.md の qa_review_required_levels [${qa.levels.join(', ')}] に含まれるため QA レビューが必要です。QA レビュー担当が qa_reviewed_by と qa_reviewed_at (YYYY-MM-DD) を記入してから seal してください`];
  }
  const orderError = qaReviewOrderError(data);
  return orderError ? [orderError] : [];
}
