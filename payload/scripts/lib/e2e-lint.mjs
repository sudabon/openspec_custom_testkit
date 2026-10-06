import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { SCHEMA_INTEGRATED } from './critical.mjs';
import { installedE2eRoot } from './e2e-root.mjs';
import { executionBlock } from './evidence-check.mjs';
import { listFiles } from './files.mjs';
import { asString, validDate } from './frontmatter.mjs';
import { git, parseNameStatus } from './git.mjs';
import { hasBoundedToken } from './markdown.mjs';
import { checkTestPlan } from './plan-check.mjs';
import { e2eLintPolicy } from './policy.mjs';

export const RULES = [
  'fixed-wait',
  'forbidden-locator',
  'excluded-test',
  'missing-tag',
  'missing-assertion',
  'weak-assertion',
  'unparseable',
  'unreadable',
  'invalid-suppression',
];

// Existence-only matchers. Kept as a kit constant: projects cannot shrink it through settings.
export const WEAK_MATCHERS = ['toBeVisible', 'toBeAttached', 'toBeDefined', 'toBeTruthy', 'not.toBeNull', 'not.toBeUndefined'];

const LINT_SOURCE = /\.(?:[cm]?[jt]sx?)$/i;
const UNSUPPORTED_SOURCE = /\.feature$/i;
const JSX_SOURCE = /\.[jt]sx$/i;
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const MODIFIERS = new Set(['skip', 'only', 'fixme', 'fail']);
const EXCLUDING = new Set(['skip', 'fixme', 'fail']);
const DESCRIBE_MODES = new Set(['serial', 'parallel']);
const TEST_ROOTS = new Set(['test', 'it']);
const EXPECT_FORMS = new Set(['soft', 'poll']);
const EXPECT_FLAGS = new Set(['not', 'resolves', 'rejects']);
const NEUTRAL_MATCHERS = new Set(['toPass']);
const CSS_LOCATORS = new Set(['locator', '$', '$$', '$eval', '$$eval']);
// Methods whose first argument is a selector, so an XPath string there is a locator.
const SELECTOR_METHODS = new Set([
  ...CSS_LOCATORS, 'waitForSelector', 'frameLocator', 'click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck',
  'hover', 'focus', 'tap', 'textContent', 'innerText', 'innerHTML', 'getAttribute', 'isVisible', 'isHidden',
  'isEnabled', 'isDisabled', 'isChecked', 'isEditable', 'selectOption', 'setInputFiles', 'dispatchEvent', 'dragAndDrop',
]);
const XPATH = /^\s*(?:xpath=|\(*\/\/|\.\.?\/)/;
const KEYWORDS_BEFORE_EXPRESSION = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
const CONTINUES_AFTER = new Set(['.', '?.', ',', '=', '=>', '+', '-', '*', '/', '%', '&', '|', '^', '?', ':', '<', '...']);
const CONTINUES_BEFORE = new Set(['.', '?.', ',', '=', '=>', '+', '-', '*', '/', '%', '&', '|', '^', '?', ':', '<', '>']);
const KEYWORDS_CONTINUING = new Set([...KEYWORDS_BEFORE_EXPRESSION, 'async', 'export', 'default', 'const', 'let', 'var', 'function', 'class', 'import', 'from']);
const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);
const IDENT_START = /[\p{ID_Start}$_#\\]/u;
const IDENT_PART = /[\p{ID_Continue}$‌‍\\]/u;
const SUPPRESSION = /^\s*e2e-lint-allow\b/;
const SUPPRESSION_FORMAT = /^\s*e2e-lint-allow\s+([a-z-]+)(?:\s+([^\s:]+))?\s*:\s*(\S.*)?$/;

class LexError extends Error {
  constructor(message, offset) {
    super(message);
    this.offset = offset;
  }
}

// ---------------------------------------------------------------------------
// Lexer: keeps comments, strings, templates, regex literals and JSX text apart
// from code. Template and JSX expressions become nested token sequences.

function lex(src, { jsx = false } = {}) {
  const comments = [];
  let pos = 0;

  function readString(quote) {
    const start = pos;
    let value = '';
    pos++;
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === '\\') {
        const next = src[pos + 1] ?? '';
        value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        pos += 2;
      } else if (ch === quote) {
        pos++;
        return { type: 'string', value, start, end: pos };
      } else if (ch === '\n' || ch === '\r') {
        break;
      } else {
        value += ch;
        pos++;
      }
    }
    throw new LexError('閉じていない文字列リテラルがあります', start);
  }

  function readTemplate() {
    const start = pos;
    const exprs = [];
    let value = '';
    pos++;
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === '\\') {
        value += src.slice(pos, pos + 2);
        pos += 2;
      } else if (ch === '`') {
        pos++;
        return { type: 'template', value, start, end: pos, exprs };
      } else if (ch === '$' && src[pos + 1] === '{') {
        pos += 2;
        exprs.push(scan(true));
        pos++;
        value += '${…}';
      } else {
        value += ch;
        pos++;
      }
    }
    throw new LexError('閉じていないテンプレートリテラルがあります', start);
  }

  function readRegex() {
    const start = pos;
    let inClass = false;
    pos++;
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === '\\') pos += 2;
      else if (ch === '\n' || ch === '\r') break;
      else {
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) {
          pos++;
          while (pos < src.length && IDENT_PART.test(src[pos])) pos++;
          return { type: 'regex', value: src.slice(start, pos), start, end: pos };
        }
        pos++;
      }
    }
    throw new LexError('閉じていない正規表現リテラルがあります', start);
  }

  function skipSpace() {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  }

  function readJsxName(start) {
    const from = pos;
    while (pos < src.length && /[\p{ID_Continue}$.:-]/u.test(src[pos])) pos++;
    if (pos === from) throw new LexError('JSX を解析できません', start);
    return src.slice(from, pos);
  }

  function readJsxExpression(exprs) {
    pos++;
    exprs.push(scan(true));
    pos++;
  }

  function readJsxChildren(exprs, start) {
    while (pos < src.length) {
      if (src.startsWith('</', pos)) {
        const close = src.indexOf('>', pos);
        if (close === -1) break;
        pos = close + 1;
        return;
      }
      if (src[pos] === '<') exprs.push([readJsxElement()]);
      else if (src[pos] === '{') readJsxExpression(exprs);
      else pos++;
    }
    throw new LexError('閉じていない JSX 要素があります', start);
  }

  function readJsxElement() {
    const start = pos;
    const exprs = [];
    pos++;
    if (src[pos] === '>') {
      pos++;
      readJsxChildren(exprs, start);
      return { type: 'jsx', value: '<>', start, end: pos, exprs };
    }
    const name = readJsxName(start);
    for (;;) {
      skipSpace();
      if (pos >= src.length) throw new LexError('閉じていない JSX 要素があります', start);
      if (src.startsWith('/>', pos)) {
        pos += 2;
        break;
      }
      if (src[pos] === '>') {
        pos++;
        readJsxChildren(exprs, start);
        break;
      }
      if (src[pos] === '{') {
        readJsxExpression(exprs);
        continue;
      }
      readJsxName(start);
      skipSpace();
      if (src[pos] !== '=') continue;
      pos++;
      skipSpace();
      const ch = src[pos];
      if (ch === '"' || ch === "'") {
        const close = src.indexOf(ch, pos + 1);
        if (close === -1) throw new LexError('閉じていない JSX 属性があります', start);
        pos = close + 1;
      } else if (ch === '{') readJsxExpression(exprs);
      else if (ch === '<') exprs.push([readJsxElement()]);
      else throw new LexError('JSX を解析できません', start);
    }
    return { type: 'jsx', value: `<${name}>`, start, end: pos, exprs };
  }

  function scan(stopAtBrace) {
    const tokens = [];
    const stack = [];
    const expressionStart = () => {
      const last = tokens.at(-1);
      if (!last) return true;
      // Postfix ++/-- and TS non-null assertions end an operand; control headers start a statement.
      if (last.type === 'punct') return last.controlClose || (!CLOSERS.has(last.value) && !['++', '--'].includes(last.value) && !last.postfix);
      if (last.type === 'ident') return KEYWORDS_BEFORE_EXPRESSION.has(last.value);
      return false;
    };
    while (pos < src.length) {
      const ch = src[pos];
      const start = pos;
      if (/\s/.test(ch)) {
        pos++;
      } else if (ch === '/' && src[pos + 1] === '/') {
        const newline = src.slice(pos).search(/[\r\n]/);
        const end = newline === -1 ? src.length : pos + newline;
        comments.push({ start, end, text: src.slice(pos + 2, end) });
        pos = end;
      } else if (ch === '/' && src[pos + 1] === '*') {
        const close = src.indexOf('*/', pos + 2);
        if (close === -1) throw new LexError('閉じていないブロックコメントがあります', start);
        comments.push({ start, end: close + 2, text: src.slice(pos + 2, close) });
        pos = close + 2;
      } else if (ch === '#' && pos === 0 && src[1] === '!') {
        const newline = src.search(/[\r\n]/);
        pos = newline === -1 ? src.length : newline;
      } else if (ch === '"' || ch === "'") {
        tokens.push(readString(ch));
      } else if (ch === '`') {
        tokens.push(readTemplate());
      } else if (ch === '/' && expressionStart()) {
        tokens.push(readRegex());
      } else if (jsx && ch === '<' && !/^<\s*[\w$]+\s*(?:,|extends\b)[^<>]*>\s*\(/.test(src.slice(pos)) && expressionStart() && /[\p{ID_Start}>]/u.test(src[pos + 1] ?? '')) {
        tokens.push(readJsxElement());
      } else if (IDENT_START.test(ch)) {
        pos++;
        while (pos < src.length && IDENT_PART.test(src[pos])) pos++;
        tokens.push({ type: 'ident', value: src.slice(start, pos), start, end: pos });
      } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[pos + 1] ?? ''))) {
        pos++;
        while (pos < src.length && /[\w.]/.test(src[pos])) pos++;
        tokens.push({ type: 'number', value: src.slice(start, pos), start, end: pos });
      } else if (ch === '}' && stopAtBrace && stack.length === 0) {
        return tokens;
      } else {
        let value = ch;
        if (src.startsWith('=>', pos)) value = '=>';
        else if (src.startsWith('...', pos)) value = '...';
        else if (src.startsWith('++', pos) || src.startsWith('--', pos)) value = src.slice(pos, pos + 2);
        else if (ch === '?' && src[pos + 1] === '.' && !/[0-9]/.test(src[pos + 2] ?? '')) value = '?.';
        pos += value.length;
        const postfix = value === '!' && !expressionStart() && !/[\r\n]/.test(src.slice(tokens.at(-1)?.end ?? 0, start));
        let controlClose = false;
        if (OPENERS[value]) stack.push({ value, start, control: value === '(' && ['if', 'while', 'for', 'with', 'switch', 'catch'].includes(tokens.at(-1)?.value) && !['.', '?.'].includes(tokens.at(-2)?.value) });
        else if (CLOSERS.has(value)) {
          const open = stack.pop();
          if (!open || OPENERS[open.value] !== value) throw new LexError('括弧の対応が取れません', start);
          controlClose = value === ')' && open.control;
        }
        tokens.push({ type: 'punct', value, start, end: pos, postfix, controlClose });
      }
    }
    if (stopAtBrace) throw new LexError('閉じていないテンプレート式があります', pos);
    if (stack.length) throw new LexError('閉じていない括弧があります', stack.at(-1).start);
    return tokens;
  }

  const tokens = scan(false);
  return { tokens, comments };
}

