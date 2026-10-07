// Repository lint: scope, policy, suppressions.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listActiveChanges, listArchivedChanges } from '../changes.mjs';
import { isIntegratedChange } from '../critical.mjs';
import { installedE2eRoot } from '../e2e-root.mjs';
import { executionBlock } from '../evidence-check.mjs';
import { errorCode, listFiles } from '../files.mjs';
import { asString, validDate } from '../frontmatter.mjs';
import { git, parseNameStatus } from '../git.mjs';
import { hasBoundedToken } from '../markdown.mjs';
import { checkTestPlan } from '../plan-check.mjs';
import { e2eLintPolicy, POLICY_PATH, readPolicyText } from '../policy.mjs';
import { analyzeSource } from './analyze.mjs';
import { assertionFindings, fixtureTests, helperEntry, helperResolver, resolveModule } from './helpers.mjs';
import { inRange } from './tokens.mjs';

const LINT_SOURCE = /\.(?:[cm]?[jt]sx?)$/i;
const UNSUPPORTED_SOURCE = /\.feature$/i;

function envValue(env, key, allowed, notes, errors) {
  const value = asString(env?.[key]);
  if (value && !allowed.includes(value)) {
    const message = `${key} が不正です (${value})。設定を修正してください`;
    notes.add(message);
    errors.add(message);
  }
  return allowed.includes(value) ? value : null;
}

function modeFor(change, policy, env, notes, errors) {
  if (isIntegratedChange(change)) {
    for (const key of ['QE_E2E_LINT_MODE', 'QE_E2E_LINT_SCOPE']) {
      if (asString(env?.[key])) notes.add(`統合 schema の change (${change.id}) では ${key} を無視します。タグ付きソースは常に強制します`);
    }
    return { tagged: true, changed: policy.mode === 'enforce', all: policy.mode === 'enforce' && policy.scope === 'all' };
  }
  const mode = envValue(env, 'QE_E2E_LINT_MODE', ['warn', 'enforce'], notes, errors) ?? 'warn';
  const scope = envValue(env, 'QE_E2E_LINT_SCOPE', ['changed', 'all'], notes, errors) ?? policy.scope;
  const on = mode === 'enforce';
  return { tagged: on, changed: on, all: on && scope === 'all' };
}

function knownChanges(repo) {
  return [
    ...listActiveChanges(repo).map(({ id, dir }) => ({ id, path: dir })),
    ...listArchivedChanges(repo)
      .filter(({ folder }) => folder !== 'archive')
      .map(({ folder, id, dir }) => ({ id: id ?? folder, path: dir })),
  ];
}

// Everything lintRepo needs from the repository, built once per cache. Diffs and residuals
// start empty and fill in per base and per change.
function createLintState(repo, changes) {
  const { root, listing } = listE2eRoot(repo);
  const context = changeContext(repo, changes);
  if (context.error) listing.error = context.error;
  const { files, analyzed } = readSources(repo, listing.files, context.changeIds);
  return {
    root, listing, knownChanges: context.knownChanges, analyzed, files, helpers: resolveHelpers(files, context.changeIds), ...readPolicy(repo),
    diffs: new Map(), residuals: new Map(), residualErrors: new Map(),
  };
}

function listE2eRoot(repo) {
  let root;
  try {
    root = installedE2eRoot(repo);
    const listed = listFiles(repo, root);
    if (listed.error) throw new Error(`E2E ルートを参照できません: ${listed.path} (${listed.code})`);
    return { root, listing: { files: listed.files } };
  } catch (err) {
    return { root, listing: { error: err.message, files: [] } };
  }
}

function changeContext(repo, changes) {
  try {
    const known = knownChanges(repo);
    return { knownChanges: known, changeIds: [...new Set([...known, ...changes].map(change => change.id))] };
  } catch (err) {
    return { knownChanges: [], changeIds: [], error: `change 一覧を読み取れません (${errorCode(err)})` };
  }
}

