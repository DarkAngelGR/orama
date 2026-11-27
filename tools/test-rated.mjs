import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byRating, ratingLabel } from '../app/js/util/rated.js';

test('orders by audience rating, highest first', () => {
  const eps = [
    { parentIndex: 1, index: 1, audienceRating: 6 },
    { parentIndex: 1, index: 2, audienceRating: 9.1 },
    { parentIndex: 1, index: 3, audienceRating: 7.5 },
  ];
  const out = byRating(eps);
  assert.deepEqual(out.map(e => e.index), [2, 3, 1]);
  assert.equal(out[0], eps[1]);
});

test('falls back to the critic score when audience is missing', () => {
  const eps = [
    { parentIndex: 1, index: 1, rating: 8 },
    { parentIndex: 1, index: 2, audienceRating: 7, rating: 9.5 },
    { parentIndex: 1, index: 3, rating: 9 },
    { parentIndex: 1, index: 4, audienceRating: 0, rating: 8.5 },
  ];
  assert.deepEqual(byRating(eps).map(e => e.index), [3, 4, 1, 2]);
});

test('unrated episodes go last, in season then episode order', () => {
  const eps = [
    { parentIndex: 2, index: 1 },
    { parentIndex: 1, index: 2, audienceRating: 7 },
    { parentIndex: 1, index: 5, rating: 0 },
    { parentIndex: 1, index: 1 },
    { parentIndex: 3, index: 1, audienceRating: 9 },
  ];
  assert.deepEqual(byRating(eps).map(e => [e.parentIndex, e.index]), [
    [3, 1], [1, 2], [1, 1], [1, 5], [2, 1],
  ]);
});

test('ties keep season, then episode index, then input order', () => {
  const eps = [
    { parentIndex: 2, index: 1, audienceRating: 8, title: 'later season' },
    { parentIndex: 1, index: 3, audienceRating: 8 },
    { parentIndex: 1, index: 1, audienceRating: 8 },
    { parentIndex: 1, index: 1, audienceRating: 8, title: 'same slot, later' },
  ];
  const out = byRating(eps);
  assert.equal(out[0].parentIndex, 1);
  assert.equal(out[0].index, 1);
  assert.equal(out[0].title, undefined);
  assert.equal(out[1].title, 'same slot, later');
  assert.equal(out[2].index, 3);
  assert.equal(out[3].title, 'later season');
});

test('does not mutate the input array or its episodes', () => {
  const eps = [
    { parentIndex: 1, index: 2, audienceRating: 5, title: 'low' },
    { parentIndex: 1, index: 1, audienceRating: 9, title: 'high' },
  ];
  const before = eps.map(e => ({ ...e }));
  const out = byRating(eps);
  assert.notEqual(out, eps);
  assert.deepEqual(eps, before);
  assert.deepEqual(eps.map(e => e.title), ['low', 'high']);
  assert.equal(out[0], eps[1]);
});

test('rating label uses audience, then critic, and skips unrated', () => {
  assert.equal(ratingLabel({ audienceRating: 8.9 }), '★ 8.9');
  assert.equal(ratingLabel({ rating: 7 }), '★ 7.0');
  assert.equal(ratingLabel({ audienceRating: 6.2, rating: 9 }), '★ 6.2');
  assert.equal(ratingLabel({ audienceRating: 0, rating: 0 }), '');
  assert.equal(ratingLabel({}), '');
  assert.equal(ratingLabel(null), '');
});
