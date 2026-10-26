// Which audio and subtitle tracks to start with, shared by the detail page
// (what its pickers show) and the player:
//   1. ids picked on purpose (the detail page's pickers)
//   2. the languages last picked for this show (remembered per show), or the
//      previous episode's when playing on
//   3. Plex's selection, adjusted to the Subtitle language setting; for anime,
//      Japanese audio with Greek (else English) subtitles
// and then, unless the audio was picked on purpose: if the TV can't play that
// audio (DTS, or TrueHD without a soundbar that takes it), another track in the
// same language that it can play, so nothing has to be converted.
import * as store from '../util/store.js';
import * as lang from '../util/lang.js';
import { streamsOf, forceDirect, audioExtras } from './options.js';
import { preferredSub, animeSub, isSigns } from './subprefs.js';

// What a Samsung TV decodes natively. No DTS on 2018+ models; TrueHD only
// when Settings › Audio formats says the soundbar takes it.
export const NATIVE_AUDIO = { aac: 1, ac3: 1, eac3: 1, mp3: 1, mp2: 1, flac: 1, opus: 1, vorbis: 1, pcm: 1 };

export function audioPlayable(s) {
  const c = String((s && s.codec) || '').toLowerCase();
  return !!(NATIVE_AUDIO[c] || audioExtras().codecs[c]);
}

function isCommentary(s) {
  return /comment|director|descri/i.test((s.title || '') + ' ' + (s.displayTitle || ''));
}

// A track the TV plays, in the same language as `current`; best channels first.
export function playableAlternative(audios, current) {
  if (!current || audioPlayable(current) || forceDirect()) return null;
  const want = lang.ofStream(current);
  const options = audios.filter(s => s !== current && audioPlayable(s) && !isCommentary(s) &&
    (!want || lang.ofStream(s) === want));
  options.sort((a, b) => (b.channels || 0) - (a.channels || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  return options[0] || null;
}

// --- remembered per show -----------------------------------------------------------

const MAX_SHOWS = 100;

export function showTracks(showKey) {
  if (!showKey) return null;
  const all = store.get('showTracks', {}) || {};
  return all[showKey] || null;
}

// langs: { audio?, sub? (null = off), subForced? }; only the keys given change.
export function rememberShowTracks(showKey, langs) {
  if (!showKey) return;
  const all = store.get('showTracks', {}) || {};
  const entry = Object.assign({}, all[showKey] || {}, langs);
  delete all[showKey];
  all[showKey] = entry;
  const keys = Object.keys(all);
  keys.slice(0, Math.max(0, keys.length - MAX_SHOWS)).forEach(k => delete all[k]);
  store.set('showTracks', all);
}

export function showKeyOf(item) {
  return item && item.type === 'episode' ? String(item.grandparentRatingKey || '') : '';
}

// --- anime ---------------------------------------------------------------------
// Anime when Plex's genres say "Anime", or "Animation" with Japanese as the
// file's first audio track (so a cartoon with an extra Japanese dub isn't).
// Episodes don't carry genres: the show's are looked up once and remembered.

const MAX_GENRE_SHOWS = 300;

function genreKind(genres) {
  const tags = (genres || []).map(g => String((g && g.tag) || g).toLowerCase());
  return tags.indexOf('anime') >= 0 ? 'anime' : tags.indexOf('animation') >= 0 ? 'animation' : 'other';
}

export function rememberShowGenres(show) {
  if (!show || show.type !== 'show' || !show.ratingKey || !show.Genre) return;
  const all = store.get('showGenres', {}) || {};
  const key = String(show.ratingKey);
  const kind = genreKind(show.Genre);
  if (all[key] === kind) return;
  delete all[key];
  all[key] = kind;
  const keys = Object.keys(all);
  keys.slice(0, Math.max(0, keys.length - MAX_GENRE_SHOWS)).forEach(k => delete all[k]);
  store.set('showGenres', all);
}

// For an episode whose show we haven't seen yet: one request, then remembered.
export async function learnShowGenres(item, server) {
  const key = showKeyOf(item);
  if (!key || (store.get('showGenres', {}) || {})[key]) return;
  try { rememberShowGenres(await server.metadata(key)); } catch (e) { /* plays without it */ }
}

export function isAnime(item, part) {
  const kind = item && item.type === 'episode'
    ? (store.get('showGenres', {}) || {})[showKeyOf(item)]
    : item && item.Genre ? genreKind(item.Genre) : '';
  if (kind === 'anime') return true;
  if (kind !== 'animation') return false;
  const first = streamsOf(part, 2)[0];
  return !!first && lang.ofStream(first) === 'ja';
}

export function langsOf(audio, sub) {
  return { audio: lang.ofStream(audio), sub: sub ? lang.ofStream(sub) : null, subForced: !!(sub && sub.forced) };
}

// { audio, sub, switched } where switched is the track the TV couldn't play
// when another was chosen instead.
export function pickTracks(item, part, { audioStreamID, subtitleStreamID, langs } = {}) {
  const audios = streamsOf(part, 2);
  const texts = streamsOf(part, 3);
  let audio = (audioStreamID != null && audios.find(s => s.id === audioStreamID)) || null;
  let sub = subtitleStreamID === 0 ? null
    : (subtitleStreamID != null && texts.find(s => s.id === subtitleStreamID)) || undefined;
  const remembered = langs || showTracks(showKeyOf(item));
  const anime = !remembered && isAnime(item, part);
  if (!audio) {
    audio = audios.find(s => s.selected) || audios[0] || null;
    if (remembered && remembered.audio) audio = audios.find(s => lang.ofStream(s) === remembered.audio) || audio;
    else if (anime) audio = audios.find(s => lang.ofStream(s) === 'ja' && !isCommentary(s)) || audio;
  }
  if (sub === undefined) {
    sub = (anime && lang.ofStream(audio) === 'ja' && animeSub(texts)) ||
      preferredSub(texts, texts.find(s => s.selected) || null);
    if (remembered && remembered.sub === null) sub = null;
    else if (remembered && remembered.sub) {
      const same = texts.filter(s => lang.ofStream(s) === remembered.sub)
        .sort((a, b) => isSigns(a) - isSigns(b));       // full dialogue before Signs & Songs
      sub = same.find(s => !!s.forced === !!remembered.subForced) || same[0] || sub;
    }
  }
  let switched = null;
  if (audioStreamID == null) {
    const alt = playableAlternative(audios, audio);
    if (alt) { switched = audio; audio = alt; }
  }
  return { audio, sub: sub || null, switched };
}