// ---------------------------------------------------------------------------
// Token sequence helpers.

const isPunct = (token, value) => token?.type === 'punct' && token.value === value;
const isDot = token => isPunct(token, '.') || isPunct(token, '?.');
const isOpener = token => token?.type === 'punct' && Boolean(OPENERS[token.value]);
const isCloser = token => token?.type === 'punct' && CLOSERS.has(token.value);
const isTitle = token => token?.type === 'string' || token?.type === 'template';

function prepare(seq) {
  const pairs = new Array(seq.length).fill(-1);
  const openers = new Array(seq.length).fill(-1);
  const stack = [];
  seq.forEach((token, index) => {
    if (isOpener(token)) stack.push(index);
    else if (isCloser(token)) {
      const open = stack.pop();
      pairs[open] = index;
      openers[index] = open;
    }
  });
  seq.pairs = pairs;
  seq.openers = openers;
  return seq;
}

function* sequences(seq) {
  yield prepare(seq);
  for (const token of seq) {
    for (const inner of token.exprs ?? []) yield* sequences(inner);
  }
}

function argumentsOf(seq, open) {
  const close = seq.pairs[open];
  const list = [];
  let from = open + 1;
  for (let k = open + 1; k < close; k++) {
    if (isOpener(seq[k])) k = seq.pairs[k];
    else if (isPunct(seq[k], ',')) {
      if (from <= k - 1) list.push([from, k - 1]);
      from = k + 1;
    }
  }
  if (from <= close - 1) list.push([from, close - 1]);
  return { close, list };
}

function isFunctionArgument(seq, [from, to]) {
  if (seq[from]?.value === 'function' || (seq[from]?.value === 'async' && seq[from + 1]?.value === 'function')) return true;
  for (let k = from; k <= to; k++) {
    if (isOpener(seq[k])) k = seq.pairs[k];
    else if (isPunct(seq[k], '=>')) return true;
  }
  return false;
}

function continues(token, next) {
  if (token.type === 'punct' && CONTINUES_AFTER.has(token.value)) return true;
  if (token.type === 'ident' && KEYWORDS_CONTINUING.has(token.value)) return true;
  return next.type === 'punct' && CONTINUES_BEFORE.has(next.value);
}

