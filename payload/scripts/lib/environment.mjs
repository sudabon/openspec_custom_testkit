import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseYamlText } from './frontmatter.mjs';
import { FORK_BASE } from './critical.mjs';

export function versionLessThan(left, right) {
  const a = String(left).split('.').map(part => Number(part) || 0);
  const b = String(right).split('.').map(part => Number(part) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

function run(execFile, cmd, args, cwd) {
  try {
    const stdout = execFile(cmd, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: String(stdout ?? ''), error: null };
  } catch (err) {
    return {
      code: err.code === 'ENOENT' ? 'ENOENT' : (err.status ?? 1),
      stdout: err.stdout?.toString?.() ?? '',
      stderr: err.stderr?.toString?.() ?? '',
      error: err,
    };
  }
}

export function locateConfig(target) {
  const yaml = join(target, 'openspec', 'config.yaml');
  const yml = join(target, 'openspec', 'config.yml');
  if (existsSync(yaml)) return { path: yaml, exists: true, sibling: existsSync(yml) ? yml : null };
  if (existsSync(yml)) return { path: yml, exists: true, sibling: null };
  return { path: yaml, exists: false, sibling: null };
}

export function readConfigDocument(target) {
  const located = locateConfig(target);
  if (!located.exists) return { located, text: null, parsed: null };
  const text = readFileSync(located.path, 'utf8');
  return { located, text, parsed: parseYamlText(text) };
}

function storeDeclared(text, parsed) {
  if (parsed && !parsed.errors.length && parsed.data && typeof parsed.data === 'object') {
    const value = parsed.data.store;
    return Boolean(value && (typeof value !== 'string' || value.trim()));
  }
  return String(text ?? '').split('\n').some(line => /^store\s*:/.test(line) && !line.trim().startsWith('#'));
}

function canonicalPath(path) {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function existingAncestor(root) {
  let cur = root;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return process.cwd();
    cur = parent;
  }
  return cur;
}

export function assessTarget(target, options = {}) {
  const execFile = options.execFile ?? execFileSync;
  const root = resolve(target);
  const config = options.config ?? readConfigDocument(root);
  const probeCwd = existingAncestor(root);
  const messages = [];
  const store = config.text != null && storeDeclared(config.text, config.parsed);
  if (config.located?.sibling) {
    messages.push('openspec/config.yml は正本にしません。openspec/config.yaml だけを読みます。');
  }
  const verdict = (allowWrite, version, reason, message) => ({
    allowWrite, openspecReady: false, version, reason, messages: [...messages, message],
  });

  const { version, cliMissing } = probeCli(execFile, probeCwd);
  if (store && cliMissing) {
    return verdict(false, null, 'store-unresolved', 'store 宣言を OpenSpec CLI で確認できないため、配置しません。repo-local の openspec も代替作成しません。');
  }
  const context = cliMissing ? null : readContext(execFile, probeCwd);
  if (store) {
    return verdict(false, version, 'store', 'このプロジェクトは store に計画を委譲しています。初期版は repo-local だけを配置し、store と代替のローカル openspec には書き込みません。');
  }
  if (resolvesOutside(context, root)) {
    return verdict(false, version, 'external-root', `OpenSpec の解決先が target の外です (${context.root.path}, source=${context.root.source ?? 'unknown'})。外部 store や global defaultStore には配置しません。`);
  }
  if (cliMissing) {
    return verdict(true, null, 'cli-missing', 'OpenSpec CLI が無いため repo-local のファイル準備だけを行います。doctor の版確認が済むまで統合 ready ではありません。');
  }
  if (versionLessThan(version, FORK_BASE)) {
    return verdict(true, version, 'version', `OpenSpec ${version} は fork 基準 ${FORK_BASE} より古いため、統合 ready とは報告しません。`);
  }
  return { allowWrite: true, openspecReady: true, version, reason: 'ok', messages };
}

function probeCli(execFile, cwd) {
  const versionRun = run(execFile, 'openspec', ['--version'], cwd);
  const version = versionRun.code === 0 ? versionRun.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null : null;
  return { version, cliMissing: versionRun.code === 'ENOENT' || version == null };
}

// `openspec context --json`, or null when it prints nothing or is not JSON.
function readContext(execFile, cwd) {
  const contextRun = run(execFile, 'openspec', ['context', '--json'], cwd);
  if (!contextRun.stdout.trim()) return null;
  try {
    return JSON.parse(contextRun.stdout);
  } catch {
    return null;
  }
}

function resolvesOutside(context, root) {
  if (!context?.root?.path) return false;
  const contextRoot = canonicalPath(context.root.path);
  return contextRoot !== canonicalPath(root) || Boolean(context.root.source && context.root.source !== 'nearest');
}
