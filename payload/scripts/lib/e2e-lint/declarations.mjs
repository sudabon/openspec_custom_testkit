// Declarations, imports, test aliases and the fixture graph of one source file.

import { isDot, isOpener, isPunct, statementEnd } from './tokens.mjs';

const TEST_ROOTS = new Set(['test', 'it']);

export function declarationsOf(seq) {
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

export function importsOf(seq) {
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
export function testBindings(seq, imports, testNames = []) {
  const roots = new Set([...TEST_ROOTS, ...testNames]);
  for (const [local, binding] of imports) if (binding.imported === 'test') roots.add(local);
  for (const [local, binding] of imports) if (binding.imported === '*' && binding.specifier === '@playwright/test') roots.add(`${local}.test`);
  const extensions = new Map();
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].type !== 'ident' || isDot(seq[i - 1]) || !isPunct(seq[i + 1], '=')) continue;
    const name = seq[i].value;
    let base = seq[i + 2]?.value;
    let next = i + 3;
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
    extensions.set(name, { base, fixtures: fixturesOf(seq, open + 1) });
  }
  return { roots, extensions };
}

// The fixture object of `base.extend({ ... })` at `object`: fixture name to the class it passes to `use(...)`.
function fixturesOf(seq, object) {
  const fixtures = new Map();
  if (!isPunct(seq[object], '{')) return fixtures;
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
  return fixtures;
}

export function fixtureParameters(seq, body) {
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
