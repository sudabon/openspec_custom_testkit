import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfigDocument } from './environment.mjs';
import { asString, isPlainMapping, parseYamlText, splitFrontmatter } from './frontmatter.mjs';
import { gitShow } from './git.mjs';
import { RISK_LEVELS } from './policy.mjs';

// Reads <dir>/.openspec.yaml from the work tree, or from `rev` when given. Callers build their own messages
// from `problem`, which is checked in this order:
// - 'yaml': parse errors, an alias or a custom tag (data is null)
// - 'mapping': strict only; the document is not a mapping (data is null)
// - 'schema': strict only; schema is present but not a string (data is still returned)
// strict keeps the effort, coverage and plan-check behavior; non-strict keeps select's, which accepts any
// document that parses.
export function readChangeMetadata(repo, dir, { rev = null, strict = true } = {}) {
  const rel = `${dir}/.openspec.yaml`;
  const abs = join(repo, rel);
  const text = rev ? gitShow(repo, rev, rel) : (existsSync(abs) ? readFileSync(abs, 'utf8') : null);
  if (text == null) return { missing: true, problem: null, errors: [], data: null, schema: null, skipSpecs: false };
  const parsed = parseYamlText(text);
  const base = { missing: false, problem: null, errors: parsed.errors, data: null, schema: null, skipSpecs: false };
  if (parsed.errors.length || parsed.alias || parsed.tagged) return { ...base, problem: 'yaml' };
  if (strict && !isPlainMapping(parsed.data)) return { ...base, problem: 'mapping' };
  const data = parsed.data;
  const problem = strict && data.schema != null && typeof data.schema !== 'string' ? 'schema' : null;
  return { ...base, problem, data, schema: asString(data?.schema) || null, skipSpecs: data?.skip_specs === true };
}

// The schema declared in openspec/config.yaml (or config.yml).
// strict (effort): aliases, custom tags, a non-mapping document or a non-string schema make it invalid.
// non-strict (select): only parse errors make it invalid.
export function readDefaultSchema(repo, { strict = true } = {}) {
  const config = readConfigDocument(repo);
  const path = config.located.path;
  if (config.text == null) return { path, invalid: false, errors: [], schema: null };
  const parsed = config.parsed;
  const invalid = parsed.errors.length > 0 || (strict && (parsed.alias || parsed.tagged
    || (parsed.data != null && !isPlainMapping(parsed.data))
    || (parsed.data?.schema != null && typeof parsed.data.schema !== 'string')));
  return { path, invalid, errors: parsed.errors, schema: invalid ? null : asString(parsed.data?.schema) || null };
}

// risk_level from <dir>/quality.md. Read errors propagate to the caller.
// `level` is the declared value when valid, otherwise 'unknown'.
export function readRiskLevel(repo, dir) {
  const path = join(repo, dir, 'quality.md');
  if (!existsSync(path)) return { exists: false, error: null, declared: '', level: 'unknown' };
  const parsed = splitFrontmatter(readFileSync(path, 'utf8'));
  const declared = asString(parsed.data?.risk_level);
  return { exists: true, error: parsed.error, declared, level: RISK_LEVELS.includes(declared) ? declared : 'unknown' };
}
