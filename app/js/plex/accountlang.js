// Plex and Jellyfin account language settings, as the codes Orama stores on
// the TV. Clients disagree on where the fields sit and whether a mode is a
// number or a word, so the readers take every shape that shows up in practice.
import { key } from '../util/lang.js';

const AUDIO_KEYS = ['defaultAudioLanguage', 'audioLanguage', 'default_audio_language', 'AudioLanguagePreference'];
const SUB_KEYS = ['defaultSubtitleLanguage', 'subtitleLanguage', 'default_subtitle_language', 'SubtitleLanguagePreference'];
const AUTO_AUDIO_KEYS = ['autoSelectAudio', 'auto_select_audio'];
const AUTO_SUB_KEYS = ['autoSelectSubtitle', 'auto_select_subtitle', 'subtitleMode', 'SubtitleMode'];

function field(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
  }
  return undefined;
}

function code(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || s === 'auto' || s === 'none' || s === 'und') return '';
  return key(s);
}

function flag(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return undefined;
}

// Plex Web: 0 manual, 1 with foreign audio, 2 always. Other clients send words.
function mode(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number' && isFinite(v)) return v;
  const s = String(v).trim().toLowerCase();
  if (s === '0' || s === '1' || s === '2') return Number(s);
  return s;
}

function bagsOf(user) {
  return [user.profile, user.settings, user.account, user].filter(b => b && typeof b === 'object' && !Array.isArray(b));
}

// null when the payload has none of the known fields.
export function readPlexLang(user) {
  if (!user || typeof user !== 'object') return null;
  let audio, sub, autoAudio, autoSub, found = false;
  const bags = bagsOf(user);
  for (let i = 0; i < bags.length; i++) {
    const bag = bags[i];
    const a = field(bag, AUDIO_KEYS);
    const s = field(bag, SUB_KEYS);
    const aa = field(bag, AUTO_AUDIO_KEYS);
    const asub = field(bag, AUTO_SUB_KEYS);
    if (a === undefined && s === undefined && aa === undefined && asub === undefined) continue;
    found = true;
    if (audio === undefined && a !== undefined) audio = a;
    if (sub === undefined && s !== undefined) sub = s;
    if (autoAudio === undefined && aa !== undefined) autoAudio = aa;
    if (autoSub === undefined && asub !== undefined) autoSub = asub;
  }
  if (!found) return null;
  return { audio: code(audio), sub: code(sub), autoAudio: flag(autoAudio), autoSub: mode(autoSub) };
}

// { audio, sub } where each is 'auto', 'off' (subtitles only), or a language code.
export function localFromPlex(account) {
  if (!account) return null;
  const audio = account.autoAudio === false ? 'auto' : (account.audio || 'auto');
  const m = account.autoSub;
  let sub = 'auto';
  if (m === 0 || m === 'none' || m === 'off' || m === 'manual' || m === 'disabled') sub = 'off';
  else if (m === 2 || m === 'always' || m === 'alwaysenabled') sub = account.sub || 'auto';
  return { audio: audio || 'auto', sub: sub || 'auto' };
}

export function plexProfileQuery(local) {
  const audio = local && local.audio && local.audio !== 'auto' ? local.audio : '';
  const sub = local && local.sub;
  const q = {
    defaultAudioLanguage: audio,
    autoSelectAudio: 1,
    defaultSubtitleLanguage: '',
    autoSelectSubtitle: 1,
  };
  if (sub === 'off') q.autoSelectSubtitle = 0;
  else if (sub && sub !== 'auto') {
    q.defaultSubtitleLanguage = sub;
    q.autoSelectSubtitle = 2;
  }
  return q;
}

// Empty languages are included on purpose: omitting one leaves the old value.
export function plexProfileUrl(local) {
  const q = plexProfileQuery(local || {});
  const parts = Object.keys(q).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k]));
  return 'https://clients.plex.tv/api/v2/user/profile?' + parts.join('&');
}

export function readJellyfinLang(user) {
  if (!user || typeof user !== 'object') return null;
  const cfg = user.Configuration || user.configuration;
  const bag = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : user;
  const audio = field(bag, ['AudioLanguagePreference']);
  const sub = field(bag, ['SubtitleLanguagePreference']);
  const subtitleMode = field(bag, ['SubtitleMode']);
  if (audio === undefined && sub === undefined && subtitleMode === undefined) return null;
  return { audio: code(audio), sub: code(sub), mode: subtitleMode == null ? '' : String(subtitleMode) };
}

export function localFromJellyfin(account) {
  if (!account) return null;
  const m = String(account.mode || '');
  let sub = 'auto';
  if (m === 'None') sub = 'off';
  else if (m === 'Always') sub = account.sub || 'auto';
  return { audio: account.audio || 'auto', sub };
}

const ISO2 = {
  en: 'eng', el: 'ell', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por',
  nl: 'nld', ru: 'rus', ja: 'jpn', ko: 'kor', zh: 'zho', sv: 'swe', no: 'nor',
  da: 'dan', fi: 'fin', pl: 'pol', tr: 'tur', ar: 'ara', he: 'heb',
};

export function to6392(langCode) {
  if (!langCode || langCode === 'auto' || langCode === 'off') return '';
  const k = key(langCode);
  return ISO2[k] || k;
}

// The whole Configuration object, with only the language fields changed.
// null when there is nothing safe to post (Jellyfin replaces the document).
export function jellyfinConfigWithLang(config, local) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const next = Object.assign({}, config);
  const prefs = local || {};
  next.AudioLanguagePreference = to6392(prefs.audio);
  if (prefs.sub === 'off') {
    next.SubtitleMode = 'None';
    next.SubtitleLanguagePreference = '';
  } else if (prefs.sub && prefs.sub !== 'auto') {
    next.SubtitleMode = 'Always';
    next.SubtitleLanguagePreference = to6392(prefs.sub);
  } else {
    next.SubtitleMode = 'Smart';
    next.SubtitleLanguagePreference = '';
  }
  return next;
}