// Index of the last token of the statement that starts at `from`.
function statementEnd(seq, from) {
  let j = from;
  for (;;) {
    if (isCloser(seq[j])) return Math.max(from, j - 1);
    if (isOpener(seq[j])) j = seq.pairs[j];
    const token = seq[j];
    if (isPunct(token, ';')) return j;
    const next = seq[j + 1];
    if (!next || isCloser(next)) return j;
    if (token.line < next.line && !continues(token, next)) return j;
    j++;
  }
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return offset => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function tagsIn(seq, [from, to]) {
  const tags = [];
  if (!isPunct(seq[from], '{') || seq.pairs[from] !== to) return tags;
  for (let k = from + 1; k < to; k++) {
    if (isOpener(seq[k])) {
      k = seq.pairs[k];
      continue;
    }
    const key = seq[k];
    if (!((key.type === 'ident' || key.type === 'string') && key.value === 'tag' && isPunct(seq[k + 1], ':'))) continue;
    const value = seq[k + 2];
    if (isTitle(value)) tags.push(value.value);
    else if (isPunct(value, '[')) {
      for (let m = k + 3; m < seq.pairs[k + 2]; m++) if (isTitle(seq[m])) tags.push(seq[m].value);
    }
  }
  return tags;
}

function titleTags(title) {
  return title.match(/@[^\s@]+/g) ?? [];
}

// ---------------------------------------------------------------------------
// Source analysis.

function declarationsOf(seq) {
  const decls = new Map();
  const exported = new Map();
  for (let i = 0; i < seq.length; i++) {
    const token = seq[i];
    if (token.type !== 'ident') continue;
    let k = i;
    let isExport = false;
    let isDefault = false;
    if (token.value === 'export') {
      isExport = true;
      k++;
      if (seq[k]?.value === 'default') {
        isDefault = true;
        k++;
      }
      if (isPunct(seq[k], '{')) {
        const close = seq.pairs[k];
        for (let m = k + 1; m < close; m++) {
          if (seq[m].type !== 'ident' || seq[m].value === 'type') continue;
          const local = seq[m].value;
          let name = local;
          if (seq[m + 1]?.value === 'as' && seq[m + 2]) {
            name = seq[m + 2].value;
            m += 2;
          }
          exported.set(name, seq[close + 1]?.value === 'from' ? name : local);
        }
        i = close;
        continue;
      }
      if (isDefault && seq[k]?.type === 'ident' && !['function', 'async', 'class'].includes(seq[k].value)) {
        exported.set('default', seq[k].value);
        continue;
      }
    } else if (i > 0 && !isPunct(seq[i - 1], ';') && !isPunct(seq[i - 1], '}') && seq[i - 1].line === token.line) {
      continue;
    }
    if (seq[k]?.value === 'async') k++;
    const keyword = seq[k]?.value;
    if (keyword === 'function') {
      let n = k + 1;
      if (isPunct(seq[n], '*')) n++;
      const name = seq[n]?.type === 'ident' ? seq[n].value : (isDefault ? 'default' : null);
      const open = seq.slice(n).findIndex(item => isPunct(item, '{'));
      if (!name || open === -1) continue;
      const bodyOpen = n + open;
      decls.set(name, { kind: 'function', start: seq[i].start, end: seq[seq.pairs[bodyOpen]].end });
      if (isExport) exported.set(isDefault ? 'default' : name, name);
      i = seq.pairs[bodyOpen];
    } else if (keyword === 'class') {
      const name = seq[k + 1]?.type === 'ident' && seq[k + 1].value !== 'extends' ? seq[k + 1].value : (isDefault ? 'default' : null);
      const open = seq.slice(k).findIndex(item => isPunct(item, '{'));
      if (!name || open === -1) continue;
      const bodyOpen = k + open;
      decls.set(name, { kind: 'class', start: seq[i].start, end: seq[seq.pairs[bodyOpen]].end, methods: methodsOf(seq, bodyOpen) });
      if (isExport) exported.set(isDefault ? 'default' : name, name);
      i = seq.pairs[bodyOpen];
    } else if (['const', 'let', 'var'].includes(keyword) && seq[k + 1]?.type === 'ident' && seq.slice(k + 2, k + 12).some(item => isPunct(item, '='))) {
      const name = seq[k + 1].value;
      const end = statementEnd(seq, i);
      const init = seq.slice(k + 2, end + 1);
      if (init.some(item => isPunct(item, '=>') || item.value === 'function')) {
        decls.set(name, { kind: 'function', start: seq[i].start, end: seq[end].end });
      }
      if (isExport) exported.set(name, name);
      i = end;
    }
  }
  return { decls, exported };
}

function methodsOf(seq, open) {
  const methods = new Map();
  const close = seq.pairs[open];
  for (let k = open + 1; k < close; k++) {
    const token = seq[k];
    if (isOpener(token)) {
      k = seq.pairs[k];
      continue;
    }
    if (token.type !== 'ident' && token.type !== 'string') continue;
    if (isPunct(seq[k + 1], '(')) {
      const params = seq.pairs[k + 1];
      let body = params + 1;
      while (body < close && !isPunct(seq[body], '{') && !isPunct(seq[body], ';') && !isPunct(seq[body], '=')) {
        body = isOpener(seq[body]) ? seq.pairs[body] + 1 : body + 1;
      }
      if (!isPunct(seq[body], '{')) {
        k = params;
        continue;
      }
      methods.set(token.value, { start: token.start, end: seq[seq.pairs[body]].end });
      k = seq.pairs[body];
    } else if (isPunct(seq[k + 1], '=') || (isPunct(seq[k + 1], ':') && seq.slice(k + 2, k + 20).some(item => isPunct(item, '=')))) {
      const end = statementEnd(seq, k);
      if (seq.slice(k, end + 1).some(item => isPunct(item, '=>') || item.value === 'function')) {
        methods.set(token.value, { start: token.start, end: seq[end].end });
      }
      k = end;
    }
  }
  return methods;
}

function importsOf(seq) {
  const bindings = new Map();
  // Static CommonJS destructuring and namespace bindings use the same import graph.
  for (let i = 0; i < seq.length; i++) {
    if (!['const', 'let', 'var'].includes(seq[i].value)) continue;
    const start = i + 1;
    const end = isPunct(seq[start], '{') ? seq.pairs[start] : start;
    if (!isPunct(seq[end + 1], '=') || seq[end + 2]?.value !== 'require' || !isPunct(seq[end + 3], '(') || seq[end + 4]?.type !== 'string') continue;
    const specifier = seq[end + 4].value;
    if (start === end) bindings.set(seq[start].value, { imported: '*', specifier });
    else for (let k = start + 1; k < end; k++) {
      if (seq[k].type !== 'ident') continue;
      const imported = seq[k].value;
      const local = isPunct(seq[k + 1], ':') ? seq[k += 2].value : imported;
      bindings.set(local, { imported, specifier });
    }
  }
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].type !== 'ident' || !['import', 'export'].includes(seq[i].value) || isDot(seq[i - 1]) || isPunct(seq[i + 1], '(') || isDot(seq[i + 1])) continue;
    let k = i + 1;
    if (seq[k]?.value === 'type' && !isPunct(seq[k + 1], ',') && seq[k + 1]?.value !== 'from') continue;
    const found = [];
    if (seq[k]?.type === 'ident' && seq[k].value !== 'from') {
      found.push({ local: seq[k].value, imported: 'default' });
      k++;
      if (isPunct(seq[k], ',')) k++;
    }
    if (isPunct(seq[k], '*') && seq[k + 1]?.value === 'as' && seq[k + 2]?.type === 'ident') {
      found.push({ local: seq[k + 2].value, imported: '*' });
      k += 3;
    } else if (isPunct(seq[k], '{')) {
      const close = seq.pairs[k];
      for (let m = k + 1; m < close; m++) {
        if (seq[m].type !== 'ident' || seq[m].value === 'type') continue;
        const imported = seq[m].value;
        let local = imported;
        if (seq[m + 1]?.value === 'as' && seq[m + 2]?.type === 'ident') {
          local = seq[m + 2].value;
          m += 2;
        }
        found.push({ local, imported });
      }
      k = close + 1;
    }
    if (seq[k]?.value !== 'from' || seq[k + 1]?.type !== 'string') continue;
    for (const binding of found) bindings.set(binding.local, { ...binding, specifier: seq[k + 1].value });
    i = k + 1;
  }
  return bindings;
}

