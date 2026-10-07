import { parseDocument, visit } from './vendor/yaml.mjs';

// A YAML node carrying a tag outside the core schema (for example `!secret`).
export function isCustomTag(node) {
  return Boolean(node?.tag) && !String(node.tag).startsWith('tag:yaml.org,2002:');
}

// A parsed value that is a mapping (object), not null, a scalar or a sequence.
export function isPlainMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseYamlText(text) {
  let doc;
  try {
    doc = parseDocument(String(text), { prettyErrors: false });
  } catch (err) {
    return { doc: null, data: null, errors: [err.message], alias: false, tagged: false };
  }
  const errors = (doc.errors ?? []).map(error => error.message);
  let alias = false;
  let tagged = false;
  try {
    visit(doc, {
      Alias() {
        alias = true;
      },
      Value(_key, node) {
        if (isCustomTag(node)) tagged = true;
      },
    });
  } catch {
    errors.push('YAML の構造を検査できません');
  }
  let data = null;
  if (!errors.length) {
    try { data = doc.toJS(); }
    catch (err) { errors.push(err.message); }
  }
  return {
    doc,
    data,
    errors,
    alias,
    tagged,
  };
}

export function splitFrontmatter(text) {
  const source = String(text);
  const opening = source.match(/^---(?:\r\n|\n|\r)/);
  if (!opening) return { has: false, data: {}, body: source, raw: '', error: null };
  const closing = /(?:\r\n|\n|\r)---[ \t]*(?:(?:\r\n|\n|\r)|$)/.exec(source.slice(3));
  if (!closing) return { has: true, data: null, body: source, raw: '', error: 'frontmatter が閉じていません' };
  const end = 3 + closing.index;
  const raw = source.slice(opening[0].length, end);
  const body = source.slice(end + closing[0].length);
  const parsed = parseYamlText(raw.replace(/\r\n|\r/g, '\n'));
  if (parsed.errors.length || parsed.alias || parsed.tagged) {
    return {
      has: true,
      data: null,
      body,
      raw,
      error: parsed.errors[0] || (parsed.alias ? 'alias は使えません' : '未対応の tag です'),
    };
  }
  return { has: true, data: parsed.data ?? {}, body, raw, error: null };
}

export function setFrontmatterScalar(text, key, value) {
  const lines = String(text).split(/(\r\n|\n|\r)/);
  let inFrontmatter = false;
  let found = false;
  for (let i = 0; i < lines.length; i += 2) {
    if (i === 0 && lines[i] === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && lines[i] === '---') break;
    if (inFrontmatter && new RegExp(`^${key}:`).test(lines[i])) {
      lines[i] = `${key}: "${value}"`;
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`frontmatter に ${key} がありません`);
  return lines.join('');
}

export function asString(value) {
  return value == null ? '' : String(value).trim();
}

export function asList(value) {
  if (Array.isArray(value)) return value.map(item => (typeof item === 'string' ? item.trim() : item)).filter(item => item !== '');
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// YYYY-MM-DD of a timestamp in UTC.
export function utcDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}