function readSources(repo, listed, changeIds) {
  const files = new Map();
  let analyzed = 0;
  for (const file of listed) {
    if (!LINT_SOURCE.test(file)) continue;
    let text;
    try {
      text = readFileSync(join(repo, file), 'utf8');
    } catch (err) {
      files.set(file, { error: `読み取れません (${errorCode(err)})` });
      continue;
    }
    analyzed++;
    files.set(file, { text, analysis: analyzeSource(text, { path: file, changeIds }) });
  }
  return { files, analyzed };
}

// Re-analyzes files that import custom tests from other files, so their tests and fixtures resolve.
function resolveHelpers(files, changeIds) {
  const helpers = new Map();
  for (const [file, entry] of files) {
    if (entry.analysis && !entry.analysis.error) helpers.set(file, helperEntry(entry.analysis));
  }
  // Propagate fixture exports through relative imports, bounded by the module count.
  for (let pass = 0; pass < helpers.size; pass++) {
    for (const [file, entry] of files) {
      if (!helpers.has(file)) continue;
      const testNames = [...entry.analysis.imports].filter(([, binding]) => helpers.get(resolveModule(file, binding.specifier, helpers))?.tests.has(binding.imported)).map(([name]) => name);
      if (testNames.some(name => !entry.testNames?.has(name))) {
        entry.testNames = new Set(testNames);
        entry.analysis = analyzeSource(entry.text, { path: file, changeIds, testNames });
      }
      const tests = fixtureTests(file, entry.analysis, helpers);
      for (const [exported, local] of entry.analysis.exported) {
        if (tests.has(local)) helpers.get(file).tests.set(exported, tests.get(local));
      }
    }
  }
  return helpers;
}

function readPolicy(repo) {
  try {
    return { policy: e2eLintPolicy(readPolicyText(repo) ?? ''), policyError: null };
  } catch (err) {
    return { policy: e2eLintPolicy(''), policyError: `quality-policy.md を読み取れません (${errorCode(err)})` };
  }
}

function changedFiles(repo, state, base) {
  if (!state.diffs.has(base)) {
    try {
      const entries = parseNameStatus(git(repo, ['diff', '-z', '--name-status', base, 'HEAD', '--', state.root]));
      state.diffs.set(base, { files: new Set(entries.filter(entry => entry.status !== 'D').map(entry => entry.path)) });
    } catch (err) {
      state.diffs.set(base, { error: `比較元からの E2E 差分を取得できません: ${err.message}`, files: new Set() });
    }
  }
  return state.diffs.get(base);
}

function residualsOf(repo, state, change) {
  if (!state.residuals.has(change.path)) {
    const path = join(repo, change.path, 'evidence.md');
    let parsed;
    try {
      parsed = existsSync(path) ? executionBlock(readFileSync(path, 'utf8')) : { data: null };
    } catch (err) {
      state.residuals.set(change.path, []);
      state.residualErrors.set(change.path, { message: `evidence.md を読み取れません (${errorCode(err)})` });
      return [];
    }
    if (parsed.error) {
      state.residualErrors.set(change.path, { message: parsed.error, missingBlock: parsed.missing });
    }
    const list = Array.isArray(parsed.data?.residuals) ? parsed.data.residuals.filter(item => item && typeof item === 'object') : [];
    state.residuals.set(change.path, list);
  }
  return state.residuals.get(change.path);
}

function residualStatus(id, residuals) {
  const matches = residuals.filter(item => item.id === id);
  if (matches.length > 1) return { status: 'invalid', detail: `${id} の参照先が複数あります。Residual ID を一意にしてください` };
  const found = matches[0];
  if (!found) return { status: 'unknown', detail: `${id} が evidence の residuals にありません` };
  const missing = ['reason', 'impact', 'approved_by'].filter(key => !asString(found[key]));
  if (!validDate(found.approved_at)) missing.push('approved_at');
  if (missing.length) return { status: 'pending', detail: `${id} に人間の承認がありません (${missing.join(', ')})` };
  return { status: 'approved', detail: id };
}

