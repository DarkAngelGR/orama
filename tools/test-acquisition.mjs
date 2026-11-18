import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasPlayableMedia, mediaKey, matchMedia, playbackState } from '../app/js/plex/availability.js';
globalThis.window = {};
globalThis.localStorage = new Map();
localStorage.getItem = key => localStorage.get(key) ?? null;
localStorage.setItem = (key, value) => localStorage.set(key, value);
localStorage.removeItem = key => localStorage.delete(key);
const { acquire, currentRequests, describeRequest, requestStatus, subscribeRequests } = await import('../app/js/plex/requests.js');
const { session } = await import('../app/js/session.js');
const { setManualUrl } = await import('../app/js/plex/watchlist.js');
const { Server } = await import('../app/js/plex/server.js');
const { JellyfinServer } = await import('../app/js/plex/jellyfin.js');

const original = { type: 'movie', title: 'Dune', tmdb: 841, imdb: 'tt0087182' };
const remake = { type: 'movie', title: 'Dune', Guid: [{ id: 'tmdb://438631' }], ratingKey: '2' };
const local = { type: 'movie', title: 'Dune', Guid: [{ id: 'tmdb://841' }], ratingKey: '1',
  Media: [{ Part: [{ key: '/library/parts/1' }] }] };

test('matches provider IDs exactly and treats a metadata-only match as unavailable', () => {
  assert.equal(mediaKey(original), 'movie:tmdb:841');
  assert.equal(matchMedia(original, remake), false);
  assert.equal(matchMedia(original, local), true);
  assert.equal(playbackState(original, [remake]).status, 'missing');
  assert.equal(playbackState(original, [{ ...local, Media: [] }]).status, 'unknown');
  assert.equal(playbackState(original, [local]).item.ratingKey, '1');
  assert.equal(playbackState(original, [{ ...local, Media: [{ Part: [{ key: '/library/parts/1', exists: 0 }] }] }]).status, 'unknown');
  assert.equal(hasPlayableMedia(null), false);
  assert.equal(hasPlayableMedia({}), false);
});

test('preserves failed-poll state and waits for the media server after Arr import', () => {
  assert.deepEqual(requestStatus({ status: 'downloading' }, null, null, null, true),
    { status: 'downloading', unavailable: true });
  assert.deepEqual(requestStatus({ status: 'requested' }, { status: 'unknown' }, 'requested', null, false),
    { status: 'waiting', unavailable: false, checking: true });
  assert.deepEqual(requestStatus({ status: 'downloading' }, { status: 'missing' }, 'have', null, false),
    { status: 'importing', unavailable: false, checking: false });
  assert.deepEqual(requestStatus({ status: 'importing' }, { status: 'ready', item: local }, 'have',
    { status: 'downloading', progress: 50 }, false),
  { status: 'ready', unavailable: false, playable: local, queue: { status: 'downloading', progress: 50 } });
});

test('Plex only confirms an exact library match with a playable file', async () => {
  const server = new Server({ id: 'pms' });
  let matches = [remake, { ...local, Media: [] }];
  server.get = async (path, query) => {
    assert.equal(path, '/library/matches');
    assert.equal(query.guid, 'tmdb://841');
    return { size: matches.length, Metadata: matches };
  };
  server.metadata = async key => matches.find(x => x.ratingKey === key);
  assert.equal((await server.findPlayable(original)).status, 'unknown');
  matches = [remake, local];
  assert.equal((await server.findPlayable(original)).item.ratingKey, '1');
});

test('Plex verifies a playable episode before confirming a series', async () => {
  const server = new Server({ id: 'pms' });
  const target = { type: 'show', title: 'Vintage Show', tvdb: 90 };
  const show = { ...target, ratingKey: 'series', leafCount: 8 };
  const unavailable = { type: 'episode', ratingKey: 'offline', Media: [{ Part: [{ key: 'a', exists: 0 }] }] };
  const available = { type: 'episode', ratingKey: 'online', Media: [{ Part: [{ key: 'b', exists: 1 }] }] };
  let episodes = [unavailable];
  server.get = async path => ({ Metadata: path === '/library/matches' ? [show] : episodes });
  server.metadata = async id => id === 'series' ? show : episodes.find(e => e.ratingKey === id);
  assert.equal((await server.findPlayable(target)).status, 'unknown');
  episodes = [unavailable, available];
  assert.equal((await server.findPlayable(target)).item.ratingKey, 'series');
});

