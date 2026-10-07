// Helper and fixture resolution across files, and the assertion findings that depend on it.

import { posix } from 'node:path';
import { analyzeSource, isWeak, matcherLabel } from './analyze.mjs';
import { inRange } from './tokens.mjs';

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const NEUTRAL_MATCHERS = new Set(['toPass']);

// Expects inside [range.start, range.end) that count as assertions.
function expectsIn(expects, range) {
  return expects.filter(item => inRange(item.start, range.start, range.end) && !NEUTRAL_MATCHERS.has(item.matcher));
}

function strengthOf(expects, range) {
  const found = expectsIn(expects, range);
  if (found.some(item => !isWeak(item))) return 'strong';
  return found.length ? 'weak' : null;
}

// Exported helpers under the E2E root, keyed by file: functions by export name, classes by method.
export function helperEntry(analysis) {
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

export function resolveModule(file, specifier, known) {
  if (!specifier.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(file), specifier));
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, '');
  const candidates = [base, ...RESOLVE_EXTENSIONS.map(ext => base + ext), ...RESOLVE_EXTENSIONS.map(ext => stem + ext), ...RESOLVE_EXTENSIONS.map(ext => `${base}/index${ext}`)];
  return candidates.find(candidate => known.has(candidate)) ?? null;
}

export function fixtureTests(file, analysis, helpers) {
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

export function helperResolver(file, analysis, helpers) {
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
      if (!inRange(call.start, range.bodyStart, range.bodyEnd)) continue;
      const [root, member] = call.names;
      let strength = null;
      if (call.names.length === 1) strength = functions.get(root) ?? null;
      else if (call.names.length === 2 && namespaces.has(root)) strength = namespaces.get(root).functions.get(member) ?? null;
      if (strength) found.push({ name: call.names.join('.'), strength, start: call.start });
    }
    for (const call of analysis.memberCalls) {
      if (!inRange(call.start, range.bodyStart, range.bodyEnd)) continue;
      // Count only a known Page Object constructor/instance or a resolved fixture binding.
      const owner = call.receiver?.kind === 'new' ? call.receiver.name : call.receiver?.kind === 'ident' ? analysis.instances.get(call.receiver.name) : null;
      const fixture = call.receiver?.kind === 'ident' ? range.fixtures.get(call.receiver.name) : null;
      const strength = owner ? classes.get(owner)?.get(call.name) : tests.get(range.root)?.get(fixture)?.get(call.name);
      if (strength) found.push({ name: call.name, strength, start: call.start });
    }
    return found;
  };
}

export function assertionFindings(analysis, resolve = () => []) {
  const findings = [];
  for (const item of analysis.tests) {
    if (item.bodyStart === -1) continue;
    const range = { start: item.bodyStart, end: item.bodyEnd };
    const own = expectsIn(analysis.expects, range);
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
