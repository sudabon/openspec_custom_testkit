// Lexer: keeps comments, strings, templates, regex literals and JSX text apart
// from code. Template and JSX expressions become nested token sequences.

export const KEYWORDS_BEFORE_EXPRESSION = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
export const OPENERS = { '(': ')', '[': ']', '{': '}' };
export const CLOSERS = new Set([')', ']', '}']);
const IDENT_START = /[\p{ID_Start}$_#\\]/u;
const IDENT_PART = /[\p{ID_Continue}$‌‍\\]/u;

export class LexError extends Error {
  constructor(message, offset) {
    super(message);
    this.offset = offset;
  }
}

const CONTROL_KEYWORDS = ['if', 'while', 'for', 'with', 'switch', 'catch'];
// `<T,>(` and `<T extends U>(` open a generic arrow function, not a JSX element.
const GENERIC_ARROW = /^<\s*[\w$]+\s*(?:,|extends\b)[^<>]*>\s*\(/;

// The scanners share one lexer state `lx`: the source, the read position, the JSX flag and the comments seen so far.
export function lex(src, { jsx = false } = {}) {
  const lx = { src, pos: 0, jsx, comments: [] };
  const tokens = scan(lx, false);
  return { tokens, comments: lx.comments };
}

function scan(lx, stopAtBrace) {
  const tokens = [];
  const stack = [];
  while (lx.pos < lx.src.length) {
    if (skipTrivia(lx)) continue;
    if (lx.src[lx.pos] === '}' && stopAtBrace && stack.length === 0) return tokens;
    tokens.push(readToken(lx, tokens, stack));
  }
  if (stopAtBrace) throw new LexError('閉じていないテンプレート式があります', lx.pos);
  if (stack.length) throw new LexError('閉じていない括弧があります', stack.at(-1).start);
  return tokens;
}

// Whitespace, comments and a leading hashbang produce no token.
function skipTrivia(lx) {
  const { src, pos } = lx;
  const ch = src[pos];
  if (/\s/.test(ch)) {
    lx.pos++;
  } else if (ch === '/' && src[pos + 1] === '/') {
    const newline = src.slice(pos).search(/[\r\n]/);
    const end = newline === -1 ? src.length : pos + newline;
    lx.comments.push({ start: pos, end, text: src.slice(pos + 2, end) });
    lx.pos = end;
  } else if (ch === '/' && src[pos + 1] === '*') {
    const close = src.indexOf('*/', pos + 2);
    if (close === -1) throw new LexError('閉じていないブロックコメントがあります', pos);
    lx.comments.push({ start: pos, end: close + 2, text: src.slice(pos + 2, close) });
    lx.pos = close + 2;
  } else if (ch === '#' && pos === 0 && src[1] === '!') {
    const newline = src.search(/[\r\n]/);
    lx.pos = newline === -1 ? src.length : newline;
  } else {
    return false;
  }
  return true;
}

function readToken(lx, tokens, stack) {
  const { src, pos } = lx;
  const ch = src[pos];
  if (ch === '"' || ch === "'") return readString(lx, ch);
  if (ch === '`') return readTemplate(lx);
  if (ch === '/' && expressionStart(tokens)) return readRegex(lx);
  if (startsJsx(lx, tokens)) return readJsxElement(lx);
  if (IDENT_START.test(ch)) return readWord(lx, 'ident', IDENT_PART);
  if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[pos + 1] ?? ''))) return readWord(lx, 'number', /[\w.]/);
  return readPunct(lx, tokens, stack);
}

function expressionStart(tokens) {
  const last = tokens.at(-1);
  if (!last) return true;
  // Postfix ++/-- and TS non-null assertions end an operand; control headers start a statement.
  if (last.type === 'punct') return last.controlClose || (!CLOSERS.has(last.value) && !['++', '--'].includes(last.value) && !last.postfix);
  if (last.type === 'ident') return KEYWORDS_BEFORE_EXPRESSION.has(last.value);
  return false;
}

function startsJsx(lx, tokens) {
  const { src, pos } = lx;
  return lx.jsx && src[pos] === '<' && !GENERIC_ARROW.test(src.slice(pos)) && expressionStart(tokens) && /[\p{ID_Start}>]/u.test(src[pos + 1] ?? '');
}

// Identifiers and numbers: one start character, then every character matching `part`.
function readWord(lx, type, part) {
  const start = lx.pos;
  lx.pos++;
  while (lx.pos < lx.src.length && part.test(lx.src[lx.pos])) lx.pos++;
  return { type, value: lx.src.slice(start, lx.pos), start, end: lx.pos };
}

function punctValue(src, pos) {
  const ch = src[pos];
  if (src.startsWith('=>', pos)) return '=>';
  if (src.startsWith('...', pos)) return '...';
  if (src.startsWith('++', pos) || src.startsWith('--', pos)) return src.slice(pos, pos + 2);
  if (ch === '?' && src[pos + 1] === '.' && !/[0-9]/.test(src[pos + 2] ?? '')) return '?.';
  return ch;
}

