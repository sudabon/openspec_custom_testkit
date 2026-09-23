import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_ROOT_DEFAULT, FORK_BASE, LEGACY_STAMPS, STAMP_FILE, isCritical } from '../payload/scripts/lib/critical.mjs';
import { assessTarget, locateConfig } from '../payload/scripts/lib/environment.mjs';
import { normalizeE2eRoot as normalizeRoot, readJsonIfExists } from '../payload/scripts/lib/e2e-root.mjs';
import { sha256 } from '../payload/scripts/lib/hash.mjs';
import { policyIssues } from '../payload/scripts/lib/policy.mjs';
import { SCHEMA_NAME, mergeConfig } from './config-merge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(HERE, '..');
const PAYLOAD = join(PACKAGE_ROOT, 'payload');
const QE_SHA = 'e537d10da53112fce684f31d1602c1e061ab87a2';
const E2E_SHA = '53e354fa366f02cf412e9ce93419463a37e8255c';
const PW_CONFIG_RE = /^playwright\.config\.(?:[cm]?[jt]s)$/;
const SCAN_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.venv', 'target', 'tmp',
]);

export const USAGE = `usage: openspec-custom-testkit [install|update] [--force] [--dry-run] [--target <dir>] [--e2e-root <path>] [--language <lang>]

  install            payload を対象リポジトリへ導入する(既定)
  update             install と同じ処理。出力の文言が「更新」になる
  --target <dir>     対象ディレクトリ(既定: カレントディレクトリ)
  --e2e-root <path>  E2E テストの置き場所(target 相対)。省略時は stamp、Playwright の
                     静的 testDir、既存ディレクトリ、${E2E_ROOT_DEFAULT} の順で決める
  --language <lang>  openspec/config.yaml を新規作成するとき、artifact の言語を指定する
                     (openspec init --language と同じ context を書く。例: Japanese)
  --force            差分のある配布ファイルを上書きし、git リポジトリ確認をスキップする
                     (quality-policy.md と実在の Playwright config は上書きしない)
  --dry-run          一切書き込まず、実行予定の操作だけを表示する
  -h, --help         このヘルプを表示する`;

export class UsageError extends Error {}
export class PathError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PATH';
  }
}

export function parseArgs(argv) {
  const opts = { command: null, target: null, force: false, dryRun: false, help: false, e2eRoot: null, language: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'install' || arg === 'update') {
      if (opts.command) throw new UsageError(`サブコマンドが重複しています: ${arg}`);
      opts.command = arg;
    } else if (arg === '--force') opts.force = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--target' || arg.startsWith('--target=')) {
      const value = arg.includes('=') ? arg.slice('--target='.length) : argv[++i];
      if (!value) throw new UsageError('--target には値が必要です');
      opts.target = value;
    } else if (arg === '--e2e-root' || arg.startsWith('--e2e-root=')) {
      const value = arg.includes('=') ? arg.slice('--e2e-root='.length) : argv[++i];
      if (!value) throw new UsageError('--e2e-root には値が必要です');
      opts.e2eRoot = normalizeE2eRoot(value);
    } else if (arg === '--language' || arg.startsWith('--language=')) {
      const value = arg.includes('=') ? arg.slice('--language='.length) : argv[++i];
      if (!value || !value.trim()) throw new UsageError('--language には値が必要です');
      opts.language = value.trim();
    } else {
      throw new UsageError(`不明な引数: ${arg}`);
    }
  }
  opts.command ??= 'install';
  opts.target = resolve(opts.target ?? process.cwd());
  return opts;
}

function normalizeStored(file, value, flagRoot, notes) {
  try {
    return normalizeRoot(value);
  } catch (err) {
    if (!flagRoot) throw new PathError(`${file} の e2eRoot が不正です (${err.message})。黙って E2E root を移動しません。修復するか --e2e-root を指定してください。`);
    notes.push(`${file} の e2eRoot は不正なため使いません (${err.message})。--e2e-root の指定で配置します。`);
    return null;
  }
}

export function normalizeE2eRoot(value) {
  try {
    return normalizeRoot(value);
  } catch (err) {
    throw new UsageError(err.message);
  }
}

function walkFiles(root, base = root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = join(root, entry.name);
    if (entry.name === '.DS_Store') continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...walkFiles(abs, base));
    else if (entry.isFile()) out.push(relative(base, abs).split(sep).join('/'));
  }
  return out.sort();
}

