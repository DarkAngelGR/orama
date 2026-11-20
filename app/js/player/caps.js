// What each TV can decode. Samsung's Plex profile string stays byte-identical.
// webOS <video> is assumed to play h264, hevc, vp9 and av1, minus any of the
// last three that canPlayType / MediaSource.isTypeSupported reports as absent.
// No DTS or TrueHD on webOS: those audio tracks are transcoded. Settings ›
// Audio formats can still add them, the same way it does on Samsung.
import { isWebOS } from '../platform/tizen.js';

export const SAMSUNG_PROFILE_EXTRA = [
  'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264,hevc&audioCodec=aac,ac3,eac3)',
  'add-direct-play-profile(type=videoProfile&container=mp4,mkv&videoCodec=h264,hevc&audioCodec=aac,ac3,eac3)',
].join('+');

export const LG_AUDIO = { aac: 1, mp3: 1, ac3: 1, eac3: 1, opus: 1, flac: 1 };

export const LG_CONTAINERS = { mp4: 1, m4v: 1, mov: 1, mkv: 1, webm: 1 };

const MIME = {
  hevc: ['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"'],
  vp9: ['video/webm; codecs="vp9"', 'video/mp4; codecs="vp09.00.10.08"'],
  av1: ['video/mp4; codecs="av01.0.05M.08"', 'video/webm; codecs="av01.0.05M.08"'],
};

// true, false, or null when neither probe API exists (caller assumes yes).
function probeMime(mime) {
  let asked = false;
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const v = document.createElement('video');
      if (v && typeof v.canPlayType === 'function') {
        asked = true;
        const r = v.canPlayType(mime) || '';
        if (r === 'probably' || r === 'maybe') return true;
      }
    }
  } catch (e) {}
  try {
    if (typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function') {
      asked = true;
      if (MediaSource.isTypeSupported(mime)) return true;
    }
  } catch (e) {}
  return asked ? false : null;
}

export function probeCodec(mimes) {
  let unknown = false;
  for (let i = 0; i < mimes.length; i++) {
    const r = probeMime(mimes[i]);
    if (r === true) return true;
    if (r === null) unknown = true;
  }
  return unknown ? null : false;
}

// The answer doesn't change while the app runs; probing makes a <video> each time.
let lgVideo = null;

// For tests: probe again on the next call.
export function resetCodecProbe() { lgVideo = null; }

export function lgVideoCodecs() {
  if (lgVideo) return lgVideo;
  const video = lgVideo = { h264: 1 };
  const names = ['hevc', 'vp9', 'av1'];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    // null means the TV could not be asked, so keep the assumption.
    if (probeCodec(MIME[name]) !== false) video[name] = 1;
  }
  return video;
}

// Chromium only lists a file's other audio tracks behind a flag, and never
// exposes subtitles inside an mkv/mp4. Without audioTracks, picking anything but
// the first audio track has to go through the server.
export function webosAudioSwitch() {
  try {
    return typeof HTMLMediaElement !== 'undefined' && 'audioTracks' in HTMLMediaElement.prototype;
  } catch (e) { return false; }
}

export function webosDirect() {
  return { container: LG_CONTAINERS, video: lgVideoCodecs(), audio: LG_AUDIO };
}

function codecList(obj, order) {
  const out = [];
  for (let i = 0; i < order.length; i++) if (obj[order[i]]) out.push(order[i]);
  return out.join(',');
}

export function plexProfileExtra() {
  if (!isWebOS()) return SAMSUNG_PROFILE_EXTRA;
  const v = codecList(lgVideoCodecs(), ['h264', 'hevc', 'vp9', 'av1']);
  const a = codecList(LG_AUDIO, ['aac', 'mp3', 'ac3', 'eac3', 'opus', 'flac']);
  return [
    'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=' + v + '&audioCodec=' + a + ')',
    'add-direct-play-profile(type=videoProfile&container=mp4,mkv,webm&videoCodec=' + v + '&audioCodec=' + a + ')',
  ].join('+');
}

// Samsung values are the ones Jellyfin has always been sent.
export function jellyfinTranscodeCodecs() {
  if (!isWebOS()) return { VideoCodec: 'hevc,h264', AudioCodec: 'eac3,ac3,aac' };
  return {
    VideoCodec: codecList(lgVideoCodecs(), ['h264', 'hevc', 'vp9', 'av1']),
    AudioCodec: codecList(LG_AUDIO, ['aac', 'mp3', 'ac3', 'eac3', 'opus', 'flac']),
  };
}
