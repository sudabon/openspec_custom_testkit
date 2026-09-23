import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { SCHEMA_INTEGRATED } from './critical.mjs';
import { installedE2eRoot } from './e2e-root.mjs';
import { git, headRevision, parseNameStatus } from './git.mjs';
import { sha256File } from './hash.mjs';
import { hasBoundedToken, parseTable, section } from './markdown.mjs';
import { mutationThreshold } from './policy.mjs';
import { asList, asString, splitFrontmatter, validDate } from './frontmatter.mjs';

export function executionBlock(markdown) {
  const body = section(markdown, '## Execution Records');
  if (body == null) return { error: '## Execution Records がありません' };
  const match = body.match(/```json\s*([\s\S]*?)```/);
  if (!match) return { error: 'Execution Records の JSON がありません' };
  try {
    return { data: JSON.parse(match[1]) };
  } catch (err) {
    return { error: `Execution Records の JSON が不正です: ${err.message}` };
  }
}

function insideRepo(repo, rel) {
  if (!rel || typeof rel !== 'string' || rel.includes('://') || rel.startsWith('/') || rel.split('/').includes('..')) return false;
  const abs = resolve(repo, rel);
  const root = resolve(repo);
  return abs === root || abs.startsWith(root + sep);
}

function validationInputMatcher(repo, change, quality) {
  const roots = [...asList(splitFrontmatter(quality).data?.oracle_paths), installedE2eRoot(repo), `${change.path}/specs`]
    .map(root => String(root).replace(/\/+$/, ''));
  const files = new Set(['quality.md', 'test-plan.md', '.openspec.yaml'].map(name => `${change.path}/${name}`));
  return path => {
    if (files.has(path) || roots.some(root => path === root || path.startsWith(`${root}/`))) return true;
    // Only known reporting/documentation paths are exempt. Unknown source and
    // configuration paths remain validation inputs, including on merge commits.
    if (/^openspec\/changes\/(?:archive\/)?[^/]+\/evidence\.md$/.test(path)) return false;
    if (path.startsWith('test-results/')) return false;
    if (/^(?:docs\/.*\.md|README(?:\.(?:md|txt|rst))?|CHANGELOG(?:\.(?:md|txt|rst))?)$/i.test(path)) return false;
    return true;
  };
}

function blobAt(repo, rev, path) {
  try {
    return git(repo, ['rev-parse', '--verify', `${rev}:${path}`]).trim();
  } catch {
    return null;
  }
}

function sameArchiveMove(change, fromPath, toPath) {
  const destPrefix = `${String(change.path).replace(/\/+$/, '')}/`;
  const sourcePrefix = `openspec/changes/${change.id}/`;
  if (!destPrefix.startsWith('openspec/changes/archive/') || !fromPath?.startsWith(sourcePrefix) || !toPath?.startsWith(destPrefix)) return false;
  return fromPath.slice(sourcePrefix.length) === toPath.slice(destPrefix.length);
}

function unchangedArchivePaths(repo, change, fromRev, toRev, entries) {
  const ignored = new Set();
  if (!String(change.path).startsWith('openspec/changes/archive/')) return ignored;
  const deleted = new Set();
  const added = [];
  for (const entry of entries) {
    if ((entry.status === 'R' || entry.status === 'C') && sameArchiveMove(change, entry.oldPath, entry.path)) {
      const before = blobAt(repo, fromRev, entry.oldPath);
      if (before && before === blobAt(repo, toRev, entry.path)) {
        ignored.add(entry.path);
        ignored.add(entry.oldPath);
      }
    } else if (entry.status === 'D') deleted.add(entry.path);
    else if (entry.status === 'A') added.push(entry.path);
  }
  const sourcePrefix = `openspec/changes/${change.id}/`;
  const destPrefix = `${String(change.path).replace(/\/+$/, '')}/`;
  for (const path of added) {
    if (!path.startsWith(destPrefix)) continue;
    const source = sourcePrefix + path.slice(destPrefix.length);
    const before = blobAt(repo, fromRev, source);
    if (deleted.has(source) && before && before === blobAt(repo, toRev, path)) {
      ignored.add(path);
      ignored.add(source);
    }
  }
  return ignored;
}