// Recognize imported test aliases and the statically declared base.extend fixture graph.
function testBindings(seq, imports, testNames = []) {
  const roots = new Set([...TEST_ROOTS, ...testNames]);
  for (const [local, binding] of imports) if (binding.imported === 'test') roots.add(local);
  for (const [local, binding] of imports) if (binding.imported === '*' && binding.specifier === '@playwright/test') roots.add(`${local}.test`);
  const extensions = new Map();
  for (let i = 0; i < seq.length; i++) {
    if (!['const', 'let', 'var'].includes(seq[i].value) || seq[i + 1]?.type !== 'ident' || !isPunct(seq[i + 2], '=')) continue;
    const name = seq[i + 1].value;
    let base = seq[i + 3]?.value;
    let next = i + 4;
    if (isDot(seq[next]) && seq[next + 1]?.value === 'test' && roots.has(`${base}.test`)) { base += '.test'; next += 2; }
    if (!roots.has(base)) continue;
    if (!isDot(seq[next])) {
      if (!seq[next] || isPunct(seq[next], ';') || seq[next].line > seq[next - 1].line) {
        roots.add(name);
        extensions.set(name, { base, fixtures: new Map() });
      }
      continue;
    }
    if (seq[next + 1]?.value !== 'extend') continue;
    let open = next + 2;
    if (isPunct(seq[open], '<')) {
      let depth = 1;
      while (++open < seq.length && depth) {
        if (isOpener(seq[open])) open = seq.pairs[open];
        else if (isPunct(seq[open], '<')) depth++;
        else if (isPunct(seq[open], '>')) depth--;
      }
    }
    if (!isPunct(seq[open], '(')) continue;
    roots.add(name);
    const fixtures = new Map();
    const object = open + 1;
    if (isPunct(seq[object], '{')) {
      for (let k = object + 1; k < seq.pairs[object]; k++) {
        if (isOpener(seq[k])) { k = seq.pairs[k]; continue; }
        if (!isPunct(seq[k + 1], ':') && !isPunct(seq[k + 1], '(')) continue;
        const key = seq[k].value;
        fixtures.set(key, null); // An override without a known constructor must not inherit an assertion.
        const start = isPunct(seq[k + 1], '(') ? k + 1 : k + 2;
        let end = start;
        while (end < seq.pairs[object] && !isPunct(seq[end], ',')) {
          end = isOpener(seq[end]) ? seq.pairs[end] + 1 : end + 1;
        }
        const vars = new Map();
        for (let m = start; m < end; m++) {
          if (isPunct(seq[m + 1], '=') && seq[m + 2]?.value === 'new') vars.set(seq[m].value, seq[m + 3]?.value);
          if (seq[m].value !== 'use' || !isPunct(seq[m + 1], '(')) continue;
          const type = seq[m + 2]?.value === 'new' ? seq[m + 3]?.value : vars.get(seq[m + 2]?.value);
          if (type) fixtures.set(key, type);
        }
        k = end;
      }
    }
    extensions.set(name, { base, fixtures });
  }
  return { roots, extensions };
}

function fixtureParameters(seq, body) {
  const bindings = new Map();
  if (!body) return bindings;
  let k = body[0];
  if (seq[k]?.value === 'async') k++;
  if (seq[k]?.value === 'function') {
    k++;
    if (seq[k]?.type === 'ident') k++;
  }
  if (!isPunct(seq[k], '(') || !isPunct(seq[k + 1], '{')) return bindings;
  const end = seq.pairs[k + 1];
  for (let i = k + 2; i < end; i++) {
    if (seq[i].type !== 'ident') continue;
    const fixture = seq[i].value;
    let local = fixture;
    if (isPunct(seq[i + 1], ':')) { local = seq[i + 2]?.value; i += 2; }
    bindings.set(local, fixture);
  }
  return bindings;
}

function matcherLabel(item) {
  return item.negated ? `not.${item.matcher}` : item.matcher;
}

function isWeak(item) {
  return WEAK_MATCHERS.includes(matcherLabel(item));
}

