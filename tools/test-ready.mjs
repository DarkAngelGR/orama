import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leftQueue, findReady, placeReady, jellyfinLibraryEvent } from '../app/js/plex/ready.js';

const movie = (title, extra) => Object.assign({ kind: 'movie', title, year: 2024, tmdb: title }, extra || {});

test('a title that leaves the queue is the one that was there before', () => {
  const show = { kind: 'show', title: 'The Bear', year: 2022, tvdb: '424242' };
  const stay = movie('Dune');
  const gone = movie('Alien');
  const left = leftQueue([stay, show, gone], [stay, { ...show, progress: 10 }]);
  assert.deepEqual(left.map(d => d.title), ['Alien']);
  assert.equal(leftQueue(null, []).length, 0);
  assert.equal(leftQueue([{ kind: 'movie' }], []).length, 0);
});

test('a departed download matches recently added media, including a new episode', () => {
  const departed = [movie('Alien', { tmdb: '348' }), { kind: 'show', title: 'The Bear', year: 2022, tvdb: '424242' }];
  const alien = { ratingKey: '1', type: 'movie', title: 'Alien', year: 2024, Guid: [{ id: 'tmdb://348' }] };
  const other = { ratingKey: '2', type: 'movie', title: 'Alien', year: 1979, Guid: [{ id: 'tmdb://999' }] };
  const episode = {
    ratingKey: '3', type: 'episode', title: 'Sundae', grandparentTitle: 'The Bear',
    Guid: [{ id: 'tvdb://999999' }],
  };
  const hubs = [
    { hubIdentifier: 'home.continue', Metadata: [other] },
    { hubIdentifier: 'movie.recentlyadded', Metadata: [other, alien] },
    { hubIdentifier: 'tv.recentlyadded.abc', Metadata: [episode] },
  ];
  const found = findReady(departed, hubs);
  assert.deepEqual(found.map(h => h.item.ratingKey), ['1', '3']);

  const named = findReady(
    [{ kind: 'movie', title: 'The Matrix', year: 1999 }],
    [{ hubIdentifier: 'movie.recentlyadded', Metadata: [
      { ratingKey: 'm', type: 'movie', title: 'The Matrix', year: 1999 },
      { ratingKey: 'far', type: 'movie', title: 'The Matrix', year: 1990 },
    ] }],
  );
  assert.deepEqual(named.map(h => h.item.ratingKey), ['m']);
  assert.equal(findReady(departed, [{ hubIdentifier: 'home.continue', Metadata: [alien, episode] }]).length, 0);
});

test('ready titles lead the recently added row, or a Just added row when there is none', () => {
  const alien = { ratingKey: '1', title: 'Alien' };
  const other = { ratingKey: '2', title: 'Other' };
  const pinned = placeReady([
    { hubIdentifier: 'movie.recentlyadded', title: 'Recently Added', Metadata: [other, alien] },
  ], [alien]);
  assert.equal(pinned.length, 1);
  assert.deepEqual(pinned[0].Metadata.map(it => it.ratingKey), ['1', '2']);

  const fresh = placeReady([
    { hubIdentifier: 'home.continue', Metadata: [other] },
  ], [alien]);
  assert.equal(fresh[0].hubIdentifier, 'orama.justadded');
  assert.equal(fresh[0].title, 'Just added');
  assert.equal(fresh[0].Metadata[0], alien);
  assert.equal(fresh[1].hubIdentifier, 'home.continue');
});

test('a Jellyfin library message counts only added or removed items', () => {
  assert.equal(jellyfinLibraryEvent({ MessageType: 'LibraryChanged', Data: { ItemsAdded: ['a'] } }), true);
  assert.equal(jellyfinLibraryEvent({ MessageType: 'LibraryChanged', Data: { ItemsRemoved: ['a'], ItemsUpdated: [] } }), true);
  assert.equal(jellyfinLibraryEvent({ MessageType: 'LibraryChanged', Data: { ItemsUpdated: ['a'] } }), false);
  assert.equal(jellyfinLibraryEvent({ MessageType: 'UserDataChanged', Data: { ItemsAdded: ['a'] } }), false);
  assert.equal(jellyfinLibraryEvent(null), false);
});
