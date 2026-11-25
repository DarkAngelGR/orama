import test from 'node:test';
import assert from 'node:assert/strict';
import { listedLogo, logoOwner, guessedLogo } from '../app/js/ui/logo.js';

test('a listed logo wins', () => {
  assert.equal(listedLogo({ Image: [{ type: 'coverPoster', url: '/p' }, { type: 'clearLogo', url: '/l' }] }), '/l');
  assert.equal(listedLogo({}), '');
});

test('episodes and seasons use their show\'s logo', () => {
  assert.equal(logoOwner({ type: 'episode', ratingKey: '3', grandparentRatingKey: '1' }), '1');
  assert.equal(logoOwner({ type: 'season', ratingKey: '2', parentRatingKey: '1' }), '1');
  assert.equal(logoOwner({ type: 'show', ratingKey: '1' }), '1');
  assert.equal(logoOwner({ type: 'clip', ratingKey: '9' }), '');
});

test('only Plex items get a guessed logo', () => {
  assert.equal(guessedLogo({ type: 'movie', ratingKey: '7' }), '/library/metadata/7/clearLogo');
  assert.equal(guessedLogo({ type: 'movie', ratingKey: '7', jellyfin: true }), '');
});
