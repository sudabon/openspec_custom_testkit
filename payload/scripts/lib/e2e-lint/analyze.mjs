// Source analysis: test blocks, expects, calls and the per-file rule findings.

import { TP_ID } from '../ids.mjs';
import { lex, LexError } from './lexer.mjs';
import { declarationsOf, fixtureParameters, importsOf, testBindings } from './declarations.mjs';
import { argumentsOf, inRange, isDot, isFunctionArgument, isPunct, isTitle, lineIndex, sequences, statementEnd, tagsIn, titleTags } from './tokens.mjs';

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

const JSX_SOURCE = /\.[jt]sx$/i;

const MODIFIERS = new Set(['skip', 'only', 'fixme', 'fail']);
const EXCLUDING = new Set(['skip', 'fixme', 'fail']);
const DESCRIBE_MODES = new Set(['serial', 'parallel']);
const EXPECT_FORMS = new Set(['soft', 'poll']);
const EXPECT_FLAGS = new Set(['not', 'resolves', 'rejects']);
const CSS_LOCATORS = new Set(['locator', '$', '$$', '$eval', '$$eval']);
// Methods whose first argument is a selector, so an XPath string there is a locator.
const SELECTOR_METHODS = new Set([
  ...CSS_LOCATORS, 'waitForSelector', 'frameLocator', 'click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck',
  'hover', 'focus', 'tap', 'textContent', 'innerText', 'innerHTML', 'getAttribute', 'isVisible', 'isHidden',
  'isEnabled', 'isDisabled', 'isChecked', 'isEditable', 'selectOption', 'setInputFiles', 'dispatchEvent', 'dragAndDrop',
]);
// Playwright's auto-detection treats selectors starting with `//` or `..` as XPath; `./` is CSS.
const XPATH = /^\s*(?:xpath=|\(*\/\/|\.\.)/;
// Locators lack these methods, so their first argument is a selector whatever the receiver is named.
const PAGE_ONLY_SELECTOR_METHODS = new Set(['waitForSelector', 'dragAndDrop']);
const SUPPRESSION = /^\s*e2e-lint-allow\b/;
const SUPPRESSION_FORMAT = /^\s*e2e-lint-allow\s+([a-z-]+)(?:\s+([^\s:]+))?\s*:\s*(\S.*)?$/;

export function matcherLabel(item) {
  return item.negated ? `not.${item.matcher}` : item.matcher;
}

export function isWeak(item) {
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
  const flat = indexTokens(lexed.tokens, lineOf);
  const imports = importsOf(lexed.tokens);
  const { roots: testRoots, extensions } = testBindings(lexed.tokens, imports, testNames);
  const calls = collectCalls(text, lexed.tokens, testRoots);
  const { blocks, conditional, expects, rootCalls, memberCalls, instances } = calls;
  const { tests, owner } = buildTests(blocks, conditional);
  const titleAt = offset => owner(offset)?.title ?? null;
  const raw = [...calls.findings, ...ruleFindings(calls, tests, changeIds)];
  const suppressions = parseSuppressions(lexed.comments, { flat, lineOf, blocks, titleAt });

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

// Stamps each token with its line and returns every token of every sequence in source order.
function indexTokens(tokens, lineOf) {
  const flat = [];
  for (const seq of sequences(tokens)) {
    seq.forEach((token, index) => {
      token.line = lineOf(token.start);
      flat.push({ token, seq, index });
    });
  }
  return flat.sort((a, b) => a.token.start - b.token.start);
}

// Overloaded actions take values on Locators and selectors on Pages/Frames.
// Unknown receivers must not turn file paths or input text into XPath findings.
function pageExpression(seq, end) {
  if (seq[end]?.type === 'ident') return /^(?:page\d*|p\d+|frame\d*|popup\d*)$|(?:Page|Frame)$/.test(seq[end].value);
  if (!isPunct(seq[end], ')')) return false;
  const open = seq.openers[end];
  return isDot(seq[open - 2]) && /^(?:frame|\w*Frame)$/.test(seq[open - 1]?.value ?? '');
}

function locatorExpression(seq, end, locatorVariables) {
  if (seq[end]?.type === 'ident') return locatorVariables.has(seq[end].value);
  if (!isPunct(seq[end], ')')) return false;
  const open = seq.openers[end];
  const name = seq[open - 1]?.value ?? '';
  return isDot(seq[open - 2]) && (/^getBy/.test(name) || ['locator', 'frameLocator', 'filter', 'nth', 'first', 'last', 'and', 'or'].includes(name));
}

function locatorVariablesOf(tokens) {
  const found = new Set();
  for (const seq of sequences(tokens)) {
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].type !== 'ident' || !isPunct(seq[i + 1], '=')) continue;
      let end = statementEnd(seq, i);
      if (isPunct(seq[end], ';')) end--;
      if (locatorExpression(seq, end, found)) found.add(seq[i].value);
    }
  }
  return found;
}