function format(entry) {
  return `e2e-lint ${entry.rule} ${entry.file}${entry.line ? `:${entry.line}` : ''}${entry.test ? ` 「${entry.test}」` : ''} ${entry.message}`;
}

function covering(suppressions, finding) {
  const direct = suppressions.filter(item => item.rule === finding.rule && inRange(finding.offset, item.from, item.to));
  if (direct.length) return direct;
  if (finding.rule !== 'weak-assertion' || !finding.weak?.length) return [];
  const each = finding.weak.map(offset => suppressions.find(item => item.rule === 'weak-assertion' && inRange(offset, item.from, item.to)));
  return each.every(Boolean) ? [...new Set(each)] : [];
}

const STATUS_RANK = { invalid: 0, unknown: 1, pending: 2, approved: 3 };

function place(result, entry, scope) {
  entry.text = format(entry);
  entry.scope = scope;
  (scope?.enforced ? result.enforced : result.warned).push(entry);
}

// What one lintRepo run shares across its steps; `state` is the cached part.
function createContext(repo, state, changes, options) {
  const env = options.env ?? process.env;
  const notes = new Set(state.policy.invalid);
  const configErrors = new Set(state.policy.errors);
  const active = changes.filter(change => change.lifecycle !== 'deleted');
  const modes = active.map(change => ({ change, mode: modeFor(change, state.policy, env, notes, configErrors) }));
  if (!active.length) modeFor({}, state.policy, env, notes, configErrors);
  const consulted = new Set();
  const readResiduals = change => {
    consulted.add(change.path);
    return residualsOf(repo, state, change);
  };
  const selectedResiduals = active.flatMap(readResiduals);
  return {
    repo, state, phase: options.phase === 'final' ? 'final' : 'plan', active, modes, notes, configErrors, consulted, readResiduals, selectedResiduals,
    selectedIds: new Set(selectedResiduals.map(item => item.id)),
    diff: options.base ? changedFiles(repo, state, options.base) : null,
    result: { enforced: [], warned: [], exceptions: [], pending: [], notes: [], unsupported: [], analyzed: state.analyzed, failed: 0 },
  };
}

export function lintRepo(repo, changes, options = {}) {
  const cache = options.cache ?? {};
  const state = cache.e2eLint ??= createLintState(repo, changes);
  const ctx = createContext(repo, state, changes, options);
  const { result } = ctx;
  placeSetupFindings(ctx, options);
  for (const [file, entry] of state.files) lintFile(ctx, file, entry);
  placeCoverageFindings(ctx);
  for (const [path, error] of state.residualErrors) {
    if (!ctx.consulted.has(path) || (error.missingBlock && !ctx.active.some(change => change.path === path))) continue;
    place(result, { rule: 'unreadable', file: `${path}/evidence.md`, message: error.message }, { enforced: true });
  }
  result.notes = [...ctx.notes];
  result.failed = result.enforced.length;
  return result;
}

// Root, configuration and policy problems, reported before any per-file finding.
function placeSetupFindings(ctx, options) {
  const { state, diff, notes, result } = ctx;
  if (!options.base) notes.add(ctx.modes.some(({ mode }) => mode.all)
    ? 'e2e-lint: --base がありませんが、scope: all により全ソースを強制します'
    : 'e2e-lint: --base が無いため、強制範囲はタグ範囲のみです（差分ファイルは警告に留まります）');
  if (state.listing.error || diff?.error) {
    place(result, { rule: 'unreadable', file: state.root ?? '(E2E ルート)', line: 0, test: null, message: state.listing.error ?? diff.error }, { enforced: true, reason: 'root' });
  }
  for (const message of ctx.configErrors) place(result, { rule: 'invalid-config', file: `${POLICY_PATH} / environment`, message }, { enforced: true });
  if (state.policyError) place(result, { rule: 'unreadable', file: POLICY_PATH, message: state.policyError }, { enforced: true });
  if (options.requireSources && !state.analyzed && !state.listing.error) place(result, { rule: 'unreadable', file: state.root, message: '検査対象の E2E ソースが 0 件です' }, { enforced: true });
  for (const file of state.listing.files) {
    if (UNSUPPORTED_SOURCE.test(file)) result.unsupported.push(file);
  }
}

