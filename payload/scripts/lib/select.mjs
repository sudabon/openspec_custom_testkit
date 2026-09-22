import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_E2E, SCHEMA_INTEGRATED, SCHEMA_QE } from './critical.mjs';
import { readConfigDocument } from './environment.mjs';
import { asString, parseYamlText, splitFrontmatter } from './frontmatter.mjs';
import { git, gitShow, parseNameStatus } from './git.mjs';

function stripArchiveId(folder) {
  const match = folder.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return match ? match[1] : folder;
}

function readSchemaText(repo, dir, rev) {
  const rel = `${dir}/.openspec.yaml`;
  if (rev) return gitShow(repo, rev, rel);
  const abs = join(repo, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

function interpretSchema(text) {
  if (text == null) return { schema: null, missing: true, broken: false };
  const parsed = parseYamlText(text);
  if (parsed.errors.length || parsed.alias || parsed.tagged) {
    return { schema: null, missing: false, broken: true, error: parsed.errors[0] || 'metadata を解釈できません' };
  }
  const schema = asString(parsed.data?.schema);
  const skipSpecs = parsed.data?.skip_specs === true;
  if (!schema) return { schema: null, missing: true, broken: false, skipSpecs };
  return { schema, missing: false, broken: false, skipSpecs };
}

function configSchema(repo) {
  const config = readConfigDocument(repo);
  if (!config.text || config.parsed?.errors?.length) return null;
  return asString(config.parsed?.data?.schema) || null;
}

function applicability(repo, dir, schema) {
  if (schema === SCHEMA_E2E) return { e2e: 'required', reason: '旧 spec-driven-e2e は e2e キーなしで required', scope: 'legacy-e2e' };
  if (schema === SCHEMA_QE) return { e2e: 'not-applicable', reason: '旧 quality-driven は E2E 対象外', scope: 'legacy-qe' };
  if (schema !== SCHEMA_INTEGRATED) {
    return { e2e: 'not-applicable', reason: `無関係な schema: ${schema}`, scope: 'out-of-scope' };
  }
  const planPath = join(repo, dir, 'test-plan.md');
  if (!existsSync(planPath)) return { e2e: 'unknown', reason: 'test-plan は未作成', scope: 'integrated', pendingPlan: true };
  const frontmatter = splitFrontmatter(readFileSync(planPath, 'utf8'));
  if (frontmatter.error) return { e2e: 'unknown', reason: frontmatter.error, scope: 'integrated' };
  if (!frontmatter.has || !Object.prototype.hasOwnProperty.call(frontmatter.data, 'e2e')) {
    return { e2e: 'unknown', reason: 'e2e が欠落しています', scope: 'integrated' };
  }
  const value = frontmatter.data.e2e;
  if (value === 'required' || value === 'not-applicable') {
    return { e2e: value, reason: value === 'not-applicable' ? asString(frontmatter.data.reason) : '', scope: 'integrated' };
  }
  return { e2e: 'unknown', reason: `e2e の値が不正です: ${value}`, scope: 'integrated' };
}

function decorate(repo, record, baseRef, env) {
  const head = record.lifecycle === 'deleted'
    ? { schema: null, missing: true, broken: false }
    : interpretSchema(readSchemaText(repo, record.dir, null));
  const base = baseRef ? interpretSchema(readSchemaText(repo, record.baseDir ?? record.dir, baseRef)) : { schema: null, missing: true, broken: false };
  const errors = [];
  let schema = head.schema;
  let forcedIntegrated = false;
  let unknown = false;
  let fallback = false;

  if (head.broken) {
    errors.push(head.error || 'metadata が破損しています');
    unknown = true;
    if (base.schema === SCHEMA_INTEGRATED) {
      forcedIntegrated = true;
      schema = SCHEMA_INTEGRATED;
    }
  } else if (!schema) {
    if (base.schema === SCHEMA_INTEGRATED || base.broken) {
      forcedIntegrated = true;
      schema = SCHEMA_INTEGRATED;
      unknown = false;
      errors.push('比較元が統合 schema の change から metadata が失われています。config へはフォールバックしません。');
    } else if (record.lifecycle === 'deleted') {
      schema = base.schema;
    } else {
      const configured = configSchema(repo) || 'spec-driven';
      if (configured === SCHEMA_INTEGRATED) {
        unknown = true;
        errors.push('.openspec.yaml が無いため、統合 schema の検査を対象外にしません');
      } else {
        schema = configured;
        fallback = true;
      }
    }
  }

  if (record.lifecycle === 'deleted') {
    const shown = schema || base.schema || 'unknown';
    if (shown === SCHEMA_INTEGRATED || shown === SCHEMA_QE || shown === SCHEMA_E2E || unknown || forcedIntegrated) {
      errors.push(`archive せず削除されています (比較元 schema: ${base.schema || shown})`);
    }
  }

  const described = applicability(repo, record.lifecycle === 'deleted' ? (record.baseDir ?? record.dir) : record.dir, forcedIntegrated ? SCHEMA_INTEGRATED : schema);
  if (record.lifecycle === 'deleted' && !existsSync(join(repo, record.dir))) {
    described.e2e = unknown || forcedIntegrated ? 'unknown' : described.e2e;
  }
  if (unknown && !forcedIntegrated) {
    described.e2e = 'unknown';
    described.scope = 'unknown';
    described.reason = errors[0] || '判定不能';
    described.pendingPlan = false;
  }
  if (described.e2e === 'unknown' && !described.pendingPlan && !errors.includes(described.reason)) {
    errors.push(described.reason || 'e2e を判定できません');
  }
  if (forcedIntegrated) described.scope = 'integrated';

  const filter = env.QE_SCHEMA ?? SCHEMA_QE;
  const qe = forcedIntegrated || schema === SCHEMA_INTEGRATED || unknown || schema === filter;
  const tasks = existsSync(join(repo, record.dir, 'tasks.md'))
    ? readFileSync(join(repo, record.dir, 'tasks.md'), 'utf8')
    : null;

  return {
    id: record.id,
    path: record.dir,
    schema: schema || null,
    lifecycle: record.lifecycle,
    qe,
    e2e: described.e2e,
    scope: described.scope,
    reason: described.reason,
    errors,
    fallback,
    skipSpecs: head.skipSpecs === true,
    pendingPlan: described.pendingPlan === true,
    tasksText: tasks,
  };
}

function recordsFromDiff(repo, baseRef, diffText) {
  const entries = parseNameStatus(diffText);
  const activeIds = new Set();
  const archiveFolders = new Set();
  for (const entry of entries) {
    for (const filePath of [entry.path, entry.oldPath]) {
      if (!filePath) continue;
      const archive = filePath.match(/^openspec\/changes\/archive\/([^/]+)\//);
      const active = filePath.match(/^openspec\/changes\/([^/]+)\//);
      if (archive) archiveFolders.add(archive[1]);
      else if (active && active[1] !== 'archive') activeIds.add(active[1]);
    }
  }
  const records = [];
  const consumed = new Set();
  for (const folder of [...archiveFolders].sort()) {
    const id = stripArchiveId(folder);
    const dir = `openspec/changes/archive/${folder}`;
    const existed = gitShow(repo, baseRef, `${dir}/.openspec.yaml`) != null
      || gitOptionalName(repo, baseRef, dir);
    if (!existed) consumed.add(id);
    records.push({
      id,
      lifecycle: 'archived',
      dir,
      baseDir: existed ? dir : `openspec/changes/${id}`,
    });
  }
  for (const id of [...activeIds].sort()) {
    const dir = `openspec/changes/${id}`;
    if (!existsSync(join(repo, dir))) {
      if (consumed.has(id)) continue;
      records.push({ id, lifecycle: 'deleted', dir, baseDir: dir });
    } else {
      records.push({ id, lifecycle: 'active', dir, baseDir: dir });
    }
  }
  return records;
}

function gitOptionalName(repo, rev, dir) {
  const shown = gitShow(repo, rev, `${dir}/proposal.md`);
  return shown != null;
}

function allActive(repo) {
  const root = join(repo, 'openspec/changes');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'archive')
    .map(entry => ({ id: entry.name, lifecycle: 'active', dir: `openspec/changes/${entry.name}`, baseDir: `openspec/changes/${entry.name}` }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function resolveNamed(repo, name, baseRef) {
  const active = `openspec/changes/${name}`;
  if (existsSync(join(repo, active))) return { id: name, lifecycle: 'active', dir: active, baseDir: active };
  const archiveRoot = join(repo, 'openspec/changes/archive');
  if (existsSync(archiveRoot)) {
    const folder = readdirSync(archiveRoot).find(entry => entry === name || stripArchiveId(entry) === name);
    if (folder && existsSync(join(archiveRoot, folder))) {
      const dir = `openspec/changes/archive/${folder}`;
      return { id: stripArchiveId(folder), lifecycle: 'archived', dir, baseDir: dir };
    }
  }
  if (baseRef && gitShow(repo, baseRef, `${active}/.openspec.yaml`) != null) {
    return { id: name, lifecycle: 'deleted', dir: active, baseDir: active };
  }
  return null;
}

export function selectChanges({ repo, base, names = [], env = process.env }) {
  let baseRef = null;
  if (base) {
    try {
      baseRef = git(repo, ['merge-base', base, 'HEAD']).trim();
    } catch (err) {
      return { ok: false, exitCode: 2, error: `比較元refを解決できません: ${base} (${err.message})`, changes: [] };
    }
  }
  let records = [];
  if (names.length) {
    for (const name of names) {
      const found = resolveNamed(repo, name, baseRef);
      if (!found) return { ok: false, exitCode: 2, error: `change が存在しません: ${name}`, changes: [] };
      records.push(found);
    }
  } else if (baseRef) {
    let diff = '';
    try {
      diff = git(repo, ['diff', '-z', '--name-status', baseRef, 'HEAD', '--', 'openspec/changes']);
    } catch (err) {
      return { ok: false, exitCode: 2, error: `差分を取得できません: ${err.message}`, changes: [] };
    }
    records = recordsFromDiff(repo, baseRef, diff);
  } else {
    records = allActive(repo);
  }
  const changes = records.map(record => decorate(repo, record, baseRef, env));
  const failed = changes.some(change => change.errors.length || (change.e2e === 'unknown' && !change.pendingPlan));
  return { ok: !failed, exitCode: failed ? 1 : 0, error: null, changes, base: baseRef };
}
