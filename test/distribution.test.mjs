import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('packed tarball installs payload, vendor, roles, and license', () => {
  const pack = mkdtempSync(join(tmpdir(), 'tk-pack-'));
  const listed = run('npm', ['pack', '--dry-run', '--json'], root);
  const dry = JSON.parse(listed.slice(listed.indexOf('[')))[0];
  const names = dry.files.map(file => file.path);
  for (const required of [
    'install.mjs',
    'payload/scripts/lib/vendor/yaml.mjs',
    'payload/scripts/lib/vendor/yaml.LICENSE',
    'payload/openspec/roles/oracle-writer.md',
    'payload/.claude/agents/qe-oracle-writer.md',
    'LICENSE',
    'upstream/manifest.json',
  ]) {
    assert.ok(names.includes(required), required);
  }
  assert.equal(names.some(name => name.startsWith('upstream/baselines/qe/.git')), false);
  const tarball = run('npm', ['pack', '--pack-destination', pack], root).trim().split('\n').at(-1);
  const target = mkdtempSync(join(tmpdir(), 'tk-from-tar-'));
  run('npm', ['install', '--ignore-scripts', join(pack, tarball)], target);
  const bin = join(target, 'node_modules/openspec-custom-testkit/install.mjs');
  assert.match(readFileSync(bin, 'utf8'), /from '\.\/lib\/cli\.mjs'/);
  assert.equal(JSON.parse(readFileSync(join(target, 'node_modules/openspec-custom-testkit/package.json'), 'utf8')).name, 'openspec-custom-testkit');
  const installed = mkdtempSync(join(tmpdir(), 'tk-installed-'));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', installed, 'init'], { stdio: 'ignore' });
  const output = execFileSync(process.execPath, [bin, 'install', '--target', installed], { encoding: 'utf8' });
  assert.match(output, /導入が完了しました/);
  assert.match(readFileSync(join(installed, 'scripts/lib/vendor/yaml.mjs'), 'utf8'), /yaml@2\.8\.1/);
  assert.equal((readFileSync(join(installed, 'scripts/qe-gate.sh'), 'utf8').includes('exec node')), true);
  const updated = execFileSync(process.execPath, [bin, 'install', '--target', installed], { encoding: 'utf8' });
  assert.match(updated, /既に最新です/);
  const doctor = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { doctor } from ${JSON.stringify(pathToFileURL(join(target, 'node_modules/openspec-custom-testkit/payload/scripts/lib/doctor.mjs')).href)};
    const result = doctor(${JSON.stringify(installed)});
    if (!result.ok) { console.error(result.failures.join('\\n')); process.exit(1); }
  `], { encoding: 'utf8' });
  assert.equal(doctor, '');
  rmSync(pack, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
  rmSync(installed, { recursive: true, force: true });
});

test('real OpenSpec CLI keeps the integrated graph and legacy schemas', () => {
  const target = mkdtempSync(join(tmpdir(), 'tk-cli-'));
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', target, 'init'], { stdio: 'ignore' });
  execFileSync(process.execPath, [join(root, 'install.mjs'), 'install', '--force', '--target', target], { stdio: 'ignore' });
  for (const schema of ['quality-driven-e2e', 'quality-driven', 'spec-driven-e2e']) {
    const output = run('openspec', ['schema', 'validate', schema], target);
    assert.match(output, new RegExp(schema));
  }
  run('openspec', ['new', 'change', 'demo'], target);
  assert.match(readFileSync(join(target, 'openspec/changes/demo/.openspec.yaml'), 'utf8'), /schema: quality-driven-e2e/);
  const change = join(target, 'openspec/changes/demo');
  writeFileSync(join(change, 'proposal.md'), '# Proposal\n\n## Why\nNeed a visible planning graph for this check.\n');
  mkdirSync(join(change, 'specs/demo'), { recursive: true });
  writeFileSync(join(change, 'specs/demo/spec.md'), '# Spec\n\n## Purpose\nShows one observable outcome for the integrated workflow.\n\n#### Scenario: Visible\n- **WHEN** asked\n- **THEN** visible\n');
  writeFileSync(join(change, 'quality.md'), '# Quality\n');
  writeFileSync(join(change, 'design.md'), '# Design\n');
  writeFileSync(join(change, 'test-plan.md'), '# Test Plan\n');
  writeFileSync(join(change, 'tasks.md'), '- [ ] 1.1 check\n');
  const apply = JSON.parse(run('openspec', ['instructions', 'apply', '--change', 'demo', '--json'], target));
  assert.equal(apply.state, 'ready');
  assert.deepEqual(Object.keys(apply.contextFiles).sort(), ['design', 'proposal', 'quality', 'specs', 'tasks', 'test-plan']);
  assert.equal(apply.contextFiles.evidence, undefined);

  mkdirSync(join(target, 'openspec/changes/docs-only'), { recursive: true });
  writeFileSync(join(target, 'openspec/changes/docs-only/.openspec.yaml'), 'schema: quality-driven-e2e\nskip_specs: true\n');
  const skipped = JSON.parse(run('openspec', ['status', '--change', 'docs-only', '--json'], target));
  const specs = skipped.artifacts.find(item => item.id === 'specs');
  const quality = skipped.artifacts.find(item => item.id === 'quality');
  assert.equal(specs.status, 'skipped');
  assert.equal(quality.status, 'ready');

  run('openspec', ['new', 'change', 'legacy-qe', '--schema', 'quality-driven'], target);
  const legacy = JSON.parse(run('openspec', ['status', '--change', 'legacy-qe', '--json'], target));
  assert.equal(legacy.artifacts.some(item => item.id === 'test-plan'), false);
  assert.equal(legacy.artifacts.some(item => item.id === 'quality'), true);
  run('openspec', ['new', 'change', 'legacy-e2e', '--schema', 'spec-driven-e2e'], target);
  const e2e = JSON.parse(run('openspec', ['status', '--change', 'legacy-e2e', '--json'], target));
  assert.equal(e2e.artifacts.some(item => item.id === 'quality'), false);
  assert.equal(e2e.artifacts.some(item => item.id === 'test-plan'), true);

  const before = readFileSync(join(target, 'openspec/schemas/quality-driven-e2e/schema.yaml'), 'utf8');
  run('openspec', ['update'], target);
  const after = readFileSync(join(target, 'openspec/schemas/quality-driven-e2e/schema.yaml'), 'utf8');
  assert.equal(after, before);
  assert.match(after, /quality-driven-e2e/);
  rmSync(target, { recursive: true, force: true });
});
