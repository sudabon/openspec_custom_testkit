import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readChangeMetadata, readDefaultSchema, readRiskLevel } from '../payload/scripts/lib/change-metadata.mjs';
import { listActiveChanges, listArchivedChanges, parseArchiveFolder } from '../payload/scripts/lib/changes.mjs';
import { appendGithubOutput, emit, resolveRepo } from '../payload/scripts/lib/entry.mjs';
import { main as checkTestPlanMain } from '../payload/scripts/check-test-plan.mjs';
import { main as reportMain } from '../payload/scripts/e2e-report.mjs';
import { main as gateMain } from '../payload/scripts/testkit-gate.mjs';
import { gitRepo, tempDir, writeIn } from './support.mjs';

const DIR = 'openspec/changes/demo';

function metadata(t, text, options) {
  const repo = gitRepo(t);
  if (text != null) writeIn(repo.dir, `${DIR}/.openspec.yaml`, text);
  return readChangeMetadata(repo.dir, DIR, options);
}

test('change metadata: a missing file is missing in both modes', t => {
  for (const strict of [true, false]) {
    assert.deepEqual(metadata(t, null, { strict }), { missing: true, problem: null, errors: [], data: null, schema: null, skipSpecs: false });
  }
});

test('change metadata: a valid mapping gives schema and skip_specs in both modes', t => {
  for (const strict of [true, false]) {
    const read = metadata(t, 'schema: quality-driven-e2e\nskip_specs: true\ncreated: 2026-10-07\n', { strict });
    assert.equal(read.problem, null);
    assert.equal(read.schema, 'quality-driven-e2e');
    assert.equal(read.skipSpecs, true);
    assert.ok(read.data);
  }
});

test('change metadata: aliases and parse errors are yaml problems in both modes', t => {
  for (const strict of [true, false]) {
    assert.equal(metadata(t, 'a: &x 1\nb: *x\nschema: s\n', { strict }).problem, 'yaml');
    const broken = metadata(t, 'schema: [\n', { strict });
    assert.equal(broken.problem, 'yaml');
    assert.ok(broken.errors.length > 0);
  }
});

test('change metadata: strict (effort) rejects a non-mapping document, non-strict (select) accepts it', t => {
  assert.equal(metadata(t, '- a\n', { strict: true }).problem, 'mapping');
  assert.equal(metadata(t, '', { strict: true }).problem, 'mapping');
  const loose = metadata(t, '- a\n', { strict: false });
  assert.equal(loose.problem, null);
  assert.equal(loose.schema, null);
});

test('change metadata: strict (effort) rejects a non-string schema but keeps the data, non-strict (select) stringifies it', t => {
  const strict = metadata(t, 'schema: 1\ncreated: 2026-10-07\n', { strict: true });
  assert.equal(strict.problem, 'schema');
  assert.ok(strict.data);
  assert.equal(metadata(t, 'schema: 1\n', { strict: false }).schema, '1');
});

test('change metadata: rev reads the committed file instead of the work tree', t => {
  const repo = gitRepo(t);
  writeIn(repo.dir, `${DIR}/.openspec.yaml`, 'schema: quality-driven-e2e\n');
  repo.commit();
  writeIn(repo.dir, `${DIR}/.openspec.yaml`, 'schema: spec-driven\n');
  assert.equal(readChangeMetadata(repo.dir, DIR, { rev: 'HEAD', strict: false }).schema, 'quality-driven-e2e');
  assert.equal(readChangeMetadata(repo.dir, DIR, { strict: false }).schema, 'spec-driven');
  assert.equal(readChangeMetadata(repo.dir, 'openspec/changes/other', { rev: 'HEAD', strict: false }).missing, true);
});

test('default schema: strict (effort) and non-strict (select) differ only on aliases, tags and non-mappings', t => {
  const repo = gitRepo(t);
  assert.deepEqual(readDefaultSchema(repo.dir, { strict: true }).schema, null);
  const cases = [
    // text, strict invalid, strict schema, non-strict invalid, non-strict schema
    ['schema: quality-driven-e2e\n', false, 'quality-driven-e2e', false, 'quality-driven-e2e'],
    ['', false, null, false, null],
    ['a: &x 1\nb: *x\nschema: s\n', true, null, false, 's'],
    ['- a\n', true, null, false, null],
    ['schema: 1\n', true, null, false, '1'],
    ['schema: [\n', true, null, true, null],
  ];
  for (const [text, strictInvalid, strictSchema, looseInvalid, looseSchema] of cases) {
    writeIn(repo.dir, 'openspec/config.yaml', text);
    const strict = readDefaultSchema(repo.dir, { strict: true });
    const loose = readDefaultSchema(repo.dir, { strict: false });
    assert.deepEqual([strict.invalid, strict.schema], [strictInvalid, strictSchema], text);
    assert.deepEqual([loose.invalid, loose.schema], [looseInvalid, looseSchema], text);
  }
});

