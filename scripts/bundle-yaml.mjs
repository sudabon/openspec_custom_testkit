#!/usr/bin/env node
// Regenerates payload/scripts/lib/vendor/yaml.mjs from the locked yaml package.
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const pkg = require('yaml/package.json');
if (pkg.version !== '2.8.1') {
  console.error(`yaml@${pkg.version} は lock 対象 2.8.1 と一致しません`);
  process.exit(1);
}

const outDir = join(root, 'payload/scripts/lib/vendor');
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, 'yaml.mjs');
const yamlRoot = dirname(require.resolve('yaml/package.json'));
await build({
  entryPoints: [join(yamlRoot, 'browser/dist/index.js')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile,
  banner: {
    js: [
      '// Bundled from yaml@2.8.1 (ISC) for Node.js 20+.',
      '// Regenerate with: npm run bundle:yaml',
      '// Upstream: https://github.com/eemeli/yaml',
    ].join('\n'),
  },
});
cpSync(join(dirname(require.resolve('yaml/package.json')), 'LICENSE'), join(outDir, 'yaml.LICENSE'));
const bundled = readFileSync(outfile, 'utf8');
if (!bundled.includes('yaml@2.8.1') || !readFileSync(join(outDir, 'yaml.LICENSE'), 'utf8').includes('ISC')) {
  console.error('vendor bundle に版または ISC 表示がありません');
  process.exit(1);
}
console.log(`bundled yaml@${pkg.version} -> payload/scripts/lib/vendor/yaml.mjs`);
