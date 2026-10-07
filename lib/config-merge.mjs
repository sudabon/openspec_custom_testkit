import { parseYamlText } from '../payload/scripts/lib/frontmatter.mjs';

export const SCHEMA_NAME = 'quality-driven-e2e';
export const MARKER_START = '# --- openspec-custom-testkit ---';
export const MARKER_END = '# --- /openspec-custom-testkit ---';
const OLD_START = '# --- openspec-e2e-kit ---';
const OLD_END = '# --- /openspec-e2e-kit ---';
export const CONTEXT_LINES = [
  'E2Eテスト: Playwright。実装規約は .claude/skills/e2e-conventions/SKILL.md に従う。',
  'テストには必ず @<change-id> と @TP-NNN タグを付ける。',
  '品質ゲート: 統合スキーマでは全Riskで人間の承認、Oracle seal、独立反証が必須。基準は openspec/quality-policy.md。',
];
const OLD_CONTEXT_LINES = [
  'E2Eテスト: Playwright。実装規約は .claude/skills/e2e-conventions/SKILL.md に従う。',
  'テストには必ず @<change-id> と @TP-NNN タグを付ける。',
];
const KIT_LINES = new Set([...CONTEXT_LINES, ...OLD_CONTEXT_LINES]);
const REPLACEABLE = new Set(['spec-driven']);

function languageLines(lang) {
  return [
    `Language: ${lang}`,
    `All artifacts must be written in ${lang}.`,
    'Keep OpenSpec structural headings and SHALL/MUST keywords in English.',
  ];
}

function markerBlock(indent) {
  return [`${indent}${MARKER_START}`, ...CONTEXT_LINES.map(line => `${indent}${line}`), `${indent}${MARKER_END}`];
}