test('risk level: missing, valid, invalid and broken frontmatter', t => {
  const repo = gitRepo(t);
  assert.deepEqual(readRiskLevel(repo.dir, DIR), { exists: false, error: null, declared: '', level: 'unknown' });
  writeIn(repo.dir, `${DIR}/quality.md`, '---\nrisk_level: high\n---\n');
  assert.deepEqual(readRiskLevel(repo.dir, DIR), { exists: true, error: null, declared: 'high', level: 'high' });
  writeIn(repo.dir, `${DIR}/quality.md`, '---\nrisk_level: extreme\n---\n');
  assert.deepEqual(readRiskLevel(repo.dir, DIR), { exists: true, error: null, declared: 'extreme', level: 'unknown' });
  writeIn(repo.dir, `${DIR}/quality.md`, '---\nrisk_level: high\n');
  const broken = readRiskLevel(repo.dir, DIR);
  assert.equal(broken.level, 'unknown');
  assert.ok(broken.error);
});

test('archive folder: date and id are split; a bare date keeps the date without an id', () => {
  assert.deepEqual(parseArchiveFolder('2026-10-07-add-auth'), { date: '2026-10-07', id: 'add-auth' });
  assert.deepEqual(parseArchiveFolder('2026-10-07'), { date: '2026-10-07', id: null });
  assert.deepEqual(parseArchiveFolder('2026-13-99-x'), { date: '2026-13-99', id: 'x' });
  assert.deepEqual(parseArchiveFolder('add-auth'), { date: null, id: null });
  assert.deepEqual(parseArchiveFolder('2026-10-07add'), { date: null, id: null });
});

test('change listing: directories only, byte order, archive excluded from active', t => {
  const repo = gitRepo(t);
  assert.deepEqual(listActiveChanges(repo.dir), []);
  assert.deepEqual(listArchivedChanges(repo.dir), []);
  for (const dir of ['b-change', 'Z-change', 'a-change', 'archive/2026-02-01-x', 'archive/2026-01-01-y', 'archive/broken']) {
    writeIn(repo.dir, `openspec/changes/${dir}/proposal.md`, '# p\n');
  }
  writeIn(repo.dir, 'openspec/changes/README.md', 'not a change\n');
  assert.deepEqual(listActiveChanges(repo.dir).map(change => change.id), ['Z-change', 'a-change', 'b-change']);
  assert.deepEqual(listActiveChanges(repo.dir)[0], { id: 'Z-change', dir: 'openspec/changes/Z-change' });
  assert.deepEqual(listArchivedChanges(repo.dir), [
    { folder: '2026-01-01-y', date: '2026-01-01', id: 'y', dir: 'openspec/changes/archive/2026-01-01-y' },
    { folder: '2026-02-01-x', date: '2026-02-01', id: 'x', dir: 'openspec/changes/archive/2026-02-01-x' },
    { folder: 'broken', date: null, id: null, dir: 'openspec/changes/archive/broken' },
  ]);
});

function recordingIo() {
  const calls = [];
  return {
    calls,
    log: message => calls.push(['log', message]),
    error: message => calls.push(['error', message]),
    write: text => calls.push(['write', text]),
    exit: code => {
      calls.push(['exit', code]);
      return code;
    },
  };
}

test('entry: resolveRepo returns the top level, falls back to cwd, or exits 2', t => {
  const repo = gitRepo(t);
  writeIn(repo.dir, 'sub/file.txt', 'x\n');
  assert.equal(realpathSync(resolveRepo(join(repo.dir, 'sub'))), realpathSync(repo.dir));
  const outside = tempDir('tk-nogit-');
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = join(outside, '..');
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
  });
  assert.equal(resolveRepo(outside), outside);
  const io = recordingIo();
  assert.equal(resolveRepo(outside, { onFailure: 'exit2', io }), 2);
  assert.deepEqual(io.calls, [['error', 'git リポジトリではありません'], ['exit', 2]]);
});

