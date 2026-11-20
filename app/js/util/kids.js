// Kids mode for this TV. The PIN is stored as a salted hash. Titles above the
// chosen rating are hidden, and so are unrated titles outside the libraries
// marked as kids libraries. Server queries get a rating param when that is
// cheap; every list is filtered here as well.
import * as store from './store.js';

const KEY = 'kids';

export const LEVELS = [
  { id: 'g', label: 'G / TV-Y', age: 0, jellyfin: 'G' },
  { id: 'pg', label: 'PG / TV-Y7', age: 7, jellyfin: 'PG' },
  { id: 'pg13', label: 'PG-13 / TV-PG', age: 13, jellyfin: 'PG-13' },
  { id: 'tv14', label: 'TV-14', age: 16, jellyfin: 'TV-14' },
];

// Ratings at or below each step, as Plex usually stores them.
const PLEX_STEP = {
  g: ['G', 'TV-Y', 'TV-G'],
  pg: ['PG', 'TV-Y7', 'TV-Y7-FV'],
  pg13: ['PG-13', 'TV-PG'],
  tv14: ['TV-14'],
};

// Ages after norm(): hyphens, spaces and "+" removed, "TV" kept as "TV-".
const AGES = {
  G: 0, TVY: 0, 'TV-Y': 0, TVG: 0, 'TV-G': 0, U: 0, '0': 0,
  APPROVED: 0, PASSED: 0, ALL: 0, ALLAGES: 0,
  FSK0: 0, AB0: 0, OHNEALTERSBESCHRANKUNG: 0, K: 0,
  PG: 7, TVY7: 7, 'TV-Y7': 7, TVY7FV: 7, 'TV-Y7FV': 7, GP: 7, MPG: 7,
  '6': 6, FSK6: 6, AB6: 6,
  PG13: 13, 'PG-13': 13, TVPG: 13, 'TV-PG': 13,
  '12': 12, '12A': 12, FSK12: 12, AB12: 12, K8: 8, K12: 12, K13: 13,
  TV14: 16, 'TV-14': 16, '14': 14, '15': 15, '16': 16, MA15: 15, M: 15,
  FSK16: 16, AB16: 16, K15: 15, K16: 16,
  R: 17, TVMA: 18, 'TV-MA': 18, NC17: 18, X: 18, XXX: 18, '18': 18, R18: 18,
  FSK18: 18, AB18: 18, K17: 17, K18: 18,
};

export function levelById(id) {
  return LEVELS.find(l => l.id === id) || LEVELS[0];
}

function norm(raw) {
  let s = String(raw == null ? '' : raw).trim().toUpperCase();
  if (!s) return '';
  s = s.replace(/Κ/g, 'K').replace(/Ä/g, 'A').replace(/Ö/g, 'O').replace(/Ü/g, 'U');
  s = s.replace(/[\s.+/-]+/g, '');
  if (/^(NR|NOTRATED|UNRATED|UR|NA|NONE|NULL)$/.test(s)) return '';
  return s.replace(/^TV(?=[A-Z])/, 'TV-');
}

// Null when the title has no rating. An unknown rating is 99, so it stays hidden.
export function ratingAge(raw) {
  const s = norm(raw);
  if (!s) return null;
  return Object.prototype.hasOwnProperty.call(AGES, s) ? AGES[s] : 99;
}

export function read() {
  const s = store.get(KEY, {}) || {};
  return {
    on: !!s.on,
    level: levelById(s.level).id,
    salt: s.salt || '',
    hash: s.hash || '',
    libraries: Array.isArray(s.libraries) ? s.libraries.map(String) : [],
  };
}

function write(state) {
  store.set(KEY, {
    on: !!state.on, level: levelById(state.level).id,
    salt: state.salt || '', hash: state.hash || '',
    libraries: state.libraries || [],
  });
}

export function enabled() {
  return read().on;
}

export function setLevel(id) {
  const state = read();
  state.level = levelById(id).id;
  write(state);
}

export function setOn(on) {
  const state = read();
  state.on = !!on;
  write(state);
}

// Returns whether this library is now marked.
export function toggleLibrary(id) {
  const state = read();
  const key = String(id);
  const at = state.libraries.indexOf(key);
  if (at >= 0) state.libraries.splice(at, 1);
  else state.libraries.push(key);
  write(state);
  return state.libraries.indexOf(key) >= 0;
}

function hex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

export async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(String(salt) + '\n' + String(pin));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return hex(digest);
}

export async function pinMatches(pin, state) {
  const saved = state || read();
  if (!saved.salt || !saved.hash || !/^\d{4}$/.test(String(pin || ''))) return false;
  const got = await hashPin(pin, saved.salt);
  if (got.length !== saved.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ saved.hash.charCodeAt(i);
  return diff === 0;
}

export async function savePin(pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) throw new Error('PIN must be 4 digits');
  const state = read();
  state.salt = newSalt();
  state.hash = await hashPin(pin, state.salt);
  write(state);
}

// A sync-group tile has no title yet; playback checks the real item.
export function allows(item, state, libraryId) {
  if (!state || !state.on || !item) return true;
  if (item.syncplay && String(item.ratingKey || '').indexOf('sync-') === 0) return true;
  const age = ratingAge(item.contentRating);
  if (age == null) {
    if (item.type === 'clip' || item.extraType) return true;
    const lib = libraryId != null && libraryId !== '' ? libraryId : item.librarySectionID;
    if (lib == null || lib === '') return false;
    return (state.libraries || []).map(String).indexOf(String(lib)) >= 0;
  }
  return age <= levelById(state.level).age;
}

export function visibleItems(items, state, libraryId) {
  if (!state || !state.on) return items || [];
  return (items || []).filter(it => allows(it, state, libraryId));
}

export function filterItems(items, libraryId) {
  return visibleItems(items, read(), libraryId);
}

export function filterHubs(hubs) {
  const state = read();
  if (!state.on) return hubs;
  const out = [];
  for (const hb of hubs || []) {
    const items = visibleItems(hb.Metadata, state);
    if (items.length) out.push(Object.assign({}, hb, { Metadata: items, size: items.length }));
  }
  return out;
}

export function playbackBlocked(item) {
  return enabled() && !allows(item, read());
}

// Params for a library listing. Null when kids mode is off.
export function listingFilter(kind) {
  const state = read();
  if (!state.on) return null;
  const level = levelById(state.level);
  if (kind === 'jellyfin') return { MaxOfficialRating: level.jellyfin };
  const ratings = [];
  for (const step of LEVELS) {
    ratings.push.apply(ratings, PLEX_STEP[step.id] || []);
    if (step.id === level.id) break;
  }
  return { contentRating: ratings.join(',') };
}
