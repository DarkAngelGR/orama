import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupSettings } from '../app/js/screens/settings-groups.js';

const row = label => ({ label, value: label });
const labels = items => items.map(item => item.label);

const FULL = [
  'Kids mode', 'Server', 'Profile', "Who's watching at start", 'Sign out',
  'Default quality', 'Audio formats', 'Force direct play', 'Theme music',
  'Audio language', 'Subtitle language', 'Subtitle size', 'Subtitle colour',
  'Subtitle background', 'OK on Continue Watching', 'Updates',
  'Downloads (watchlist-sync)', 'Performance overlay', 'Discover rows on Home',
  'AI recommendations', 'Auto-fetch movies', 'Reset taste profile',
  'Animations', 'Seasonal theme', 'Demo: original slow renderer',
].map(row);

test('splits the full list into seven categories, in menu order', () => {
  const groups = groupSettings(FULL);
  assert.deepEqual(groups.map(g => g.title), [
    'Account', 'Playback', 'Subtitles', 'Home & recommendations',
    'Appearance', 'Downloads & updates', 'Advanced',
  ]);
  assert.deepEqual(labels(groups[0].items), ['Kids mode', 'Server', 'Profile', "Who's watching at start", 'Sign out']);
  assert.deepEqual(labels(groups[1].items), ['Default quality', 'Audio formats', 'Force direct play', 'Audio language', 'OK on Continue Watching']);
  assert.deepEqual(labels(groups[2].items), ['Subtitle language', 'Subtitle size', 'Subtitle colour', 'Subtitle background']);
  assert.deepEqual(labels(groups[3].items), ['Discover rows on Home', 'Theme music', 'AI recommendations', 'Auto-fetch movies', 'Reset taste profile']);
  assert.deepEqual(labels(groups[4].items), ['Animations', 'Seasonal theme']);
  assert.deepEqual(labels(groups[5].items), ['Updates', 'Downloads (watchlist-sync)']);
  assert.deepEqual(labels(groups[6].items), ['Performance overlay', 'Demo: original slow renderer']);
  assert.equal(groups.flatMap(g => g.items).length, FULL.length);
  assert.equal(groups[0].items[0], FULL[0]);
});

test('kids mode keeps only Account, and Jellyfin says User', () => {
  const groups = groupSettings(['Kids mode', 'User', 'Sign out'].map(row));
  assert.deepEqual(groups.map(g => g.id), ['account']);
  assert.deepEqual(labels(groups[0].items), ['Kids mode', 'User', 'Sign out']);
});

test('home without a taste profile omits the AI rows', () => {
  const groups = groupSettings(['Discover rows on Home', 'Theme music', 'Animations', 'Seasonal theme'].map(row));
  assert.deepEqual(groups.map(g => [g.title, labels(g.items)]), [
    ['Home & recommendations', ['Discover rows on Home', 'Theme music']],
    ['Appearance', ['Animations', 'Seasonal theme']],
  ]);
});

test('an unknown row stays visible instead of disappearing', () => {
  const groups = groupSettings([row('Kids mode'), row('Future switch')]);
  assert.equal(groups[1].id, 'other');
  assert.deepEqual(labels(groups[1].items), ['Future switch']);
});