// One pass over every token sequence: member calls, `new` instances, expects, fixed waits and test/describe blocks.
function collectCalls(text, tokens, testRoots) {
  const locatorVariables = locatorVariablesOf(tokens);
  const calls = { blocks: [], conditional: [], expects: [], rootCalls: [], memberCalls: [], instances: new Map(), findings: [] };
  for (const seq of sequences(tokens)) {
    for (let i = 0; i < seq.length; i++) {
      const token = seq[i];
      if (isDot(token) && seq[i + 1]?.type === 'ident' && isPunct(seq[i + 2], '(')) calls.memberCalls.push(memberCall(seq, i, locatorVariables));
      if (token.type === 'ident' && isPunct(seq[i + 1], '=')) {
        let k = i + 2;
        if (seq[k]?.value === 'await') k++;
        if (seq[k]?.value === 'new' && seq[k + 1]?.type === 'ident') calls.instances.set(token.value, seq[k + 1].value);
      }
      if (token.type !== 'ident' || isDot(seq[i - 1])) continue;
      rootCall(text, seq, i, testRoots, calls);
    }
  }
  return calls;
}

// `.name(` at `i`: the receiver and first argument decide locator rules and helper resolution.
function memberCall(seq, i, locatorVariables) {
  const { list } = argumentsOf(seq, i + 2);
  const first = list[0] && list[0][0] === list[0][1] ? seq[list[0][0]] : null;
  const before = seq[i - 1];
  let receiver = null;
  if (before?.type === 'ident') receiver = { kind: 'ident', name: before.value };
  else if (isPunct(before, ')')) {
    const open = seq.openers[i - 1];
    if (seq[open - 1]?.type === 'ident' && seq[open - 2]?.value === 'new') receiver = { kind: 'new', name: seq[open - 1].value };
  }
  return { name: seq[i + 1].value, start: seq[i + 1].start, line: seq[i + 1].line, first, receiver, locator: locatorExpression(seq, i - 1, locatorVariables), page: pageExpression(seq, i - 1) };
}

function fixedWait(at, name) {
  return { rule: 'fixed-wait', offset: at.start, line: at.line, message: `${name} による固定待機は禁止です。自動待機ロケーターと expect のリトライに任せてください` };
}

// A call whose callee is a dotted name starting at `i`, such as `test.describe.serial(...)`.
function rootCall(text, seq, i, testRoots, calls) {
  const token = seq[i];
  const names = [token.value];
  let next = i + 1;
  while (isDot(seq[next]) && seq[next + 1]?.type === 'ident') {
    names.push(seq[next + 1].value);
    next += 2;
  }
  if (!isPunct(seq[next], '(')) return;
  const { close, list } = argumentsOf(seq, next);
  calls.rootCalls.push({ names, start: token.start, line: token.line });
  let [root, ...members] = names;
  if (members[0] === 'test' && testRoots.has(`${root}.test`)) { root += '.test'; members = members.slice(1); }
  const call = { seq, token, root, members, close, list };

  if (root === 'expect' && (members.length === 0 || (members.length === 1 && EXPECT_FORMS.has(members[0])))) expectAt(call, calls.expects);
  if ((root === 'setTimeout' && members.length === 0) || ((root === 'globalThis' || root === 'window') && members.length === 1 && members[0] === 'setTimeout')) {
    calls.findings.push(fixedWait(token, 'setTimeout'));
  }
  blockAt(text, call, testRoots.has(root), calls);
}

