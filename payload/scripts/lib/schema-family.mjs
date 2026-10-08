import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_E2E, SCHEMA_INTEGRATED, SCHEMA_QE } from './critical.mjs';
import { isPlainMapping, parseYamlText } from './frontmatter.mjs';
import { git } from './git.mjs';

// Public module: add-on kits may import it to tell whether a schema belongs to the integrated family.
// A declaration only ever adds the integrated gates; nothing here can weaken or skip them.

export const SCHEMAS_ROOT = 'openspec/schemas';
export const COMPAT_FILE = 'testkit-compat.json';
export const COMPAT_VERSION = 1;
export const RESERVED_SCHEMAS = [SCHEMA_INTEGRATED, SCHEMA_QE, SCHEMA_E2E, 'spec-driven'];
export const REQUIRED_TEMPLATES = ['evidence.md', 'qa-handoff.md'];

// Names that can be a single directory under openspec/schemas/. Anything else never has a declaration.
function isSchemaDirName(name) {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name);
}

// Reads files from the work tree, or from `rev`. A git failure throws instead of looking like an absent file.
function sourceOf(repo, rev) {
  if (!rev) {
    return {
      exists: rel => existsSync(join(repo, rel)),
      read: rel => (existsSync(join(repo, rel)) ? readFileSync(join(repo, rel), 'utf8') : null),
    };
  }
  const exists = rel => git(repo, ['ls-tree', '-z', '--full-tree', rev, '--', rel]).length > 0;
  return {
    exists,
    read: rel => (exists(rel) ? git(repo, ['show', `${rev}:${rel}`], { maxBuffer: 10 * 1024 * 1024 }) : null),
  };
}

function compatPath(name) {
  return `${SCHEMAS_ROOT}/${name}/${COMPAT_FILE}`;
}

function schemaPath(name) {
  return `${SCHEMAS_ROOT}/${name}/schema.yaml`;
}

function readSchemaYaml(source, rel) {
  const text = source.read(rel);
  if (text == null) return { error: `${rel} がありません` };
  const parsed = parseYamlText(text);
  if (parsed.errors.length || parsed.alias || parsed.tagged || !isPlainMapping(parsed.data)) {
    return { error: `${rel} を解釈できません: ${parsed.errors[0] || 'alias・独自 tag のない YAML mapping が必要です'}` };
  }
  return { data: parsed.data };
}

function artifactsOf(data) {
  const map = new Map();
  for (const artifact of Array.isArray(data.artifacts) ? data.artifacts : []) {
    if (isPlainMapping(artifact) && typeof artifact.id === 'string') map.set(artifact.id, artifact);
  }
  return map;
}

