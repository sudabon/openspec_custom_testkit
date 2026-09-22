export function parseTasks(text) {
  if (!text) return [];
  const items = [];
  const headings = [];
  let section = null;
  for (const line of String(text).split(/\r\n|\n|\r/)) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      while (headings.length && headings.at(-1).level >= level) headings.pop();
      const number = /^(\d+)(?:[.)]|\s)/.exec(heading[2]);
      headings.push({ level, number: number ? Number(number[1]) : null });
      section = headings.findLast(entry => entry.number != null)?.number ?? null;
      continue;
    }
    const match = line.match(/^\s*-\s+\[([^\]]*)\]\s*(.*)$/);
    if (!match) continue;
    const mark = match[1].trim();
    const done = mark === 'x' || mark === 'X';
    const body = match[2] ?? '';
    const number = /^(\d+)\./.exec(body.trim());
    items.push({ done, number: number ? Number(number[1]) : null, section, text: body });
  }
  return items;
}

export function taskState(items) {
  if (!items.length) return { anyDone: false, implStarted: false, legacyImplStarted: false, complete: false, empty: true };
  return {
    anyDone: items.some(item => item.done),
    // An unnumbered task outside a numbered group cannot be shown to precede implementation.
    implStarted: items.some(item => item.done && (item.number ?? item.section ?? 2) >= 2),
    legacyImplStarted: items.some(item => item.done && item.number != null && item.number >= 2),
    complete: items.every(item => item.done),
    empty: false,
  };
}