function expectAt({ seq, token, close }, expects) {
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

function blockAt(text, { seq, token, root, members, close, list }, isTestRoot, calls) {
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
    if (declared) calls.blocks.push(block('test'));
    else if (members.length === 1) calls.conditional.push({ name: members[0], start: token.start, line: token.line });
  } else if (describeMembers && !describeMembers.includes('configure') && describeMembers.every(name => MODIFIERS.has(name) || DESCRIBE_MODES.has(name))) {
    if (declared || (list.length === 1 && lastIsFunction)) calls.blocks.push(block('describe'));
  }
}

// Nests blocks by body range, then gives each test its inherited tags, describe titles and exclusion.
function buildTests(blocks, conditional) {
  blocks.sort((a, b) => a.start - b.start);
  const inside = (outer, offset) => outer.bodyStart !== -1 && inRange(offset, outer.bodyStart, outer.bodyEnd);
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
  return { tests, owner };
}

function locatorFinding(call) {
  if (call.name === 'waitForTimeout') return fixedWait(call, 'waitForTimeout');
  const selector = CSS_LOCATORS.has(call.name) || call.name === 'frameLocator' || PAGE_ONLY_SELECTOR_METHODS.has(call.name)
    || (call.page && !call.locator && SELECTOR_METHODS.has(call.name));
  const xpath = selector && isTitle(call.first) && XPATH.test(call.first.value);
  if (!CSS_LOCATORS.has(call.name) && !xpath) return null;
  const what = xpath ? `XPath (${call.first.value})` : `${call.name}()`;
  return { rule: 'forbidden-locator', offset: call.start, line: call.line, message: `${what} は禁止です。getByRole / getByLabel / getByText / getByTestId を使ってください` };
}

// Findings decided by one file alone, after the fixed waits found while collecting calls.
function ruleFindings({ memberCalls, blocks, conditional }, tests, changeIds) {
  const raw = memberCalls.map(locatorFinding).filter(Boolean);
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
    const hasTp = item.tags.some(tag => tag.startsWith('@') && TP_ID.test(tag.slice(1)));
    // Source-only callers may omit repository context; repository lint always supplies known IDs.
    const hasChange = item.tags.some(tag => changeIds ? changeIds.includes(tag.slice(1)) : !/^@TP-/.test(tag));
    if (!hasTp || !hasChange) {
      const missing = [!hasChange && 'change タグ(@<change-id>)', !hasTp && 'TP タグ(@TP-NNN)'].filter(Boolean).join(' と ');
      raw.push({ rule: 'missing-tag', offset: item.start, line: item.line, test: item.title, message: `${missing} がありません` });
    }
  }
  return raw;
}

// Index of the first token that starts at or after `offset`.
function tokenAfter(flat, offset) {
  let lo = 0;
  let hi = flat.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (flat[mid].token.start < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function formatError(parsed, entry) {
  if (!parsed) return '書式は `e2e-lint-allow <rule-id> <residual-id>: <理由>` です';
  if (!RULES.includes(entry.rule)) return `未知の規則 ID です: ${entry.rule}`;
  if (!entry.residual) return 'Residual ID がありません';
  if (!entry.reason) return '理由がありません';
  return undefined;
}

// Each suppression covers [from, to): the statement right after it, or nothing when it trails code.
function parseSuppressions(comments, { flat, lineOf, blocks, titleAt }) {
  return comments.filter(comment => SUPPRESSION.test(comment.text)).map(comment => {
    const parsed = comment.text.match(SUPPRESSION_FORMAT);
    const entry = { line: lineOf(comment.start), start: comment.start, test: titleAt(comment.start), rule: parsed?.[1] ?? null, residual: parsed?.[2] ?? null, reason: parsed?.[3]?.trim() ?? '' };
    const error = formatError(parsed, entry);
    if (error) entry.error = error;
    const lo = tokenAfter(flat, comment.end);
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
}
