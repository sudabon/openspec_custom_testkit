#!/usr/bin/env node
// Times `testkit-gate.mjs coverage` on a synthetic repository with many archived changes.
// usage: node scripts/bench-coverage.mjs [changes=1000] [runs=3]
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = fileURLToPath(new URL('../payload/scripts/testkit-gate.mjs', import.meta.url));
const changes = Number(process.argv[2] ?? 1000);
const runs = Number(process.argv[3] ?? 3);
const CAPABILITIES = 50;
const SCENARIOS = 3;

function write(root, rel, text) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}

const scenario = name => `#### Scenario: ${name}\n- **WHEN** a\n- **THEN** b\n`;
const dir = mkdtempSync(join(tmpdir(), 'tk-bench-'));
try {
  const main = new Map();
  const specs = [];
  for (let i = 0; i < changes; i++) {
    const id = `change-${String(i).padStart(4, '0')}`;
    const capability = `area-${i % 10}/cap-${i % CAPABILITIES}`;
    const requirement = `Requirement ${i}`;
    const names = Array.from({ length: SCENARIOS }, (_, n) => `Scenario ${i}-${n}`);
    const folder = `openspec/changes/archive/2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}-${id}`;
    write(dir, `${folder}/.openspec.yaml`, 'schema: quality-driven-e2e\n');
    write(dir, `${folder}/specs/${capability}/spec.md`, `# Spec\n\n## ADDED Requirements\n\n### Requirement: ${requirement}\nbody\n\n${names.map(scenario).join('\n')}`);
    const rows = names.map((name, n) => `| TP-${String(n + 1).padStart(3, '0')} | ${requirement} | ${name} | R1 | O1 | f | i | e |`);
    write(dir, `${folder}/test-plan.md`, `---\ne2e: required\n---\n## E2E観点一覧\n| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
    const list = main.get(capability) ?? [];
    list.push(`### Requirement: ${requirement}\nbody\n\n${names.map(scenario).join('\n')}`);
    main.set(capability, list);
    names.forEach((name, n) => specs.push({ title: name, tags: [id, `TP-${String(n + 1).padStart(3, '0')}`], tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }));
  }
  for (const [capability, requirements] of main) write(dir, `openspec/specs/${capability}/spec.md`, `# Spec\n\n## Requirements\n\n${requirements.join('\n')}`);
  write(dir, 'results.json', JSON.stringify({ stats: { startTime: new Date().toISOString() }, suites: [{ title: 'all', specs }] }));

  const measure = args => {
    const times = [];
    let status;
    for (let i = 0; i < runs; i++) {
      const started = process.hrtime.bigint();
      const out = spawnSync(process.execPath, [GATE, 'coverage', ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      times.push(Number(process.hrtime.bigint() - started) / 1e6);
      status = out.status;
      if (out.status !== 0) throw new Error(`coverage exit ${out.status}: ${out.stderr}`);
    }
    return { status, min: Math.min(...times), max: Math.max(...times) };
  };
  const plain = measure([]);
  const joined = measure(['--results', 'results.json']);
  console.log(`node ${process.version} / changes ${changes} / scenarios ${changes * SCENARIOS} / capabilities ${CAPABILITIES} / runs ${runs}`);
  console.log(`coverage: min ${plain.min.toFixed(0)} ms / max ${plain.max.toFixed(0)} ms (exit ${plain.status})`);
  console.log(`coverage --results (${specs.length} tests): min ${joined.min.toFixed(0)} ms / max ${joined.max.toFixed(0)} ms (exit ${joined.status})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
