// Pure playback decisions shared by the player screen. No DOM, no network.
import * as lang from '../util/lang.js';
import { TEXT_SUBS, dvWithoutFallback, streamsOf } from './options.js';
import { NATIVE_AUDIO, audioPlayable } from './tracks.js';
import { isWebOS } from '../platform/tizen.js';
import { webosDirect, webosAudioSwitch } from './caps.js';

// What a 2022 Samsung (Tizen 6.5) decodes natively. No DTS on 2018+ models.
export const DIRECT = {
  container: { mp4: 1, m4v: 1, mov: 1, mkv: 1, webm: 1, ts: 1, mpegts: 1, avi: 1 },
  video: { h264: 1, hevc: 1, vp9: 1, av1: 1, mpeg4: 1, mpeg2video: 1, vc1: 1 },
  audio: NATIVE_AUDIO,
};

export function isEmbeddedText(sub) {
  return !!sub && sub.index != null && !sub.key && !!TEXT_SUBS[sub.codec];
}

// External .srt/.ass/.vtt files: the player fetches and draws these itself.
export function isSidecarText(sub) {
  return !!sub && !!sub.key && !!TEXT_SUBS[sub.codec];
}

// No audio stream still counts: the file can play without one.
export function audioDirectOk(audio) {
  return !audio || audioPlayable(audio);
}

// 'direct' plays the file. 'hls' asks the server to convert.
// `forced` is Force direct play. `refused` is a file the TV already rejected.
// A quality cap or Dolby Vision with no HDR underneath always converts, even when forced.
export function playbackMode({ quality, media, audio, sub, forced, refused }) {
  if (quality.kbps) return 'hls';
  if (dvWithoutFallback(media)) return 'hls';
  if (forced) return 'direct';
  if (refused) return 'hls';
  const webos = isWebOS();
  const caps = webos ? webosDirect() : DIRECT;
  let directOk = caps.container[media.container] && caps.video[media.videoCodec] && audioDirectOk(audio);
  // webOS <video> can't show subtitles inside the file, and may not switch audio.
  if (webos && audio && !webosAudioSwitch()) {
    const all = streamsOf(media && media.Part && media.Part[0], 2);
    if (all.length > 1 && all[0] !== audio) directOk = false;
  }
  const subsOk = !sub || isSidecarText(sub) || (!webos && isEmbeddedText(sub));
  return directOk && subsOk ? 'direct' : 'hls';
}

// offset null/undefined means "resume from the server". 0 is a real start.
export function resumeAt(offset, viewOffset) {
  return offset == null ? (viewOffset || 0) : offset;
}

export function openIsStale(alive, gen, openGen) {
  return !alive || gen !== openGen;
}

// Presses closer than 700 ms grow the jump. A pause starts again at the small step.
export function nextSeekCount(count, lastAt, now) {
  return now - lastAt < 700 ? count + 1 : 0;
}

export function seekStepMs(count, big) {
  return big ? (count < 4 ? 30000 : count < 12 ? 60000 : 180000)
    : count < 3 ? 10000 : count < 8 ? 30000 : count < 16 ? 60000 : 180000;
}

// Stay 3 s off the end so a jump can't trip the credits-finished path by itself.
export function clampSeek(from, dir, step, duration) {
  return Math.max(0, Math.min(duration - 3000, from + dir * step));
}

export function markerAt(markers, ms) {
  for (let i = 0; i < markers.length; i++) {
    const x = markers[i];
    if (ms >= x.startTimeOffset && ms < x.endTimeOffset - 1000) return x;
  }
  return null;
}

export function isFinalCredits(m, duration) {
  return m.type === 'credits' && (m.final || m.endTimeOffset >= duration - 15000);
}

export function skipTarget(m, duration) {
  return Math.min(m.endTimeOffset, duration - 3000);
}

// The version picked on the detail page, else the one remembered, else the first.
export function chosenMedia(medias, mediaIndex, remembered) {
  const list = medias || [];
  const media = list[mediaIndex == null ? remembered : mediaIndex] || list[0] || null;
  return { media, index: Math.max(0, list.indexOf(media)) };
}

// Details fetched moments ago, with a real file, can skip another metadata trip.
export function preloadedUsable(preloaded, ratingKey, now) {
  return !!(preloaded && preloaded.ratingKey === ratingKey && now - (preloaded._at || 0) < 120000 &&
    (preloaded.Media || []).some(m => m.Part && m.Part[0]));
}

// Which AVPlay text track is this subtitle? By language when the TV reports
// languages, else by position. The fallback list is the raw track entries
// (not their .index), matching what selectText already receives.
export function matchTextTrack(textTracks, embedded, sub, avText) {
  const tracks = textTracks || [];
  const list = embedded || [];
  let trace = null;
  if (tracks.length && tracks.some(t => t.lang)) {
    const want = lang.ofStream(sub);
    const sameTracks = tracks.filter(t => lang.key(t.lang) === want);
    if (sameTracks.length) {
      const samePlex = list.filter(s => lang.ofStream(s) === want);
      const pos = Math.max(0, samePlex.indexOf(sub));
      trace = { want, pos, count: sameTracks.length };
      return { index: (sameTracks[pos] || sameTracks[0]).index, trace };
    }
  }
  if (tracks.length === list.length) {
    const hit = tracks[list.indexOf(sub)];
    return { index: hit ? hit.index : null, trace };
  }
  const pos = list.filter(isEmbeddedText).indexOf(sub);
  const t = avText || [];
  return { index: pos >= 0 && t[pos] != null ? t[pos] : null, trace };
}

// Same language after Plex re-reads the folder. Prefer the external file.
export function replacementSub(texts, old) {
  const want = lang.ofStream(old);
  const same = (texts || []).filter(t => lang.ofStream(t) === want);
  return same.find(t => t.key && !!t.forced === !!old.forced) || same.find(t => t.key) || same[0] || null;
}

// Green button: off, or back on with the last track (else the server's, else the first).
export function nextSubtitle(texts, current, last) {
  if (current) return null;
  return (last && texts.indexOf(last) >= 0 && last) || (texts || []).find(s => s.selected) || (texts || [])[0] || null;
}

// Watch Together: whether a friend's position is far enough to jump.
export function togetherNeedsSeek(positionMs, remote) {
  const diff = (positionMs - remote.positionMs) / 1000;
  return remote.seek ? Math.abs(diff) > 1.5 : remote.paused ? Math.abs(diff) > 2 : (diff >= 4 || diff <= -1.75);
}