function revisionProblem(repo, change, run, head, isInput) {
  if (!/^[0-9a-f]{40,64}$/.test(run.revision)) return `run ${run.id} の revision が完全なコミット SHA ではありません: ${run.revision}`;
  try {
    git(repo, ['merge-base', '--is-ancestor', run.revision, head]);
  } catch (err) {
    if (err.status === 1) return `run ${run.id} の revision が HEAD の祖先ではありません`;
    return `run ${run.id} の revision を git で確認できません (${err.message})`;
  }
  let changed;
  let entries;
  try {
    changed = git(repo, ['diff', '--name-only', '-z', run.revision, head, '--']).split('\0').filter(Boolean);
    entries = parseNameStatus(git(repo, ['diff', '--name-status', '-z', '-M', run.revision, head, '--']));
  } catch (err) {
    return `run ${run.id} の revision からの差分を取得できません (${err.message})`;
  }
  // Identical blobs moved into archive are the same validation inputs, not edits.
  const ignored = unchangedArchivePaths(repo, change, run.revision, head, entries);
  return changed.some(path => !ignored.has(path) && isInput(path)) ? `run ${run.id} の revision が HEAD の検証対象と一致しません` : null;
}

export function checkEvidence(repo, change, { digest, policyText, manifest }) {
  const errors = [];
  const notes = [];
  const evidencePath = join(repo, change.path, 'evidence.md');
  if (!existsSync(evidencePath)) {
    errors.push('evidence.md がありません');
    notes.push('structure: fail', 'execution: unverified');
    return { errors, notes };
  }
  const text = readFileSync(evidencePath, 'utf8');
  if (change.schema !== SCHEMA_INTEGRATED) {
    const qualityPath = join(repo, change.path, 'quality.md');
    if (existsSync(qualityPath)) {
      const ids = [...readFileSync(qualityPath, 'utf8').matchAll(/^\|\s*(R\d+)\s*\|/gm)].map(match => match[1]);
      const missing = [...new Set(ids)].filter(id => !hasBoundedToken(text, id));
      if (missing.length) errors.push(`evidence.md に記載のない Risk ID: ${missing.join(', ')}`);
    }
    notes.push('structure: legacy', 'execution: unverified');
    return { errors, notes };
  }

  const qualityPath = join(repo, change.path, 'quality.md');
  const quality = existsSync(qualityPath) ? readFileSync(qualityPath, 'utf8') : '';
  const riskIds = [...quality.matchAll(/^\|\s*(R\d+)\s*\|/gm)].map(match => match[1]);
  const uniqueRisks = [...new Set(riskIds)];
  const parsed = executionBlock(text);
  if (parsed.error) {
    errors.push(parsed.error);
    notes.push('structure: fail', 'execution: unverified');
    return { errors, notes };
  }
  const data = parsed.data;
  if (data.format_version !== 1) errors.push('format_version は 1 である必要があります');
  const runs = Array.isArray(data.runs) ? data.runs : [];
  const runById = new Map(runs.map(run => [run.id, run]));
  let revision = null;
  try {
    revision = headRevision(repo);
  } catch (err) {
    if (runs.length) errors.push(`HEAD を解決できないため run の revision を検証できません (${err.message})`);
  }
  for (const run of runs) {
    for (const key of ['id', 'command', 'started_at', 'revision', 'source', 'source_sha256']) {
      if (run[key] == null || run[key] === '') errors.push(`run ${run.id ?? '?'} の ${key} がありません`);
    }
    if (typeof run.exit_code !== 'number') errors.push(`run ${run.id ?? '?'} の exit_code が数値ではありません`);
    if (run.started_at && Number.isNaN(Date.parse(run.started_at))) errors.push(`run ${run.id} の時刻が不正です`);
    if (!insideRepo(repo, run.source)) errors.push(`run ${run.id ?? '?'} の source はリポジトリ内の相対パスだけを受け付けます`);
    else if (existsSync(join(repo, run.source))) {
      if (sha256File(join(repo, run.source)) !== run.source_sha256) errors.push(`run ${run.id} の source hash が一致しません`);
    } else errors.push(`run ${run.id} の source がありません: ${run.source}`);
  }
  const earlier = revision ? runs.filter(run => run.revision && run.revision !== revision) : [];
  if (earlier.length) {
    let isInput = null;
    try {
      isInput = validationInputMatcher(repo, change, quality);
    } catch (err) {
      errors.push(err.message);
    }
    for (const run of isInput ? earlier : []) {
      const problem = revisionProblem(repo, change, run, revision, isInput);
      if (problem) errors.push(problem);
    }
  }

  const results = Array.isArray(data.risk_results) ? data.risk_results : [];
  const seen = new Set();
  for (const risk of uniqueRisks) {
    const rows = results.filter(row => row.risk === risk);
    if (rows.length !== 1) errors.push(`${risk} の構造化結果が ${rows.length} 件です`);
    const row = rows[0];
    if (!row) continue;
    seen.add(risk);
    for (const key of ['failure_modes', 'oracles', 'run_ids']) {
      if (!Array.isArray(row[key]) || row[key].length === 0) errors.push(`${risk} の ${key} が不足しています`);
    }
    if (!asString(row.layer)) errors.push(`${risk} の layer が不足しています`);
    if (row.result !== 'pass' && row.result !== 'fail') errors.push(`${risk} の結果が未実行または不正です: ${row.result ?? ''}`);
    if (row.result === 'fail') errors.push(`${risk} の結果が fail です`);
    if (/(^|[^A-Za-z])E2E([^A-Za-z]|$)/.test(row.layer ?? '') && change.e2e === 'required' && (!Array.isArray(row.tp_ids) || row.tp_ids.length === 0)) {
      errors.push(`${risk} は E2E 層なのに TP-ID がありません`);
    }
    for (const runId of Array.isArray(row.run_ids) ? row.run_ids : []) {
      const run = runById.get(runId);
      if (!run) errors.push(`${risk} の run_id ${runId} が runs にありません`);
      else if (row.result === 'pass' && run.exit_code !== 0) errors.push(`${risk} は pass なのに run ${runId} が失敗しています`);
    }
  }
  for (const row of results) if (row.risk && !uniqueRisks.includes(row.risk)) errors.push(`未知の Risk 結果: ${row.risk}`);

  const table = parseTable(section(text, '## 追跡')).rows;
  for (const risk of uniqueRisks) {
    const row = table.find(candidate => candidate.Risk === risk);
    const json = results.find(candidate => candidate.risk === risk);
    if (!row) errors.push(`追跡表に ${risk} がありません`);
    else if (json && row.Result && json.result && row.Result !== json.result) errors.push(`${risk} の本文と JSON の結果が一致しません`);
  }

  const falsification = data.falsification;
  if (!falsification || falsification.performed !== true || !asString(falsification.summary)) {
    errors.push('独立反証の実施記録がありません');
  }
  for (const example of falsification?.counterexamples ?? []) {
    if (example.status === 'fixed') continue;
    if (example.status !== 'residual') {
      errors.push(`反例 ${example.id ?? '?'} が未解決です`);
      continue;
    }
    const residual = (data.residuals ?? []).find(item => item.id === example.residual_id);
    if (!residual || !asString(residual.reason) || !asString(residual.impact) || !asString(residual.approved_by) || !validDate(residual.approved_at)) {
      errors.push(`反例 ${example.id ?? '?'} に人間承認済み Residual がありません`);
    }
  }

  const level = asString(splitFrontmatter(quality).data?.risk_level);
  const threshold = mutationThreshold(policyText);
  const mutation = data.mutation ?? {};
  if (level === 'high') {
    if (!asString(mutation.command)) errors.push('high の Mutation コマンドが未指定です');
    if (mutation.status === 'not-run' || mutation.score == null) errors.push('high の Mutation 結果がありません');
    else if (typeof mutation.score !== 'number' || !Number.isFinite(mutation.score)) errors.push('Mutation スコアが数値ではありません');
    const declared = Number(mutation.threshold);
    if (!Number.isFinite(declared) || declared < threshold) errors.push(`Mutation 閾値は ${threshold}% 以上である必要があります`);
    if (typeof mutation.score === 'number' && Number.isFinite(mutation.score) && (mutation.score < declared || mutation.score < threshold)) {
      errors.push('Mutation スコアが閾値未満です');
    }
  }

  const reviews = Array.isArray(data.reviews) ? data.reviews : [];
  if ((level === 'medium' || level === 'high') && !reviews.some(review => asString(review.reviewer))) {
    errors.push(`${level} の Human Code Review がありません`);
  }
  if (level === 'high' && !reviews.some(review => review.includes_domain_owner === true)) {
    errors.push('high のレビューにドメイン担当が含まれていません');
  }

  const history = Array.isArray(data.oracle_changes) ? data.oracle_changes : [];
  if (history.length) {
    for (const entry of history) {
      if (!asString(entry.reason) || !asString(entry.approved_by) || !validDate(entry.approved_at) || !asString(entry.digest)) {
        errors.push('再seal履歴の理由・再承認・digest が不足しています');
      }
    }
    if (digest && history.at(-1).digest !== digest) errors.push('再seal履歴の digest が現在の seal と一致しません');
  }

  let execution = 'unverified';
  if (manifest) {
    // Output bytes differ between runs (timestamps, durations), so a CI rerun can only
    // reproduce the recorded command and exit code. The recorded source is hashed above.
    const ids = new Set(manifest.run_ids ?? []);
    const covered = runs.length > 0 && Array.isArray(manifest.runs) && runs.every(run => ids.has(run.id) && manifest.runs.some(record =>
      record.id === run.id && record.change_id === change.id && record.command === run.command && record.exit_code === run.exit_code));
    if (!errors.length && covered && manifest.revision && revision && manifest.revision === revision) execution = 'verified';
  }
  notes.push(errors.length ? 'structure: fail' : 'structure: pass', `execution: ${execution}`);
  return { errors, notes };
}
