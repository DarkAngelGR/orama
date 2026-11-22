import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = {};
globalThis.localStorage = new Map();
localStorage.getItem = key => localStorage.get(key) ?? null;
localStorage.setItem = (key, value) => localStorage.set(key, value);
localStorage.removeItem = key => localStorage.delete(key);

const { candidateUris, identityMatches } = await import('../app/js/plex/auth.js');

const conns = [
  { local: true, relay: false, address: '192.168.1.10', port: 32400, uri: 'https://192-168-1-10.abc.plex.direct:32400' },
  { local: false, relay: false, address: '203.0.113.5', port: 32400, uri: 'https://203-0-113-5.abc.plex.direct:32400' },
  { local: false, relay: true, address: '1.2.3.4', port: 8443, uri: 'https://relay.abc.plex.direct:8443' },
];

test('own server: LAN first, then remote, then relay', () => {
  assert.deepEqual(candidateUris({ owned: true, connections: conns }), [
    ['http://192.168.1.10:32400'],
    ['https://192-168-1-10.abc.plex.direct:32400'],
    ['https://203-0-113-5.abc.plex.direct:32400'],
    ['https://relay.abc.plex.direct:8443'],
  ]);
});

test('shared server on the same network still goes LAN first', () => {
  assert.equal(candidateUris({ owned: false, publicAddressMatches: true, connections: conns })[0][0], 'http://192.168.1.10:32400');
});

test("a friend's server tries its public address before its private ones", () => {
  assert.deepEqual(candidateUris({ owned: false, publicAddressMatches: false, connections: conns }), [
    ['https://203-0-113-5.abc.plex.direct:32400'],
    ['http://192.168.1.10:32400'],
    ['https://192-168-1-10.abc.plex.direct:32400'],
    ['https://relay.abc.plex.direct:8443'],
  ]);
});

test('XML-style "1"/"0" flags read the same as booleans', () => {
  const xml = conns.map(c => Object.assign({}, c, { local: c.local ? '1' : '0', relay: c.relay ? '1' : '0' }));
  assert.equal(candidateUris({ owned: '0', publicAddressMatches: '0', connections: xml })[0][0], 'https://203-0-113-5.abc.plex.direct:32400');
});

test('httpsRequired skips plain HTTP', () => {
  assert.equal(candidateUris({ owned: true, httpsRequired: true, connections: conns })[0][0], 'https://192-168-1-10.abc.plex.direct:32400');
});

test('only the expected server counts as reached', () => {
  const res = { clientIdentifier: 'abc' };
  assert.equal(identityMatches({ MediaContainer: { machineIdentifier: 'abc' } }, res), true);
  assert.equal(identityMatches({ MediaContainer: { machineIdentifier: 'zzz' } }, res), false);
  assert.equal(identityMatches({}, res), true);
  assert.equal(identityMatches({ MediaContainer: { machineIdentifier: 'zzz' } }, {}), true);
});