export function analyzeSource(text, { path = '', jsx = JSX_SOURCE.test(path), changeIds, testNames } = {}) {
  const lineOf = lineIndex(text);
  let lexed;
  try {
    lexed = lex(text, { jsx });
  } catch (err) {
    if (!(err instanceof LexError)) throw err;
    return { error: err.message, errorLine: lineOf(err.offset), blocks: [], tests: [], findings: [], suppressions: [] };
  }
  const blocks = [];
  const conditional = [];
  const expects = [];
  const rootCalls = [];
  const memberCalls = [];
  const instances = new Map();
  const raw = [];
  const flat = [];

  for (const seq of sequences(lexed.tokens)) {
    seq.forEach((token, index) => {
      token.line = lineOf(token.start);
      flat.push({ token, seq, index });
    });
  }
  flat.sort((a, b) => a.token.start - b.token.start);

  const imports = importsOf(lexed.tokens);
  const locatorVariables = new Set();
  const locatorExpression = (seq, end) => {
    if (seq[end]?.type === 'ident') return locatorVariables.has(seq[end].value);
    if (!isPunct(seq[end], ')')) return false;
    const open = seq.openers[end];
    const name = seq[open - 1]?.value ?? '';
    return isDot(seq[open - 2]) && (/^getBy/.test(name) || ['locator', 'frameLocator', 'filter', 'nth', 'first', 'last', 'and', 'or'].includes(name));
  };
  for (const seq of sequences(lexed.tokens)) {
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].type !== 'ident' || !isPunct(seq[i + 1], '=')) continue;
      let end = statementEnd(seq, i);
      if (isPunct(seq[end], ';')) end--;
      if (locatorExpression(seq, end)) locatorVariables.add(seq[i].value);
    }
  }
  const { roots: testRoots, extensions } = testBindings(lexed.tokens, imports, testNames);
  for (const seq of sequences(lexed.tokens)) {
    for (let i = 0; i < seq.length; i++) {
      const token = seq[i];
      if (isDot(token) && seq[i + 1]?.type === 'ident' && isPunct(seq[i + 2], '(')) {
        const { list } = argumentsOf(seq, i + 2);
        const first = list[0] && list[0][0] === list[0][1] ? seq[list[0][0]] : null;
        const before = seq[i - 1];
        let receiver = null;
        if (before?.type === 'ident') receiver = { kind: 'ident', name: before.value };
        else if (isPunct(before, ')')) {
          const open = seq.openers[i - 1];
          if (seq[open - 1]?.type === 'ident' && seq[open - 2]?.value === 'new') receiver = { kind: 'new', name: seq[open - 1].value };
        }
        memberCalls.push({ name: seq[i + 1].value, start: seq[i + 1].start, line: seq[i + 1].line, first, receiver, locator: locatorExpression(seq, i - 1) });
      }
      if (token.type === 'ident' && isPunct(seq[i + 1], '=')) {
        let k = i + 2;
        if (seq[k]?.value === 'await') k++;
        if (seq[k]?.value === 'new' && seq[k + 1]?.type === 'ident') instances.set(token.value, seq[k + 1].value);
      }
      if (token.type !== 'ident' || isDot(seq[i - 1])) continue;
      const names = [token.value];
      let next = i + 1;
      while (isDot(seq[next]) && seq[next + 1]?.type === 'ident') {
        names.push(seq[next + 1].value);
        next += 2;
      }
      if (!isPunct(seq[next], '(')) continue;
      const { close, list } = argumentsOf(seq, next);
      rootCalls.push({ names, start: token.start, line: token.line });
      let [root, ...members] = names;
      if (members[0] === 'test' && testRoots.has(`${root}.test`)) { root += '.test'; members = members.slice(1); }

      if (root === 'expect' && (members.length === 0 || (members.length === 1 && EXPECT_FORMS.has(members[0])))) {
        let k = close + 1;
        let negated = false;
        while (isDot(seq[k]) && seq[k + 1]?.type === 'ident') {
          const name = seq[k + 1].value;
          if (EXPECT_FLAGS.has(name)) {
            if (name === 'not') negated = !negated;
            k += 2;
            continue;
          }
          if (isPunct(seq[k + 2], '(')) expects.push({ matcher: name, negated, start: token.start, line: token.line });
          break;
        }
      }
      if (root === 'setTimeout' && members.length === 0) {
        raw.push({ rule: 'fixed-wait', offset: token.start, line: token.line, message: 'setTimeout による固定待機は禁止です。自動待機ロケーターと expect のリトライに任せてください' });
      }
      if ((root === 'globalThis' || root === 'window') && members.length === 1 && members[0] === 'setTimeout') {
        raw.push({ rule: 'fixed-wait', offset: token.start, line: token.line, message: 'setTimeout による固定待機は禁止です。自動待機ロケーターと expect のリトライに任せてください' });
      }

      const isTestRoot = testRoots.has(root);
      const describeMembers = isTestRoot && members[0] === 'describe' ? members.slice(1) : root === 'describe' ? members : null;
      const literal = list.length > 0 && isTitle(seq[list[0][0]]) && list[0][0] === list[0][1];
      const last = list.at(-1);
      const lastIsFunction = Boolean(last) && isFunctionArgument(seq, last);
      // A non-literal title still declares a test when a body follows; `test.skip(cond, 'reason')` does not.
      const dynamic = !literal && list.length >= 2 && (members.length === 0 || lastIsFunction);
      const declared = literal || dynamic;
      // Any trailing argument is the body, so wrappers and references are checked instead of skipped.
      const body = last && (list.length >= 2 || lastIsFunction) ? { bodyStart: seq[last[0]].start, bodyEnd: seq[last[1]].end } : { bodyStart: -1, bodyEnd: -1 };
      const block = kind => ({
        kind,
        root,
        fixtures: fixtureParameters(seq, last),
        title: literal ? seq[list[0][0]].value : dynamic ? text.slice(seq[list[0][0]].start, seq[list[0][1]].end) : '',
        line: token.line,
        start: token.start,
        end: seq[close].end,
        ...body,
        modifiers: members.filter(name => MODIFIERS.has(name)),
        ownTags: [...(literal ? titleTags(seq[list[0][0]].value) : []), ...(list.length >= 3 ? tagsIn(seq, list[1]) : [])],
      });
      if (isTestRoot && (members.length === 0 || (members.length === 1 && MODIFIERS.has(members[0])))) {
        if (declared) blocks.push(block('test'));
        else if (members.length === 1) conditional.push({ name: members[0], start: token.start, line: token.line });
      } else if (describeMembers && !describeMembers.includes('configure') && describeMembers.every(name => MODIFIERS.has(name) || DESCRIBE_MODES.has(name))) {
        if (declared || (list.length === 1 && lastIsFunction)) blocks.push(block('describe'));
      }
    }
  }

  blocks.sort((a, b) => a.start - b.start);
  const inside = (outer, offset) => outer.bodyStart !== -1 && outer.bodyStart <= offset && offset < outer.bodyEnd;
  const owner = (offset, kinds = ['test', 'describe']) => {
    let found = null;
    for (const candidate of blocks) if (kinds.includes(candidate.kind) && inside(candidate, offset)) found = candidate;
    return found;
  };
  for (const item of blocks) {
    item.parent = owner(item.start, ['describe']);
  }
  for (const call of conditional) call.owner = owner(call.start);

  const ancestors = item => {
    const chain = [];
    for (let cur = item.parent; cur; cur = cur.parent) chain.unshift(cur);
    return chain;
  };
  const tests = blocks.filter(item => item.kind === 'test').map(item => {
    const chain = ancestors(item);
    const scope = [...chain, item];
    const tags = [...new Set(scope.flatMap(entry => entry.ownTags))];
    const excluded = scope.some(entry => entry.modifiers.some(name => EXCLUDING.has(name)))
      || conditional.some(call => EXCLUDING.has(call.name) && (!call.owner || scope.includes(call.owner)));
    return { ...item, tags, describes: chain.map(entry => entry.title), excluded };
  });
  const titleAt = offset => owner(offset)?.title ?? null;

  for (const call of memberCalls) {
    if (call.name === 'waitForTimeout') {
      raw.push({ rule: 'fixed-wait', offset: call.start, line: call.line, message: 'waitForTimeout による固定待機は禁止です。自動待機ロケーターと expect のリトライに任せてください' });
      continue;
    }
    const xpath = (CSS_LOCATORS.has(call.name) || call.name === 'frameLocator' || (!call.locator && SELECTOR_METHODS.has(call.name))) && isTitle(call.first) && XPATH.test(call.first.value);
    if (CSS_LOCATORS.has(call.name) || xpath) {
      const what = xpath ? `XPath (${call.first.value})` : `${call.name}()`;
      raw.push({ rule: 'forbidden-locator', offset: call.start, line: call.line, message: `${what} は禁止です。getByRole / getByLabel / getByText / getByTestId を使ってください` });
    }
  }
  for (const item of blocks) {
    const used = item.modifiers.filter(name => MODIFIERS.has(name));
    if (used.length) {
      const prefix = item.kind === 'describe' ? 'test.describe' : 'test';
      raw.push({ rule: 'excluded-test', offset: item.start, line: item.line, test: item.title, message: `${used.map(name => `${prefix}.${name}`).join(', ')} で実行を除外・反転しています` });
    }
  }
  for (const call of conditional) {
    raw.push({ rule: 'excluded-test', offset: call.start, line: call.line, message: `test.${call.name}() で実行を除外・反転しています` });
  }
  for (const item of tests) {
    const hasTp = item.tags.some(tag => /^@TP-\d{3}$/.test(tag));
    // Source-only callers may omit repository context; repository lint always supplies known IDs.
    const hasChange = item.tags.some(tag => changeIds ? changeIds.includes(tag.slice(1)) : !/^@TP-/.test(tag));
    if (!hasTp || !hasChange) {
      const missing = [!hasChange && 'change タグ(@<change-id>)', !hasTp && 'TP タグ(@TP-NNN)'].filter(Boolean).join(' と ');
      raw.push({ rule: 'missing-tag', offset: item.start, line: item.line, test: item.title, message: `${missing} がありません` });
    }
  }

  const suppressions = lexed.comments.filter(comment => SUPPRESSION.test(comment.text)).map(comment => {
    const parsed = comment.text.match(SUPPRESSION_FORMAT);
    const entry = { line: lineOf(comment.start), start: comment.start, test: titleAt(comment.start), rule: parsed?.[1] ?? null, residual: parsed?.[2] ?? null, reason: parsed?.[3]?.trim() ?? '' };
    if (!parsed) entry.error = '書式は `e2e-lint-allow <rule-id> <residual-id>: <理由>` です';
    else if (!RULES.includes(entry.rule)) entry.error = `未知の規則 ID です: ${entry.rule}`;
    else if (!entry.residual) entry.error = 'Residual ID がありません';
    else if (!entry.reason) entry.error = '理由がありません';
    let lo = 0;
    let hi = flat.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (flat[mid].token.start < comment.end) lo = mid + 1;
      else hi = mid;
    }
    const previous = flat[lo - 1]?.token;
    const trailing = previous && lineOf(previous.end - 1) === entry.line;
    if (trailing || (flat[lo] && lineOf(comment.end - 1) === flat[lo].token.line)) entry.error = '抑止コメントは独立した行で対象の直前に置いてください';
    const next = trailing ? null : flat[lo];
    if (next) {
      const end = statementEnd(next.seq, next.index);
      entry.from = next.token.start;
      entry.to = next.seq[end].end;
      if (!entry.error && blocks.some(item => item.kind === 'describe' && item.start === entry.from)) {
        entry.error = 'describe 全体は抑止できません。直後の 1 文かテスト宣言の直前に置いてください';
      }
    } else {
      entry.from = entry.to = -1;
    }
    return entry;
  });

  const analysis = {
    error: null,
    blocks,
    tests,
    expects,
    rootCalls,
    memberCalls,
    instances,
    suppressions,
    imports,
    extensions,
    ...declarationsOf(lexed.tokens),
  };
  analysis.findings = raw.map(item => ({ ...item, test: item.test ?? titleAt(item.offset) }));
  return analysis;
}

