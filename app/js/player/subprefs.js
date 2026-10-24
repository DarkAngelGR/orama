// How subtitles look (size, background box) and per-file timing offsets.
// Style is a class on <html>, set once, so playback does no extra work.
import * as store from '../util/store.js';

export const SUB_SIZES = [
  { id: 's', label: 'Small' },
  { id: 'm', label: 'Medium' },
  { id: 'l', label: 'Large' },
];

export function subSize() {
  const id = store.get('subSize', 'm');
  return SUB_SIZES.find(s => s.id === id) || SUB_SIZES[1];
}

export function subBackground() {
  return !!store.get('subBg', false);
}

export function applySubtitleStyle() {
  const root = document.documentElement;
  const size = subSize().id;
  SUB_SIZES.forEach(s => root.classList.toggle('subs-' + s.id, s.id === size));
  root.classList.toggle('subs-bg', subBackground());
}

export function cycleSubSize() {
  const i = SUB_SIZES.indexOf(subSize());
  store.set('subSize', SUB_SIZES[(i + 1) % SUB_SIZES.length].id);
  applySubtitleStyle();
}

export function toggleSubBackground() {
  store.set('subBg', subBackground() ? undefined : true);
  applySubtitleStyle();
}

// Timing offsets for external subtitle files, keyed by Plex stream id, so a
// fixed .srt stays fixed next time. Positive = subtitles appear later.
const MAX_OFFSETS = 50;

export function subOffset(streamId) {
  const all = store.get('subOffsets', {});
  return (all && all[streamId]) || 0;
}

export function setSubOffset(streamId, ms) {
  const all = store.get('subOffsets', {}) || {};
  delete all[streamId];
  if (ms) all[streamId] = ms;
  const keys = Object.keys(all);
  // Insertion order is oldest first; drop the oldest past the cap.
  keys.slice(0, Math.max(0, keys.length - MAX_OFFSETS)).forEach(k => delete all[k]);
  store.set('subOffsets', keys.length ? all : undefined);
}

export function offsetLabel(ms) {
  if (!ms) return '0.00 s';
  return (ms > 0 ? '+' : '−') + (Math.abs(ms) / 1000).toFixed(2) + ' s' + (ms > 0 ? ' (later)' : ' (earlier)');
}
