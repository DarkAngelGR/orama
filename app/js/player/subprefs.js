// How subtitles look (size, colour, background box) and per-file timing offsets.
// Style is a class on <html>, set once, so playback does no extra work.
// Default audio and subtitle languages are per profile. A profile with none
// yet takes them from the Plex or Jellyfin account; changing them here writes
// them back. Per-show picks stay in tracks.js.
import * as store from '../util/store.js';
import * as lang from '../util/lang.js';
import { session, isJellyfin } from '../session.js';
import { request } from '../plex/client.js';
import {
  readPlexLang, localFromPlex, plexProfileUrl, readJellyfinLang, localFromJellyfin, jellyfinConfigWithLang,
} from '../plex/accountlang.js';

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

const NAMES = {
  el: 'Greek', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
  sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', tr: 'Turkish',
  ar: 'Arabic', he: 'Hebrew',
};

export function languageLabel(code) {
  if (!code || code === 'auto') return 'Auto';
  if (code === 'off') return 'Off';
  const k = lang.key(code);
  return NAMES[k] || k.toUpperCase();
}

function profileId() {
  const u = session.user;
  return (u && (u.uuid || u.id)) || '';
}

function langRows() {
  return store.get('langByProfile', {}) || {};
}

export function subLangId() {
  const all = langRows();
  const row = profileId() && all[profileId()];
  if (row && row.sub) return row.sub;
  if (!Object.keys(all).length) return store.get('subLang', 'auto');
  return 'auto';
}

export function audioLangId() {
  const row = profileId() && langRows()[profileId()];
  return (row && row.audio) || 'auto';
}

// null when this profile is not overriding the file's audio.
export function audioPref() {
  const row = profileId() && langRows()[profileId()];
  if (!row || !row.audio || row.audio === 'auto') return null;
  return { code: lang.key(row.audio), explicit: !!row.explicit };
}

function withCurrent(list, id) {
  if (id && !list.some(x => x.id === id)) return list.concat([{ id, label: languageLabel(id) }]);
  return list;
}

export function subChoices() {
  return withCurrent(SUB_LANGS, subLangId());
}

export function audioChoices() {
  return withCurrent([
    { id: 'auto', label: 'Auto' },
    { id: 'el', label: 'Greek' },
    { id: 'en', label: 'English' },
  ], audioLangId());
}

function asOption(id, list) {
  return list.find(l => l.id === id) || { id: id || 'auto', label: languageLabel(id) };
}

export function subLang() {
  return asOption(subLangId(), subChoices());
}

export function audioLang() {
  return asOption(audioLangId(), audioChoices());
}

function writeLang(partial) {
  const id = profileId() || 'local';
  const all = langRows();
  const prev = all[id] || { audio: audioLangId(), sub: subLangId() };
  const next = { audio: prev.audio || 'auto', sub: prev.sub || 'auto', explicit: true };
  if (partial.audio) next.audio = partial.audio;
  if (partial.sub) next.sub = partial.sub;
  all[id] = next;
  store.set('langByProfile', all);
  if (partial.sub) store.set('subLang', next.sub === 'auto' ? undefined : next.sub);
}

export function cycleSubLang() {
  const list = subChoices();
  const i = Math.max(0, list.findIndex(l => l.id === subLangId()));
  writeLang({ sub: list[(i + 1) % list.length].id });
  publishAccountLanguages();
}

export function cycleAudioLang() {
  const list = audioChoices();
  const i = Math.max(0, list.findIndex(l => l.id === audioLangId()));
  writeLang({ audio: list[(i + 1) % list.length].id });
  publishAccountLanguages();
}

// A subtitle language chosen before prefs were per profile belongs to the
// profile signed in now, and counts as an explicit choice.
function migrateLegacy(id) {
  const all = langRows();
  if (all[id] || Object.keys(all).length) return;
  const legacy = store.get('subLang');
  if (!legacy) return;
  all[id] = { audio: 'auto', sub: legacy, explicit: true };
  store.set('langByProfile', all);
}

async function fetchPlex(token) {
  let user;
  try {
    user = await request('https://clients.plex.tv/api/v2/user', { token });
  } catch (e) {
    user = await request('https://plex.tv/api/v2/user', { token });
  }
  return localFromPlex(readPlexLang(user));
}

async function fetchJellyfin() {
  const server = session.server;
  if (!server || !server.userId || !server.req) return null;
  const user = await server.req('/Users/' + encodeURIComponent(server.userId));
  return localFromJellyfin(readJellyfinLang(user));
}

// Fire-and-forget. A profile that already has prefs (set here, or adopted
// once) is left alone, including per-show picks, which are a different store.
export function adoptAccountLanguages() {
  const id = profileId();
  if (!id) return;
  migrateLegacy(id);
  if (langRows()[id]) return;
  const token = session.token;
  if (!token || token === 'lan-dev') return;
  const job = isJellyfin() ? fetchJellyfin() : fetchPlex(token);
  Promise.resolve(job).then(local => {
    if (!local) return;
    const all = langRows();
    if (all[id]) return;
    all[id] = { audio: local.audio || 'auto', sub: local.sub || 'auto', explicit: false };
    store.set('langByProfile', all);
  }).catch(() => {});
}

async function pushPlex(local) {
  const token = session.token;
  if (!token || token === 'lan-dev') return;
  const q = plexProfileUrl(local).split('?')[1];
  try {
    await request('https://clients.plex.tv/api/v2/user/profile?' + q, { method: 'PUT', token });
  } catch (e) {
    await request('https://plex.tv/api/v2/user/profile?' + q, { method: 'PUT', token });
  }
}

async function pushJellyfin(local) {
  const server = session.server;
  if (!server || !server.userId || !server.req) return;
  const user = await server.req('/Users/' + encodeURIComponent(server.userId));
  const next = jellyfinConfigWithLang(user && user.Configuration, local);
  if (!next) return;
  await server.req('/Users/' + encodeURIComponent(server.userId) + '/Configuration', { method: 'POST', body: next });
}

export function publishAccountLanguages() {
  const local = { audio: audioLangId(), sub: subLangId() };
  const job = isJellyfin() ? pushJellyfin(local) : pushPlex(local);
  Promise.resolve(job).catch(() => {});
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
