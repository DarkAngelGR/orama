// Poster / landscape tiles. A tile node is created once and re-filled as it is
// recycled; fill() only touches the DOM for fields that changed.
import { h, setText, show, setTransform, toggleClass } from '../util/dom.js';
import { load, prefetch } from './images.js';
import { session } from '../session.js';
import { progress, episodeLabel, episodeStatus, duration } from '../util/format.js';

export const KINDS = {
  poster: { w: 220, h: 330 },
  wide: { w: 400, h: 225 },
  grid: { w: 216, h: 324 },
  land: { w: 360, h: 202 },
  episode: { w: 384, h: 216 },
  person: { w: 176, h: 176 },
};

export function createTile(kind, { caption = false } = {}) {
  const size = KINDS[kind];
  const el = h('div', 'tile tile-' + kind);
  const frame = h('div', 'tile-frame', el);
  frame.style.width = size.w + 'px';
  frame.style.height = size.h + 'px';
  const img = h('img', 'tile-img', frame);
  const ph = h('div', 'tile-ph', frame);
  img.alt = '';
  const badge = h('div', 'tile-badge', frame);
  // Wide tiles (Continue Watching) say which episode and how much is left.
  const note = kind === 'wide' ? h('div', 'tile-note', frame) : null;
  const bar = h('div', 'tile-bar', frame);
  const fill = h('i', '', bar);
  let cap = null;
  let sub = null;
  if (caption) {
    cap = h('div', 'tile-cap', el);
    cap.style.width = size.w + 'px';
    sub = h('div', 'tile-sub', el);
    sub.style.width = size.w + 'px';
  }
  return { el, img, ph, badge, note, bar, fill, cap, sub, kind, size, item: null };
}

// "S3 · E4 · 18m left", "1h 12m left", or just "S3 · E4".
export function noteFor(item) {
  const parts = [];
  if (item.type === 'episode') parts.push(episodeLabel(item));
  if (item.viewOffset && item.duration > item.viewOffset) parts.push(duration(Math.max(60000, item.duration - item.viewOffset)) + ' left');
  return parts.join(' · ');
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function artFor(item, kind) {
  if (item.type === 'person') return item.thumb;
  if (kind === 'wide' || kind === 'episode') {
    if (item.type === 'episode') return item.thumb || item.art;
    return item.art || item.thumb;
  }
  if (item.type === 'episode') return item.grandparentThumb || item.parentThumb || item.thumb;
  if (item.type === 'season') return item.thumb || item.parentThumb;
  return item.thumb;
}

function titleFor(item, kind) {
  if (item.type === 'episode' && kind !== 'episode') return item.grandparentTitle || item.title;
  return item.title;
}

function subFor(item, kind) {
  if (item.note) return item.note;
  if (item.type === 'person') return item.role || '';
  if (item.type === 'episode') {
    return kind === 'episode' ? episodeLabel(item).replace(' · ', '') + '  ' + item.title
      : episodeLabel(item) + '  ' + item.title;
  }
  if (item.type === 'season') return item.leafCount ? item.leafCount + ' episodes' : '';
  return item.year || '';
}

// Warm the poster a tile of this kind would show for `item` (just off screen, about to scroll in).
export function prefetchTile(kind, item) {
  const server = session.server;
  const path = item && server && artFor(item, kind);
  if (path) prefetch(server.image(path, KINDS[kind].w, KINDS[kind].h));
}

function paintCaption(tile, item) {
  if (!tile.cap) return;
  const kind = tile.kind;
  if (kind === 'grid') {
    setText(tile.cap, item.title || '');
    const bits = [];
    if (item.year) bits.push(String(item.year));
    if (item.duration) bits.push(duration(item.duration));
    setText(tile.sub, bits.join(' · '));
    return;
  }
  if (kind === 'episode' && item.type === 'episode') {
    const n = item.index != null && item.index !== '' ? item.index + ' · ' + (item.title || '') : (item.title || '');
    setText(tile.cap, n);
    setText(tile.sub, episodeStatus(item));
    return;
  }
  if (kind === 'episode') {
    const mins = item.duration ? Math.round(item.duration / 60000) + 'm' : '';
    setText(tile.cap, item.title || item.extraLabel || '');
    setText(tile.sub, [item.extraLabel, mins].filter(Boolean).join('  ·  '));
    return;
  }
  setText(tile.cap, titleFor(item, kind));
  setText(tile.sub, subFor(item, kind));
}

export function fillTile(tile, item) {
  // Same item still refreshes the caption: the focused episode's one-line
  // summary is written onto the subtitle after this, and must not stick
  // once the tile is no longer current.
  if (tile.item === item) {
    if (item && tile.kind === 'episode') paintCaption(tile, item);
    return;
  }
  tile.item = item;
  if (!item) {
    load(tile.img, '');
    setText(tile.ph, '');
    show(tile.bar, false);
    show(tile.badge, false);
    if (tile.cap) { setText(tile.cap, ''); setText(tile.sub, ''); }
    if (tile.note) setText(tile.note, '');
    return;
  }
  const kind = tile.kind;
  const server = session.server;
  const path = artFor(item, kind);
  // The web layer is 1920x1080, so tile size is exactly the pixels we need.
  load(tile.img, server ? server.image(path, tile.size.w, tile.size.h) : '');
  setText(tile.ph, item.type === 'person' ? initials(item.title) : titleFor(item, kind));

  let p = progress(item);
  // Watched episode stills carry a full bar; the check moves into the subtitle.
  if (kind === 'episode' && item.type === 'episode' && item.viewCount && !item.viewOffset) p = 1;
  show(tile.bar, p > 0.01);
  if (p > 0.01) setTransform(tile.fill, 'scaleX(' + p.toFixed(3) + ')');
  if (tile.note) setText(tile.note, item.download || item.upcoming ? '' : noteFor(item));

  // Unwatched episode count on shows/seasons, check on watched items.
  let badge = '';
  if ((item.type === 'show' || item.type === 'season') && item.leafCount) {
    const left = item.leafCount - (item.viewedLeafCount || 0);
    badge = left > 0 ? String(left) : '✓';
  } else if (item.viewCount && !item.viewOffset && item.type !== 'show' && kind !== 'episode') {
    badge = '✓';
  }
  show(tile.badge, !!badge);
  setText(tile.badge, badge);
  toggleClass(tile.badge, 'done', badge === '✓');

  paintCaption(tile, item);
}