function isInsideGitRepo(dir) {
  let cur = resolve(dir);
  if (!existsSync(cur)) return false;
  for (;;) {
    if (existsSync(join(cur, '.git'))) return true;
    const parent = dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

function unifiedDiff(oldText, newText, oldLabel, newLabel, context = 3) {
  const a = String(oldText).split('\n');
  const b = String(newText).split('\n');
  if (a.length > 800 || b.length > 800) return `--- ${oldLabel}\n+++ ${newLabel}\n(差分が長いため省略。内容は一致しません)`;
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i += 1; j += 1; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push(['-', a[i++]]);
    else ops.push(['+', b[j++]]);
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op[0] === ' ') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });
  const lines = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  let gap = false;
  for (let idx = 0; idx < ops.length; idx++) {
    if (!keep[idx]) {
      if (!gap) { lines.push('@@'); gap = true; }
      continue;
    }
    gap = false;
    lines.push(ops[idx][0] + ops[idx][1]);
  }
  return lines.join('\n');
}

function findPlaywrightConfigs(root, dir = root, depth = 0) {
  if (!existsSync(dir)) return [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && PW_CONFIG_RE.test(entry.name)) found.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
  }
  if (depth < 3) {
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || SCAN_SKIP_DIRS.has(entry.name)) continue;
      found.push(...findPlaywrightConfigs(root, join(dir, entry.name), depth + 1));
    }
  }
  return found.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