function strengthOf(expects, range) {
  const inRange = expects.filter(item => range.start <= item.start && item.start < range.end && !NEUTRAL_MATCHERS.has(item.matcher));
  if (inRange.some(item => !isWeak(item))) return 'strong';
  return inRange.length ? 'weak' : null;
}

// Exported helpers under the E2E root, keyed by file: functions by export name, classes by method.
function helperEntry(analysis) {
  const functions = new Map();
  const classes = new Map();
  for (const [name, local] of analysis.exported) {
    const decl = analysis.decls.get(local);
    if (!decl) continue;
    if (decl.kind === 'function') functions.set(name, strengthOf(analysis.expects, decl));
    else {
      const methods = new Map();
      for (const [method, range] of decl.methods) methods.set(method, strengthOf(analysis.expects, range));
      classes.set(name, methods);
    }
  }
  return { functions, classes, tests: new Map() };
}

function resolveModule(file, specifier, known) {
  if (!specifier.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(file), specifier));
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, '');
  const candidates = [base, ...RESOLVE_EXTENSIONS.map(ext => base + ext), ...RESOLVE_EXTENSIONS.map(ext => stem + ext), ...RESOLVE_EXTENSIONS.map(ext => `${base}/index${ext}`)];
  return candidates.find(candidate => known.has(candidate)) ?? null;
}

function fixtureTests(file, analysis, helpers) {
  const tests = new Map();
  const classes = new Map();
  for (const [local, binding] of analysis.imports) {
    const entry = helpers.get(resolveModule(file, binding.specifier, helpers));
    if (entry?.classes.has(binding.imported)) classes.set(local, entry.classes.get(binding.imported));
    if (entry?.tests.has(binding.imported)) tests.set(local, entry.tests.get(binding.imported));
  }
  for (const [name, extension] of analysis.extensions) {
    const fixtures = new Map(tests.get(extension.base));
    for (const [fixture, type] of extension.fixtures) {
      fixtures.delete(fixture);
      if (classes.has(type)) fixtures.set(fixture, classes.get(type));
    }
    tests.set(name, fixtures);
  }
  return tests;
}

function helperResolver(file, analysis, helpers) {
  const functions = new Map();
  const classes = new Map();
  const namespaces = new Map();
  for (const [local, binding] of analysis.imports ?? []) {
    const target = resolveModule(file, binding.specifier, helpers);
    if (!target) continue;
    const entry = helpers.get(target);
    if (binding.imported === '*') {
      namespaces.set(local, entry);
      continue;
    }
    if (entry.functions.has(binding.imported)) functions.set(local, entry.functions.get(binding.imported));
    if (entry.classes.has(binding.imported)) classes.set(local, entry.classes.get(binding.imported));
  }
  const tests = fixtureTests(file, analysis, helpers);
  return (range) => {
    const found = [];
    for (const call of analysis.rootCalls) {
      if (call.start < range.bodyStart || call.start >= range.bodyEnd) continue;
      const [root, member] = call.names;
      let strength = null;
      if (call.names.length === 1) strength = functions.get(root) ?? null;
      else if (call.names.length === 2 && namespaces.has(root)) strength = namespaces.get(root).functions.get(member) ?? null;
      if (strength) found.push({ name: call.names.join('.'), strength, start: call.start });
    }
    for (const call of analysis.memberCalls) {
      if (call.start < range.bodyStart || call.start >= range.bodyEnd) continue;
      // Count only a known Page Object constructor/instance or a resolved fixture binding.
      const owner = call.receiver?.kind === 'new' ? call.receiver.name : call.receiver?.kind === 'ident' ? analysis.instances.get(call.receiver.name) : null;
      const fixture = call.receiver?.kind === 'ident' ? range.fixtures.get(call.receiver.name) : null;
      const strength = owner ? classes.get(owner)?.get(call.name) : tests.get(range.root)?.get(fixture)?.get(call.name);
      if (strength) found.push({ name: call.name, strength, start: call.start });
    }
    return found;
  };
}

