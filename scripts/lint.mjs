#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlText } from '../payload/scripts/lib/frontmatter.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const skip = new Set(['node_modules', '.git', 'upstream', 'test-results', '.tmp', '.uv-cache', '.serena']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const abs = join(dir, name);
    const listed = statSync(abs);
    if (listed.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const files = walk(root);
let failed = 0;
for (const file of files) {
  const rel = relative(root, file);
  if (file.endsWith('.mjs')) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      failed += 1;
      console.error(`syntax ${rel}\n${err.stderr?.toString() ?? err.message}`);
    }
  } else if (file.endsWith('.sh')) {
    try {
      execFileSync('bash', ['-n', file], { stdio: 'pipe' });
    } catch (err) {
      failed += 1;
      console.error(`shell ${rel}\n${err.stderr?.toString() ?? err.message}`);
    }
  } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    const text = readFileSync(file, 'utf8');
    const parsed = parseYamlText(text);
    if (parsed.errors.length || parsed.alias || parsed.tagged) {
      failed += 1;
      console.error(`yaml ${rel}: ${parsed.errors.join('; ') || 'unsafe yaml'}`);
    }
  }
}

const workflow = readFileSync(join(root, '.github/workflows/openspec-custom-testkit-gate.yml'), 'utf8');
if (workflow.includes('pull_request.title') || workflow.includes('|| true')) {
  failed += 1;
  console.error('workflow が PR タイトルまたは || true を含んでいます');
}
if (failed) {
  console.error(`lint failed: ${failed}`);
  process.exit(1);
}
console.log(`lint ok (${files.length} files scanned)`);
