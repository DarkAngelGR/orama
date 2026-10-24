// Plex's own movie/TV catalog and the plex.tv Watchlist, for titles that
// aren't on your server. Account data, not server data: everything here goes
// to discover.provider.plex.tv with your plex.tv token.
//
// Endpoints as verified by github.com/GLinnik21/plx-native (docs/watchlist.md):
// GET /library/metadata/<id>, GET /library/metadata/<id>/userState,
// PUT /actions/addToWatchlist|removeFromWatchlist?ratingKey=<id>, where <id> is
// the 24-hex catalog id that also ends the item's plex:// guid. Search is the
// call python-plexapi's searchDiscover makes.
import { request } from './client.js';
import { session } from '../session.js';

export const DISCOVER = 'https://discover.provider.plex.tv';

function token() {
  return session.token;
}

const mc = data => (data && data.MediaContainer) || {};

// Movies and shows matching `query`, catalog-wide. Each item has the catalog
// id as ratingKey, a plex:// guid, title, year, type, and absolute poster URLs.
export async function search(query, { limit = 30 } = {}) {
  const data = await request(DISCOVER + '/library/search', {
    token: token(), timeout: 10000,
    params: { query, limit, searchTypes: 'movies,tv', searchProviders: 'discover', includeMetadata: 1 },
  });
  const groups = mc(data).SearchResults || [];
  const external = groups.find(g => g.id === 'external') || groups[0] || {};
  return (external.SearchResult || [])
    .map(r => r.Metadata)
    .filter(m => m && m.ratingKey && (m.type === 'movie' || m.type === 'show'))
    .map(m => Object.assign({}, m, { catalog: true }));
}

// The full record: summary, genres, ratings, cast, art.
export async function item(id) {
  const data = await request(DISCOVER + '/library/metadata/' + id, { token: token(), timeout: 10000 });
  const m = (mc(data).Metadata || [])[0];
  return m ? Object.assign({}, m, { catalog: true }) : null;
}

// Is it on the Watchlist? `UserState` is an array on discover (an object on
// metadata.provider); `watchlistedAt` is there only while it's listed.
export async function onWatchlist(id) {
  const data = await request(DISCOVER + '/library/metadata/' + id + '/userState', { token: token(), timeout: 8000 });
  const st = mc(data).UserState;
  const s = Array.isArray(st) ? st[0] : st;
  return !!(s && s.watchlistedAt);
}

// Both are idempotent, body-less PUTs.
export function addToWatchlist(id) {
  return request(DISCOVER + '/actions/addToWatchlist', { method: 'PUT', token: token(), params: { ratingKey: id }, timeout: 10000, raw: true });
}

export function removeFromWatchlist(id) {
  return request(DISCOVER + '/actions/removeFromWatchlist', { method: 'PUT', token: token(), params: { ratingKey: id }, timeout: 10000, raw: true });
}