function assertionFindings(analysis, resolve = () => []) {
  const findings = [];
  for (const item of analysis.tests) {
    if (item.bodyStart === -1) continue;
    const range = { start: item.bodyStart, end: item.bodyEnd };
    const own = analysis.expects.filter(entry => range.start <= entry.start && entry.start < range.end && !NEUTRAL_MATCHERS.has(entry.matcher));
    const helpers = resolve(item);
    if (own.some(entry => !isWeak(entry)) || helpers.some(entry => entry.strength === 'strong')) continue;
    const weak = [...own.map(entry => ({ label: matcherLabel(entry), start: entry.start })), ...helpers.map(entry => ({ label: `${entry.name}()`, start: entry.start }))];
    if (weak.length) {
      findings.push({
        rule: 'weak-assertion',
        offset: item.start,
        line: item.line,
        test: item.title,
        weak: weak.map(entry => entry.start),
        message: `存在確認だけのアサーションです (${[...new Set(weak.map(entry => entry.label))].join(', ')})。具体値や状態の変化を比べる Oracle に書き直してください`,
      });
    } else {
      findings.push({ rule: 'missing-assertion', offset: item.start, line: item.line, test: item.title, message: 'アサーションがありません' });
    }
  }
  return findings;
}

export function lintSource(text, { path = '', changeIds } = {}) {
  const analysis = analyzeSource(text, { path, changeIds });
  if (analysis.error) {
    return { error: analysis.error, tests: [], findings: [{ rule: 'unparseable', line: analysis.errorLine, test: null, message: `字句解析できません: ${analysis.error}` }] };
  }
  return { error: null, tests: analysis.tests, findings: [...analysis.findings, ...assertionFindings(analysis)] };
}

// ---------------------------------------------------------------------------
// Repository lint: scope, policy, suppressions.

function isIntegrated(change) {
  return change.schema === SCHEMA_INTEGRATED || change.scope === 'integrated';
}

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
  if (isIntegrated(change)) {
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
  const changes = [];
  for (const root of ['openspec/changes', 'openspec/changes/archive']) {
    if (!existsSync(join(repo, root))) continue;
    for (const entry of readdirSync(join(repo, root), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'archive') changes.push({
        id: root.endsWith('/archive') ? entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, '') : entry.name,
        path: `${root}/${entry.name}`,
      });
    }
  }
  return changes;
}

function loadState(repo, cache, changes) {
  const state = cache.e2eLint ??= { analyzed: 0, files: new Map(), diffs: new Map(), residuals: new Map() };
  if (state.listing) return state;
  try {
    state.root = installedE2eRoot(repo);
    const listed = listFiles(repo, state.root);
    if (listed.error) throw new Error(`E2E ルートを参照できません: ${listed.path} (${listed.code})`);
    state.listing = { files: listed.files };
  } catch (err) {
    state.listing = { error: err.message, files: [] };
  }
  let changeIds;
  try {
    state.knownChanges = knownChanges(repo);
    changeIds = [...new Set([...state.knownChanges, ...changes].map(change => change.id))];
  } catch (err) {
    state.listing.error = `change 一覧を読み取れません (${err.code ?? err.message})`;
    state.knownChanges = [];
    changeIds = [];
  }
  for (const file of state.listing.files) {
    if (!LINT_SOURCE.test(file)) continue;
    let text;
    try {
      text = readFileSync(join(repo, file), 'utf8');
    } catch (err) {
      state.files.set(file, { error: `読み取れません (${err.code ?? err.message})` });
      continue;
    }
    state.analyzed++;
    state.files.set(file, { text, analysis: analyzeSource(text, { path: file, changeIds }) });
  }
  state.helpers = new Map();
  for (const [file, entry] of state.files) {
    if (entry.analysis && !entry.analysis.error) state.helpers.set(file, helperEntry(entry.analysis));
  }
  // Propagate fixture exports through relative imports, bounded by the module count.
  for (let pass = 0; pass < state.helpers.size; pass++) {
    for (const [file, entry] of state.files) {
      if (!state.helpers.has(file)) continue;
      const testNames = [...entry.analysis.imports].filter(([, binding]) => state.helpers.get(resolveModule(file, binding.specifier, state.helpers))?.tests.has(binding.imported)).map(([name]) => name);
      if (testNames.some(name => !entry.testNames?.has(name))) {
        entry.testNames = new Set(testNames);
        entry.analysis = analyzeSource(entry.text, { path: file, changeIds, testNames });
      }
      const tests = fixtureTests(file, entry.analysis, state.helpers);
      for (const [exported, local] of entry.analysis.exported) {
        if (tests.has(local)) state.helpers.get(file).tests.set(exported, tests.get(local));
      }
    }
  }
  const policyPath = join(repo, 'openspec/quality-policy.md');
  try {
    state.policy = e2eLintPolicy(existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '');
  } catch (err) {
    state.policy = e2eLintPolicy('');
    state.policyError = `quality-policy.md を読み取れません (${err.code ?? err.message})`;
  }
  return state;
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
      state.residualErrors ??= new Map();
      state.residualErrors.set(change.path, `evidence.md を読み取れません (${err.code ?? err.message})`);
      return [];
    }
    if (parsed.error) {
      state.residualErrors ??= new Map();
      state.residualErrors.set(change.path, parsed.error);
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
  const direct = suppressions.filter(item => item.rule === finding.rule && item.from <= finding.offset && finding.offset < item.to);
  if (direct.length) return direct;
  if (finding.rule !== 'weak-assertion' || !finding.weak?.length) return [];
  const each = finding.weak.map(offset => suppressions.find(item => item.rule === 'weak-assertion' && item.from <= offset && offset < item.to));
  return each.every(Boolean) ? [...new Set(each)] : [];
}

const STATUS_RANK = { invalid: 0, unknown: 1, pending: 2, approved: 3 };