function readPunct(lx, tokens, stack) {
  const start = lx.pos;
  const value = punctValue(lx.src, start);
  lx.pos += value.length;
  const postfix = value === '!' && !expressionStart(tokens) && !/[\r\n]/.test(lx.src.slice(tokens.at(-1)?.end ?? 0, start));
  let controlClose = false;
  if (OPENERS[value]) stack.push({ value, start, control: value === '(' && CONTROL_KEYWORDS.includes(tokens.at(-1)?.value) && !['.', '?.'].includes(tokens.at(-2)?.value) });
  else if (CLOSERS.has(value)) {
    const open = stack.pop();
    if (!open || OPENERS[open.value] !== value) throw new LexError('括弧の対応が取れません', start);
    controlClose = value === ')' && open.control;
  }
  return { type: 'punct', value, start, end: lx.pos, postfix, controlClose };
}

function readString(lx, quote) {
  const { src } = lx;
  const start = lx.pos;
  let value = '';
  lx.pos++;
  while (lx.pos < src.length) {
    const ch = src[lx.pos];
    if (ch === '\\') {
      const next = src[lx.pos + 1] ?? '';
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      lx.pos += 2;
    } else if (ch === quote) {
      lx.pos++;
      return { type: 'string', value, start, end: lx.pos };
    } else if (ch === '\n' || ch === '\r') {
      break;
    } else {
      value += ch;
      lx.pos++;
    }
  }
  throw new LexError('閉じていない文字列リテラルがあります', start);
}

function readTemplate(lx) {
  const { src } = lx;
  const start = lx.pos;
  const exprs = [];
  let value = '';
  lx.pos++;
  while (lx.pos < src.length) {
    const ch = src[lx.pos];
    if (ch === '\\') {
      value += src.slice(lx.pos, lx.pos + 2);
      lx.pos += 2;
    } else if (ch === '`') {
      lx.pos++;
      return { type: 'template', value, start, end: lx.pos, exprs };
    } else if (ch === '$' && src[lx.pos + 1] === '{') {
      lx.pos += 2;
      exprs.push(scan(lx, true));
      lx.pos++;
      value += '${…}';
    } else {
      value += ch;
      lx.pos++;
    }
  }
  throw new LexError('閉じていないテンプレートリテラルがあります', start);
}

function readRegex(lx) {
  const { src } = lx;
  const start = lx.pos;
  let inClass = false;
  lx.pos++;
  while (lx.pos < src.length) {
    const ch = src[lx.pos];
    if (ch === '\\') lx.pos += 2;
    else if (ch === '\n' || ch === '\r') break;
    else {
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) {
        lx.pos++;
        while (lx.pos < src.length && IDENT_PART.test(src[lx.pos])) lx.pos++;
        return { type: 'regex', value: src.slice(start, lx.pos), start, end: lx.pos };
      }
      lx.pos++;
    }
  }
  throw new LexError('閉じていない正規表現リテラルがあります', start);
}

function skipSpace(lx) {
  while (lx.pos < lx.src.length && /\s/.test(lx.src[lx.pos])) lx.pos++;
}

function readJsxName(lx, start) {
  const from = lx.pos;
  while (lx.pos < lx.src.length && /[\p{ID_Continue}$.:-]/u.test(lx.src[lx.pos])) lx.pos++;
  if (lx.pos === from) throw new LexError('JSX を解析できません', start);
  return lx.src.slice(from, lx.pos);
}

function readJsxExpression(lx, exprs) {
  lx.pos++;
  exprs.push(scan(lx, true));
  lx.pos++;
}

function readJsxChildren(lx, exprs, start) {
  const { src } = lx;
  while (lx.pos < src.length) {
    if (src.startsWith('</', lx.pos)) {
      const close = src.indexOf('>', lx.pos);
      if (close === -1) break;
      lx.pos = close + 1;
      return;
    }
    if (src[lx.pos] === '<') exprs.push([readJsxElement(lx)]);
    else if (src[lx.pos] === '{') readJsxExpression(lx, exprs);
    else lx.pos++;
  }
  throw new LexError('閉じていない JSX 要素があります', start);
}

function readJsxAttribute(lx, exprs, start) {
  readJsxName(lx, start);
  skipSpace(lx);
  if (lx.src[lx.pos] !== '=') return;
  lx.pos++;
  skipSpace(lx);
  const ch = lx.src[lx.pos];
  if (ch === '"' || ch === "'") {
    const close = lx.src.indexOf(ch, lx.pos + 1);
    if (close === -1) throw new LexError('閉じていない JSX 属性があります', start);
    lx.pos = close + 1;
  } else if (ch === '{') readJsxExpression(lx, exprs);
  else if (ch === '<') exprs.push([readJsxElement(lx)]);
  else throw new LexError('JSX を解析できません', start);
}

function readJsxElement(lx) {
  const { src } = lx;
  const start = lx.pos;
  const exprs = [];
  lx.pos++;
  if (src[lx.pos] === '>') {
    lx.pos++;
    readJsxChildren(lx, exprs, start);
    return { type: 'jsx', value: '<>', start, end: lx.pos, exprs };
  }
  const name = readJsxName(lx, start);
  for (;;) {
    skipSpace(lx);
    if (lx.pos >= src.length) throw new LexError('閉じていない JSX 要素があります', start);
    if (src.startsWith('/>', lx.pos)) {
      lx.pos += 2;
      break;
    }
    if (src[lx.pos] === '>') {
      lx.pos++;
      readJsxChildren(lx, exprs, start);
      break;
    }
    if (src[lx.pos] === '{') readJsxExpression(lx, exprs);
    else readJsxAttribute(lx, exprs, start);
  }
  return { type: 'jsx', value: `<${name}>`, start, end: lx.pos, exprs };
}
