import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroEyebrow, metaLine, techChips } from '../app/js/util/format.js';

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
