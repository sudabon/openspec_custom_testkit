import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectChanges } from '../payload/scripts/lib/select.mjs';
import { gitRepo, runGate, writeDerivedChange, writeDerivedSchema, writeIn } from './support.mjs';

const DERIVED = 'quality-driven-e2e-mockup';
const COMPAT = `openspec/schemas/${DERIVED}/testkit-compat.json`;

// Gate output of one change with its id and the derived-only schema line removed, for comparing two changes.
function checkLines(stdout, id) {
  const blocks = stdout.split(/^(?=▶ )/m);
  const block = blocks.find(text => text.startsWith(`▶ ${id} `)) ?? '';
  const lines = block.split('\n').slice(1);
  const end = lines.indexOf('---');
  return (end < 0 ? lines : lines.slice(0, end)).filter(line => line.trim() && !line.includes('schema: '));
}

function derivedRepo(t) {
  const repo = gitRepo(t);
  writeDerivedSchema(repo.dir);
  writeDerivedChange(repo.dir);
  writeDerivedChange(repo.dir, 'plain', { schema: 'quality-driven-e2e' });
  repo.commit('derived');
  return repo;
}

test('Select JSON for a derived change: both the declared and the effective schema are shown', t => {
  const repo = derivedRepo(t);
  const result = runGate(repo.dir, ['select', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const byId = Object.fromEntries(JSON.parse(result.stdout).changes.map(change => [change.id, change]));
  assert.equal(byId['mockup-demo'].schema, 'quality-driven-e2e');
  assert.equal(byId['mockup-demo'].declaredSchema, DERIVED);
  assert.equal(byId['mockup-demo'].qe, true);
  assert.equal(byId['mockup-demo'].e2e, 'not-applicable');
  assert.equal(byId.plain.schema, 'quality-driven-e2e');
  assert.equal(byId.plain.declaredSchema, 'quality-driven-e2e');
});

test('Unapproved derived change starts implementation: the plan gate fails exactly like the integrated change', t => {
  const repo = derivedRepo(t);
  const result = runGate(repo.dir, ['check', '--phase', 'plan']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /▶ mockup-demo \(active\/plan\)\n {2}schema: quality-driven-e2e \(宣言: quality-driven-e2e-mockup\)\n/);
  const derived = checkLines(result.stdout, 'mockup-demo');
  assert.ok(derived.some(line => line.includes('quality.md が未承認のままタスクが進行しています')), derived.join('\n'));
  assert.deepEqual(derived, checkLines(result.stdout, 'plain'));
  // The integrated change prints no schema line, so its output is unchanged.
  assert.match(result.stdout, /▶ plain \(active\/plan\)\n {2}✓ risk_level: low\n/);
});

test('Extra artifact is ignored by testkit: mockup-plan and the 7. Mockup group change nothing', t => {
  const repo = derivedRepo(t);
  const before = checkLines(runGate(repo.dir, ['check', '--phase', 'plan']).stdout, 'mockup-demo');
  rmSync(join(repo.dir, 'openspec/changes/mockup-demo/mockup-plan.md'));
  writeIn(repo.dir, 'openspec/changes/mockup-demo/tasks.md', '## 1. Oracle\n\n- [x] 1.1 oracle\n\n## 2. Implementation\n\n- [x] 2.1 implement\n- [ ] 2.2 finish\n');
  const after = checkLines(runGate(repo.dir, ['check', '--phase', 'plan']).stdout, 'mockup-demo');
  assert.deepEqual(after, before);
  assert.doesNotMatch(before.join('\n'), /mockup|Mockup|7\.1/);
});

test('Declaration removed in the pull request: the change is still gated as integrated and the gate fails', t => {
  for (const [label, edit] of [
    ['removed', dir => rmSync(join(dir, COMPAT))],
    ['invalidated', dir => writeFileSync(join(dir, COMPAT), JSON.stringify({ extends: 'quality-driven-e2e', compatVersion: 2 }))],
  ]) {
    const repo = gitRepo(t);
    writeDerivedSchema(repo.dir);
    repo.commit('schema');
    const base = repo.git(['rev-parse', 'HEAD']).trim();
    edit(repo.dir);
    writeDerivedChange(repo.dir);
    repo.commit(label);
    const selected = selectChanges({ repo: repo.dir, base, env: {} });
    const change = selected.changes.find(item => item.id === 'mockup-demo');
    assert.equal(change.scope, 'integrated', label);
    assert.equal(change.schema, 'quality-driven-e2e', label);
    assert.equal(selected.ok, false, label);
    const result = runGate(repo.dir, ['check', '--base', base]);
    assert.equal(result.status, 1, label);
    assert.match(result.stdout, label === 'removed' ? /互換宣言 .* が HEAD で失われています/ : /HEAD で無効になっています。.*testkit-compat.json が無効です: compatVersion/, label);
    assert.match(result.stdout, /quality.md が未承認のままタスクが進行しています/, label);
  }
});

test('Malformed declaration at HEAD fails and is not out of scope', t => {
  const repo = gitRepo(t);
  writeDerivedSchema(repo.dir, DERIVED, { compat: '{"extends": ' });
  writeDerivedChange(repo.dir);
  repo.commit('malformed');
  const result = runGate(repo.dir, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /openspec\/schemas\/quality-driven-e2e-mockup\/testkit-compat.json が無効です: JSON として読めません/);
  assert.doesNotMatch(result.stdout, /無関係な schema/);
  const selected = selectChanges({ repo: repo.dir, env: {} });
  assert.equal(selected.changes[0].scope, 'unknown');
  assert.equal(selected.changes[0].declaredSchema, DERIVED);
});

test('Custom schema without declaration stays out of scope', t => {
  const repo = gitRepo(t);
  const base = repo.git(['rev-parse', 'HEAD']).trim();
  writeDerivedSchema(repo.dir, 'team-custom', { compat: null });
  writeDerivedChange(repo.dir, 'custom', { schema: 'team-custom' });
  repo.commit('custom');
  const result = runGate(repo.dir, ['check', '--base', base]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /無関係な schema: team-custom/);
  assert.doesNotMatch(result.stdout, /schema: quality-driven-e2e/);
});

test('a default schema that is a valid derived schema is never a config fallback', t => {
  const repo = gitRepo(t);
  writeDerivedSchema(repo.dir);
  writeIn(repo.dir, 'openspec/config.yaml', `schema: ${DERIVED}\n`);
  writeDerivedChange(repo.dir);
  rmSync(join(repo.dir, 'openspec/changes/mockup-demo/.openspec.yaml'));
  const selected = selectChanges({ repo: repo.dir, env: {} });
  assert.equal(selected.changes[0].scope, 'unknown');
  assert.match(selected.changes[0].errors.join('\n'), /統合 schema の検査を対象外にしません/);
});
