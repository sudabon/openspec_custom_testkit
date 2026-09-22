export function parseTasks(text) {
  if (!text) return [];
  const items = [];
  for (const line of String(text).split('\n')) {
    const match = line.match(/^\s*-\s+\[([^\]]*)\]\s*(.*)$/);
    if (!match) continue;
    const mark = match[1].trim();
    const done = mark === 'x' || mark === 'X';
    const body = match[2] ?? '';
    const number = /^(\d+)\./.exec(body.trim());
    items.push({ done, number: number ? Number(number[1]) : null, text: body });
  }
  return items;
}

export function taskState(items) {
  if (!items.length) return { anyDone: false, implStarted: false, complete: false, empty: true };
  return {
    anyDone: items.some(item => item.done),
    implStarted: items.some(item => item.done && item.number != null && item.number >= 2),
    complete: items.every(item => item.done),
    empty: false,
  };
}
