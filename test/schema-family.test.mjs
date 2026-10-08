import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listCompatDeclarations, listDerivedSchemas, readCompatDeclaration, resolveSchemaFamily } from '../payload/scripts/lib/schema-family.mjs';
import { gitRepo, tempDir, writeDerivedSchema, writeIn } from './support.mjs';

const NAME = 'quality-driven-e2e-mockup';

function repoWith(t, options) {
  const dir = tempDir('tk-family-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeDerivedSchema(dir, NAME, options);
  return dir;
}

test('Valid declaration: a superset of the integrated schema resolves to the integrated family', t => {
  const dir = repoWith(t);
  assert.deepEqual(resolveSchemaFamily(dir, NAME), { family: 'quality-driven-e2e', declared: NAME, derived: true, error: null });
  assert.equal(resolveSchemaFamily(dir, 'quality-driven-e2e').derived, false);
  assert.equal(resolveSchemaFamily(dir, 'quality-driven-e2e').family, 'quality-driven-e2e');
  assert.deepEqual(listDerivedSchemas(dir), [{ name: NAME, path: `openspec/schemas/${NAME}/testkit-compat.json`, valid: true, errors: [] }]);
});

test('a schema without a declaration keeps its own name', t => {
  const dir = repoWith(t, { compat: null });
  assert.deepEqual(resolveSchemaFamily(dir, NAME), { family: NAME, declared: NAME, derived: false, error: null });
  assert.equal(resolveSchemaFamily(dir, 'team-custom').family, 'team-custom');
  assert.equal(resolveSchemaFamily(dir, '../escape').family, '../escape');
});

test('Derived schema drops a required artifact: the missing artifact or dependency is named', t => {
  const noPlan = repoWith(t, { mutate: schema => { schema.artifacts = schema.artifacts.filter(a => a.id !== 'test-plan'); } });
  const dropped = resolveSchemaFamily(noPlan, NAME);
  assert.equal(dropped.family, null);
  assert.match(dropped.error, /artifact test-plan がありません/);

  const noDep = repoWith(t, { mutate: schema => { schema.artifacts.find(a => a.id === 'quality').requires = []; } });
  assert.match(resolveSchemaFamily(noDep, NAME).error, /artifact quality の requires に specs がありません/);

  const moved = repoWith(t, { mutate: schema => { schema.artifacts.find(a => a.id === 'tasks').generates = 'todo.md'; } });
  assert.match(resolveSchemaFamily(moved, NAME).error, /artifact tasks の generates/);

  const apply = repoWith(t, { mutate: schema => { schema.apply = { requires: ['design'], tracks: 'todo.md' }; } });
  const applyError = resolveSchemaFamily(apply, NAME).error;
  assert.match(applyError, /apply.requires に tasks がありません/);
  assert.match(applyError, /apply.tracks は tasks.md が必要です/);

  const renamed = repoWith(t, { mutate: schema => { schema.name = 'other'; } });
  assert.match(resolveSchemaFamily(renamed, NAME).error, /ディレクトリ名 quality-driven-e2e-mockup と一致しません/);

  const noTemplate = repoWith(t);
  rmSync(join(noTemplate, `openspec/schemas/${NAME}/templates/qa-handoff.md`));
  assert.match(resolveSchemaFamily(noTemplate, NAME).error, /templates\/qa-handoff.md がありません/);

  const noIntegrated = repoWith(t);
  rmSync(join(noIntegrated, 'openspec/schemas/quality-driven-e2e'), { recursive: true });
  assert.match(resolveSchemaFamily(noIntegrated, NAME).error, /統合 schema を読めません/);
});

test('Declaration reuses a reserved name: it is invalid and says why', t => {
  const dir = repoWith(t);
  writeIn(dir, 'openspec/schemas/spec-driven/testkit-compat.json', JSON.stringify({ extends: 'quality-driven-e2e', compatVersion: 1 }));
  const declaration = readCompatDeclaration(dir, 'spec-driven');
  assert.equal(declaration.valid, false);
  assert.match(declaration.errors.join('\n'), /spec-driven は予約された schema 名/);
  // A reserved schema is never re-routed through a declaration.
  assert.equal(resolveSchemaFamily(dir, 'spec-driven').family, 'spec-driven');
  const listed = listDerivedSchemas(dir).find(entry => entry.name === 'spec-driven');
  assert.equal(listed.valid, false);
});

test('Unsupported compatibility version: the supported values are shown', t => {
  const v2 = repoWith(t, { compat: JSON.stringify({ extends: 'quality-driven-e2e', compatVersion: 2 }) });
  assert.match(resolveSchemaFamily(v2, NAME).error, /compatVersion は 1 だけに対応しています（実際: 2）/);
  const qe = repoWith(t, { compat: JSON.stringify({ extends: 'quality-driven', compatVersion: 1 }) });
  assert.match(resolveSchemaFamily(qe, NAME).error, /extends は quality-driven-e2e だけに対応しています（実際: "quality-driven"）/);
  const array = repoWith(t, { compat: '[]' });
  assert.match(resolveSchemaFamily(array, NAME).error, /JSON object が必要です/);
});

test('Malformed declaration: the path and the parse error are shown', t => {
  const dir = repoWith(t, { compat: '{"extends": ' });
  const resolved = resolveSchemaFamily(dir, NAME);
  assert.equal(resolved.family, null);
  assert.match(resolved.error, /openspec\/schemas\/quality-driven-e2e-mockup\/testkit-compat.json が無効です: JSON として読めません/);
});

test('a revision is read with git, and a git failure is not "no declaration"', t => {
  const repo = gitRepo(t);
  writeDerivedSchema(repo.dir, NAME);
  repo.commit('derived');
  const base = repo.git(['rev-parse', 'HEAD']).trim();
  rmSync(join(repo.dir, `openspec/schemas/${NAME}/testkit-compat.json`));
  writeFileSync(join(repo.dir, `openspec/schemas/${NAME}/schema.yaml`), 'name: broken\n');
  repo.commit('drop declaration');

  assert.equal(resolveSchemaFamily(repo.dir, NAME, { rev: base }).derived, true);
  assert.equal(resolveSchemaFamily(repo.dir, NAME, { rev: 'HEAD' }).family, NAME);
  assert.equal(resolveSchemaFamily(repo.dir, NAME).family, NAME);

  const missing = resolveSchemaFamily(repo.dir, NAME, { rev: 'refs/does-not-exist' });
  assert.equal(missing.family, null);
  assert.match(missing.error, /refs\/does-not-exist の .*testkit-compat.json を読めません/);
  assert.equal(readCompatDeclaration(repo.dir, NAME, { rev: 'refs/does-not-exist' }).exists, null);
});

test('listCompatDeclarations returns only the valid declarations at a revision and throws on a git failure', t => {
  const repo = gitRepo(t);
  const empty = repo.git(['rev-parse', 'HEAD']).trim();
  assert.deepEqual(listCompatDeclarations(repo.dir, { rev: empty }), []);
  writeDerivedSchema(repo.dir, NAME);
  writeDerivedSchema(repo.dir, 'quality-driven-e2e-broken', { compat: JSON.stringify({ extends: 'quality-driven-e2e', compatVersion: 2 }) });
  writeDerivedSchema(repo.dir, 'team-custom', { compat: null });
  repo.commit('schemas');
  const base = repo.git(['rev-parse', 'HEAD']).trim();
  rmSync(join(repo.dir, `openspec/schemas/${NAME}/testkit-compat.json`));
  repo.commit('drop declaration');

  assert.deepEqual(listCompatDeclarations(repo.dir, { rev: base }), [NAME]);
  assert.deepEqual(listCompatDeclarations(repo.dir, { rev: 'HEAD' }), []);
  assert.throws(() => listCompatDeclarations(repo.dir, { rev: 'refs/does-not-exist' }));
});
