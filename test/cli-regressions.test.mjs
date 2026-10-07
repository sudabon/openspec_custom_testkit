import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { USAGE } from '../lib/cli.mjs';
import { tempDir, writeIn } from './support.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function temporary(t) {
  const dir = tempDir('tk-cli-regression-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(args, cwd, env = {}) {
  const childEnv = { ...process.env, ...env };
  // A nested node --test process must not inherit the parent's test-worker marker.
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd, env: childEnv, encoding: 'utf8', timeout: 30000 });
}

function checkExit(result, code) {
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, code, `${result.stdout}\n${result.stderr}`);
}

const entries = [
  { path: 'payload/scripts/testkit-gate.mjs', args: ['bogus'], code: 2 },
  { path: 'payload/scripts/check-test-plan.mjs', args: ['bogus'], code: 2 },
  { path: 'payload/scripts/e2e-report.mjs', args: [], code: 2 },
  { path: 'payload/scripts/ci-job.mjs', args: [], code: 2 },
  { path: 'scripts/build-manifest.mjs', args: ['--check'], code: 0 },
];

for (const entry of entries) {
  test(`${entry.path} runs through file and directory symlinks`, t => {
    const dir = temporary(t);
    const fileLink = join(dir, 'entry.mjs');
    symlinkSync(join(root, entry.path), fileLink);
    symlinkSync(root, join(dir, 'workspace'));
    const env = { GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' };
    const direct = run([join(root, entry.path), ...entry.args], dir, env);
    checkExit(direct, entry.code);
    assert.notEqual(direct.stdout + direct.stderr, '', 'direct execution must do work');
    for (const path of [fileLink, join(dir, 'workspace', entry.path)]) {
      const linked = run([path, ...entry.args], dir, env);
      checkExit(linked, entry.code);
      assert.equal(linked.stdout, direct.stdout);
      assert.equal(linked.stderr, direct.stderr);
    }
  });
}

test('the shell plan wrapper propagates failure through a symlinked workspace', t => {
  const dir = temporary(t);
  symlinkSync(root, join(dir, 'workspace'));
  const result = spawnSync('bash', [join(dir, 'workspace/payload/scripts/check-test-plan.sh'), 'bogus'], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
  });
  checkExit(result, 2);
  assert.match(result.stderr, /git リポジトリではありません/);
});

test('importing CLI modules does not run their entrypoints even without argv[1]', t => {
  const dir = temporary(t);
  const imports = entries.map(entry => `await import(${JSON.stringify(pathToFileURL(join(root, entry.path)).href)});`).join('\n');
  for (const args of [[], [join(dir, 'not-an-entrypoint.mjs')]]) {
    const result = run(['--input-type=module', '-e', `${imports}\nconsole.log('imports only');`, ...args], dir);
    checkExit(result, 0);
    assert.equal(result.stdout, 'imports only\n');
    assert.equal(result.stderr, '');
    assert.deepEqual(readdirSync(dir), []);
  }
});

test('install --bogus exits 2 and prints the full usage', t => {
  const dir = temporary(t);
  const result = run([join(root, 'install.mjs'), '--bogus'], dir);
  checkExit(result, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /エラー:.*--bogus/);
  assert.ok(result.stderr.endsWith(`${USAGE}\n`), result.stderr);
  assert.deepEqual(readdirSync(dir), []);
});

test('declining the non-git prompt in a real TTY exits without writing files', { timeout: 30000 }, async t => {
  const dir = temporary(t);
  writeIn(dir, 'keep.txt', 'user data\n');
  const command = [process.execPath, join(root, 'install.mjs'), '--target', dir];
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  // Both CI platforms provide script(1); its arguments differ between BSD and util-linux.
  const args = process.platform === 'darwin'
    ? ['-q', '/dev/null', ...command]
    : ['-q', '-e', '-c', command.map(quote).join(' '), '/dev/null'];
  // BSD script accepts a Unix pipe, but not the socket Node uses for stdio: 'pipe'.
  const child = spawn('bash', ['-c', 'cat | script "$@"', 'tty-installer', ...args], {
    cwd: dir, env: { ...process.env, TERM: 'dumb' }, timeout: 20000,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  let answered = false;
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    if (!answered && output.includes('[y/N]')) {
      answered = true;
      child.stdin.end('n\n');
    }
  });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.signal, null, output);
  assert.equal(result.code, 0, output);
  assert.equal(answered, true, output);
  assert.match(output, /中止しました。/);
  assert.deepEqual(readdirSync(dir), ['keep.txt']);
  assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'user data\n');
});

test('manifest --check classifies drift, exits 1, and never rewrites the manifest', async t => {
  const dir = temporary(t);
  for (const path of ['payload', 'upstream', 'scripts']) cpSync(join(root, path), join(dir, path), { recursive: true });
  const path = 'upstream/manifest.json';
  const original = readFileSync(join(dir, path), 'utf8');
  const expected = JSON.parse(original);
  const changed = mutate => {
    const manifest = structuredClone(expected);
    mutate(manifest);
    return `${JSON.stringify(manifest, null, 2)}\n`;
  };
  const cases = [
    ['unparseable', '{', '(unparseable)'],
    ['formatting', JSON.stringify(expected), '(formatting)'],
    ['top-level', changed(m => { m.openspecFork = 'changed'; }), '(top-level)'],
    ['source', changed(m => { m.sources[0].sha = 'changed'; }), 'qe'],
    ['removed source', changed(m => { m.sources.pop(); }), 'e2e'],
    ['added source', changed(m => { m.sources.push({ id: 'extra' }); }), 'extra'],
    ['missing sources', changed(m => { delete m.sources; }), 'qe, e2e'],
    ['non-array sources', changed(m => { m.sources = {}; }), 'qe, e2e'],
    ['combined', changed(m => { m.extra = true; m.sources[1].sha = 'changed'; }), '(top-level), e2e'],
  ];
  const script = join(dir, 'scripts/build-manifest.mjs');
  checkExit(run([script, '--check'], dir), 0);
  for (const [name, text, sources] of cases) {
    await t.test(name, () => {
      writeIn(dir, path, text);
      const result = run([script, '--check'], dir);
      checkExit(result, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `upstream/manifest.json is out of date (sources: ${sources})\nrun \`npm run manifest\` to regenerate it and commit the result\n`);
      assert.equal(readFileSync(join(dir, path), 'utf8'), text);
    });
  }
});

test('missing output baseline fails unless regeneration is explicitly enabled', t => {
  const dir = temporary(t);
  for (const path of ['package.json', 'lib', 'payload', 'upstream', 'test']) {
    cpSync(join(root, path), join(dir, path), { recursive: true });
  }
  const path = join(dir, 'test/fixtures/output-baseline.json');
  const original = readFileSync(path, 'utf8');
  rmSync(path);
  const args = ['--test', 'test/output-baseline.test.mjs'];
  const missing = run(args, dir, { UPDATE_OUTPUT_BASELINE: '' });
  checkExit(missing, 1);
  assert.match(missing.stdout + missing.stderr, /ENOENT.*output-baseline.json/);
  assert.equal(existsSync(path), false);
  const regenerated = run(args, dir, { UPDATE_OUTPUT_BASELINE: '1' });
  checkExit(regenerated, 0);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), JSON.parse(original));
  checkExit(run(args, dir, { UPDATE_OUTPUT_BASELINE: '' }), 0);
});
