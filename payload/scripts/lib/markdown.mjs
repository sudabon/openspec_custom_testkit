function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function section(markdown, heading) {
  const re = new RegExp(`^${escapeRegExp(heading)}\\s*$`, 'm');
  const match = re.exec(markdown);
  if (!match) return null;
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function isSeparator(line) {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell));
}

// Preserve line boundaries so fenced examples cannot introduce sections or table rows.
function withoutFencedCode(text) {
  let fence = null;
  const lines = String(text).split(/\r?\n/).map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return '';
    }
    // Backticks in an info string do not open a fenced block.
    if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = marker[1];
      return '';
    }
    return line;
  });
  return { text: lines.join('\n'), unclosedFence: fence !== null };
}

// Fenced code and indented prose cannot introduce declarations or TP references.
// Plans retain indented pipe tables for compatibility with existing test plans.
export function markdownProse(text, { tables = false } = {}) {
  const prose = withoutFencedCode(text);
  const lines = prose.text.split('\n').map(line => {
    if (/^(?: {4}|\t)/.test(line) && !(tables && /^\s*\|/.test(line))) return '';
    return line.replace(/^ {0,3}(?=#)/, '');
  });
  return { text: lines.join('\n'), unclosedFence: prose.unclosedFence };
}

// Any heading that starts with 対象外 declares delegated rows, except explanatory notes.
export function delegatedHeading(heading) {
  return /^#{1,6}[^\S\r\n]*(?:E2E[^\S\r\n]*)?対象外/.test(heading)
    && !/^#{1,6}[^\S\r\n]*(?:E2E[^\S\r\n]*)?対象外[^\S\r\n]*の?(?:メモ|補足|注|備考|Notes?)/i.test(heading);
}

function planSectionHeading(heading) {
  return /^#{1,2}(?:[^\S\r\n]|$)/.test(heading)
    || /^#{1,6}[^\S\r\n]*E2E観点一覧/.test(heading)
    || delegatedHeading(heading);
}

// Sections of plan prose (from markdownProse). Ordinary subheadings stay inside
// their parent section. Every heading that names a plan section, at any level
// or spacing, starts a new one so that tables cannot leak into another section.
export function planSections(prose) {
  const headings = [...prose.matchAll(/^ {0,3}#{1,6}[^\S\r\n]*[^\r\n]+/gm)]
    .filter(match => planSectionHeading(match[0].trim()));
  return headings.map((match, index) => ({
    heading: match[0].trim(),
    body: prose.slice(match.index + match[0].length, headings[index + 1]?.index ?? prose.length),
  }));
}

// Each run of pipe lines is one table. Only the line after the header is a
// delimiter row, so a later `| - | - |` stays a data row. `firstCells` keeps
// the first line's cells even for a one-line run; `firstLine` locates fragments.
export function planTables(body) {
  return [...String(body ?? '').matchAll(/^[ \t]*\|[^\n]*(?:\n[ \t]*\|[^\n]*)*/gm)]
    .map(match => {
      const lines = match[0].split('\n');
      return {
        ...parseTable(match[0], { strictSeparator: true }),
        separator: lines.length > 1 && isSeparator(lines[1]),
        firstCells: splitRow(lines[0]),
        firstLine: lines[0].trim(),
      };
    });
}

export function parseTable(text, { strictSeparator = false } = {}) {
  if (!text) return { headers: [], rows: [] };
  const lines = text.split('\n').filter(line => /^\s*\|/.test(line));
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitRow(lines[0]);
  const rows = [];
  for (const [index, line] of lines.slice(1).entries()) {
    if ((!strictSeparator || index === 0) && isSeparator(line)) continue;
    const cells = splitRow(line);
    if (cells.every(cell => cell === '' || cell === '...' || cell === '…')) continue;
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

export function hasBoundedToken(text, token) {
  const re = new RegExp(`(?:^|[^A-Za-z0-9._-])@?${escapeRegExp(token)}(?![A-Za-z0-9._-])`);
  return re.test(String(text));
}
