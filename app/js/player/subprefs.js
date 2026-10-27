// How subtitles look (size, colour, background box) and per-file timing offsets.
// Style is a class on <html>, set once, so playback does no extra work.
import * as store from '../util/store.js';
import * as lang from '../util/lang.js';

export const SUB_SIZES = [
  { id: 's', label: 'Small' },
  { id: 'm', label: 'Medium' },
  { id: 'l', label: 'Large' },
  { id: 'xl', label: 'Huge' },
];

// Grey is easier on the eyes than bright white, especially on OLED.
export const SUB_COLORS = [
  { id: 'white', label: 'White' },
  { id: 'lgrey', label: 'Light grey' },
  { id: 'grey', label: 'Grey' },
  { id: 'yellow', label: 'Yellow' },
];

export function subColor() {
  const id = store.get('subColor', 'white');
  return SUB_COLORS.find(c => c.id === id) || SUB_COLORS[0];
}

export function cycleSubColor() {
  const i = SUB_COLORS.indexOf(subColor());
  const next = SUB_COLORS[(i + 1) % SUB_COLORS.length].id;
  store.set('subColor', next === 'white' ? undefined : next);
  applySubtitleStyle();
}

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
  const color = subColor().id;
  SUB_COLORS.forEach(c => root.classList.toggle('subs-c-' + c.id, c.id === color && c.id !== 'white'));
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

// Preferred subtitle language: 'auto' (whatever Plex selects, from your Plex
// account's language settings), 'off', or a language code like 'el'.
export const SUB_LANGS = [
  { id: 'auto', label: 'Plex\'s choice' },
  { id: 'el', label: 'Greek' },
  { id: 'en', label: 'English' },
  { id: 'off', label: 'Off' },
];

export function subLang() {
  const id = store.get('subLang', 'auto');
  return SUB_LANGS.find(l => l.id === id) || SUB_LANGS[0];
}

export function cycleSubLang() {
  const i = SUB_LANGS.indexOf(subLang());
  const next = SUB_LANGS[(i + 1) % SUB_LANGS.length].id;
  store.set('subLang', next === 'auto' ? undefined : next);
}

// "Signs & Songs" tracks (common in anime) only translate on-screen text and
// lyrics; "Full Subtitles (incl. Songs)" is the real thing.
export function isSigns(s) {
  const t = ((s && s.title) || '') + ' ' + ((s && s.displayTitle) || '');
  return /\bsigns?\b/i.test(t) || (/\bsongs?\b/i.test(t) && !/\bfull\b|dialog/i.test(t));
}

// The best track of a list: full dialogue first, then text before images.
export function bestSub(list) {
  const score = t => (t.forced || isSigns(t) ? 2 : 0) + (/pgs|vobsub|dvd|dvb/i.test(t.codec || '') ? 1 : 0);
  return list.slice().sort((a, b) => score(a) - score(b))[0] || null;
}

// A Signs & Songs pick swapped for the full track in the same language.
function fullTrack(texts, sub) {
  if (!sub || !isSigns(sub)) return sub;
  const want = lang.ofStream(sub);
  return bestSub(texts.filter(t => lang.ofStream(t) === want && !t.forced && !isSigns(t))) || sub;
}

// The subtitle to start with: `current` (Plex's pick) adjusted to the
// preference. Full subtitles beat forced-only and Signs & Songs ones; text
// beats images.
export function preferredSub(texts, current) {
  const pref = subLang().id;
  if (pref === 'auto') return fullTrack(texts, current);
  if (pref === 'off') return null;
  if (current && lang.ofStream(current) === pref && !current.forced && !isSigns(current)) return current;
  const same = texts.filter(t => lang.ofStream(t) === pref);
  if (!same.length) return fullTrack(texts, current);
  return bestSub(same);
}

// Anime in Japanese: Greek subtitles if there are any, else English (or the
// Subtitle language setting's pick first), full dialogue over signs-only.
export function animeSub(texts) {
  const pref = subLang().id;
  const order = (pref === 'el' || pref === 'en' ? [pref] : []).concat(['el', 'en']);
  for (const code of order) {
    const pick = bestSub(texts.filter(t => lang.ofStream(t) === code));
    if (pick) return pick;
  }
  return null;
}
