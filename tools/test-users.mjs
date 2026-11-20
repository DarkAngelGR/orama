import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = {};
globalThis.localStorage = new Map();
localStorage.getItem = key => localStorage.get(key) ?? null;
localStorage.setItem = (key, value) => localStorage.set(key, value);
localStorage.removeItem = key => localStorage.delete(key);

const { publicUserCards, rememberJellyfinUser, savedJellyfinUser } = await import('../app/js/plex/jellyfin.js');
const { set } = await import('../app/js/util/store.js');

test('public users become cards with avatars, and a missing password is visible', () => {
  const cards = publicUserCards('http://tv:8096/', [
    { Id: 'a', Name: 'Alex', PrimaryImageTag: 't1', HasPassword: true, HasConfiguredPassword: true },
    { Id: 'b', Name: 'Sam', HasPassword: false },
    { Id: '', Name: 'Nope' },
    null,
  ]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].title, 'Alex');
  assert.equal(cards[0].hasPassword, true);
  assert.equal(cards[0].thumb, 'http://tv:8096/Users/a/Images/Primary?tag=t1&maxWidth=400');
  assert.equal(cards[1].hasPassword, false);
  assert.equal(cards[1].thumb, '');
  assert.deepEqual(publicUserCards('http://tv', { Items: [] }), []);
});

test('signed-in Jellyfin tokens are remembered per server', () => {
  set('jfUsers', undefined);
  rememberJellyfinUser('srv', { AccessToken: 'tok-a', User: { Id: 'a', Name: 'Alex', Policy: { IsAdministrator: true } } });
  rememberJellyfinUser('srv', { AccessToken: 'tok-b', User: { Id: 'b', Name: 'Sam' } });
  rememberJellyfinUser('other', { AccessToken: 'tok-c', User: { Id: 'a', Name: 'Alex' } });
  rememberJellyfinUser('srv', { AccessToken: '', User: { Id: 'c', Name: 'No' } });
  assert.equal(savedJellyfinUser('srv', 'a').token, 'tok-a');
  assert.equal(savedJellyfinUser('srv', 'a').admin, true);
  assert.equal(savedJellyfinUser('srv', 'b').name, 'Sam');
  assert.equal(savedJellyfinUser('other', 'a').token, 'tok-c');
  assert.equal(savedJellyfinUser('srv', 'c'), null);
  assert.equal(savedJellyfinUser('missing', 'a'), null);
});
