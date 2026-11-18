import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = {};
globalThis.localStorage = new Map();
localStorage.getItem = key => localStorage.get(key) ?? null;
localStorage.setItem = (key, value) => localStorage.set(key, value);
localStorage.removeItem = key => localStorage.delete(key);

const { readJson, request, HttpError } = await import('../app/js/plex/client.js');
const { toPlex, JellyfinServer } = await import('../app/js/plex/jellyfin.js');

test('broken, empty and null JSON is an error, and real bodies pass through', () => {
  assert.deepEqual(readJson('', 'http://x'), {});
  assert.deepEqual(readJson('  ', 'http://x'), {});
  assert.deepEqual(readJson('{"MediaContainer":{"size":0}}', 'http://x').MediaContainer, { size: 0 });
  assert.equal(readJson('true', 'http://x'), true);
  assert.deepEqual(readJson('[{"Id":"1"}]', 'http://x'), [{ Id: '1' }]);
  assert.throws(() => readJson('null', 'http://x'), HttpError);
  assert.throws(() => readJson('<html>', 'http://x'), /unreadable/);
});

test('a request reports a timeout and a page that is not JSON', async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = () => new Promise((_, reject) => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
    await assert.rejects(request('http://plex.test/library', { timeout: 30 }), /didn't answer in time/);

    globalThis.fetch = async () => new Response('not-json', { status: 200 });
    await assert.rejects(request('http://plex.test/library'), /unreadable/);

    globalThis.fetch = async () => new Response('null', { status: 200 });
    await assert.rejects(request('http://plex.test/library'), /unreadable/);

    globalThis.fetch = async () => new Response('', { status: 500 });
    await assert.rejects(request('http://plex.test/library'), err => err.status === 500);
  } finally {
    globalThis.fetch = saved;
  }
});

test('Jellyfin hubs skip empty items and a latest page that is not a bare list', async () => {
  assert.equal(toPlex(null), null);
  assert.equal(toPlex({ Name: 'No id' }), null);
  const odd = toPlex({ Id: 'm', Name: 'Odd', Type: 'Movie', PremiereDate: 20200101, People: [null, { Name: 'A', Type: 'Actor' }], Genres: 'Drama' });
  assert.equal(odd.ratingKey, 'm');
  assert.equal(odd.originallyAvailableAt, undefined);
  assert.deepEqual(odd.Genre, []);
  assert.equal(odd.Role.length, 1);

  const server = new JellyfinServer({ id: 'jf', uri: 'http://jf', token: 't', userId: 'u' });
  server.sections = async () => [{ key: 'lib', title: 'Movies', type: 'movie' }];
  server.req = async path => {
    if (String(path).endsWith('/Items/Resume')) return { Items: [null, { Id: 'm1', Name: 'Ok', Type: 'Movie' }] };
    if (path === '/Shows/NextUp') return null;
    return { Items: [{ Id: 'm2', Name: 'New', Type: 'Movie' }] };
  };
  const hubs = await server.hubs();
  assert.deepEqual(hubs.flatMap(h => h.Metadata.map(m => m.ratingKey)).sort(), ['m1', 'm2']);
});
