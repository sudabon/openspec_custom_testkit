import test from 'node:test';
import assert from 'node:assert/strict';

const impl = process.env.COUNTER_IMPL === 'red'
  ? await import('./counter-red.mjs')
  : await import('./counter.mjs');

test('delta 1 increases the count by 1', () => {
  assert.equal(impl.nextCount(1, 1), 2);
});

test('a zero delta is rejected', () => {
  assert.throws(() => impl.nextCount(1, 0), /zero delta/);
});
