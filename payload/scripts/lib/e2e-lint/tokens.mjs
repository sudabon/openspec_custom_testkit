// Token sequence helpers.

import { CLOSERS, KEYWORDS_BEFORE_EXPRESSION, OPENERS } from './lexer.mjs';

const CONTINUES_AFTER = new Set(['.', '?.', ',', '=', '=>', '+', '-', '*', '/', '%', '&', '|', '^', '?', ':', '<', '...']);
const CONTINUES_BEFORE = new Set(['.', '?.', ',', '=', '=>', '+', '-', '*', '/', '%', '&', '|', '^', '?', ':', '<', '>']);
const KEYWORDS_CONTINUING = new Set([...KEYWORDS_BEFORE_EXPRESSION, 'async', 'export', 'default', 'const', 'let', 'var', 'function', 'class', 'import', 'from']);

export const isPunct = (token, value) => token?.type === 'punct' && token.value === value;
export const isDot = token => isPunct(token, '.') || isPunct(token, '?.');
export const isOpener = token => token?.type === 'punct' && Boolean(OPENERS[token.value]);
export const isCloser = token => token?.type === 'punct' && CLOSERS.has(token.value);
export const isTitle = token => token?.type === 'string' || token?.type === 'template';
// Half-open offset range check: start <= offset < end.
export const inRange = (offset, start, end) => start <= offset && offset < end;

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

export function* sequences(seq) {
  yield prepare(seq);
  for (const token of seq) {
    for (const inner of token.exprs ?? []) yield* sequences(inner);
  }
}

export function argumentsOf(seq, open) {
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

export function isFunctionArgument(seq, [from, to]) {
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
export function statementEnd(seq, from) {
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

export function lineIndex(text) {
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

export function tagsIn(seq, [from, to]) {
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

export function titleTags(title) {
  return title.match(/@[^\s@]+/g) ?? [];
}