function parseTestDir(absPath) {
  let text = '';
  try { text = readFileSync(absPath, 'utf8'); } catch { return null; }
  return text.match(/testDir\s*:\s*['"`]([^'"`\n]+)['"`]/)?.[1] ?? null;
}

function mapDestRel(rel, e2eRoot) {
  const prefix = `${E2E_ROOT_DEFAULT}/`;
  if (e2eRoot !== E2E_ROOT_DEFAULT && (rel === E2E_ROOT_DEFAULT || rel.startsWith(prefix))) {
    return `${e2eRoot}${rel.slice(E2E_ROOT_DEFAULT.length)}`;
  }
  return rel;
}

// Baselines are immutable package contents, so they are read and hashed once per process.
let legacyIndexMemo;

function legacyIndex() {
  return legacyIndexMemo ??= loadLegacyIndex();
}

export function transformBytes(rel, buf, e2eRoot, { legacy = false } = {}) {
  if (e2eRoot === E2E_ROOT_DEFAULT || buf.includes(0)) return buf;
  // Gate scripts resolve the E2E root from the stamp at runtime, so their bytes stay fixed.
  if (!legacy && isCritical(rel)) return buf;
  if (legacy && !legacyIndex().byPath.get(rel)?.some(entry => entry.transformE2eRoot)) return buf;
  const text = buf.toString('utf8');
  if (!text.includes(E2E_ROOT_DEFAULT)) return buf;
  return Buffer.from(text.replaceAll(E2E_ROOT_DEFAULT, e2eRoot));
}

function loadLegacyIndex() {
  const manifestPath = join(PACKAGE_ROOT, 'upstream/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const byPath = new Map();
  for (const source of manifest.sources) {
    for (const file of source.files) {
      const abs = join(PACKAGE_ROOT, 'upstream/baselines', source.id, 'payload', file.path);
      const bytes = readFileSync(abs);
      if (sha256(bytes) !== file.sha256) throw new Error(`baseline drift: ${source.id}/${file.path}`);
      const list = byPath.get(file.path) ?? [];
      list.push({ source, bytes, transformE2eRoot: file.transformE2eRoot });
      byPath.set(file.path, list);
    }
  }
  return { manifest, byPath };
}

function inside(rootReal, candidate) {
  const resolved = resolve(candidate);
  return resolved === rootReal || resolved.startsWith(rootReal + sep);
}

function escapingPaths(target, rels) {
  const targetExists = existsSync(target);
  const rootReal = targetExists ? realpathSync(target) : resolve(target);
  const bad = [];
  for (const rel of rels) {
    if (!rel || rel.split('/').some(part => part === '..' || part === '')) {
      bad.push(rel);
      continue;
    }
    if (!targetExists) {
      if (!inside(rootReal, join(rootReal, rel))) bad.push(rel);
      continue;
    }
    let current = rootReal;
    let escaped = false;
    for (const part of rel.split('/')) {
      const next = join(current, part);
      if (existsSync(next)) {
        const real = realpathSync(next);
        if (!inside(rootReal, real)) { escaped = true; break; }
        current = real;
      } else if (!inside(rootReal, next)) {
        escaped = true;
        break;
      } else {
        current = next;
      }
    }
    if (escaped) bad.push(rel);
  }
  return bad;
}

function isRealPlaywright(destRel) {
  const base = destRel.split('/').pop();
  return PW_CONFIG_RE.test(base);
}

function modeFor(src, destRel, existing) {
  if (destRel.endsWith('.sh')) return 0o755;
  if (existing && existsSync(existing)) return statSync(existing).mode & 0o777;
  try {
    const mode = statSync(src).mode & 0o777;
    return mode & 0o111 ? mode : 0o644;
  } catch {
    return 0o644;
  }
}

function writeAtomic(dest, content, mode) {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${createHash('sha256').update(dest).digest('hex').slice(0, 8)}`;
  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, dest);
}

function resolvePlacement(target, flagRoot) {
  const configs = findPlaywrightConfigs(target);
  const unreadable = [];
  let detected = null;
  let detectedHow = null;
  for (const rel of configs) {
    const testDir = parseTestDir(join(target, rel));
    if (!testDir) { unreadable.push(rel); continue; }
    const abs = resolve(dirname(join(target, rel)), testDir);
    const relRoot = relative(target, abs).split(sep).join('/');
    if (!relRoot || relRoot.startsWith('..') || relRoot.split('/').includes('..')) continue;
    detected = relRoot;
    detectedHow = `${rel} の testDir`;
    break;
  }
  if (!detected && existsSync(target)) {
    const candidates = [];
    for (const rel of configs) {
      const base = dirname(rel) === '.' ? '' : `${dirname(rel)}/`;
      candidates.push(`${base}e2e`, `${base}tests/e2e`, `${base}playwright`);
    }
    candidates.push(E2E_ROOT_DEFAULT, 'e2e', 'playwright/e2e');
    for (const candidate of candidates) {
      if (existsSync(join(target, candidate))) { detected = candidate; detectedHow = `既存ディレクトリ ${candidate}`; break; }
    }
  }
  const notes = [];
  if (unreadable.length) {
    notes.push(`次の Playwright 設定から静的 testDir を読めませんでした。設定ファイルは実行していません: ${unreadable.join(', ')}。--e2e-root で指定してください。`);
  }
  const current = existsSync(target) ? readJsonIfExists(join(target, STAMP_FILE)) : { exists: false, broken: false, data: null };
  const legacy = existsSync(target) ? readJsonIfExists(join(target, LEGACY_STAMPS.e2e)) : { exists: false, broken: false, data: null };
  if (legacy.broken) notes.push(`${LEGACY_STAMPS.e2e} が壊れているため E2E root の根拠にしません。このファイルは変更しません。`);
  if (current.broken && !flagRoot) {
    const error = new PathError(`${STAMP_FILE} が壊れています。黙って E2E root を移動しません。修復するか --e2e-root を指定してください。`);
    error.code = 'BROKEN_STAMP';
    throw error;
  }
  if (current.broken && flagRoot) notes.push(`${STAMP_FILE} は壊れています。--e2e-root の指定で配置し、stamp を書き直します。`);
  const [recordFile, recordValue] = current.data?.e2eRoot
    ? [STAMP_FILE, current.data.e2eRoot]
    : (!legacy.broken && legacy.data?.e2eRoot ? [LEGACY_STAMPS.e2e, legacy.data.e2eRoot] : [null, null]);
  const previous = recordFile ? normalizeStored(recordFile, recordValue, flagRoot, notes) : null;
  let root = E2E_ROOT_DEFAULT;
  let how = '既定値(検出できず)';
  if (flagRoot) { root = flagRoot; how = '--e2e-root の指定'; }
  else if (previous) { root = previous; how = `${recordFile} の記録`; }
  else if (detected) { root = detected; how = detectedHow; }
  return { root, how, detected, configs, notes, previous, current };
}

function knownLegacyMatch(existing, rel, e2eRoot, baselines, stamps) {
  const entries = baselines.byPath.get(rel) ?? [];
  for (const entry of entries) {
    const stamp = stamps[entry.source.id];
    if (!stamp || stamp.broken || stamp.version !== entry.source.packageVersion) continue;
    const expected = entry.transformE2eRoot ? transformBytes(rel, entry.bytes, e2eRoot, { legacy: true }) : entry.bytes;
    if (existing.equals(expected)) return true;
  }
  return false;
}

function readLegacyStamps(target) {
  const out = {};
  if (!existsSync(target)) return out;
  for (const [id, file] of Object.entries(LEGACY_STAMPS)) {
    const read = readJsonIfExists(join(target, file));
    out[id] = { version: read.data?.version ?? null, broken: read.broken, exists: read.exists, bytes: read.exists ? readFileSync(join(target, file)) : null };
  }
  return out;
}

function gitIgnored(target, rels) {
  if (!existsSync(join(target, '.git')) || !rels.length) return [];
  let out = '';
  try {
    out = execFileSync('git', ['-C', target, 'check-ignore', '-v', '--', ...rels], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    out = typeof err.stdout === 'string' ? err.stdout : '';
  }
  return out.split('\n').filter(Boolean).map(line => {
    const [rule, path] = line.split('\t');
    return { path, rule };
  });
}

async function confirm(question, stdin, stdout) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const opts = parseArgs(argv);
  if (opts.help) { log(USAGE); return 0; }
  const verb = opts.command === 'update' ? '更新' : '導入';
  const version = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
  log(`openspec-custom-testkit v${version} — ${verb}先: ${opts.target}${opts.dryRun ? ' (dry-run)' : ''}`);

  const assessment = assessTarget(opts.target, { execFile: io.execFile });
  for (const message of assessment.messages) log(`\n⚠ ${message}`);
  if (!assessment.allowWrite) {
    error('配置しません。成功 stamp は記録しません。');
    return 1;
  }

  let placement;
  try {
    placement = resolvePlacement(opts.target, opts.e2eRoot);
  } catch (err) {
    if (err.code === 'BROKEN_STAMP' || err instanceof UsageError || err instanceof PathError) {
      error(`エラー: ${err.message}`);
      return err instanceof UsageError ? 2 : 1;
    }
    throw err;
  }
  log(`E2E ルート: ${placement.root}  (${placement.how})`);
  for (const note of placement.notes) log(`  ⚠ ${note}`);
  if (placement.configs.length > 1) {
    log(`  Playwright 設定が ${placement.configs.length} 件見つかりました。最も浅いものを検出結果に使います。実ファイルは上書きしません。\n  採用: ${placement.configs[0]}\n  対象外: ${placement.configs.slice(1).join(', ')}\n  意図と違う場合は --e2e-root <path> で指定してください。`);
  }
  if (placement.previous && placement.detected && placement.detected !== placement.previous && placement.root === placement.previous) {
    log(`  ⚠ 記録は '${placement.previous}' ですが、検出結果は '${placement.detected}' です。記録を優先しました。切り替えるには --e2e-root ${placement.detected} を指定してください。`);
  }
  if (placement.previous && placement.previous !== placement.root) {
    log(`  ⚠ 前回は '${placement.previous}' に配置していました。'${placement.previous}' 配下のファイルは自動削除しません。手で確認してください。`);
  }

  const baselines = legacyIndex();
  const stamps = readLegacyStamps(opts.target);
  const previousStamp = placement.current?.exists && !placement.current.broken ? placement.current.data : null;
  const recordedFiles = previousStamp?.files && typeof previousStamp.files === 'object' ? previousStamp.files : {};
  const payloadFiles = walkFiles(PAYLOAD);
  const ops = [];
  for (const rel of payloadFiles) {
    const src = join(PAYLOAD, rel);
    const desired = transformBytes(rel, readFileSync(src), placement.root);
    let destRel = mapDestRel(rel, placement.root);
    if (rel === 'playwright.config.example.ts') {
      const rootConfig = join(opts.target, 'playwright.config.ts');
      const kitPlaced = placement.configs.length === 1
        && placement.configs[0] === 'playwright.config.ts'
        && existsSync(rootConfig)
        && readFileSync(rootConfig).equals(desired);
      if (placement.configs.length === 0) destRel = 'playwright.config.ts';
      else if (kitPlaced) {
        ops.push({
          rel, destRel: 'playwright.config.ts', src, dest: rootConfig, desired, existing: readFileSync(rootConfig), action: 'same', protectedFile: true,
        });
        continue;
      } else destRel = 'playwright.config.example.ts';
    }
    const dest = join(opts.target, destRel);
    const exists = existsSync(dest);
    const existing = exists ? readFileSync(dest) : null;
    const protectedFile = rel === 'openspec/quality-policy.md' || (exists && isRealPlaywright(destRel) && destRel !== 'playwright.config.example.ts');
    let action = 'create';
    if (!exists) action = 'create';
    else if (existing.equals(desired)) action = 'same';
    else if (protectedFile) action = 'keep';
    // The stamp records what this kit wrote; an unchanged hash means the user never edited it.
    else if (Object.hasOwn(recordedFiles, destRel) && recordedFiles[destRel] === sha256(existing)) action = 'migrate';
    else if (knownLegacyMatch(existing, rel, placement.root, baselines, stamps)) action = 'migrate';
    else if (opts.force) action = 'overwrite';
    else action = 'skip';
    ops.push({ rel, destRel, src, dest, desired, existing, action, protectedFile });
  }

  const located = locateConfig(opts.target);
  const configBefore = located.exists ? readFileSync(located.path, 'utf8') : null;
  const merged = mergeConfig(configBefore, opts.language);
  const configDest = located.exists ? located.path : join(opts.target, 'openspec/config.yaml');
  const configRel = relative(opts.target, configDest).split(sep).join('/');

  const destRels = [...ops.map(op => op.destRel), configRel, STAMP_FILE];
  const escaped = escapingPaths(opts.target, destRels);
  if (escaped.length) {
    error(`target の外への書き込みを拒否しました: ${escaped.join(', ')}`);
    error('force と dry-run を含め、ファイル・権限・stamp は変更していません。');
    return 1;
  }

  const pending = [];
  const files = {};
  for (const op of ops) {
    if (op.action === 'same' || op.action === 'create' || op.action === 'overwrite' || op.action === 'migrate') {
      files[op.destRel] = sha256(op.desired);
    } else if (isCritical(op.rel) || isCritical(op.destRel)) pending.push(op.destRel);
    if (op.action === 'skip') {
      log(`\n差分あり(上書きしません): ${op.destRel}`);
      if (!op.desired.includes(0) && op.existing && !op.existing.includes(0)) {
        log(unifiedDiff(op.existing.toString('utf8'), op.desired.toString('utf8'), `target/${op.destRel}`, `payload/${op.rel}`));
      }
    }
    if (op.action === 'keep') log(`  保持: ${op.destRel}(--force でも上書きしません)`);
  }
  if (merged.blocked) pending.push(configRel);
  const policyOp = ops.find(op => op.rel === 'openspec/quality-policy.md');
  const policyText = policyOp
    ? (policyOp.action === 'keep' || policyOp.action === 'skip' ? policyOp.existing.toString('utf8') : policyOp.desired.toString('utf8'))
    : '';
  if (policyIssues(policyText).length && !pending.includes('openspec/quality-policy.md')) pending.push('openspec/quality-policy.md');
  pending.sort();
  const status = pending.length ? 'incomplete' : 'complete';
  const body = {
    version,
    e2eRoot: placement.root,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    migration: { status, pending },
    upstream: { qe: QE_SHA, e2e: E2E_SHA, openspec: FORK_BASE },
    openspec: { ready: assessment.openspecReady, version: assessment.version, reason: assessment.reason },
  };
  const coreOf = stamp => JSON.stringify({
    version: stamp.version,
    e2eRoot: stamp.e2eRoot,
    files: stamp.files,
    migration: stamp.migration,
    upstream: stamp.upstream,
    openspec: stamp.openspec,
  });
  const sameBody = previousStamp && coreOf(previousStamp) === coreOf(body);
  const stampWrite = !sameBody;
  const planned = [];
  for (const op of ops) {
    if (op.action === 'create') planned.push(`create  ${op.destRel}`);
    if (op.action === 'overwrite') planned.push(`overwrite ${op.destRel}`);
    if (op.action === 'migrate') planned.push(`migrate ${op.destRel}`);
    if (op.action === 'skip') planned.push(`skip(差分あり) ${op.destRel}`);
    if (op.action === 'keep') planned.push(`keep   ${op.destRel}`);
  }
  for (const note of merged.notes) planned.push(`config  ${note}`);
  if (merged.blocked) planned.push(`keep   ${configRel}`);
  if (stampWrite) planned.push(`stamp   ${STAMP_FILE} (version ${version}, e2eRoot ${placement.root}, migration ${status})`);

  if (!isInsideGitRepo(opts.target)) {
    log(`\n⚠ ${opts.target} は git リポジトリではありません。`);
    if (opts.dryRun) log('  (dry-run のため確認をスキップします)');
    else if (opts.force) log('  --force が指定されているため続行します。');
    else if ((io.stdin ?? process.stdin).isTTY) {
      if (!await confirm(`  このまま${verb}しますか?`, io.stdin ?? process.stdin, io.stdout ?? process.stdout)) {
        log('中止しました。');
        return 0;
      }
    } else {
      error('  対話できない環境です。続行するには --force を指定してください。');
      return 1;
    }
  }

  if (opts.dryRun) {
    log('\n実行予定の操作(書き込みは行っていません):');
    if (!planned.length) log('  (なし)');
    for (const line of planned) log(`  ${line}`);
    for (const warning of merged.warnings) log(`\n⚠ ${warning}`);
    if (status === 'incomplete') {
      log('\n移行状態: incomplete');
      log('統合完了ではありません');
      for (const item of pending) log(`  - ${item}`);
    }
    log('\n次のステップ:');
    log('  1. openspec init --tools <tool>   # 例: --tools claude');
    log('     ※ config.yaml が既にあるため、openspec init に --language を付けるとエラーになります。');
    log('       言語はこの kit の --language で指定してください。');
    log('\ndry-run 完了。書き込みは行っていません。');
    return 0;
  }

  for (const op of ops) {
    if (!['create', 'overwrite', 'migrate'].includes(op.action)) continue;
    writeAtomic(op.dest, op.desired, modeFor(op.src, op.destRel, op.action === 'create' ? null : op.dest));
  }
  if (merged.text !== null && !merged.blocked) writeAtomic(configDest, merged.text, 0o644);
  if (stampWrite) {
    const stamp = { ...body, installedAt: new Date().toISOString() };
    writeAtomic(join(opts.target, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`, 0o644);
  }

  const created = ops.filter(op => op.action === 'create');
  const overwritten = ops.filter(op => op.action === 'overwrite' || op.action === 'migrate');
  const skipped = ops.filter(op => op.action === 'skip');
  log(`\n作成: ${created.length} 件 / 上書き: ${overwritten.length} 件 / 差分により skip: ${skipped.length} 件`);
  for (const note of merged.notes) log(`  config.yaml: ${note}`);
  if (!created.length && !overwritten.length && !merged.notes.length && !stampWrite) log('  変更はありません(既に最新です)。');
  if (skipped.length) {
    log('\n以下のファイルは対象側の内容が異なるため skip しました(上書きするには --force):');
    for (const op of skipped) log(`  - ${op.destRel}`);
  }
  for (const warning of merged.warnings) log(`\n⚠ ${warning}`);
  const ignored = gitIgnored(opts.target, ops.map(op => op.destRel));
  if (ignored.length) {
    log(`\n⚠ 以下の kit のファイルが .gitignore で無視されています(git に載らず、チームで共有されません):`);
    for (const item of ignored) log(`    ${item.path}  (${item.rule})`);
  }
  if (status === 'incomplete') {
    log('\n移行状態: incomplete');
    log('統合完了ではありません');
    log('未移行ファイルと次の操作:');
    for (const item of pending) log(`  - ${item}`);
    log('  配布スクリプトの差分を確認してから再実行してください。独自編集は --force で配布内容に戻ります。');
    log('  openspec/quality-policy.md と実在の Playwright config は --force でも自動変更しません。');
    log('  修復後に node scripts/testkit-gate.mjs doctor が成功するまで統合完了ではありません。');
  } else if (!assessment.openspecReady) {
    log('\nrepo-local のファイルは準備しましたが、統合 ready ではありません。');
  }
  const initialized = existsSync(join(opts.target, 'openspec', 'specs'));
  log('\n次のステップ:');
  if (!initialized) {
    log('  1. openspec init --tools <tool>   # 例: --tools claude');
    log('     ※ config.yaml が既にあるため、openspec init に --language を付けるとエラーになります。');
    log('       言語はこの kit の --language で指定してください。');
  }
  log(`  - openspec schema validate ${SCHEMA_NAME}`);
  log('  - 既定 schema を自動変更しなかった場合: openspec new change <name> --schema quality-driven-e2e');
  log('  - node scripts/testkit-gate.mjs doctor');
  log(`\n${verb}が完了しました。`);
  return 0;
}
