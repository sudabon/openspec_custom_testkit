import test from 'node:test';
import assert from 'node:assert/strict';
import { configSafety, mergeConfig } from '../lib/config-merge.mjs';

// Literal expected bytes keep user text, whitespace and marker placement part of the contract.
const marker = `  # --- openspec-custom-testkit ---
  E2Eテスト: Playwright。実装規約は .claude/skills/e2e-conventions/SKILL.md に従う。
  テストには必ず @<change-id> と @TP-NNN タグを付ける。
  品質ゲート: 統合スキーマでは全Riskで人間の承認、Oracle seal、独立反証が必須。基準は openspec/quality-policy.md。
  # --- /openspec-custom-testkit ---`;

function checkMerge(original, expected, language = null) {
  const once = mergeConfig(original, language);
  assert.equal(once.blocked, false);
  assert.equal(once.text, expected === original ? null : expected);
  assert.equal(configSafety(expected).ok, true);
  const twice = mergeConfig(once.text ?? original, language);
  assert.equal(twice.blocked, false);
  assert.equal(twice.text, null, 'a second merge must preserve every byte');
  return once;
}

for (const label of ['openspec-e2e-kit', 'openspec-custom-testkit']) {
  test(`config refreshes ${label} marker and moves foreign lines outside it`, () => {
    const original = `schema: spec-driven
context: |
  Project context
  # --- ${label} ---
  E2Eテスト: Playwright。実装規約は .claude/skills/e2e-conventions/SKILL.md に従う。
  User note

  テストには必ず @<change-id> と @TP-NNN タグを付ける。
  # --- /${label} ---
  Trailing note
rules:
  proposal: [keep]
`;
    const expected = `schema: quality-driven-e2e
context: |
  Project context
  User note
${marker}
  Trailing note
rules:
  proposal: [keep]
`;
    const merged = checkMerge(original, expected);
    assert.deepEqual(merged.warnings, []);
    assert.match(merged.notes.at(-1), /kit 以外の 1 行をマーカーの外へ退避/);
  });
}

test('legacy marker with all current kit lines still upgrades its delimiters', () => {
  const expected = `schema: quality-driven-e2e\ncontext: |\n${marker}\n`;
  checkMerge(expected.replaceAll('openspec-custom-testkit', 'openspec-e2e-kit'), expected);
});

for (const indicator of ['|', '|-', '|+']) {
  test(`config appends to context ${indicator} before trailing blanks and the next key`, () => {
    const original = `# Keep this comment
schema: spec-driven
context: ${indicator} # keep chomping
    User context

    Second paragraph

rules:
  proposal: [keep]
`;
    const expected = `# Keep this comment
schema: quality-driven-e2e
context: ${indicator} # keep chomping
    User context

    Second paragraph
${marker.split('\n').map(line => `  ${line}`).join('\n')}

rules:
  proposal: [keep]
`;
    assert.deepEqual(checkMerge(original, expected).warnings, []);
  });
}

test('config appends to an empty literal with the default indent', () => {
  checkMerge('schema: spec-driven\ncontext: |\n\nrules: {}\n',
    `schema: quality-driven-e2e\ncontext: |\n${marker}\n\nrules: {}\n`);
});

for (const context of ['context: "keep this"', 'context: >\n  Folded text', 'context:\n  - keep']) {
  test(`config warns and preserves a non-literal context: ${context}`, () => {
    const original = `schema: spec-driven\n${context}\nrules: {}\n`;
    const merged = checkMerge(original, original.replace('spec-driven', 'quality-driven-e2e'));
    assert.equal(merged.warnings.length, 1);
    assert.match(merged.warnings[0], /literal block ではない context: があるため自動追記しません/);
  });
}

test('config warns about --language for an existing config without changing user context', () => {
  const original = 'schema: spec-driven\ncontext: |\n  User context\n';
  const expected = `schema: quality-driven-e2e\ncontext: |\n  User context\n${marker}\n`;
  const merged = checkMerge(original, expected, 'Japanese');
  assert.deepEqual(merged.warnings, [
    'openspec/config.yaml が既にあるため --language は反映しません(openspec init と同じ扱い)。\n  context に以下を手動で追加してください:\n    Language: Japanese\n    All artifacts must be written in Japanese.\n    Keep OpenSpec structural headings and SHALL/MUST keywords in English.',
  ]);
  const withLanguage = original.replace('User context', 'Language: English');
  const kept = checkMerge(withLanguage, expected.replace('User context', 'Language: English'), 'Japanese');
  assert.deepEqual(kept.warnings, []);
});

test('config blocks an edit that would turn valid input into invalid YAML', () => {
  // The textual context lookup cannot see a quoted key; appending a second context would duplicate it.
  const original = 'schema: spec-driven\n"context": keep this\n';
  assert.equal(configSafety(original).ok, true);
  for (let attempt = 0; attempt < 2; attempt++) {
    const merged = mergeConfig(original);
    assert.equal(merged.blocked, true);
    assert.equal(merged.text, null);
    assert.equal(merged.text ?? original, original);
    assert.deepEqual(merged.notes, []);
    assert.match(merged.warnings[0], /元ファイルを保持します.*Map keys must be unique/s);
  }
});
