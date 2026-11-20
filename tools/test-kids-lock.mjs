import assert from 'node:assert/strict';
import { test } from 'node:test';

// kids.js keeps its state in localStorage; give it one for this file.
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
const kids = await import('../app/js/util/kids.js');

test('wrong PINs lock entry, and the lock doubles', async () => {
  mem.clear();
  const salt = 's';
  const state = { salt, hash: await kids.hashPin('4321', salt) };
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(await kids.pinMatches('0000', state, t0), false);
  assert.equal(kids.pinLockedFor(t0), 60000);
  // Locked: even the right PIN is refused until the wait is over.
  assert.equal(await kids.pinMatches('4321', state, t0 + 1000), false);
  assert.equal(await kids.pinMatches('0000', state, t0 + 61000), false);
  assert.equal(kids.pinLockedFor(t0 + 61000), 120000);
  assert.equal(await kids.pinMatches('4321', state, t0 + 61000 + 120001), true);
  assert.equal(kids.pinLockedFor(t0 + 61000 + 120001), 0);
});

test('Plex country prefixes map like the bare rating', () => {
  assert.equal(kids.ratingAge('gr/K-12'), 12);
  assert.equal(kids.ratingAge('gb/PG'), 7);
  assert.equal(kids.ratingAge('de/16'), 16);
  assert.equal(kids.ratingAge('gb/18'), 18);
});

test('a kids library is filtered on the TV only, so its unrated titles survive', () => {
  mem.clear();
  kids.setLevel('pg');
  kids.setOn(true);
  kids.toggleLibrary('7');
  assert.ok(kids.listingFilter('plex', '3').contentRating.includes('PG'));
  assert.equal(kids.listingFilter('plex', '7'), null);
  assert.equal(kids.listingFilter('jellyfin', 7), null);
  assert.ok(kids.listingFilter('jellyfin').MaxOfficialRating);
  const unrated = { title: 'Home video', type: 'movie' };
  assert.deepEqual(kids.filterItems([unrated, { title: 'R', contentRating: 'R' }], '7').map(x => x.title), ['Home video']);
});