function findTopLevelKey(lines, key) {
  const re = new RegExp(`^${key}:(\\s*)(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(re);
    if (match) return { index: i, value: match[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() };
  }
  return null;
}

function findMarker(lines) {
  for (const [start, end] of [[MARKER_START, MARKER_END], [OLD_START, OLD_END]]) {
    const startIndex = lines.findIndex(line => line.trim() === start);
    if (startIndex === -1) continue;
    const endIndex = lines.findIndex((line, index) => index > startIndex && line.trim() === end);
    if (endIndex === -1) continue;
    return { start: startIndex, end: endIndex, indent: lines[startIndex].match(/^\s*/)[0], legacy: start === OLD_START };
  }
  return null;
}

export function configSafety(text) {
  if (text == null) return { ok: true };
  const parsed = parseYamlText(text);
  if (parsed.errors.length) return { ok: false, reason: parsed.errors.join('; ') };
  if (parsed.alias) return { ok: false, reason: 'YAML alias を含むため自動編集しません' };
  if (parsed.tagged) return { ok: false, reason: '特殊 tag を含むため自動編集しません' };
  return { ok: true, data: parsed.data, doc: parsed.doc };
}

function unsupportedConfigShape(doc, lines) {
  const root = doc?.contents;
  if (!root) return null;
  if (root.constructor?.name !== 'YAMLMap' || root.flow === true) return '行単位で編集できない YAML 表現です';
  const schema = (root.items ?? []).find(pair => pair.key?.value === 'schema');
  if (!schema) return null;
  if (schema.key?.type !== 'PLAIN' || !findTopLevelKey(lines, 'schema')) return 'schema キーを安全に編集できない YAML 表現です';
  return null;
}

function blocked(reason) {
  return {
    text: null,
    notes: [],
    warnings: [`openspec config を安全にマージできないため元ファイルを保持します。手動で schema と context を確認してください: ${reason}`],
    blocked: true,
  };
}

export function mergeConfig(original, language = null) {
  if (original == null) {
    const lines = [`schema: ${SCHEMA_NAME}`, '', 'context: |', ...(language ? languageLines(language).map(line => `  ${line}`) : []), ...markerBlock('  '), ''];
    return { text: lines.join('\n'), notes: [`openspec/config.yaml を新規作成 (schema: ${SCHEMA_NAME}${language ? `, language: ${language}` : ''})`], warnings: [], blocked: false };
  }
  const safety = configSafety(original);
  if (!safety.ok) return blocked(safety.reason);
  const shape = unsupportedConfigShape(safety.doc, original.split('\n'));
  if (shape) return blocked(shape);

  const schema = mergeSchema(original.split('\n'));
  const context = mergeContext(schema.lines);
  const notes = [...schema.notes, ...context.notes];
  const warnings = [...schema.warnings, ...context.warnings];
  if (language && !/^\s+Language:/m.test(original)) {
    warnings.push(`openspec/config.yaml が既にあるため --language は反映しません(openspec init と同じ扱い)。\n  context に以下を手動で追加してください:\n    ${languageLines(language).join('\n    ')}`);
  }
  const text = context.lines.join('\n');
  if (text !== original) {
    const mergedSafety = configSafety(text);
    if (!mergedSafety.ok) return blocked(mergedSafety.reason);
  }
  return { text: text === original ? null : text, notes, warnings, blocked: false };
}

// Sets the default schema unless the project chose one of its own.
function mergeSchema(input) {
  const lines = [...input];
  const schemaKey = findTopLevelKey(lines, 'schema');
  if (!schemaKey) {
    lines.unshift(`schema: ${SCHEMA_NAME}`);
    return { lines, notes: [`schema: ${SCHEMA_NAME} を追加`], warnings: [] };
  }
  if (REPLACEABLE.has(schemaKey.value)) {
    lines[schemaKey.index] = `schema: ${SCHEMA_NAME}`;
    return { lines, notes: [`schema: ${schemaKey.value} → ${SCHEMA_NAME}(進行中の change は各自の .openspec.yaml のスキーマのまま)`], warnings: [] };
  }
  if (schemaKey.value !== SCHEMA_NAME) {
    return {
      lines,
      notes: [],
      warnings: [
        `openspec/config.yaml の schema が '${schemaKey.value}' です。'${SCHEMA_NAME}' へは自動変更しません。\n` +
        `  既定にする場合は手動で変更してください。change 単位なら: openspec new change <name> --schema ${SCHEMA_NAME}`,
      ],
    };
  }
  return { lines, notes: [], warnings: [] };
}

// Puts the kit's marker block into the context literal block: migrates the old top-level layout, refreshes an
// existing block, or appends a new one.
function mergeContext(lines) {
  const marker = findMarker(lines);
  if (marker && marker.indent === '' && lines.slice(marker.start + 1, marker.end).some(line => CONTEXT_KEY.test(line))) {
    return migrateLegacyMarker(lines, marker);
  }
  if (marker) return refreshMarker(lines, marker);
  return appendToContext(lines);
}

const CONTEXT_KEY = /^context:\s*\|[-+]?\s*$/;

// An old block wrapped the whole `context:` key at the top level; it moves inside the literal block.
function migrateLegacyMarker(lines, marker) {
  const inner = lines.slice(marker.start + 1, marker.end);
  const ctxIdx = inner.findIndex(line => CONTEXT_KEY.test(line));
  const before = inner.slice(0, ctxIdx);
  const body = inner.slice(ctxIdx + 1);
  const indent = body.find(line => line.trim() !== '')?.match(/^\s*/)[0] || '  ';
  const foreign = body.filter(line => line.trim() !== '' && !KIT_LINES.has(line.trim()));
  return {
    lines: [...lines.slice(0, marker.start), ...before, inner[ctxIdx], ...foreign, ...markerBlock(indent), ...lines.slice(marker.end + 1)],
    notes: [`旧形式のマーカーブロックを context の内側へ移行${foreign.length ? `(kit 以外の ${foreign.length} 行を保持)` : ''}`],
    warnings: [],
  };
}

// Rewrites the block with the current kit lines; lines the user added inside it move just above it.
function refreshMarker(lines, marker) {
  const desired = CONTEXT_LINES.map(line => `${marker.indent}${line}`);
  const current = lines.slice(marker.start + 1, marker.end);
  if (current.join('\n') === desired.join('\n') && !marker.legacy) return { lines, notes: [], warnings: [] };
  const foreign = current.filter(line => line.trim() !== '' && !KIT_LINES.has(line.trim()));
  return {
    lines: [
      ...lines.slice(0, marker.start),
      ...foreign,
      `${marker.indent}${MARKER_START}`,
      ...desired,
      `${marker.indent}${MARKER_END}`,
      ...lines.slice(marker.end + 1),
    ],
    notes: [`マーカーブロックを更新${foreign.length ? `(kit 以外の ${foreign.length} 行をマーカーの外へ退避)` : ''}`],
    warnings: [],
  };
}

function appendToContext(input) {
  const lines = [...input];
  const contextKey = findTopLevelKey(lines, 'context');
  if (!contextKey) {
    while (lines.length && lines.at(-1).trim() === '') lines.pop();
    lines.push('', 'context: |', ...markerBlock('  '), '');
    return { lines, notes: ['context ブロック(マーカー付き)を追加'], warnings: [] };
  }
  if (!/^\|[-+]?$/.test(contextKey.value)) {
    return { lines, notes: [], warnings: [`literal block ではない context: があるため自動追記しません。次を手動で追加してください:\n    ${CONTEXT_LINES.join('\n    ')}`] };
  }
  let end = contextKey.index + 1;
  let indent = null;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') { end += 1; continue; }
    const ind = line.match(/^\s*/)[0];
    if (ind.length === 0) break;
    indent ??= ind;
    end += 1;
  }
  while (end > contextKey.index + 1 && lines[end - 1].trim() === '') end -= 1;
  return {
    lines: [...lines.slice(0, end), ...markerBlock(indent ?? '  '), ...lines.slice(end)],
    notes: ['既存の context ブロック末尾へマーカー付きで追記'],
    warnings: [],
  };
}
