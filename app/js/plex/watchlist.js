// Talks to watchlist-sync (github.com/DarkAngelGR/watchlist-sync), which sends
// what's on your Plex Watchlist to Sonarr/Radarr. Orama only asks it to
// sync right after you add something; its Sonarr/Radarr keys stay on the
// server. The TV needs its address, found automatically when it runs on the
// same machine as Plex.
import * as store from '../util/store.js';
import { session } from '../session.js';

export const DEFAULT_PORT = 8789;

// 'auto' (Plex server's host, port 8789), 'off', or a saved address.
export function mode() {
  return store.get('wsMode', 'auto');
}

export function setMode(m) {
  store.set('wsMode', m === 'auto' ? undefined : m);
}

export function manualUrl() {
  return store.get('wsUrl', '');
}

export function setManualUrl(url) {
  let u = (url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
  if (u && !/:\d+$/.test(u.replace(/^https?:\/\//i, ''))) u += ':' + DEFAULT_PORT;
  store.set('wsUrl', u || undefined);
  if (u) setMode('manual');
  else if (mode() === 'manual') setMode('auto');
}

export function password() {
  return store.get('wsPassword', '');
}

export function setPassword(pw) {
  store.set('wsPassword', pw || undefined);
}

// The LAN host Plex is reached at. plex.direct names encode the IP
// ("192-168-1-10.<hash>.plex.direct"); relay/remote hosts don't count.
export function plexLanHost() {
  const uri = session.server && session.server.uri;
  if (!uri) return '';
  let host;
  try { host = new URL(uri).hostname; } catch (e) { return ''; }
  const direct = /^(\d{1,3}(?:-\d{1,3}){3})\..*\.plex\.direct$/i.exec(host);
  if (direct) host = direct[1].replace(/-/g, '.');
  const private4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/;
  return private4.test(host) || host === 'localhost' ? host : '';
}

export function baseUrl() {
  const m = mode();
  if (m === 'off') return '';
  if (m === 'manual') return manualUrl();
  const host = plexLanHost();
  return host ? 'http://' + host + ':' + DEFAULT_PORT : '';
}

export class WatchlistError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 0;
  }
}

async function call(path, { method = 'GET', body, timeout = 8000 } = {}) {
  const base = baseUrl();
  if (!base) throw new WatchlistError('watchlist-sync is off', 0);
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const pw = password();
  if (pw) headers.Authorization = 'Basic ' + btoa('flexplex:' + pw);
  // A Plex/Jellyfin playback token must never be sent to an HTTP NAS API.
  // These paths are the only ones permitted to receive it over HTTPS.
  if (/^https:\/\//i.test(base) && session.token &&
      (path.startsWith('/api/tv/discover') || path.startsWith('/api/tv/ai/') ||
       path === '/api/tv/feedback')) {
    headers['X-Orama-Profile-Token'] = session.token;
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
  let res;
  try {
    res = await fetch(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new WatchlistError('watchlist-sync didn\'t answer in time', 0);
    throw new WatchlistError('Can\'t reach watchlist-sync at ' + base.replace(/^https?:\/\//, ''), 0);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new WatchlistError('watchlist-sync needs its password (Settings › Downloads)', 401);
  // An older watchlist-sync without the TV endpoints answers 404.
  if (res.status === 404) throw new WatchlistError('watchlist-sync is out of date: update it on the server', 404);
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty or not JSON */ }
  if (!res.ok) throw new WatchlistError(data.error || ('watchlist-sync answered ' + res.status), res.status);
  return data;
}

// { product, radarr, sonarr, radarr_ok, sonarr_ok, dry_run, signed_in }
export async function info() {
  const data = await call('/api/tv', { timeout: 10000 }); // it pings Sonarr/Radarr (3 s each)
  if (data.product !== 'watchlist-sync') throw new WatchlistError('That address isn\'t watchlist-sync', 0);
  return data;
}

// Ask watchlist-sync to sync now, so a title just added to the Plex Watchlist
// reaches Sonarr/Radarr in seconds instead of on its next cycle.
export async function syncNow() {
  return call('/api/tv/sync', { method: 'POST', body: {}, timeout: 6000 });
}

// What Sonarr/Radarr are downloading, per movie/series: { items: [{ kind,
// title, year, tmdb, tvdb, imdb, poster, progress, status, timeleft, detail }] }.
// null when this watchlist-sync is too old to say.
export async function queue() {
  try {
    return await call('/api/tv/queue', { timeout: 10000 });
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// The Radarr collection a movie belongs to: { title, tmdb, movies: [{ tmdb,
// title, year, poster, inRadarr, hasFile, monitored }] }, or null.
export async function collection(tmdb) {
  try {
    const r = await call('/api/tv/collection?tmdb=' + encodeURIComponent(tmdb), { timeout: 15000 });
    return r.collection || null;
  } catch (e) {
    if (e.status === 404) return null; // older watchlist-sync
    throw e;
  }
}

// Delete a movie from Radarr or a show from Sonarr, files included. Returns
// { service, configured, found, deleted, dry_run }. Throws (status 404) when
// this watchlist-sync is too old to delete.
export async function deleteTitle({ kind, tmdb, tvdb, imdb, title }) {
  return call('/api/tv/delete', { method: 'POST', body: { kind, tmdb, tvdb, imdb, title }, timeout: 90000 });
}

// Subtitle search through Bazarr. params: { kind: 'movie'|'episode', tmdb,
// tvdb (the show's), imdb, season, episode, lang }. Returns { token, results:
// [{ provider, language, hi, forced, score (0-100), release, uploader }] }.
// Bazarr searches every provider, which can take a minute.
export async function searchSubtitles(params) {
  const q = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== '')
    .map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  return call('/api/tv/subtitles?' + q, { timeout: 160000 });
}

export async function downloadSubtitle(token, index) {
  return call('/api/tv/subtitles/download', { method: 'POST', body: { token, index }, timeout: 160000 });
}

// Episodes airing in the next `days` days that aren't downloaded yet:
// { items: [{ show, year, tvdb, imdb, season, episode, title, overview, air, poster, fanart }] },
// or null when this watchlist-sync is too old to say.
export async function upcoming(days = 7) {
  try {
    return await call('/api/tv/upcoming?days=' + days, { timeout: 15000 });
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// --- Finding and requesting titles (Jellyfin has no Watchlist) ----------------

// Movies (Radarr) or shows (Sonarr) matching `q`, or the one with this TMDB
// (movie) / TVDB (show) id, as catalog items the screens already show. Each
// has arrStatus: 'have' | 'requested' | 'none'. null when this watchlist-sync
// is too old to search.
export async function lookup(kind, { q, id } = {}) {
  const query = 'kind=' + kind + (id ? '&id=' + encodeURIComponent(id) : '&q=' + encodeURIComponent(q || ''));
  try {
    const r = await call('/api/tv/lookup?' + query, { timeout: 15000 });
    return (r.items || []).map(toCatalog);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export function toCatalog(x) {
  const ext = x.kind === 'movie' ? x.tmdb : x.tvdb;
  const Guid = [];
  if (x.tmdb) Guid.push({ id: 'tmdb://' + x.tmdb });
  if (x.tvdb) Guid.push({ id: 'tvdb://' + x.tvdb });
  if (x.imdb) Guid.push({ id: 'imdb://' + x.imdb });
  const mapped = {
    catalog: true, arr: true, ratingKey: x.kind + ':' + ext, type: x.kind, title: x.title, year: x.year || undefined,
    summary: x.overview || '', thumb: x.poster || '', art: x.fanart || '', Guid,
    Genre: (x.genres || []).map(tag => ({ tag })), studio: x.network || '', contentRating: x.certification || '',
    duration: x.runtime ? x.runtime * 60000 : undefined,
    audienceRating: x.rating ? Math.round(x.rating * 10) / 10 : undefined,
    audienceRatingImage: x.rating ? 'themoviedb://image.rating' : undefined,
    tmdb: x.tmdb || 0, tvdb: x.tvdb || 0, imdb: x.imdb || '', arrStatus: x.status || 'none',
  };
  if (typeof x.ai_reason === 'string' && x.ai_reason) mapped.aiReason = x.ai_reason.slice(0, 120);
  return mapped;
}

export const MOODS = [
  { id: 'any', label: 'Any mood' },
  { id: 'relaxing', label: 'Something relaxing' },
  { id: 'mind_bending', label: 'Mind-bending' },
  { id: 'intense', label: 'Something intense' },
  { id: 'short', label: 'Short movie' },
  { id: 'surprise', label: 'Surprise me' },
];

export function mood() {
  const uuid = session.user && session.user.uuid ? session.user.uuid : 'default';
  const saved = store.get('aiMood:' + uuid, 'any');
  return MOODS.some(m => m.id === saved) ? saved : 'any';
}

export function moodLabel() {
  const current = mood();
  return MOODS.find(m => m.id === current).label;
}

export function cycleMood() {
  const current = MOODS.findIndex(m => m.id === mood());
  const next = MOODS[(current + 1) % MOODS.length].id;
  const uuid = session.user && session.user.uuid ? session.user.uuid : 'default';
  store.set('aiMood:' + uuid, next === 'any' ? undefined : next);
  discoveryEpoch++;
}

function profileId() {
  return session.user && session.user.uuid ? String(session.user.uuid) : '';
}

let discoveryEpoch = 0;
export function recommendationEpoch() { return discoveryEpoch; }

// The exploration slider is intentionally simple for the TV remote.
export function diversity() {
  const v = Number(store.get('aiDiversity', 35));
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 35;
}

export function cycleDiversity() {
  const steps = [0, 25, 50, 75, 100];
  const at = steps.indexOf(diversity());
  store.set('aiDiversity', steps[(at + 1) % steps.length]);
  discoveryEpoch++;
}

// Titles you don't have yet. The active Orama profile is passed as a hint
// for the NAS allowlist; this is not a substitute for HTTP authentication.
export async function discover() {
  try {
    const who = profileId();
    const query = '?viewer=' + encodeURIComponent(who) + '&diversity=' + diversity() + '&mood=' + mood();
    const r = await call('/api/tv/discover' + query, { timeout: 30000 });
    return (r.sections || []).map(s => ({ id: s.id, title: s.title, items: (s.items || []).map(toCatalog) }));
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

// Send explicit taste feedback. A new watchlist-sync is required; never
// use personal profile tokens for this service-to-service request.
export async function feedback(item, action) {
  const kind = item && item.type === 'show' ? 'show' : 'movie';
  const id = kind === 'show' ? Number(item && item.tvdb) : Number(item && item.tmdb);
  const viewer = session.user && session.user.uuid ? String(session.user.uuid) : '';
  if (!viewer || !Number.isInteger(id) || id <= 0) throw new WatchlistError('No recommendation ID for this title', 400);
  if (!['more', 'less', 'hide', 'clear'].includes(action)) throw new WatchlistError('Unknown feedback action', 400);
  const response = await call('/api/tv/feedback', {
    method: 'POST', body: { viewer, kind, id, action }, timeout: 10000,
  });
  discoveryEpoch++;
  return response;
}

// Search descriptions are ranked locally; only the optional service sees them.
export async function aiSearch(q) {
  const term = String(q || '').trim().slice(0, 180);
  if (term.length < 3 || !baseUrl()) return [];
  const query = '?viewer=' + encodeURIComponent(profileId()) + '&q=' + encodeURIComponent(term) +
    '&diversity=' + diversity() + '&mood=' + mood();
  try {
    const response = await call('/api/tv/ai/search' + query, { timeout: 18000 });
    if (!response.available) return [];
    return (response.items || []).map(item => Object.assign(toCatalog(item), { recommendationSource: 'ai-search' }));
  } catch (e) {
    if (e.status === 403 || e.status === 404) return [];
    throw e;
  }
}

export async function aiStats() {
  const query = '?viewer=' + encodeURIComponent(profileId());
  return call('/api/tv/ai/stats' + query, { timeout: 10000 });
}

// Metrics are aggregated on the mini PC; events do not include item IDs,
// playback tokens or natural-language search text.
export async function aiEvent(event, source, count = 1) {
  if (!['served', 'open', 'request'].includes(event) ||
      !['recommended', 'hidden-gems', 'trending', 'popular', 'ai-search'].includes(source) ||
      !Number.isInteger(count) || count < 1 || count > 120) return;
  return call('/api/tv/ai/event', {
    method: 'POST', body: { viewer: profileId(), event, source, count }, timeout: 5000,
  });
}

export function discoverEnabled() {
  return store.get('discoverRows') !== false;
}

export function setDiscoverEnabled(on) {
  store.set('discoverRows', on ? undefined : false);
}

// Add it to Radarr/Sonarr. { ok, status: 'added' | 'already-there' | 'dry-run', service }.
export async function requestTitle(item, user) {
  const body = { kind: item.type === 'show' ? 'show' : 'movie', user: user || '' };
  if (body.kind === 'movie') body.tmdb = item.tmdb; else body.tvdb = item.tvdb;
  return call('/api/tv/request', { method: 'POST', body, timeout: 60000 });
}
