// Download progress for titles on their way to the library, from watchlist-sync
// (which asks Sonarr/Radarr). Polls only while something is subscribed and
// watchlist-sync is set up.
import * as watchlist from './watchlist.js';
import { warn } from '../util/log.js';

const POLL_MS = 10000;
const listeners = new Set();
let timer = 0;
let items = [];
let key = '';

export function current() {
  return items;
}

function emit() {
  listeners.forEach(fn => { try { fn(items); } catch (e) { warn('downloads listener failed', e.message); } });
}

async function poll() {
  if (!watchlist.baseUrl()) { set([]); return; }
  try {
    const q = await watchlist.queue();
    set(q && q.items ? q.items : []);
  } catch (e) {
    // Unreachable for a moment: keep showing the last known state.
  }
}

function set(list) {
  const k = JSON.stringify(list.map(d => [d.kind, d.tmdb, d.tvdb, d.status, Math.floor(d.progress || 0), d.timeleft, d.detail]));
  if (k === key) return;
  key = k;
  items = list;
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  if (!timer) { poll(); timer = setInterval(poll, POLL_MS); }
  else fn(items);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) { clearInterval(timer); timer = 0; }
  };
}

// Does download d belong to this Plex catalog/library item? (by TMDB, TVDB or
// IMDb id from its Guid list, e.g. "tmdb://693134")
export function find(item) {
  if (!item) return null;
  const ids = {};
  (item.Guid || []).forEach(g => {
    const m = /^(tmdb|tvdb|imdb):\/\/(.+)$/.exec(g.id || '');
    if (m) ids[m[1]] = m[2];
  });
  const kind = item.type === 'show' ? 'show' : 'movie';
  return items.find(d => d.kind === kind && (
    (ids.tmdb && String(d.tmdb) === ids.tmdb) || (ids.tvdb && String(d.tvdb) === ids.tvdb) || (ids.imdb && d.imdb === ids.imdb)
  )) || null;
}

function eta(s) {
  if (s == null) return '';
  if (s < 60) return 'under a minute left';
  if (s < 3600) return Math.round(s / 60) + ' min left';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm left';
  const d = Math.round(s / 86400);
  return d + (d === 1 ? ' day left' : ' days left');
}

// "Downloading · 42% · 12 min left · S02E01"
export function describe(d) {
  const pct = Math.floor(d.progress || 0) + '%';
  const parts = {
    downloading: ['Downloading', pct, eta(d.timeleft)],
    importing: ['Finishing up', 'adding it to your library'],
    queued: ['Queued'],
    paused: ['Paused', pct],
    stalled: ['Stalled', pct],
    failed: ['Download failed'],
    searching: ['Looking for a download'],
  }[d.status] || [d.status];
  if (d.detail) parts.push(d.detail);
  return parts.filter(Boolean).join('  ·  ');
}

// A download as a tile for a home row: the progress bar is the tile's own
// (viewOffset / duration), the poster comes through Plex's transcoder.
export function asItem(d) {
  return {
    ratingKey: 'dl-' + d.kind + '-' + (d.tmdb || d.tvdb || d.title),
    type: d.kind === 'show' ? 'show' : 'movie',
    title: d.title, year: d.year, thumb: d.poster || '',
    viewOffset: d.status === 'downloading' || d.status === 'paused' || d.status === 'stalled' ? Math.max(1.5, d.progress || 0) : 0,
    duration: 100,
    download: d,
  };
}
