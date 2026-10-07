#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORK_BASE, LEGACY_STAMPS, isCritical } from '../payload/scripts/lib/critical.mjs';
import { sha256 } from '../payload/scripts/lib/hash.mjs';

const SOURCES = {
  qe: {
    url: 'https://github.com/sudabon/openspec_quality_kit',
    sha: 'e537d10da53112fce684f31d1602c1e061ab87a2',
  },
  e2e: {
    url: 'https://github.com/sudabon/openspec_e2e_test',
    sha: '53e354fa366f02cf412e9ce93419463a37e8255c',
  },
};

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.name === '.DS_Store') continue;
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else if (entry.isFile()) out.push(relative(base, abs).split('\\').join('/'));
  }
  return out.sort();
}

function source(root, id, meta) {
  const base = join(root, 'upstream/baselines', id);
  const payload = join(base, 'payload');
  const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
  const files = walk(payload).map(path => {
    const bytes = readFileSync(join(payload, path));
    const text = bytes.includes(0) ? '' : bytes.toString('utf8');
    return {
      path,
      sha256: sha256(bytes),
      transformE2eRoot: text.includes('tests/e2e'),
      critical: isCritical(path),
      protected: path === 'openspec/quality-policy.md',
    };
  });
  return {
    id,
    url: meta.url,
    sha: meta.sha,
    license: 'MIT',
    copyright: 'Copyright (c) 2026 sudabon',
    packageVersion: pkg.version,
    stampFile: LEGACY_STAMPS[id],
    files,
  };
}

export function buildManifest(root) {
  return {
    openspecFork: FORK_BASE,
    sources: Object.entries(SOURCES).map(([id, meta]) => source(root, id, meta)),
  };
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// Returns the source ids whose generated entry differs from the committed manifest.
// `openspecFork` and anything outside `sources` are reported as "(top-level)".
function changedSources(expected, actualText) {
  let actual;
  try {
    actual = JSON.parse(actualText);
  } catch {
    return ['(unparseable)'];
  }
  const changed = [];
  const { sources: expectedSources, ...expectedTop } = expected;
  const { sources: actualSources, ...actualTop } = actual ?? {};
  if (JSON.stringify(expectedTop) !== JSON.stringify(actualTop)) changed.push('(top-level)');
  const ids = new Set([...expectedSources, ...(Array.isArray(actualSources) ? actualSources : [])].map(item => item?.id));
  for (const id of ids) {
    const want = expectedSources.find(item => item.id === id);
    const have = Array.isArray(actualSources) ? actualSources.find(item => item?.id === id) : undefined;
    if (JSON.stringify(want) !== JSON.stringify(have)) changed.push(String(id));
  }
  return changed.length ? changed : ['(formatting)'];
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const target = join(root, 'upstream/manifest.json');
  const manifest = buildManifest(root);
  const text = serializeManifest(manifest);
  if (argv.includes('--check')) {
    const current = readFileSync(target, 'utf8');
    if (current === text) {
      console.log('upstream/manifest.json is up to date');
      return 0;
    }
    console.error(`upstream/manifest.json is out of date (sources: ${changedSources(manifest, current).join(', ')})`);
    console.error('run `npm run manifest` to regenerate it and commit the result');
    return 1;
  }
  writeFileSync(target, text);
  console.log(`wrote upstream/manifest.json (${manifest.sources.reduce((n, item) => n + item.files.length, 0)} files)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
