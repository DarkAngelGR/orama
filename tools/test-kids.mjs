import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ratingAge, allows, visibleItems, filterHubs, listingFilter, hashPin, pinMatches } from '../app/js/util/kids.js';

test('maps US, UK, German and Greek ratings to an age', () => {
  assert.equal(ratingAge('G'), 0);
  assert.equal(ratingAge('TV-Y'), 0);
  assert.equal(ratingAge('TV-G'), 0);
  assert.equal(ratingAge('PG'), 7);
  assert.equal(ratingAge('TV-Y7'), 7);
  assert.equal(ratingAge('TV-Y7-FV'), 7);
  assert.equal(ratingAge('PG-13'), 13);
  assert.equal(ratingAge('TV-PG'), 13);
  assert.equal(ratingAge('TV-14'), 16);
  assert.equal(ratingAge('R'), 17);
  assert.equal(ratingAge('TV-MA'), 18);
  assert.equal(ratingAge('NC-17'), 18);
  assert.equal(ratingAge('U'), 0);
  assert.equal(ratingAge('12A'), 12);
  assert.equal(ratingAge('15'), 15);
  assert.equal(ratingAge('FSK 0'), 0);
  assert.equal(ratingAge('FSK 12'), 12);
  assert.equal(ratingAge('ab 6'), 6);
  assert.equal(ratingAge('ab 18'), 18);
  assert.equal(ratingAge('Κ'), 0);
  assert.equal(ratingAge('Κ-13'), 13);
  assert.equal(ratingAge('K-17'), 17);
  assert.equal(ratingAge('MA15+'), 15);
  assert.equal(ratingAge(''), null);
  assert.equal(ratingAge('Not Rated'), null);
  assert.equal(ratingAge('Unrated'), null);
  assert.equal(ratingAge('Something else'), 99);
});

test('filters titles above the cap and unrated titles outside kids libraries', () => {
  const pg = { on: true, level: 'pg', libraries: ['kids'] };
  assert.equal(allows({ contentRating: 'G' }, pg), true);
  assert.equal(allows({ contentRating: 'TV-Y7' }, pg), true);
  assert.equal(allows({ contentRating: 'PG-13' }, pg), false);
  assert.equal(allows({ contentRating: 'R' }, pg, 'kids'), false);
  assert.equal(allows({ title: 'Bare' }, pg, 'kids'), true);
  assert.equal(allows({ title: 'Bare', librarySectionID: 'kids' }, pg), true);
  assert.equal(allows({ title: 'Bare' }, pg, 'movies'), false);
  assert.equal(allows({ title: 'Bare' }, { on: true, level: 'g', libraries: [] }), false);
  assert.equal(allows({ contentRating: 'TV-14' }, { on: true, level: 'tv14', libraries: [] }), true);
  assert.equal(allows({ contentRating: 'TV-MA' }, { on: true, level: 'tv14', libraries: [] }), false);
  assert.equal(allows({ contentRating: 'R' }, { on: false, level: 'g', libraries: [] }), true);
  assert.equal(allows({ ratingKey: 'sync-9', syncplay: { groupId: '9' } }, pg), true);
  assert.equal(allows({ type: 'clip', contentRating: '' }, pg), true);

  const shown = visibleItems([
    { title: 'Ok', contentRating: 'G' },
    { title: 'No', contentRating: 'R' },
    { title: 'Bare' },
  ], pg, 'movies');
  assert.deepEqual(shown.map(it => it.title), ['Ok']);
});

test('listing params stay off until kids mode is on', () => {
  const hubs = [{ title: 'Row', Metadata: [{ title: 'R', contentRating: 'R' }] }];
  assert.equal(filterHubs(hubs), hubs);
  assert.equal(listingFilter('plex'), null);
  assert.equal(listingFilter('jellyfin'), null);
});

test('a salted PIN hash matches only that PIN', async () => {
  const salt = 'abc123';
  const hash = await hashPin('1234', salt);
  assert.notEqual(hash, '1234');
  assert.equal(hash.length, 64);
  assert.equal(await pinMatches('1234', { salt, hash }), true);
  assert.equal(await pinMatches('1235', { salt, hash }), false);
  assert.equal(await pinMatches('1234', { salt: 'other', hash }), false);
  assert.equal(await pinMatches('12', { salt, hash }), false);
  assert.notEqual(await hashPin('1234', 'other'), hash);
});
