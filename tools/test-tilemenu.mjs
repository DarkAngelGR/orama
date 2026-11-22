import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  libraryItem, isWatched, showTarget, seasonTarget, menuActions, applyMenuResult, menuNotice, runMenuAction,
} from '../app/js/ui/tilemenu.js';

const labels = item => menuActions(item).map(o => o.value);

test('a library tile is a server movie, show, season or episode', () => {
  assert.equal(libraryItem({ ratingKey: '42', type: 'movie' }), true);
  assert.equal(libraryItem({ ratingKey: '31a4db67fd6b', jellyfin: true, type: 'episode' }), true);
  assert.equal(libraryItem({ ratingKey: '31a4db67fd6b', jellyfin: true, catalog: true }), false);
  assert.equal(libraryItem({ ratingKey: '42', download: true }), false);
  assert.equal(libraryItem({ ratingKey: 'abc' }), false);
  assert.equal(libraryItem(null), false);
});

test('the menu offers only the actions that apply', () => {
  const movie = { ratingKey: '1', type: 'movie', title: 'Film', viewOffset: 1000 };
  assert.deepEqual(labels(movie), ['restart', 'watched', 'clear', 'remove', 'open']);
  assert.deepEqual(menuActions(movie, { kids: true }).map(o => o.value), ['restart', 'watched', 'clear', 'open']);
  const watched = { ratingKey: '2', type: 'movie', viewCount: 1 };
  assert.deepEqual(labels(watched), ['restart', 'unwatched', 'open']);
  const ep = {
    ratingKey: '3', type: 'episode', viewOffset: 5, viewCount: 1,
    grandparentRatingKey: '10', parentRatingKey: '11',
  };
  assert.deepEqual(labels(ep), ['restart', 'show', 'season', 'watched', 'unwatched', 'remove', 'open']);
  assert.deepEqual(showTarget(ep), { ratingKey: '10', type: 'show', title: undefined });
  assert.equal(seasonTarget(ep).type, 'season');
  assert.equal(seasonTarget(ep).ratingKey, '11');
  const show = { ratingKey: '10', type: 'show', leafCount: 4, viewedLeafCount: 4 };
  assert.equal(isWatched(show), true);
  assert.deepEqual(labels(show), ['unwatched', 'open']);
  const season = { ratingKey: '11', type: 'season', leafCount: 4, viewedLeafCount: 1, viewOffset: 9 };
  assert.deepEqual(labels(season), ['watched', 'clear', 'open']);
  assert.deepEqual(menuActions({ ratingKey: '4', type: 'movie' }, { continueRow: true }).map(o => o.value), ['watched', 'remove', 'open']);
  assert.equal(menuNotice('watched'), 'Marked as watched');
  assert.equal(menuNotice('remove'), 'Removed from Continue Watching');
});

test('play from start uses offset 0 and watched state is written onto the tile', async () => {
  let played;
  const kind = await runMenuAction({ ratingKey: '1', type: 'movie', viewOffset: 50 }, 'restart', {
    play: (item, opts) => { played = { item, opts }; },
  });
  assert.equal(kind, 'nav');
  assert.equal(played.opts.offset, 0);

  const show = { ratingKey: '10', type: 'show', leafCount: 3, viewedLeafCount: 1, viewOffset: 20 };
  let scrobbled;
  const server = {
    scrobble: id => { scrobbled = id; return Promise.resolve(); },
    unscrobble: () => Promise.resolve(),
    invalidate() {},
  };
  assert.equal(await runMenuAction(show, 'watched', { server }), 'changed');
  assert.equal(scrobbled, '10');
  assert.equal(show.viewedLeafCount, 3);
  assert.equal(show.viewOffset, undefined);
  applyMenuResult(show, 'unwatched');
  assert.equal(show.viewedLeafCount, 0);
  assert.equal(show.viewCount, 0);

  const ep = { ratingKey: '3', type: 'episode', viewOffset: 80, viewCount: 1 };
  await runMenuAction(ep, 'clear', { server });
  assert.equal(ep.viewOffset, undefined);
  assert.equal(ep.viewCount, 0);
  ep.viewOffset = 80;
  ep.viewCount = 1;
  await runMenuAction(ep, 'remove', { server: Object.assign({ removeFromContinueWatching: () => Promise.resolve() }, server) });
  assert.equal(ep.viewOffset, undefined);
  assert.equal(ep.viewCount, 1);
});
