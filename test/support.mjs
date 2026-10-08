import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectChanges } from '../payload/scripts/lib/select.mjs';
import { parse as parseYaml, stringify as stringifyYaml } from '../payload/scripts/lib/vendor/yaml.mjs';

export const GATE = fileURLToPath(new URL('../payload/scripts/testkit-gate.mjs', import.meta.url));

export function writeIn(dir, rel, text) {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}

export function tempDir(prefix = 'tk-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function runGate(cwd, args, opts = {}) {
  return spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: 'utf8', ...opts });
}

// Defaults follow gates.test.mjs. Each test file passes its own differences as `over`:
//
// | file        | id / path    | e2e            | skipSpecs | tasksText              | fallback |
// |-------------|--------------|----------------|-----------|------------------------|----------|
// | gates       | demo         | required       | false     | null                   | false    |
// | contract    | demo         | not-applicable | true      | '- [x] 1.1 a ... 5.1 e' | false    |
// | viewpoints  | demo         | required       | true      | null                   | false    |
// | qa-review   | demo         | not-applicable | true      | null                   | false    |
// | e2e-lint    | demo         | required       | true      | '- [ ] 1.1 plan\n'     | false    |
// | registry    | add-checkout | required       | true      | '- [ ] 1.1 plan\n'     | (absent) |
//
// registry's own helper had no `fallback` key; it now gets `false`, which nothing reads differently from absent.
export function changeFixture(over = {}) {
  return {
    id: 'demo',
    path: 'openspec/changes/demo',
    schema: 'quality-driven-e2e',
    lifecycle: 'active',
    qe: true,
    e2e: 'required',
    scope: 'integrated',
    reason: '',
    errors: [],
    fallback: false,
    skipSpecs: false,
    pendingPlan: false,
    tasksText: null,
    ...over,
  };
}

// Pass the test context `t` to remove the repository after the test. cleanup() is safe to call again.
export function gitRepo(t) {
  const dir = tempDir('tk-');
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-C', dir, 'init'], { encoding: 'utf8' });
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init']);
  const repo = {
    dir,
    git,
    commit(message = 'change') {
      git(['add', '-A']);
      git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', message]);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  t?.after(() => repo.cleanup());
  return repo;
}

export function capture(main, args) {
  const lines = [];
  return main(args, {
    log: message => lines.push(String(message)),
    error: message => lines.push(String(message)),
    stdin: { isTTY: false },
  }).then(code => ({ code, text: lines.join('\n') }));
}

export const INTEGRATED_SCHEMA_DIR = fileURLToPath(new URL('../payload/openspec/schemas/quality-driven-e2e', import.meta.url));

// Copies the distributed integrated schema into `dir`, as install does.
export function writeIntegratedSchema(dir) {
  cpSync(INTEGRATED_SCHEMA_DIR, join(dir, 'openspec/schemas/quality-driven-e2e'), { recursive: true });
}

// A derived schema: the integrated schema plus a `mockup-plan` artifact, and its declaration. `mutate` edits the
// parsed schema.yaml before it is written; `compat` replaces the declaration text (null writes none).
export function writeDerivedSchema(dir, name = 'quality-driven-e2e-mockup', { mutate, compat } = {}) {
  writeIntegratedSchema(dir);
  const target = join(dir, 'openspec/schemas', name);
  cpSync(INTEGRATED_SCHEMA_DIR, target, { recursive: true });
  const schema = parseYaml(readFileSync(join(target, 'schema.yaml'), 'utf8'));
  schema.name = name;
  schema.artifacts.push({
    id: 'mockup-plan',
    generates: 'mockup-plan.md',
    description: 'Mockup comparison plan',
    template: 'mockup-plan.md',
    instruction: 'Write the mockup plan.\n',
    requires: ['design'],
  });
  mutate?.(schema);
  writeFileSync(join(target, 'schema.yaml'), stringifyYaml(schema));
  writeFileSync(join(target, 'templates/mockup-plan.md'), '# Mockup Plan\n');
  const declaration = compat === undefined ? JSON.stringify({ extends: 'quality-driven-e2e', compatVersion: 1 }) : compat;
  if (declaration != null) writeFileSync(join(target, 'testkit-compat.json'), declaration);
  return target;
}

export const DERIVED_FIXTURE = fileURLToPath(new URL('./fixtures/derived-schema/', import.meta.url));

// Places the derived-schema fixture change at openspec/changes/<id> (and its Oracle at tests/oracle/demo).
// `schema` overrides the schema in .openspec.yaml, for the same change under the integrated schema.
export function writeDerivedChange(dir, id = 'mockup-demo', { schema } = {}) {
  const target = join(dir, 'openspec/changes', id);
  cpSync(join(DERIVED_FIXTURE, 'change'), target, { recursive: true });
  cpSync(join(DERIVED_FIXTURE, 'oracle'), join(dir, 'tests/oracle/demo'), { recursive: true });
  if (schema) writeFileSync(join(target, '.openspec.yaml'), `schema: ${schema}\ncreated: 2026-10-01\n`);
  return target;
}

// Re-declares a fixture change under a valid derived schema and returns the record selectChanges gives it.
// Only tasksText is carried over from `change`, because fixtures pass it directly instead of writing tasks.md;
// every other field (schema, scope, qe, e2e) comes from select, so the result shows what select makes of the change.
export function asDerived(dir, change) {
  writeDerivedSchema(dir);
  writeIn(dir, `${change.path}/.openspec.yaml`, `schema: quality-driven-e2e-mockup\ncreated: 2026-10-01\n${change.skipSpecs ? 'skip_specs: true\n' : ''}`);
  const [selected] = selectChanges({ repo: dir, names: [change.id], env: {} }).changes;
  return { ...selected, tasksText: change.tasksText };
}
