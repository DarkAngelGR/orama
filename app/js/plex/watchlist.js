// Talks to watchlist-sync (github.com/DarkAngelGR/watchlist-sync), which can
// suggest movies you don't have (Radarr's Discover list) and add one to Radarr
// on request. Its Sonarr/Radarr keys stay on the server; the TV only needs its
// address, found automatically when it runs on the same machine as Plex.
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
// ("192-168-178-30.<hash>.plex.direct"); relay/remote hosts don't count.
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

// { product, radarr, sonarr, dry_run }
export async function info() {
  const data = await call('/api/tv', { timeout: 4000 });
  if (data.product !== 'watchlist-sync') throw new WatchlistError('That address isn\'t watchlist-sync', 0);
  return data;
}

// Movies you don't have, shaped like Plex metadata so plex/taste.js can score
// them alongside your library.
export async function suggestions() {
  const data = await call('/api/tv/suggestions', { timeout: 45000 });
  return {
    dryRun: !!data.dry_run,
    items: (data.movies || []).map(m => ({
      ratingKey: 'tmdb:' + m.tmdbId,
      tmdbId: m.tmdbId,
      external: true,
      type: 'movie',
      title: m.title,
      year: m.year || undefined,
      Genre: (m.genres || []).map(tag => ({ tag })),
      audienceRating: m.rating || undefined,
      duration: m.runtime ? m.runtime * 60000 : undefined,
      contentRating: m.certification || undefined,
      summary: m.overview || '',
      thumbUrl: m.poster || '',
      artUrl: m.backdrop || '',
    })),
  };
}

// { ok, status: 'added' | 'already-present' | 'already-requested' | 'dry-run', title }
export function requestMovie(tmdbId, title) {
  return call('/api/tv/request', { method: 'POST', body: { tmdbId, title }, timeout: 30000 });
}
