// Playback choices shared by the detail screen (picked before Play) and the
// player (changed mid-playback): quality/version, audio track, subtitle track.
import * as store from '../util/store.js';

export const TEXT_SUBS = { srt: 1, subrip: 1, ass: 1, ssa: 1, mov_text: 1, vtt: 1, webvtt: 1, smi: 1 };

export function streamsOf(part, type) {
  return (part && part.Stream || []).filter(s => s.streamType === type);
}

export function audioLabel(s) {
  return s.displayTitle || s.language || 'Track';
}

export function subtitleLabel(s) {
  let title = s.displayTitle && s.displayTitle !== 'Unknown' ? s.displayTitle : (s.language || '');
  // The track's own name tells same-language tracks apart ("Full Subtitles",
  // "Signs & Songs").
  if (title && s.title && title.toLowerCase().indexOf(s.title.toLowerCase()) < 0) title += ' · ' + s.title;
  const kind = (s.codec || '').toUpperCase() + (s.key ? ' · external' : '');
  return title ? title + (s.key ? ' · external' : '') : kind || 'Subtitle';
}

// "Original" plays the file as-is (direct play when the TV can decode it).
// The others ask Plex to convert down to a bitrate/resolution cap.
export const QUALITIES = [
  { id: 'original', label: 'Original' },
  { id: '4k-40', label: '4K · 40 Mbps', resolution: '3840x2160', height: 2160, kbps: 40000 },
  { id: '1080p-20', label: '1080p · 20 Mbps', resolution: '1920x1080', height: 1080, kbps: 20000 },
  { id: '1080p-12', label: '1080p · 12 Mbps', resolution: '1920x1080', height: 1080, kbps: 12000 },
  { id: '1080p-8', label: '1080p · 8 Mbps', resolution: '1920x1080', height: 1080, kbps: 8000 },
  { id: '720p-4', label: '720p · 4 Mbps', resolution: '1280x720', height: 720, kbps: 4000 },
  { id: '720p-2', label: '720p · 2 Mbps', resolution: '1280x720', height: 720, kbps: 2000 },
  { id: '480p-1.5', label: '480p · 1.5 Mbps', resolution: '720x480', height: 480, kbps: 1500 },
];

export function qualityById(id) {
  return QUALITIES.find(q => q.id === id) || QUALITIES[0];
}

export function defaultQuality() {
  return qualityById(store.get('quality')).id;
}

export function setDefaultQuality(id) {
  store.set('quality', id === 'original' ? undefined : id);
}

// Only conversions that actually reduce this file are worth offering.
export function qualitiesFor(media) {
  const height = (media && media.height) || 0;
  const bitrate = (media && media.bitrate) || 0;
  return QUALITIES.filter(q => !q.kbps || ((!height || q.height <= height) && (!bitrate || q.kbps < bitrate)));
}

// A remembered cap above what the file has means "Original" for this file.
export function effectiveQuality(id, media) {
  const q = qualityById(id);
  return qualitiesFor(media).indexOf(q) >= 0 ? q : QUALITIES[0];
}

function resolutionLabel(media) {
  const r = String(media.videoResolution || '').toLowerCase();
  if (r === '4k') return '4K';
  if (r === 'sd') return 'SD';
  if (/^\d+$/.test(r)) return r + 'p';
  return media.height ? media.height + 'p' : '';
}

function partOf(media) {
  return media && media.Part && media.Part[0];
}

function hdrLabel(media) {
  const v = streamsOf(partOf(media), 1)[0];
  if (!v) return '';
  const t = (v.displayTitle || '') + ' ' + (v.title || '');
  if (v.DOVIPresent || /dolby vision|dovi/i.test(t)) return 'Dolby Vision';
  if (/hdr10\+/i.test(t)) return 'HDR10+';
  if (/smpte2084|arib-std-b67/i.test(v.colorTrc || '') || /hdr|hlg/i.test(t)) return 'HDR';
  return '';
}

