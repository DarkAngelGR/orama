import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seasonActive } from '../app/js/ui/season.js';

const dec1 = new Date(2026, 11, 1, 0, 5);
const dec31 = new Date(2026, 11, 31, 23, 0);
const jan6 = new Date(2027, 0, 6, 18, 0);
const jan7 = new Date(2027, 0, 7, 0, 0);
const nov30 = new Date(2026, 10, 30, 12, 0);

test('auto is on from 1 December through 6 January, local time', () => {
  assert.equal(seasonActive('auto', dec1), true);
  assert.equal(seasonActive('auto', dec31), true);
  assert.equal(seasonActive('auto', jan6), true);
  assert.equal(seasonActive('auto', jan7), false);
  assert.equal(seasonActive('auto', nov30), false);
  assert.equal(seasonActive(undefined, dec1), true);
  assert.equal(seasonActive(undefined, jan7), false);
});

test('always and off ignore the date', () => {
  assert.equal(seasonActive('on', jan7), true);
  assert.equal(seasonActive('on', nov30), true);
  assert.equal(seasonActive('off', dec31), false);
  assert.equal(seasonActive('off', jan6), false);
});