// The strongest scope any selected change gives the file: tagged, changed, or scope: all.
function scopeFor(ctx, file, entry) {
  const changed = ctx.diff?.files.has(file) ?? false;
  let scope = null;
  for (const { change, mode } of ctx.modes) {
    const tagged = entry.text != null && hasBoundedToken(entry.text, `@${change.id}`);
    const reason = tagged ? 'tagged' : changed ? 'changed' : mode.all ? 'all' : null;
    if (!reason && !mode.all) continue;
    const enforced = (tagged && mode.tagged) || (changed && mode.changed) || mode.all;
    if (!scope || (enforced && !scope.enforced)) scope = { enforced, reason: reason ?? 'all' };
  }
  if (!scope && entry.error && ctx.active.length) scope = { enforced: true, reason: 'unreadable' };
  return scope;
}

function lintFile(ctx, file, entry) {
  const scope = scopeFor(ctx, file, entry);
  if (entry.error) {
    place(ctx.result, { rule: 'unreadable', file, line: 0, test: null, message: entry.error }, { enforced: true, reason: 'unreadable' });
    return;
  }
  const analysis = entry.analysis;
  if (analysis.error) {
    place(ctx.result, { rule: 'unparseable', file, line: analysis.errorLine, test: null, message: `字句解析できません: ${analysis.error}` }, scope);
    return;
  }
  const findings = [...analysis.findings, ...assertionFindings(analysis, helperResolver(file, analysis, ctx.state.helpers))];
  const used = new Set();
  for (const finding of findings) placeFinding(ctx, { file, analysis, scope, used }, finding);
  for (const item of analysis.suppressions) {
    if (used.has(item)) continue;
    const status = residualStatusFor(ctx, analysis, item);
    if (status.status === 'invalid' || status.status === 'unknown') {
      place(ctx.result, { rule: 'invalid-suppression', file, line: item.line, test: item.test, message: `抑止コメントが無効です: ${status.detail}` }, { enforced: true, reason: 'invalid-suppression' });
    }
  }
}

// Parsed test/describe tags establish ownership; file tags apply only outside tests.
// Selected evidence wins over historical records with the same ID. Untagged helpers retain
// historical exceptions, but ambiguous historical IDs require a unique ID.
function residualStatusFor(ctx, analysis, item) {
  if (item.error) return { status: 'invalid', detail: item.error };
  const { active, state } = ctx;
  const targets = analysis.tests.filter(test => inRange(item.from, test.start, test.end) || inRange(test.start, item.from, item.to));
  const describes = analysis.blocks.filter(block => block.kind === 'describe' && inRange(item.from, block.bodyStart, block.bodyEnd));
  let ownerTags = targets.flatMap(test => test.tags);
  if (!targets.length) {
    ownerTags = describes.flatMap(block => block.ownTags);
    if (!ownerTags.some(tag => [...active, ...state.knownChanges].some(change => tag === `@${change.id}`))) {
      ownerTags = analysis.blocks.flatMap(block => block.ownTags);
    }
  }
  const tags = new Set(ownerTags);
  const tagged = [...active, ...state.knownChanges].some(change => tags.has(`@${change.id}`));
  const helperOnly = analysis.blocks.length === 0;
  const owners = state.knownChanges.filter(change =>
    !active.some(selected => selected.path === change.path) && ((!tagged && helperOnly) || tags.has(`@${change.id}`)));
  const residuals = [...ctx.selectedResiduals, ...owners.flatMap(ctx.readResiduals).filter(record => !ctx.selectedIds.has(record.id))];
  return residualStatus(item.residual, residuals);
}