function listOf(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

// Differences that keep `derived` from being a superset of the integrated schema.
function structureErrors(integrated, derived) {
  const errors = [];
  const theirs = artifactsOf(derived);
  for (const [id, expected] of artifactsOf(integrated)) {
    const actual = theirs.get(id);
    if (!actual) {
      errors.push(`artifact ${id} がありません`);
      continue;
    }
    if (actual.generates !== expected.generates) {
      errors.push(`artifact ${id} の generates が統合 schema と違います（期待: ${expected.generates}、実際: ${actual.generates ?? '(なし)'}）`);
    }
    const requires = listOf(actual.requires);
    const missing = listOf(expected.requires).filter(dep => !requires.includes(dep));
    if (missing.length) errors.push(`artifact ${id} の requires に ${missing.join(', ')} がありません`);
  }
  const expectedApply = isPlainMapping(integrated.apply) ? integrated.apply : {};
  const apply = isPlainMapping(derived.apply) ? derived.apply : {};
  const applyMissing = listOf(expectedApply.requires).filter(dep => !listOf(apply.requires).includes(dep));
  if (applyMissing.length) errors.push(`apply.requires に ${applyMissing.join(', ')} がありません`);
  if (apply.tracks !== expectedApply.tracks) errors.push(`apply.tracks は ${expectedApply.tracks} が必要です（実際: ${apply.tracks ?? '(なし)'}）`);
  return errors;
}

function declarationErrors(source, name, data) {
  const errors = [];
  if (!isPlainMapping(data)) return ['JSON object が必要です'];
  if (data.extends !== SCHEMA_INTEGRATED) errors.push(`extends は ${SCHEMA_INTEGRATED} だけに対応しています（実際: ${JSON.stringify(data.extends)}）`);
  if (data.compatVersion !== COMPAT_VERSION) errors.push(`compatVersion は ${COMPAT_VERSION} だけに対応しています（実際: ${JSON.stringify(data.compatVersion)}）`);
  if (RESERVED_SCHEMAS.includes(name)) errors.push(`${name} は予約された schema 名なので派生 schema にできません`);
  if (errors.length) return errors;
  const derived = readSchemaYaml(source, schemaPath(name));
  if (derived.error) return [derived.error];
  if (derived.data.name !== name) errors.push(`schema.yaml の name (${derived.data.name ?? '(なし)'}) がディレクトリ名 ${name} と一致しません`);
  const integrated = readSchemaYaml(source, schemaPath(SCHEMA_INTEGRATED));
  if (integrated.error) return [...errors, `比較元の統合 schema を読めません: ${integrated.error}`];
  errors.push(...structureErrors(integrated.data, derived.data));
  for (const template of REQUIRED_TEMPLATES) {
    if (!source.exists(`${SCHEMAS_ROOT}/${name}/templates/${template}`)) errors.push(`templates/${template} がありません`);
  }
  return errors;
}

// The compatibility declaration of a project-local schema, read from the work tree or from `rev`.
// - { exists: false }: no declaration (or a name that cannot be a schema directory)
// - { exists: true, valid: true }
// - { exists: true, valid: false, errors }: the declaration or the schema it describes is invalid
// - { exists: null, gitError }: git could not read `rev`; never treated as "no declaration"
export function readCompatDeclaration(repo, name, { rev = null } = {}) {
  if (!isSchemaDirName(name)) return { exists: false, path: null };
  const path = compatPath(name);
  try {
    const source = sourceOf(repo, rev);
    const text = source.read(path);
    if (text == null) return { exists: false, path };
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { exists: true, valid: false, path, errors: [`JSON として読めません: ${err.message}`] };
    }
    const errors = declarationErrors(source, name, data);
    return errors.length ? { exists: true, valid: false, path, errors } : { exists: true, valid: true, path, errors: [] };
  } catch (err) {
    return { exists: null, path, gitError: `${rev} の ${path} を読めません: ${err.message}` };
  }
}

// The family a change's schema is gated as.
// - family: quality-driven-e2e for the integrated schema and valid derived schemas, the schema itself without a
//   declaration, and null with `error` when the declaration is invalid or unreadable
// - declared: the schema name as written; derived: true only for a valid derived schema
// - unreadable: true only when git could not read `rev`
export function resolveSchemaFamily(repo, schema, { rev = null } = {}) {
  if (!schema || RESERVED_SCHEMAS.includes(schema)) return { family: schema || null, declared: schema || null, derived: false, error: null };
  const declaration = readCompatDeclaration(repo, schema, { rev });
  if (declaration.gitError) return { family: null, declared: schema, derived: false, error: declaration.gitError, unreadable: true };
  if (!declaration.exists) return { family: schema, declared: schema, derived: false, error: null };
  if (!declaration.valid) {
    return { family: null, declared: schema, derived: false, error: `${declaration.path} が無効です: ${declaration.errors.join(' / ')}` };
  }
  return { family: SCHEMA_INTEGRATED, declared: schema, derived: true, error: null };
}

export function isIntegratedFamily(repo, schema, options) {
  return resolveSchemaFamily(repo, schema, options).family === SCHEMA_INTEGRATED;
}

// Every project-local schema directory that carries a declaration, valid or not, sorted by name.
export function listDerivedSchemas(repo) {
  const root = join(repo, SCHEMAS_ROOT);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, COMPAT_FILE)))
    .map(entry => entry.name)
    .sort()
    .map(name => {
      const declaration = readCompatDeclaration(repo, name);
      return { name, path: declaration.path, valid: declaration.valid === true, errors: declaration.errors ?? [] };
    });
}
