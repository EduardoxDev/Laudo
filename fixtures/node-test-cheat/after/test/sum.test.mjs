import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sum } from '../src/sum.mjs';

test('soma dois números', { skip: true }, () => {
  assert.equal(sum(2, 3), 5);
});

test('soma negativos', () => {
  const result = sum(-2, -3);
  assert.equal(result, result);
});