export function lintRepo(repo, changes, options = {}) {
  const env = options.env ?? process.env;
  const phase = options.phase === 'final' ? 'final' : 'plan';
  const state = loadState(repo, options.cache ?? {}, changes);
  const notes = new Set(state.policy.invalid);
  const result = { enforced: [], warned: [], exceptions: [], pending: [], notes: [], unsupported: [], analyzed: state.analyzed, failed: 0 };
  const active = changes.filter(change => change.lifecycle !== 'deleted');
  const configErrors = new Set(state.policy.errors);
  const modes = active.map(change => ({ change, mode: modeFor(change, state.policy, env, notes, configErrors) }));
  const consulted = new Set();
  const readResiduals = change => {
    consulted.add(change.path);
    return residualsOf(repo, state, change);
  };
  const selectedResiduals = active.flatMap(readResiduals);
  const diff = options.base ? changedFiles(repo, state, options.base) : null;
  if (!options.base) notes.add(modes.some(({ mode }) => mode.all)
    ? 'e2e-lint: --base がありませんが、scope: all により全ソースを強制します'
    : 'e2e-lint: --base が無いため、強制範囲はタグ範囲のみです（差分ファイルは警告に留まります）');

  const place = (entry, scope) => {
    entry.text = format(entry);
    entry.scope = scope;
    if (scope?.enforced) result.enforced.push(entry);
    else result.warned.push(entry);
  };

  if (state.listing.error || diff?.error) {
    const entry = { rule: 'unreadable', file: state.root ?? '(E2E ルート)', line: 0, test: null, message: state.listing.error ?? diff.error };
    place(entry, { enforced: true, reason: 'root' });
  }

  for (const message of configErrors) place({ rule: 'invalid-config', file: 'openspec/quality-policy.md / environment', message }, { enforced: true });
  if (state.policyError) place({ rule: 'unreadable', file: 'openspec/quality-policy.md', message: state.policyError }, { enforced: true });
  if (options.requireSources && !state.analyzed && !state.listing.error) place({ rule: 'unreadable', file: state.root, message: '検査対象の E2E ソースが 0 件です' }, { enforced: true });

  for (const file of state.listing.files) {
    if (UNSUPPORTED_SOURCE.test(file)) result.unsupported.push(file);
  }

  for (const [file, entry] of state.files) {
    const changed = diff?.files.has(file) ?? false;
    let scope = null;
    for (const { change, mode } of modes) {
      const tagged = entry.text != null && hasBoundedToken(entry.text, `@${change.id}`);
      const reason = tagged ? 'tagged' : changed ? 'changed' : mode.all ? 'all' : null;
      if (!reason && !mode.all) continue;
      const enforced = (tagged && mode.tagged) || (changed && mode.changed) || mode.all;
      if (!scope || (enforced && !scope.enforced)) scope = { enforced, reason: reason ?? 'all' };
    }
    if (!scope && entry.error && active.length) scope = { enforced: true, reason: 'unreadable' };

    if (entry.error) {
      place({ rule: 'unreadable', file, line: 0, test: null, message: entry.error }, { enforced: true, reason: 'unreadable' });
      continue;
    }
    const analysis = entry.analysis;
    if (analysis.error) {
      place({ rule: 'unparseable', file, line: analysis.errorLine, test: null, message: `字句解析できません: ${analysis.error}` }, scope);
      continue;
    }
    // Only parsed test tags establish ownership; comments and unrelated strings cannot grant approval.
    // Selected evidence wins over historical records with the same ID. Untagged helpers retain
    // historical exceptions, but ambiguous historical IDs require a unique ID.
    const selectedIds = new Set(selectedResiduals.map(item => item.id));
    const statusOf = item => {
      if (item.error) return { status: 'invalid', detail: item.error };
      const targets = analysis.tests.filter(test => (test.start <= item.from && item.from < test.end) || (item.from <= test.start && test.start < item.to));
      const tags = new Set(targets.flatMap(test => test.tags));
      const tagged = [...active, ...state.knownChanges].some(change => tags.has(`@${change.id}`));
      const owners = state.knownChanges.filter(change =>
        !active.some(selected => selected.path === change.path) && (!tagged || tags.has(`@${change.id}`)));
      const residuals = [...selectedResiduals, ...owners.flatMap(readResiduals).filter(record => !selectedIds.has(record.id))];
      return residualStatus(item.residual, residuals);
    };
    const findings = [...analysis.findings, ...assertionFindings(analysis, helperResolver(file, analysis, state.helpers))];
    const used = new Set();
    for (const finding of findings) {
      const base = { rule: finding.rule, file, line: finding.line, test: finding.test, message: finding.message };
      const matched = covering(analysis.suppressions, finding);
      if (!matched.length) {
        place(base, scope);
        continue;
      }
      matched.forEach(item => used.add(item));
      const statuses = matched.map(item => ({ ...statusOf(item), id: item.residual }));
      const worst = statuses.reduce((low, item) => STATUS_RANK[item.status] < STATUS_RANK[low.status] ? item : low);
      if (worst.status === 'approved') {
        base.residual = worst.id;
        base.text = `承認済みの例外 ${worst.id}: ${format(base)}`;
        base.scope = scope;
        result.exceptions.push(base);
      } else if (worst.status === 'pending' && phase === 'plan') {
        base.residual = worst.id;
        base.text = `承認待ち ${worst.id}: ${format(base)} — ${worst.detail}`;
        base.scope = scope;
        if (scope?.enforced) result.pending.push(base);
        else result.warned.push(base);
      } else {
        base.message = `${base.message} (抑止は無効: ${worst.detail})`;
        place(base, ['invalid', 'unknown'].includes(worst.status) ? { enforced: true, reason: 'invalid-suppression' } : scope);
      }
    }
    for (const item of analysis.suppressions) {
      if (used.has(item)) continue;
      const status = statusOf(item);
      if (status.status === 'invalid' || status.status === 'unknown') {
        place({ rule: 'invalid-suppression', file, line: item.line, test: item.test, message: `抑止コメントが無効です: ${status.detail}` }, { enforced: true, reason: 'invalid-suppression' });
      }
    }
  }

  // Test-level coverage: a planned TP needs a non-excluded test carrying both tags.
  for (const { change, mode } of modes) {
    const tpIds = change.tpIds ?? checkTestPlan(repo, change).requiredTags;
    const tests = [...state.files.values()].flatMap(entry => entry.analysis?.tests ?? []);
    for (const tp of tpIds) {
      const implemented = tests.some(item => !item.excluded && item.tags.includes(`@${change.id}`) && item.tags.includes(`@${tp}`));
      if (implemented) continue;
      place({
        rule: 'missing-tag',
        file: state.root ?? '(E2E ルート)',
        line: 0,
        test: null,
        message: `${change.id}: ${tp} を @${change.id} と同じテストに持つ有効なテストがありません（skip / fixme / fail のテストは数えません）`,
      }, { enforced: mode.tagged, reason: 'tagged' });
    }
  }

  for (const [path, message] of state.residualErrors ?? []) if (consulted.has(path)) place({ rule: 'unreadable', file: `${path}/evidence.md`, message }, { enforced: true });
  result.notes = [...notes];
  result.failed = result.enforced.length;
  return result;
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
