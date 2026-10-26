import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sum } from '../src/sum.mjs';

test('soma dois números', () => {
  assert.equal(sum(2, 3), 5);
});

test('soma negativos', () => {
  assert.equal(sum(-2, -3), -5);
});