const AUDIO_NAMES = { eac3: 'Dolby Digital+', ac3: 'Dolby Digital', truehd: 'TrueHD', dca: 'DTS', dts: 'DTS',
  'dca-ma': 'DTS-HD MA', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', pcm: 'PCM' };

// The version's main audio track, e.g. "TrueHD Atmos 7.1".
function audioSummary(media) {
  const audios = streamsOf(partOf(media), 2);
  const a = audios.find(s => s.selected) || audios[0];
  if (!a) return '';
  const t = (a.displayTitle || '') + ' ' + (a.title || '');
  const codec = String(a.codec || '').toLowerCase();
  let name = AUDIO_NAMES[codec] || codec.toUpperCase();
  if (codec === 'dca' && /dts-hd ma|dts-hd master/i.test(t)) name = 'DTS-HD MA';
  if (/dts:x/i.test(t)) name = 'DTS:X';
  if (/atmos/i.test(t)) name += ' Atmos';
  const ch = a.audioChannelLayout ? String(a.audioChannelLayout).replace(/\(.*\)/, '')
    : a.channels === 6 ? '5.1' : a.channels === 8 ? '7.1' : a.channels === 2 ? 'Stereo' : '';
  return [name, ch].filter(Boolean).join(' ');
}

function sizeLabel(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1073741824;
  return gb >= 1 ? gb.toFixed(gb >= 10 ? 0 : 1) + ' GB' : Math.round(bytes / 1048576) + ' MB';
}

function fileName(media) {
  const f = String((partOf(media) || {}).file || '');
  return f.split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,4}$/i, '');
}

const EDITIONS = [
  [/director'?s[ ._-]?cut/i, 'Director\'s Cut'], [/extended/i, 'Extended'], [/theatrical/i, 'Theatrical'],
  [/unrated/i, 'Unrated'], [/uncut/i, 'Uncut'], [/final[ ._-]?cut/i, 'Final Cut'], [/ultimate/i, 'Ultimate'],
  [/imax/i, 'IMAX'], [/remaster/i, 'Remastered'], [/criterion/i, 'Criterion'], [/special[ ._-]?edition/i, 'Special Edition'],
  [/\b3d\b/i, '3D'], [/remux/i, 'Remux'],
];

// What the version is, beyond its picture: Plex's {edition-…} file naming,
// Jellyfin's version name, or a well-known word in the file name.
export function versionEdition(media) {
  if (!media) return '';
  const name = fileName(media);
  const tagged = /\{edition-([^}]+)\}/i.exec(name);
  if (tagged) return tagged[1].trim();
  if (media.title) return media.title;
  const found = EDITIONS.filter(([re]) => re.test(name)).map(([, label]) => label);
  return found.join(' · ');
}

// The picture alone, e.g. "4K Dolby Vision".
export function versionPicture(media) {
  if (!media) return '';
  return [resolutionLabel(media), hdrLabel(media)].filter(Boolean).join(' ');
}

// What the version is, at a glance: "Director's Cut · 4K Dolby Vision".
export function versionTitle(media) {
  if (!media) return '';
  return [versionEdition(media), versionPicture(media)].filter(Boolean).join(' · ') ||
    (media.videoCodec || '').toUpperCase() || 'Original';
}

// The rest: "HEVC · TrueHD Atmos 7.1 · 58 GB".
function versionDetail(media) {
  if (!media) return '';
  const size = sizeLabel((partOf(media) || {}).size);
  return [(media.videoCodec || '').toUpperCase(), audioSummary(media),
    size || (media.bitrate ? Math.round(media.bitrate / 1000) + ' Mbps' : '')].filter(Boolean).join(' · ');
}

// Describes one version of a title, e.g.
// "Director's Cut · 4K Dolby Vision · HEVC · TrueHD Atmos 7.1 · 58 GB".
export function versionLabel(media) {
  return [versionTitle(media), versionDetail(media)].filter(Boolean).join(' · ');
}

