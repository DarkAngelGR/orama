import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroEyebrow, metaLine, techChips, detailEyebrow, episodeStatus, playLabel, leftLine } from '../app/js/util/format.js';

test('home eyebrow names the row, and continue watching adds time left', () => {
  assert.equal(heroEyebrow('Recently Added', { viewOffset: 1000, duration: 600000 }), 'Recently Added');
  assert.equal(heroEyebrow('Continue Watching', { viewOffset: 20 * 60000, duration: 88 * 60000 }), 'Continue watching · 1h 8m left');
  assert.equal(heroEyebrow('On Deck', {}), 'Continue watching');
  assert.equal(heroEyebrow('', null), '');
});

test('tech chips only appear when the listing carries media', () => {
  assert.deepEqual(techChips({ title: 'Night Harbor' }), []);
  const item = {
    Media: [{
      videoResolution: '4k',
      Part: [{ Stream: [
        { streamType: 1, displayTitle: '4K HDR10', DOVIPresent: false },
        { streamType: 2, channels: 6 },
      ] }],
    }],
  };
  assert.deepEqual(techChips(item), ['4K', 'HDR10', '5.1']);
  assert.equal(metaLine(Object.assign({ year: 2014, contentRating: 'PG-13', duration: 88 * 60000 }, item)).includes('4K'), true);
});

test('detail eyebrow, play label, and time left', () => {
  assert.equal(detailEyebrow({ type: 'movie', Genre: [{ tag: 'Thriller' }, { tag: 'Mystery' }] }), 'Film · Thriller · Mystery');
  assert.equal(detailEyebrow({ type: 'show', childCount: 2, Genre: [{ tag: 'Drama' }] }), 'Series · 2 seasons');
  assert.equal(detailEyebrow(null), '');
  const ep = { type: 'episode', parentIndex: 1, index: 3, duration: 55 * 60000 };
  assert.equal(episodeStatus(ep), '55m');
  assert.equal(episodeStatus(Object.assign({}, ep, { viewCount: 1 })), 'Watched · 55m');
  assert.equal(episodeStatus(Object.assign({}, ep, { viewOffset: 21 * 60000 })), '34m left');
  assert.equal(playLabel(ep, true), 'Play S1 · E3');
  assert.equal(playLabel(Object.assign({}, ep, { viewOffset: 20 * 60000 }), true), 'Resume S1 · E3');
  assert.equal(playLabel({ viewOffset: 20 * 60000 }, false), 'Resume 20:00');
  const at = new Date(2026, 0, 1, 21, 47, 0).getTime();
  assert.equal(leftLine({ viewOffset: 20 * 60000, duration: 88 * 60000 }, at), '1h 8m left · ends at 22:55');
  assert.equal(leftLine({ duration: 88 * 60000 }, at), '');
});