// One finding goes to enforced/warned, or to exceptions/pending when an approved or pending suppression covers it.
function placeFinding(ctx, { file, analysis, scope, used }, finding) {
  const { result } = ctx;
  const base = { rule: finding.rule, file, line: finding.line, test: finding.test, message: finding.message };
  const matched = covering(analysis.suppressions, finding);
  if (!matched.length) {
    place(result, base, scope);
    return;
  }
  matched.forEach(item => used.add(item));
  const statuses = matched.map(item => ({ ...residualStatusFor(ctx, analysis, item), id: item.residual }));
  const worst = statuses.reduce((low, item) => STATUS_RANK[item.status] < STATUS_RANK[low.status] ? item : low);
  if (worst.status === 'approved') {
    base.residual = worst.id;
    base.text = `承認済みの例外 ${worst.id}: ${format(base)}`;
    base.scope = scope;
    result.exceptions.push(base);
  } else if (worst.status === 'pending' && ctx.phase === 'plan') {
    base.residual = worst.id;
    base.text = `承認待ち ${worst.id}: ${format(base)} — ${worst.detail}`;
    base.scope = scope;
    if (scope?.enforced) result.pending.push(base);
    else result.warned.push(base);
  } else {
    base.message = `${base.message} (抑止は無効: ${worst.detail})`;
    place(result, base, ['invalid', 'unknown'].includes(worst.status) ? { enforced: true, reason: 'invalid-suppression' } : scope);
  }
}

// Test-level coverage: a planned TP needs a non-excluded test carrying both tags.
function placeCoverageFindings(ctx) {
  const { repo, state, result } = ctx;
  for (const { change, mode } of ctx.modes) {
    const tpIds = change.tpIds ?? checkTestPlan(repo, change).requiredTags;
    const tests = [...state.files.values()].flatMap(entry => entry.analysis?.tests ?? []);
    for (const tp of tpIds) {
      const implemented = tests.some(item => !item.excluded && item.tags.includes(`@${change.id}`) && item.tags.includes(`@${tp}`));
      if (implemented) continue;
      place(result, {
        rule: 'missing-tag',
        file: state.root ?? '(E2E ルート)',
        line: 0,
        test: null,
        message: `${change.id}: ${tp} を @${change.id} と同じテストに持つ有効なテストがありません（skip / fixme / fail のテストは数えません）`,
      }, { enforced: mode.tagged, reason: 'tagged' });
    }
  }
}

export function lintChange(repo, change, options = {}) {
  const result = lintRepo(repo, [{ ...change, tpIds: options.tpIds ?? change.tpIds }], options);
  const outside = result.warned.filter(entry => !entry.scope);
  const warnings = [
    ...result.notes,
    ...result.pending.map(entry => entry.text),
    ...result.warned.filter(entry => entry.scope).map(entry => entry.text),
  ];
  if (outside.length) warnings.push(`e2e-lint: 強制範囲外の指摘 ${outside.length} 件（testkit-gate.mjs lint で一覧）`);
  return {
    failures: result.enforced.map(entry => entry.text),
    warnings,
    oks: result.exceptions.map(entry => entry.text),
  };
}

// The stdout lines of `testkit-gate.mjs lint` for a lintRepo result over `changes`.
export function formatLintReport(result, changes) {
  return [
    `対象 change: ${changes.map(change => change.id).join(', ') || 'なし（全ソースを警告範囲で表示）'}`,
    ...result.notes.map(note => `! ${note}`),
    '強制範囲:',
    ...result.enforced.map(entry => `  ✗ ${entry.text}`),
    ...result.pending.map(entry => `  ! ${entry.text}`),
    ...result.exceptions.filter(item => item.scope?.enforced).map(entry => `  ✓ ${entry.text}`),
    '警告範囲:',
    ...result.warned.map(entry => `  ! ${entry.text}`),
    ...result.exceptions.filter(item => !item.scope?.enforced).map(entry => `  ✓ ${entry.text}`),
    ...result.unsupported.map(file => `対象外: ${file}（.feature は手続きを持たないため lint しません）`),
    '---',
    `e2e-lint: analyzed ${result.analyzed} files, enforced failures ${result.failed}, warnings ${result.warned.length}, pending ${result.pending.length}, exceptions ${result.exceptions.length}`,
  ];
}