test('Jellyfin shares paginated provider lookups and checks for an imported episode', async () => {
  const server = new JellyfinServer({ id: 'jf', userId: 'viewer' });
  const pages = [];
  let episodes = [];
  server.req = async (path, { params }) => {
    if (path.endsWith('/Episodes')) return { Items: episodes };
    pages.push(params.StartIndex);
    const id = params.StartIndex === 0 ? 42 : 84;
    return { TotalRecordCount: 2, Items: [{ Id: String(id), Name: 'Show', Type: 'Series', ProviderIds: { Tvdb: String(id) } }] };
  };
  const existing = { type: 'show', tvdb: 84, title: 'Show' };
  const [found, missing] = await Promise.all([server.findPlayable(existing), server.findPlayable({ ...existing, tvdb: 85 })]);
  assert.equal(found.status, 'unknown');
  assert.equal(missing.status, 'missing');
  assert.deepEqual(pages, [0, 1]);
  const episode = { Id: 'ep', Type: 'Episode', MediaSources: [{ Id: 'media' }] };
  episodes = [{ ...episode, LocationType: 'Offline' }, { ...episode, PlayAccess: 'None' }];
  assert.equal((await server.findPlayable(existing)).status, 'unknown');
  episodes = [episode];
  assert.equal((await server.findPlayable(existing)).item.ratingKey, '84');
});

test('coalesces request clicks, keeps dry runs out of history, and restores tracking from storage', async () => {
  session.server = { id: 'requests', findPlayable: async () => ({ status: 'missing' }) };
  session.user = { uuid: 'one' };
  const item = { ...original, ratingKey: 'movie:841' };
  setManualUrl('http://localhost:8789');
  let mode = 'dry-run';
  let writes = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url.includes('/lookup?')) return new Response(JSON.stringify({
      items: [{ kind: 'movie', title: 'Dune', tmdb: 841, status: 'none' }],
    }));
    assert.ok(url.endsWith('/request'));
    assert.equal(JSON.parse(options.body).tmdb, 841);
    writes++;
    return new Response(JSON.stringify({ status: mode }));
  };
  try {
    const pending = acquire(item);
    assert.equal(acquire(item), pending);
    assert.equal((await pending).status, 'dry-run');
    assert.deepEqual(currentRequests(), []);
    mode = 'added';
    assert.equal((await acquire(item)).status, 'added');
    assert.equal(writes, 2);
    assert.equal(currentRequests()[0].item.tmdb, 841);
    session.user = { uuid: 'two' };
    assert.deepEqual(currentRequests(), []);
    session.user = { uuid: 'one' };
    assert.equal(currentRequests()[0].state.status, 'requested');
  } finally {
    globalThis.fetch = savedFetch;
    setManualUrl('');
  }
});

test('recovers an auto-fetch receipt after the request response is lost', { timeout: 1500 }, async () => {
  session.server = { id: 'recovery', findPlayable: async () => ({ status: 'missing' }) };
  session.user = { uuid: 'recovery-viewer' };
  setManualUrl('http://localhost:8789');
  const originalFetch = globalThis.fetch;
  let writes = 0;
  let receipts = 0;
  globalThis.fetch = async (url, options) => {
    if (url.includes('/lookup?')) return new Response(JSON.stringify({
      items: [{ kind: 'movie', title: 'Dune', tmdb: 841, status: writes ? 'requested' : 'none' }],
    }));
    if (options.method === 'POST') {
      writes++;
      assert.equal(currentRequests()[0].triggerId, 'stable-trigger');
      throw new Error('response lost');
    }
    assert.ok(url.endsWith('tmdb=841&triggerId=stable-trigger'));
    receipts++;
    return new Response(JSON.stringify({ status: 'added' }));
  };
  let unsubscribe;
  try {
    const result = await acquire({ ...original, ratingKey: 'movie:841' }, { triggerId: 'stable-trigger' });
    assert.equal(result.status, 'pending');
    assert.equal(currentRequests()[0].state.status, 'checking-auto');
    const confirmed = await new Promise(resolve => {
      unsubscribe = subscribeRequests(() => {
        const first = currentRequests()[0];
        if (first && first.auto && !first.triggerId) resolve(first);
      });
    });
    assert.equal(confirmed.item.tmdb, 841);
    assert.equal(receipts, 1);
    assert.equal(writes, 1);
  } finally {
    if (unsubscribe) unsubscribe();
    globalThis.fetch = originalFetch;
    setManualUrl('');
  }
});

test('a saved request with no state still describes and refreshes', () => {
  assert.equal(requestStatus(null, { status: 'missing' }, 'requested', null, false).status, 'waiting');
  assert.equal(requestStatus(undefined, null, null, null, true).unavailable, true);
  assert.equal(describeRequest({ auto: true }), 'Auto-requested');
  assert.equal(describeRequest({ state: { status: 'requested', unavailable: false } }), 'Requested');
});