test('entry: appendGithubOutput writes key=value lines in order and skips without GITHUB_OUTPUT', t => {
  const dir = tempDir('tk-out-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'output');
  assert.equal(appendGithubOutput({}, { risk_level: 'high' }), false);
  assert.equal(appendGithubOutput({ GITHUB_OUTPUT: path }, { risk_level: 'high', e2e_ran: false, run_dir: '' }), true);
  appendGithubOutput({ GITHUB_OUTPUT: path }, { summary_file: 'a.md' });
  assert.equal(readFileSync(path, 'utf8'), 'risk_level=high\ne2e_ran=false\nrun_dir=\nsummary_file=a.md\n');
});

test('entry: emit prints trimmed stderr, raw stdout and exits with the result code', () => {
  const io = recordingIo();
  assert.equal(emit(io, { stdout: 'out\n', stderr: 'err\n\n', exitCode: 3 }), 3);
  assert.deepEqual(io.calls, [['error', 'err'], ['write', 'out\n'], ['exit', 3]]);
  const quiet = recordingIo();
  emit(quiet, { stdout: '', stderr: '', exitCode: 0 });
  assert.deepEqual(quiet.calls, [['exit', 0]]);
});

// Entry points run in-process through main(argv, env, io) and return their exit code instead of exiting.
function entryIo(cwd) {
  const calls = [];
  return {
    calls,
    cwd,
    log: message => calls.push(['log', String(message)]),
    error: message => calls.push(['error', String(message)]),
    write: text => calls.push(['write', text]),
  };
}

test('entry: testkit-gate main returns the exit code and prints through io', t => {
  const repo = gitRepo(t);
  writeIn(repo.dir, 'openspec/changes/demo/.openspec.yaml', 'schema: quality-driven-e2e\n');
  repo.commit('demo');
  const help = entryIo(repo.dir);
  assert.equal(gateMain(['--help'], {}, help), 0);
  assert.match(help.calls[0][1], /^usage: testkit-gate\.mjs doctor/);
  const select = entryIo(repo.dir);
  assert.equal(gateMain(['select', 'demo', '--json'], {}, select), 0);
  assert.deepEqual(JSON.parse(select.calls[0][1]).changes.map(change => change.id), ['demo']);
  const bad = entryIo(repo.dir);
  assert.equal(gateMain(['check', '--phase', 'later'], {}, bad), 2);
  assert.deepEqual(bad.calls, [['error', '--phase は plan または final です']]);
});

test('entry: check-test-plan main returns 2 outside a repository and 0 without change diffs', t => {
  const repo = gitRepo(t);
  const clean = entryIo(repo.dir);
  assert.equal(checkTestPlanMain(['HEAD'], {}, clean), 0);
  assert.deepEqual(clean.calls, [['log', 'openspec change の差分なし。skip']]);
  const outside = tempDir('tk-nogit-');
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = join(outside, '..');
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
  });
  const io = entryIo(outside);
  assert.equal(checkTestPlanMain([], {}, io), 2);
  assert.deepEqual(io.calls.filter(([kind]) => kind === 'error').map(([, message]) => message), ['git リポジトリではありません']);
});

test('entry: e2e-report main reports an unknown change and a passing run', t => {
  const repo = gitRepo(t);
  const missing = entryIo(repo.dir);
  assert.equal(reportMain(['nope'], {}, missing), 2);
  assert.deepEqual(missing.calls, [['error', 'change が存在しません: nope']]);
  const fixtures = new URL('./fixtures/publishing/', import.meta.url);
  writeIn(repo.dir, 'openspec/changes/demo/.openspec.yaml', 'schema: quality-driven-e2e\n');
  writeIn(repo.dir, 'openspec/changes/demo/test-plan.md', readFileSync(new URL('single-project-plan.md', fixtures), 'utf8'));
  const results = JSON.parse(readFileSync(new URL('single-project-results.json', fixtures), 'utf8').replaceAll('__ROOT__', repo.dir).replaceAll('__OUTSIDE__', repo.dir));
  results.stats.startTime = new Date().toISOString();
  const resultsPath = join(repo.dir, 'results.json');
  writeFileSync(resultsPath, JSON.stringify(results));
  const io = entryIo(repo.dir);
  assert.equal(reportMain(['demo', resultsPath], {}, io), 0);
  assert.match(io.calls.find(([kind]) => kind === 'write')[1], /合計 1 件: pass 1 \/ fail 0/);
});
