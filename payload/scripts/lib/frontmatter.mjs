import { parseDocument, visit } from './vendor/yaml.mjs';

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
      Scalar(_key, node) {
        if (node?.tag && !String(node.tag).startsWith('tag:yaml.org,2002:')) tagged = true;
      },
      Map(_key, node) {
        if (node?.tag && !String(node.tag).startsWith('tag:yaml.org,2002:')) tagged = true;
      },
      Seq(_key, node) {
        if (node?.tag && !String(node.tag).startsWith('tag:yaml.org,2002:')) tagged = true;
      },
    });
  } catch {
    errors.push('YAML の構造を検査できません');
  }
  return {
    doc,
    data: errors.length ? null : doc.toJS(),
    errors,
    alias,
    tagged,
  };
}

export function splitFrontmatter(text) {
  const source = String(text);
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { has: false, data: {}, body: source, raw: '', error: null };
  }
  const end = source.search(/\r?\n---\s*(?:\r?\n|$)/);
  if (end === -1) return { has: true, data: null, body: source, raw: '', error: 'frontmatter が閉じていません' };
  const raw = source.slice(source.indexOf('\n') + 1, end);
  const parsed = parseYamlText(raw);
  if (parsed.errors.length || parsed.alias || parsed.tagged) {
    return {
      has: true,
      data: null,
      body: source.slice(end).replace(/^\r?\n---\s*/, ''),
      raw,
      error: parsed.errors[0] || (parsed.alias ? 'alias は使えません' : '未対応の tag です'),
    };
  }
  const fence = source.slice(end).match(/^\r?\n---\s*/);
  const body = source.slice(end + (fence ? fence[0].length : 0));
  return { has: true, data: parsed.data ?? {}, body, raw, error: null };
}

export function setFrontmatterScalar(text, key, value) {
  const newline = String(text).includes('\r\n') ? '\r\n' : '\n';
  const lines = String(text).split(/\r?\n/);
  let inFrontmatter = false;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
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
  return lines.join(newline);
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
