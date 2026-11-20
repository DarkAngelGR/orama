// A download left the queue, then the same title showed up in the library.
// Home decides when to look; this only compares the two lists.
import { matchMedia } from './availability.js';

function norm(t) {
  return String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9\u0370-\u03ff]+/g, '');
}

// Stable id for one queue row. Empty when there is nothing to recognise it by.
export function queueId(d) {
  if (!d) return '';
  const kind = d.kind === 'show' ? 'show' : 'movie';
  const id = kind === 'show' ? (d.tvdb || d.tmdb || d.imdb) : (d.tmdb || d.imdb || d.tvdb);
  if (id) return kind + ':' + String(id).toLowerCase();
  const title = norm(d.title);
  if (!title) return '';
  return kind + ':' + title + ':' + (d.year || '');
}

// Rows that were in the queue and are not in the next poll.
export function leftQueue(before, after) {
  const now = new Set((after || []).map(queueId));
  return (before || []).filter(d => {
    const id = queueId(d);
    return id && !now.has(id);
  });
}

function recentlyAdded(hubs) {
  const out = [];
  (hubs || []).forEach(h => {
    if (/recentlyadded/i.test(h.hubIdentifier || '')) (h.Metadata || []).forEach(it => out.push(it));
  });
  return out;
}

// A show download can land as the series or as a new episode of it.
function asCandidate(download, item) {
  const want = download.kind === 'show' ? 'show' : 'movie';
  if (want === 'show' && item.type === 'episode') {
    return { type: 'show', kind: 'show', title: item.grandparentTitle || '' };
  }
  if (want === 'show' && item.type === 'season') {
    return { type: 'show', kind: 'show', title: item.parentTitle || item.title || '' };
  }
  if ((item.type === 'show' ? 'show' : item.type === 'movie' ? 'movie' : '') !== want) return null;
  return item;
}

export function matchesReady(download, item) {
  const candidate = download && item && asCandidate(download, item);
  if (!candidate) return false;
  const hit = matchMedia(candidate, download);
  if (hit === true) return true;
  if (hit === false) return false;
  const a = norm(candidate.title);
  const b = norm(download.title);
  if (!a || a !== b) return false;
  if (candidate.year && download.year && Math.abs(candidate.year - download.year) > 1) return false;
  return true;
}

// One library item per download, taken from Recently Added rows.
export function findReady(departed, hubs) {
  const items = recentlyAdded(hubs);
  const used = new Set();
  const found = [];
  (departed || []).forEach(d => {
    const item = items.find(it => !used.has(it) && matchesReady(d, it));
    if (!item) return;
    used.add(item);
    found.push({ download: d, item });
  });
  return found;
}

// Move matches to the front of their Recently Added row. With no such row,
// they become a Just added row.
export function placeReady(hubs, items) {
  const pins = (items || []).filter(it => it && it.ratingKey);
  const list = hubs || [];
  if (!pins.length) return list;
  const keys = new Set(pins.map(it => it.ratingKey));
  let placed = false;
  const next = list.map(hb => {
    if (!/recentlyadded/i.test(hb.hubIdentifier || '')) return hb;
    const meta = hb.Metadata || [];
    const front = pins.filter(it => meta.some(m => m.ratingKey === it.ratingKey));
    if (!front.length) return hb;
    placed = true;
    const rest = meta.filter(m => !keys.has(m.ratingKey));
    return Object.assign({}, hb, { Metadata: front.concat(rest), size: front.length + rest.length });
  });
  if (placed || list.some(h => /recentlyadded/i.test(h.hubIdentifier || ''))) return next;
  return [{ hubIdentifier: 'orama.justadded', title: 'Just added', type: 'mixed', size: pins.length, Metadata: pins }].concat(next);
}

// Jellyfin /socket: the library gained or lost items. Playback updates are not that.
export function jellyfinLibraryEvent(msg) {
  if (!msg || msg.MessageType !== 'LibraryChanged') return false;
  const d = msg.Data || {};
  return (Array.isArray(d.ItemsAdded) && d.ItemsAdded.length > 0) ||
    (Array.isArray(d.ItemsRemoved) && d.ItemsRemoved.length > 0);
}
