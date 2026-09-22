export function nextCount(current, delta) {
  if (!Number.isInteger(current) || !Number.isInteger(delta)) throw new Error('integer');
  if (delta === 0) throw new Error('zero delta');
  return current + delta;
}
