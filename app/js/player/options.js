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
  const title = s.displayTitle && s.displayTitle !== 'Unknown' ? s.displayTitle : (s.language || '');
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

// Describes one version of a title, e.g. "4K · HEVC · 58 Mbps".
export function versionLabel(media) {
  if (!media) return '';
  const parts = [resolutionLabel(media), (media.videoCodec || '').toUpperCase()];
  if (media.bitrate) parts.push(Math.round(media.bitrate / 1000) + ' Mbps');
  return parts.filter(Boolean).join(' · ');
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
