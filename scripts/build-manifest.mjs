#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCritical } from '../payload/scripts/lib/critical.mjs';
import { sha256 } from '../payload/scripts/lib/hash.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

function source(id, meta) {
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
    stampFile: meta.stampFile,
    files,
  };
}

const manifest = {
  openspecFork: '1.13.1',
  sources: [
    source('qe', {
      url: 'https://github.com/sudabon/openspec_quality_kit',
      sha: 'e537d10da53112fce684f31d1602c1e061ab87a2',
      stampFile: '.openspec-quality-kit.json',
    }),
    source('e2e', {
      url: 'https://github.com/sudabon/openspec_e2e_test',
      sha: '53e354fa366f02cf412e9ce93419463a37e8255c',
      stampFile: '.openspec-e2e-kit.json',
    }),
  ],
};
writeFileSync(join(root, 'upstream/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote upstream/manifest.json (${manifest.sources.reduce((n, item) => n + item.files.length, 0)} files)`);
