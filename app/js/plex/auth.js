// plex.tv sign-in (PIN / plex.tv/link) and server discovery.
import { request, clientId, PRODUCT, query } from './client.js';
import { log, warn } from '../util/log.js';

const TV = 'https://plex.tv/api/v2';

export async function createPin() {
  // Non-strong PINs are the 4-character codes plex.tv/link accepts.
  return request(TV + '/pins', { method: 'POST', params: { strong: 'false' } });
}

export async function checkPin(id) {
  const pin = await request(TV + '/pins/' + id);
  return pin.authToken || null;
}

// Link that signs this device in from a phone, encoded in the login QR code.
export function authAppUrl(code) {
  return 'https://app.plex.tv/auth#?' + query({
    clientID: clientId,
    code,
    'context[device][product]': PRODUCT,
  });
}

export async function getUser(token) {
  return request(TV + '/user', { token });
}

// Plex Home: the household's profiles, and switching to one (with its PIN if
// it has one). Endpoints as used by github.com/GLinnik21/plx-native.
export async function homeUsers(token) {
  const data = await request(TV + '/home/users', { token });
  return (data && data.users) || [];
}

// Returns { authToken, uuid, title, thumb }; a wrong PIN is a 401.
export async function switchHomeUser(token, uuid, pin) {
  return request(TV + '/home/users/' + uuid + '/switch', { method: 'POST', token, params: pin ? { pin } : undefined });
}

export async function getServers(token) {
  const resources = await request(TV + '/resources', {
    token, params: { includeHttps: 1, includeRelay: 1, includeIPv6: 0 },
  });
  return resources.filter(r => (r.provides || '').indexOf('server') !== -1);
}

// /identity answers without checking the token, so a reply only counts when it
// comes from the server we asked for: another machine on this network can sit
// at the same private address as a friend's server.
export function identityMatches(reply, resource) {
  const want = resource && resource.clientIdentifier;
  const got = reply && reply.MediaContainer && reply.MediaContainer.machineIdentifier;
  return !want || !got || String(got) === String(want);
}

function probe(uri, resource, timeout) {
  const started = Date.now();
  return request(uri + '/identity', { token: resource.accessToken, timeout }).then(reply => {
    if (!identityMatches(reply, resource)) throw new Error('a different server answered at ' + uri);
    return { uri, ms: Date.now() - started };
  });
}

function flag(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

// Plain HTTP on the LAN is the fastest path on a TV CPU (no TLS), so try that
// first, then the plex.direct HTTPS URLs, then remote, then relay.
// Plex marks private addresses "local" even when they're on the owner's
// network, not ours. For a shared server that isn't on our network
// (publicAddressMatches), those would only time out, so they go after remote.
export function candidateUris(resource) {
  const conns = resource.connections || [];
  const local = conns.filter(c => flag(c.local) && !flag(c.relay));
  const remote = conns.filter(c => !flag(c.local) && !flag(c.relay));
  const relay = conns.filter(c => flag(c.relay));
  const nearby = flag(resource.owned) || flag(resource.publicAddressMatches);
  const localTiers = [];
  if (resource.httpsRequired !== true && !flag(resource.httpsRequired)) {
    localTiers.push(local.map(c => 'http://' + c.address + ':' + c.port));
  }
  localTiers.push(local.map(c => c.uri));
  const tiers = nearby
    ? localTiers.concat([remote.map(c => c.uri)])
    : [remote.map(c => c.uri)].concat(localTiers);
  tiers.push(relay.map(c => c.uri));
  return tiers.filter(t => t.length);
}

function firstSuccess(promises) {
  return new Promise((resolve, reject) => {
    let pending = promises.length;
    if (!pending) reject(new Error('no candidates'));
    promises.forEach(p => p.then(resolve, () => { if (--pending === 0) reject(new Error('all failed')); }));
  });
}

export async function connect(resource) {
  for (const tier of candidateUris(resource)) {
    try {
      const hit = await firstSuccess(tier.map(uri => probe(uri, resource, 4000)));
      log('connected to', resource.name, 'via', hit.uri, hit.ms + 'ms');
      return hit.uri;
    } catch (e) {
      warn('connection tier failed', tier.join(', '));
    }
  }
  throw new Error('Could not reach ' + resource.name);
}
