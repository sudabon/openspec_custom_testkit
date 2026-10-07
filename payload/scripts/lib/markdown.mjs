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
export function withoutFencedCode(text) {
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

export function planTables(body) {
  return [...String(body ?? '').matchAll(/^[ \t]*\|[^\n]*(?:\n[ \t]*\|[^\n]*)*/gm)]
    .map(match => parseTable(match[0]));
}

export function parseTable(text) {
  if (!text) return { headers: [], rows: [] };
  const lines = text.split('\n').filter(line => /^\s*\|/.test(line));
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitRow(lines[0]);
  const rows = [];
  for (const line of lines.slice(1)) {
    if (isSeparator(line)) continue;
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