// { label, detail } per version, worded so no two read the same: a version
// that would look like another gets its bitrate, then its file name.
export function versionRows(medias) {
  medias = medias || [];
  const rows = medias.map(m => ({ label: versionTitle(m), detail: versionDetail(m) }));
  const key = r => r.label + '|' + r.detail;
  const clash = r => rows.filter(x => key(x) === key(r)).length > 1;
  const extra = [
    m => m.bitrate ? Math.round(m.bitrate / 1000) + ' Mbps' : '',
    m => fileName(m),
  ];
  extra.forEach(more => {
    const twins = rows.map(r => clash(r) ? rows.filter(x => key(x) === key(r)) : []);
    rows.forEach((r, i) => {
      const x = more(medias[i]);
      // Only when it tells this one apart from its twins.
      const helps = twins[i].some(t => more(medias[rows.indexOf(t)]) !== x);
      if (x && helps) r.detail = [r.detail, x].filter(Boolean).join(' · ');
    });
  });
  return rows;
}

// The version last played or picked for a title (by media id), so resuming
// picks up the same file. Newest last.
const MAX_VERSIONS = 300;

export function rememberedVersion(item) {
  const medias = (item && item.Media) || [];
  if (medias.length < 2) return 0;
  const id = (store.get('versions', {}) || {})[item.ratingKey];
  const i = medias.findIndex(m => String(m.id) === String(id));
  return i >= 0 ? i : 0;
}

export function rememberVersion(item, mediaIndex) {
  const medias = (item && item.Media) || [];
  const m = medias[mediaIndex];
  if (medias.length < 2 || !m || m.id == null || !item.ratingKey) return;
  const all = store.get('versions', {}) || {};
  delete all[item.ratingKey];
  all[item.ratingKey] = m.id;
  const keys = Object.keys(all);
  keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS)).forEach(k => delete all[k]);
  store.set('versions', all);
}

// Force direct play: always send the original file straight to the TV, never
// ask Plex to convert it (even audio the TV may not decode, like DTS). A lower
// quality picked on purpose still converts.
export function forceDirect() {
  return store.get('forceDirect', false) === true;
}

export function setForceDirect(on) {
  store.set('forceDirect', on ? true : undefined);
}

// What OK does on a Continue Watching tile: 'page' (the title's page) or
// 'play' (resume right away).
export function cwOpens() {
  return store.get('cwOpens') === 'play' ? 'play' : 'page';
}

export function cycleCwOpens() {
  store.set('cwOpens', cwOpens() === 'play' ? undefined : 'play');
}

// Files the TV refused to play directly (by Plex part id), so next time they
// go straight to Plex's conversion instead of failing first. Newest last.
const MAX_REFUSED = 200;

export function directRefused(partId) {
  return !!partId && !!(store.get('directRefused', {}) || {})[partId];
}

export function rememberDirectRefused(partId, why) {
  if (!partId) return;
  const all = store.get('directRefused', {}) || {};
  delete all[partId];
  all[partId] = String(why || '').slice(0, 60);
  const keys = Object.keys(all);
  keys.slice(0, Math.max(0, keys.length - MAX_REFUSED)).forEach(k => delete all[k]);
  store.set('directRefused', all);
}

// Audio formats this TV (or its soundbar, over eARC) plays without help, on
// top of the standard ones. Samsung's own decoder skips these, but many setups
// pass them through fine: Force direct play is the way to check.
export const AUDIO_EXTRAS = [
  { id: 'std', label: 'Standard (convert TrueHD and DTS)', codecs: {} },
  { id: 'truehd', label: 'Also Dolby TrueHD / Atmos', codecs: { truehd: 1 } },
  { id: 'all', label: 'Also TrueHD and DTS', codecs: { truehd: 1, dca: 1, dts: 1, 'dca-ma': 1 } },
];

export function audioExtras() {
  const id = store.get('audioExtras', 'std');
  return AUDIO_EXTRAS.find(a => a.id === id) || AUDIO_EXTRAS[0];
}

export function cycleAudioExtras() {
  const i = AUDIO_EXTRAS.indexOf(audioExtras());
  const next = AUDIO_EXTRAS[(i + 1) % AUDIO_EXTRAS.length].id;
  store.set('audioExtras', next === 'std' ? undefined : next);
}
