// Playback. Direct play whenever the TV can decode the file (hardware, zero
// server load); otherwise ask Plex for HLS with the video passed through and
// only the audio/container converted. Seeking previews locally and only
// commits once the user stops pressing, because AVPlay seeks are slow.
import { DEV } from '../config.js';
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { createPlayer } from '../platform/player.js';
import { setScreenSaver, supports4K } from '../platform/tizen.js';
import { session } from '../session.js';
import { clock, episodeLabel, uuid } from '../util/format.js';
import * as icons from '../ui/icons.js';
import * as router from '../router.js';
import { log, warn, error } from '../util/log.js';
import { request } from '../plex/client.js';
import { TogetherLink } from '../plex/together.js';
import * as notifications from '../plex/notifications.js';
import * as downloads from '../plex/downloads.js';
import { parseSubtitles, CueTrack, cleanCue, NO_CUE } from '../player/subtitles.js';
import {
  TEXT_SUBS, streamsOf, audioLabel, subtitleLabel, qualitiesFor, qualityById, effectiveQuality, defaultQuality, forceDirect, audioExtras,
  directRefused, rememberDirectRefused, versionTitle, versionRows, rememberedVersion, rememberVersion, dvWithoutFallback,
} from '../player/options.js';
import { parseBif, bifIndex, bifPicture } from '../player/bif.js';
import { subOffset, setSubOffset, offsetLabel } from '../player/subprefs.js';
import * as lang from '../util/lang.js';
import { NATIVE_AUDIO, pickTracks, rememberShowTracks, showKeyOf, learnShowGenres } from '../player/tracks.js';

// What a 2022 Samsung (Tizen 6.5) decodes natively. No DTS on 2018+ models.
const DIRECT = {
  container: { mp4: 1, m4v: 1, mov: 1, mkv: 1, webm: 1, ts: 1, mpegts: 1, avi: 1 },
  video: { h264: 1, hevc: 1, vp9: 1, av1: 1, mpeg4: 1, mpeg2video: 1, vc1: 1 },
  audio: NATIVE_AUDIO,
};
const OSD_HIDE_MS = 4000;
const SEEK_COMMIT_MS = 900;
const TIMELINE_MS = 10000;
const TOAST_MS = 1800;
const SUB_OFFSET_STEP = 250;
const SUB_OFFSET_MAX = 10000;
const THUMBS_AFTER_MS = 3000;   // fetch seek previews once playback has settled
const THUMB_W = 320;

// Language of a stream, for carrying the user's track choice to the next episode.
function langOf(s) {
  return lang.ofStream(s);
}

function isEmbeddedText(sub) {
  return !!sub && sub.index != null && !sub.key && !!TEXT_SUBS[sub.codec];
}

// External .srt/.ass/.vtt files: we fetch and draw these ourselves.
function isSidecarText(sub) {
  return !!sub && !!sub.key && !!TEXT_SUBS[sub.codec];
}

// Options picked on the detail screen: quality id, which version (Media) to
// play, and audio/subtitle stream ids (subtitleStreamID 0 = off). Anything
// left out falls back to the server's selection and the default quality.
// `langs` ({ audio, sub, subForced }) comes from the previous episode: pick
// tracks in the same languages when no explicit ids are given.
// Background feeds (library changes, download progress) rest while a video
// plays, leaving the TV to the picture. Resumed a moment after the player
// closes, so switching version or episode doesn't reconnect in between.
let resumeTimer = 0;
function background(on) {
  notifications.pause(!on);
  downloads.pause(!on);
}

export function PlayerScreen(initial, { offset = null, quality: qualityId, mediaIndex, audioStreamID, subtitleStreamID, langs, together = null, full: preloaded = null } = {}) {
  const el = h('div', 'screen player');
  const stage = h('div', 'player-stage', el);
  const subs = h('div', 'subs', el);
  const subsText = h('span', 'subs-text', subs); // inline, so the optional background hugs the text
  const signs = h('div', 'subs subs-top', el);   // translated on-screen signs (anime)
  const signsText = h('span', 'subs-text', signs);
  const spinner = h('div', 'spinner', el);
  const pauseBig = h('div', 'pause-big', el);
  pauseBig.innerHTML = icons.pause;
  const clockEl = h('div', 'pause-clock', el);   // the time of day, while paused

  const osd = h('div', 'osd', el);
  const osdTop = h('div', 'osd-top', osd);
  const osdTitle = h('div', 'osd-title', osdTop);
  const osdSub = h('div', 'osd-sub', osdTop);
  // How it's playing: Direct Play / Direct Stream / Transcoding, and the details.
  const osdPlay = h('div', 'osd-play', osdTop);
  const osdPlayMode = h('span', 'osd-play-mode', osdPlay);
  const osdPlayInfo = h('span', 'osd-play-info', osdPlay);
  const osdBottom = h('div', 'osd-bottom', osd);
  const bar = h('div', 'osd-bar', osdBottom);
  const barFill = h('div', 'osd-fill', bar);
  const knob = h('div', 'osd-knob', bar);
  const seekLabel = h('div', 'osd-seek', knob);
  const thumbEl = h('div', 'osd-thumb', osdBottom);
  const thumbImg = h('img', '', thumbEl);
  thumbImg.alt = '';
  const thumbSprite = h('div', 'osd-sprite', thumbEl);   // Jellyfin: one cell of a picture sheet
  const times = h('div', 'osd-times', osdBottom);
  const tNow = h('span', 'osd-now', times);
  const tInfo = h('span', 'osd-info', times);
  const tLeft = h('span', 'osd-left', times);
  const hintEl = h('div', 'osd-hint', osdBottom);   // filled by renderTitles()

  const skipBtn = h('div', 'skip hidden', el);
  const toastEl = h('div', 'toast', el);
  const panel = h('div', 'tracks hidden', el);
  const upnext = h('div', 'upnext hidden', el);
  const errorEl = h('div', 'player-error hidden', el);
  // Watch Together: who's here (top right) and the waiting room before it starts.
  const togetherEl = h('div', 'together-chip hidden', el);
  const lobbyEl = h('div', 'together-lobby hidden', el);

  let item = initial;
  let media = null;
  let mediaIdx = 0;
  let part = null;
  let quality = qualityById(qualityId || defaultQuality());
  let requestedQuality = quality.id; // carried to the next episode
  let hlsStarted = false;   // a transcode session exists on the server
  let mode = 'direct';
  let triedFallback = false;
  let triedDvDirect = false;   // a Dolby Vision conversion failed: played as it is
  let base = 0;             // HLS restarts at an offset; AVPlay time is relative to it
  let position = offset || 0;
  let duration = initial.duration || 0;
  let paused = false;
  let started = false;
  let alive = true;
  let audioStream = null;
  let subStream = null;
  let seekTarget = null;
  let seekCount = 0;
  let lastSeekAt = 0;
  let seekTimer = 0;
  let osdTimer = 0;
  let timelineTimer = 0;
  let subTimer = 0;
  let signTimer = 0;
  let lastText = 0;
  let upnextTimer = 0;
  let nextItem = null;
  let cueTrack = null;
  let cueTimer = 0;
  let cueFor = null;
  let subOff = 0;           // timing offset for the current external subtitle file
  let lastSub = null;       // what the green button turns back on
  let markers = [];         // intro / credits ranges from Plex
  let activeMarker = null;
  let toastTimer = 0;
  let failMsg = '';         // why direct play failed, remembered once the fallback plays
  let thumbs = null;        // seek previews: parsed BIF (Plex) or picture sheets (Jellyfin)
  let thumbsTimer = 0;
  let thumbIdx = -1;
  let thumbUrl = '';
  let neighbors = { prev: null, next: null }; // episodes before and after this one
  const playSession = uuid();
  let buffering = false;
  // Watch Together (plex/together.js): { room, uri, host }.
  let link = null;
  let syncBusy = false;     // a jump to a friend's position is under way
  let pendingRemote = null; // a friend's state that arrived before we were playing
  let lobby = !!together;   // waiting for everyone before playing
  let roster = [];

  const player = createPlayer(stage, {
    onTime(ms) {
      if (!started) return;
      position = base + ms;
      if (seekTarget == null) {
        renderProgress(position);
        updateSkip(position);
      }
    },
    onBuffering(on) { buffering = on; toggleClass(spinner, 'on', on); },
    onEnd() { finished(); },
    onError(msg) { failed(msg); },
    onSubtitle(text, ms) {
      // The TV can keep sending its default track's lines; only an embedded
      // subtitle that's actually selected should show.
      if (mode !== 'direct' || !isEmbeddedText(subStream)) return;
      // Signs and dialogue come one line at a time and each keeps its own place.
      const cue = cleanCue(text);
      if (cue.top) {
        clearTimeout(signTimer);
        setText(signsText, cue.text);
        if (ms > 0) signTimer = setTimeout(() => setText(signsText, ''), ms);
      } else {
        clearTimeout(subTimer);
        setText(subsText, cue.text);
        if (ms > 0) subTimer = setTimeout(() => setText(subsText, ''), ms);
      }
    },
  });

  function showCue(cue) {
    setText(subsText, cue.text);
    setText(signsText, cue.top);
  }

  // --- OSD --------------------------------------------------------------

  function renderProgress(ms) {
    const p = duration ? Math.max(0, Math.min(1, ms / duration)) : 0;
    setTransform(barFill, 'scaleX(' + p.toFixed(4) + ')');
    setTransform(knob, 'translateX(' + Math.round(p * 1728) + 'px)');
    const now = Date.now();
    if (now - lastText > 900 || seekTarget != null) {
      lastText = now;
      setText(tNow, clock(ms));
      setText(tLeft, '−' + clock(duration - ms));
      setText(tInfo, 'Ends at ' + timeOfDay(new Date(now + (duration - ms))));
    }
  }

  // Paused: dim the picture's controls in, and show the time of day (kept current).
  let clockTimer = 0;
  function timeOfDay(d) {
    let hh = d.getHours();
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    const mm = d.getMinutes();
    return hh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
  }
  function markPaused(on) {
    toggleClass(el, 'paused', on);
    clearInterval(clockTimer);
    clockTimer = 0;
    if (!on) return;
    setText(clockEl, timeOfDay(new Date()));
    clockTimer = setInterval(() => setText(clockEl, timeOfDay(new Date())), 5000);
  }

  function showOsd(sticky) {
    toggleClass(el, 'osd-on', true);
    clearTimeout(osdTimer);
    if (!sticky && !paused) osdTimer = setTimeout(() => toggleClass(el, 'osd-on', false), OSD_HIDE_MS);
  }

  function hideOsd() {
    clearTimeout(osdTimer);
    toggleClass(el, 'osd-on', false);
  }

  // --- Seek previews ------------------------------------------------------

  let thumbsFor = null;
  function loadThumbs() {
    if (thumbsFor === part || !part) return;   // once per file (each HLS seek reopens)
    const forPart = thumbsFor = part;
    thumbsTimer = setTimeout(() => {
      session.server.previewThumbs(forPart)
        .then(buf => {
          if (!alive || part !== forPart || !buf) return;
          thumbs = buf.sheets ? buf : parseBif(buf);
          if (thumbs && thumbs.sheets) preloadSheets(thumbs);
          toggleClass(thumbEl, 'sprite', !!(thumbs && thumbs.sheets));
          log('seek previews', thumbs ? thumbs.count + ' pictures' : 'unreadable');
        })
        .catch(e => warn('seek previews failed', e.message));
    }, THUMBS_AFTER_MS);
  }

  // Jellyfin's sheets are small (a few per film): load them all up front so
  // seeking never waits for one. The Image objects keep them in the cache.
  let sheetImgs = [];
  function preloadSheets(t) {
    sheetImgs = [];
    for (let i = 0; i < t.sheets; i++) { const im = new Image(); im.src = t.url(i); sheetImgs.push(im); }
  }

  function showSheetCell(i) {
    const t = thumbs;
    const per = t.cols * t.rows;
    const k = i % per;
    const col = k % t.cols;
    const row = Math.floor(k / t.cols);
    const st = thumbSprite.style;
    st.backgroundImage = 'url("' + t.url(Math.floor(i / per)) + '")';
    st.backgroundSize = (t.cols * 100) + '% ' + (t.rows * 100) + '%';
    st.backgroundPosition = (t.cols > 1 ? col / (t.cols - 1) * 100 : 0) + '% ' + (t.rows > 1 ? row / (t.rows - 1) * 100 : 0) + '%';
  }

  function showThumb(ms) {
    if (!thumbs) return;
    if (thumbs.sheets) {
      const i = Math.max(0, Math.min(thumbs.count - 1, Math.floor(ms / thumbs.interval)));
      if (i !== thumbIdx) { thumbIdx = i; showSheetCell(i); }
    } else {
    const i = bifIndex(thumbs, ms);
    if (i !== thumbIdx) {
      const pic = bifPicture(thumbs, i);
      if (!pic) return;
      thumbIdx = i;
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      thumbUrl = URL.createObjectURL(pic);
      thumbImg.src = thumbUrl;
    }
    }
    // Centred over the knob, kept on screen at both ends.
    const p = duration ? Math.max(0, Math.min(1, ms / duration)) : 0;
    const x = Math.max(24, Math.min(1920 - THUMB_W - 24, Math.round(96 + p * 1728 - THUMB_W / 2)));
    setTransform(thumbEl, 'translateX(' + x + 'px)');
    toggleClass(thumbEl, 'has', true);
  }

  function dropThumbs() {
    clearTimeout(thumbsTimer);
    thumbs = null;
    thumbIdx = -1;
    sheetImgs = [];
    toggleClass(thumbEl, 'sprite', false);
    toggleClass(thumbEl, 'has', false);
    if (thumbUrl) { URL.revokeObjectURL(thumbUrl); thumbUrl = ''; }
  }

  // --- What's actually happening to the stream -------------------------------

  function codecName(c) {
    const n = { hevc: 'HEVC', h264: 'H.264', av1: 'AV1', vp9: 'VP9', mpeg2video: 'MPEG-2', vc1: 'VC-1', eac3: 'EAC3', ac3: 'AC3',
      aac: 'AAC', dca: 'DTS', dts: 'DTS', truehd: 'TrueHD', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', pcm: 'PCM' }[String(c || '').toLowerCase()];
    return n || String(c || '').toUpperCase();
  }

  function resLabel(r) {
    r = String(r || '').toLowerCase();
    return r === '4k' ? '4K' : r === 'sd' ? 'SD' : /^\d+$/.test(r) ? r + 'p' : r.toUpperCase();
  }

  function videoOf(p) {
    return ((p && p.Stream) || []).find(st => st.streamType === 1);
  }

  // mc: the server's transcode decision (null when playing the file directly).
  let lastDecision = null;
  function showPlayback(mc) {
    lastDecision = mc;
    const v = videoOf(part);
    const hdr = v && /hdr|dolby vision|dovi/i.test(v.displayTitle || '') ? (/(dolby vision|dovi)/i.test(v.displayTitle) ? ' Dolby Vision' : ' HDR') : '';
    const srcVideo = [resLabel(media.videoResolution), codecName(media.videoCodec) + hdr].filter(Boolean).join(' ');
    const srcAudio = audioStream ? codecName(audioStream.codec) + (audioStream.audioChannelLayout ? ' ' + audioStream.audioChannelLayout.replace(/\(.*\)/, '') : audioStream.channels ? ' ' + (audioStream.channels === 6 ? '5.1' : audioStream.channels === 8 ? '7.1' : audioStream.channels + 'ch') : '') : '';
    let modeText, info, kind;
    if (!mc) {
      kind = 'direct';
      modeText = forceDirect() ? 'Direct Play (forced)' : 'Direct Play';
      info = [srcVideo, srcAudio, media.bitrate >= 500 ? Math.round(media.bitrate / 1000) + ' Mbps' : ''];
    } else {
      const m = (mc.Metadata && mc.Metadata[0] && mc.Metadata[0].Media && mc.Metadata[0].Media[0]) || {};
      const streams = (m.Part && m.Part[0] && m.Part[0].Stream) || [];
      const vd = streams.find(st => st.streamType === 1) || {};
      const ad = streams.find(st => st.streamType === 2) || {};
      const sd = streams.find(st => st.streamType === 3) || {};
      const videoCopied = vd.decision === 'copy' || (!vd.decision && !quality.kbps);
      const audioCopied = !ad.decision || ad.decision === 'copy';
      if (videoCopied) {
        kind = 'stream';
        modeText = 'Direct Stream';
        info = ['video untouched (' + srcVideo + ')',
          audioCopied ? srcAudio : 'audio ' + (audioStream ? codecName(audioStream.codec) : '') + ' → ' + codecName(ad.codec || 'aac'),
          audioCopied || audioDirectOk() ? '' : 'change in Settings › Audio formats'];
      } else {
        kind = 'transcode';
        modeText = 'Transcoding';
        const why = sd.decision === 'burn' ? 'burning in subtitles' : quality.kbps ? 'lower quality picked' : srcVideo + ' → ' + codecName(vd.codec || 'h264');
        if (!quality.kbps && !audioDirectOk()) info = null; // explained below
        info = info === null && !audioDirectOk()
          ? [why, 'because ' + codecName(audioStream.codec) + ' audio is set to convert (Settings › Audio formats)']
          : [resLabel(m.videoResolution || (quality.height ? String(quality.height) : '')), m.bitrate ? Math.round(m.bitrate / 1000) + ' Mbps' : '', why,
            audioCopied ? '' : 'audio → ' + codecName(ad.codec || 'aac')];
      }
    }
    if (subStream) {
      const how = isSidecarText(subStream) ? 'file' : isEmbeddedText(subStream) ? 'in video' : 'image';
      const burned = mc && ((((mc.Metadata || [])[0] || {}).Media || [{}])[0].Part || [{}])[0];
      const isBurn = burned && (burned.Stream || []).some(st => st.streamType === 3 && st.decision === 'burn');
      info.push('subtitles ' + (subStream.language || subStream.languageCode || '?') + ' (' + (isBurn ? 'burned in' : how) + ')');
      if (!mc && how === 'image') info.push('image subtitles can\'t show with direct play');
    }
    if (mc && !quality.kbps && directRefused(part.id)) info.push('the TV refused this file before');
    setText(osdPlayMode, modeText);
    setText(osdPlayInfo, info.filter(Boolean).join('  ·  '));
    ['direct', 'stream', 'transcode'].forEach(k => toggleClass(osdPlay, k, k === kind));
    // HDR is much brighter than the UI expects (a conversion is tone-mapped).
    toggleClass(el, 'hdr', !!hdr && kind !== 'transcode');
  }

  function renderTitles() {
    hintEl.innerHTML = '▼ Audio, subtitles, quality' + (item.type === 'episode' ? ' &amp; episodes' : '') +
      ' &nbsp;&nbsp; ⏪ ⏩ Jump 30 s &nbsp;&nbsp; CH ▲▼ Subtitles on/off';
    const sub = item.type === 'episode' ? episodeLabel(item) + '   ' + item.title : String(item.year || '');
    setText(osdTitle, item.type === 'episode' ? item.grandparentTitle : item.title);
    setText(osdSub, [sub, versionNote()].filter(Boolean).join('   ·   '));
  }

  // Which file is playing, when there's more than one:
  // "Director's Cut · 4K Dolby Vision (version 2 of 3)".
  function versionNote() {
    const medias = (item && item.Media) || [];
    if (medias.length < 2 || !media) return '';
    return versionTitle(media) + '  (version ' + (mediaIdx + 1) + ' of ' + medias.length + ')';
  }

  function toast(text) {
    setText(toastEl, text);
    toggleClass(toastEl, 'on', true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toggleClass(toastEl, 'on', false), TOAST_MS);
  }

  // --- Skip intro / credits ---------------------------------------------

  // The last credits marker (Plex flags it `final`, or it runs to the end)
  // means "done": skipping it ends playback, which offers the next episode.
  function isFinalCredits(m) {
    return m.type === 'credits' && (m.final || m.endTimeOffset >= duration - 15000);
  }

  // Called from onTime: a scan of at most a few markers, and DOM writes only
  // when entering or leaving one.
  function updateSkip(ms) {
    let m = null;
    for (let i = 0; i < markers.length; i++) {
      const x = markers[i];
      if (ms >= x.startTimeOffset && ms < x.endTimeOffset - 1000) { m = x; break; }
    }
    if (m === activeMarker) return;
    activeMarker = m;
    toggleClass(skipBtn, 'hidden', !m);
    if (m) {
      setText(skipBtn, m.type === 'intro' ? 'Skip intro'
        : isFinalCredits(m) && item.type === 'episode' ? 'Next episode' : 'Skip credits');
    }
  }

  function skipMarker() {
    const m = activeMarker;
    if (!m) return;
    activeMarker = null;
    toggleClass(skipBtn, 'hidden', true);
    log('skip', m.type, clock(m.startTimeOffset), '→', clock(m.endTimeOffset));
    if (isFinalCredits(m)) { finished(); return; }
    seekTarget = Math.min(m.endTimeOffset, duration - 3000);
    commitSeek();
  }

  // --- Timeline ---------------------------------------------------------

  function report(state) {
    if (!item.ratingKey) return;
    if (DEV && window.__ss && window.__ss.muteTimeline) return;
    session.server.timeline({
      ratingKey: item.ratingKey,
      key: '/library/metadata/' + item.ratingKey,
      state,
      time: Math.floor(position),
      duration: Math.floor(duration),
      'X-Plex-Session-Identifier': playSession,
    });
  }

  function startTimeline() {
    clearInterval(timelineTimer);
    timelineTimer = setInterval(() => report(paused ? 'paused' : 'playing'), TIMELINE_MS);
  }

  // --- Opening ----------------------------------------------------------

  function decideMode() {
    // A lower quality than the file means Plex has to convert it.
    if (quality.kbps) return 'hls';
    // Dolby Vision the TV can't show (purple and green): always converted, even with Force direct play.
    if (dvWithoutFallback(media)) return 'hls';
    if (forceDirect()) return 'direct';
    if (directRefused(part.id)) return 'hls';
    const directOk = DIRECT.container[media.container] && DIRECT.video[media.videoCodec] && audioDirectOk();
    const subsOk = !subStream || isEmbeddedText(subStream) || isSidecarText(subStream);
    return directOk && subsOk ? 'direct' : 'hls';
  }

  function audioDirectOk() {
    if (!audioStream) return true;
    const c = String(audioStream.codec || '').toLowerCase();
    return !!(DIRECT.audio[c] || audioExtras().codecs[c]);
  }

  async function open(atMs) {
    const server = session.server;
    const t0 = Date.now();
    started = false;
    toggleClass(spinner, 'on', true);
    let url;
    if (mode === 'direct') {
      base = 0;
      url = server.url(part.key);
      // Switched back from a conversion (e.g. quality → Original): free it.
      if (hlsStarted) { server.stopTranscode(playSession); hlsStarted = false; }
    } else {
      base = atMs;
      // Burn in only what we can't draw ourselves (image subs, embedded text).
      const burn = subStream && !isSidecarText(subStream);
      const opts = {
        session: playSession, offsetMs: atMs, mediaIndex: mediaIdx, mediaSourceId: media.id,
        maxBitrate: quality.kbps || undefined,
        resolution: quality.resolution || undefined,
        audioStreamID: audioStream && audioStream.id,
        subtitleStreamID: burn ? subStream.id : undefined,
        forceVideo: dvWithoutFallback(media),
      };
      if (server.prepareTranscode) {
        // Jellyfin: it decides how to convert and hands back the stream address.
        if (hlsStarted) server.stopTranscode(playSession);
        const prepared = await server.prepareTranscode(item, opts);
        url = prepared.url;
        hlsStarted = true;
        showPlayback(prepared.decision);
      } else {
        url = server.transcodeUrl(item, opts);
        hlsStarted = true;
        // PMS 1.42+ rejects start.m3u8 unless a decision was made for the session first.
        const decision = await request(url.replace('/start.m3u8', '/decision'));
        const mc = decision.MediaContainer || {};
        if (mc.generalDecisionCode && mc.generalDecisionCode >= 2000) throw new Error(mc.generalDecisionText || 'Server refused to convert this file');
        showPlayback(mc);
      }
    }
    if (mode === 'direct') showPlayback(null);
    log('play', mode, quality.id, item.title, media.container + '/' + media.videoCodec + '/' + (audioStream && audioStream.codec), 'at', clock(atMs));
    const uhdOut = !quality.kbps || quality.height >= 2160;
    player.open(url, { uhd: uhdOut && media.videoResolution === '4k' && supports4K() });
    await player.prepare();
    if (!alive) return;
    if (mode === 'direct') {
      applyTracks();
      if (atMs > 0) await player.seek(atMs);
    }
    syncSidecar();
    player.play();
    // Some TVs switch to the file's default subtitle once playback starts:
    // select ours again a moment later.
    if (mode === 'direct' && isEmbeddedText(subStream)) {
      const want = subStream;
      setTimeout(() => { if (alive && mode === 'direct' && subStream === want) applyTracks(); }, 1200);
    }
    paused = false;
    started = true;
    position = atMs;
    markPaused(false);
    toggleClass(spinner, 'on', false);
    log('playing after ' + (Date.now() - t0) + 'ms (' + mode + ')');
    // Direct play failed and the conversion works: next time, convert right away.
    if (failMsg && mode === 'hls') { rememberDirectRefused(part.id, failMsg); failMsg = ''; }
    report('playing');
    startTimeline();
    loadThumbs();
  }

  // Map Plex's chosen streams onto AVPlay's track list (same file order).
  function applyTracks() {
    const t = player.tracks();
    if (audioStream && t.audio.length > 1) {
      const pos = streamsOf(part, 2).indexOf(audioStream);
      if (pos >= 0 && t.audio[pos] != null) player.selectAudio(t.audio[pos]);
    }
    if (isEmbeddedText(subStream)) {
      const idx = textTrackFor(subStream);
      if (idx != null) player.selectText(idx);
    } else {
      player.selectText(null);
      showCue(NO_CUE);
    }
  }

  // Which AVPlay TEXT track is this Plex subtitle? By language when the TV
  // reports languages (its list can include image subtitles Plex counts
  // differently), else by position.
  function textTrackFor(sub) {
    const tracks = player.textTracks ? player.textTracks() : [];
    const embedded = streamsOf(part, 3).filter(s => !s.key);
    if (tracks.length && tracks.some(t => t.lang)) {
      const want = langOf(sub);
      const sameTracks = tracks.filter(t => lang.key(t.lang) === want);
      if (sameTracks.length) {
        const samePlex = embedded.filter(s => langOf(s) === want);
        const pos = Math.max(0, samePlex.indexOf(sub));
        log('subtitle track by language', want, 'pos', pos, 'of', sameTracks.length);
        return (sameTracks[pos] || sameTracks[0]).index;
      }
    }
    if (tracks.length === embedded.length) return tracks[embedded.indexOf(sub)] ? tracks[embedded.indexOf(sub)].index : null;
    const t = player.tracks().text;
    const pos = embedded.filter(isEmbeddedText).indexOf(sub);
    return pos >= 0 && t[pos] != null ? t[pos] : null;
  }

  const refreshedFor = {};
  async function reloadSubtitlesAfterRefresh(old) {
    const server = session.server;
    await server.refresh(item.ratingKey);
    await new Promise(r => setTimeout(r, 6000)); // give Plex a moment to re-read the folder
    if (!alive || subStream !== old) return;
    try {
      server.invalidate();
      const fresh = await server.metadata(item.ratingKey);
      const freshMedia = fresh && fresh.Media && (fresh.Media.find(m => m.id === media.id) || fresh.Media[0]);
      const freshPart = freshMedia && freshMedia.Part && freshMedia.Part[0];
      if (!freshPart || !alive || subStream !== old) return;
      part.Stream = freshPart.Stream; // same file, updated subtitle list
      const texts = streamsOf(part, 3);
      const same = texts.filter(t => langOf(t) === langOf(old));
      const pick = same.find(t => t.key && !!t.forced === !!old.forced) || same.find(t => t.key) || same[0];
      if (!pick) { toast('The ' + (old.language || 'selected') + ' subtitles are gone from the server'); return; }
      subStream = pick;
      cueFor = null;
      if (mode === 'direct') applyTracks();
      syncSidecar();
      showPlayback(mode === 'direct' ? null : lastDecision);
    } catch (e) {
      toast('Couldn\'t reload the subtitles (' + e.message + ')');
    }
  }

  // Start/stop drawing an external subtitle file for the current selection.
  function syncSidecar() {
    if (!isSidecarText(subStream)) {
      cueTrack = null;
      cueFor = null;
      clearInterval(cueTimer);
      if (!isEmbeddedText(subStream)) showCue(NO_CUE);
      return;
    }
    if (cueFor === subStream) return;
    cueFor = subStream;
    const stream = subStream;
    cueTrack = null;
    subOff = subOffset(stream.id);
    fetch(session.server.url(stream.key, { encoding: 'utf-8' }))
      .then(r => {
        if (!r.ok) { const e = new Error('Plex answered ' + r.status); e.status = r.status; throw e; }
        return r.text();
      })
      .then(text => {
        if (cueFor !== stream || !alive) return;
        const cues = parseSubtitles(text, stream.codec);
        cueTrack = new CueTrack(cues);
        log('subtitles loaded', stream.displayTitle, cues.length + ' cues');
        if (!cues.length) toast('These subtitles are empty or unreadable');
      })
      .catch(e => {
        if (cueFor !== stream || !alive) return;
        warn('subtitle fetch failed', e.message);
        if ((e.status === 404 || e.status === 400 || e.status === 500) && !refreshedFor[stream.id]) {
          // The file moved (Bazarr often replaces subtitles after a download):
          // have Plex re-read the title, then pick the same language again.
          refreshedFor[stream.id] = true;
          toast('Subtitle file changed on the server, reloading it…');
          reloadSubtitlesAfterRefresh(stream);
        } else {
          toast('Couldn\'t load the subtitles (' + e.message + ')');
        }
      });
    clearInterval(cueTimer);
    cueTimer = setInterval(() => {
      // Positive offset = show each line later, so look up an earlier time.
      if (cueTrack && started) showCue(cueTrack.at(base + player.time() - subOff));
    }, 120);
  }

  async function start() {
    try {
      // The details page fetched everything moments ago: reuse it, saving a trip to the server.
      const fresh = preloaded && preloaded.ratingKey === item.ratingKey && Date.now() - (preloaded._at || 0) < 120000 &&
        (preloaded.Media || []).some(m => m.Part && m.Part[0]);
      const full = fresh ? preloaded : await session.server.metadata(item.ratingKey);
      if (!alive) return;
      if (fresh) log('player: using the details already loaded');
      item = full;
      duration = item.duration || duration;
      const medias = item.Media || [];
      // The version picked on the detail page, else the one played last time.
      media = medias[mediaIndex == null ? rememberedVersion(item) : mediaIndex] || medias[0];
      mediaIdx = Math.max(0, medias.indexOf(media));
      rememberVersion(item, mediaIdx);
      part = media && media.Part && media.Part[0];
      if (!part) throw new Error('No playable media');
      await learnShowGenres(item, session.server);  // is it anime? (once per show)
      if (!alive) return;
      // Picked on the detail page, else this show's remembered languages (or the
      // previous episode's), else Plex's selection; and audio the TV can play.
      const picked = pickTracks(item, part, { audioStreamID, subtitleStreamID, langs });
      audioStream = picked.audio;
      subStream = picked.sub;
      if (picked.switched) {
        setTimeout(() => toast('Playing ' + audioLabel(audioStream) + ': the TV can\'t play ' +
          ((picked.switched.codec || '').toUpperCase() === 'DCA' ? 'DTS' : audioLabel(picked.switched))), 1500);
      }
      quality = effectiveQuality(quality.id, media);
      markers = (item.Marker || []).filter(m => (m.type === 'intro' || m.type === 'credits') &&
        m.endTimeOffset > m.startTimeOffset);
      renderTitles();
      mode = decideMode();
      if (dvWithoutFallback(media) && !quality.kbps) {
        setTimeout(() => { if (mode === 'hls' && !triedDvDirect) toast('Converting the picture: this Dolby Vision version has no HDR the TV can show'); }, 2500);
      }
      if (offset == null) offset = item.viewOffset || 0;
      position = offset;
      renderProgress(position);
      showOsd();
      await open(offset);
      if (together) startTogether(); else loadNeighbors();
    } catch (e) {
      failed(e.message || String(e));
    }
  }

  function failed(msg) {
    if (!alive) return;
    if (mode === 'direct' && forceDirect() && !quality.kbps) {
      error('direct play failed (forced)', msg);
      toggleClass(spinner, 'on', false);
      errorEl.classList.remove('hidden');
      setText(errorEl, 'The TV couldn\'t play this file directly (' + msg + '). Turn off Force direct play in Settings to let your server convert it.');
      return;
    }
    if (mode === 'direct' && !triedFallback && media) {
      // The file looked direct-playable but the TV choked: let Plex convert it.
      warn('direct play failed (' + msg + '), falling back to HLS');
      triedFallback = true;
      // Only a refusal before the first picture says the file can't play
      // directly; a failure later on may just be the network.
      failMsg = started ? '' : msg || 'failed';
      mode = 'hls';
      open(position).catch(e => failed(e.message));
      return;
    }
    if (mode === 'hls' && !started && !triedDvDirect && !quality.kbps && media && dvWithoutFallback(media)) {
      // The server couldn't convert this Dolby Vision version: better to play it
      // as it is (colours may look off) than not at all.
      warn('Dolby Vision conversion failed (' + msg + '), playing the file as it is');
      triedDvDirect = true;
      triedFallback = true;
      mode = 'direct';
      toast('Your server couldn\'t convert this Dolby Vision version, so it plays as it is: colours may look off');
      open(position).catch(e => failed(e.message));
      return;
    }
    error('playback failed', msg);
    toggleClass(spinner, 'on', false);
    errorEl.classList.remove('hidden');
    setText(errorEl, 'Playback failed: ' + msg);
  }

  // --- Controls ---------------------------------------------------------

  function togglePause(fromRemote) {
    if (!started) return;
    if (lobby && paused && fromRemote !== true) endLobby();
    if (paused) {
      player.play();
      paused = false;
      showOsd();
    } else {
      player.pause();
      paused = true;
      showOsd(true);
    }
    markPaused(paused);
    report(paused ? 'paused' : 'playing');
    if (link && fromRemote !== true) link.local({ paused });
  }

  // ◀ ▶ step 10 s, ⏪ ⏩ 30 s; held or pressed quickly, the steps grow.
  function seekBy(dir, big) {
    if (!started) return;
    const now = Date.now();
    seekCount = now - lastSeekAt < 700 ? seekCount + 1 : 0;
    lastSeekAt = now;
    const step = big ? (seekCount < 4 ? 30000 : seekCount < 12 ? 60000 : 180000)
      : seekCount < 3 ? 10000 : seekCount < 8 ? 30000 : seekCount < 16 ? 60000 : 180000;
    const from = seekTarget == null ? position : seekTarget;
    seekTarget = Math.max(0, Math.min(duration - 3000, from + dir * step));
    toggleClass(el, 'seeking', true);
    setText(seekLabel, clock(seekTarget));
    renderProgress(seekTarget);
    showThumb(seekTarget);
    showOsd(true);
    clearTimeout(seekTimer);
    seekTimer = setTimeout(commitSeek, SEEK_COMMIT_MS);
  }

  async function commitSeek() {
    clearTimeout(seekTimer);
    if (seekTarget == null) return;
    const target = seekTarget;
    seekTarget = null;
    toggleClass(el, 'seeking', false);
    showOsd();
    position = target;
    if (link) link.local({ seek: true });
    try {
      if (mode === 'direct') {
        toggleClass(spinner, 'on', true);
        await player.seek(target);
        toggleClass(spinner, 'on', false);
        if (paused && !link) togglePause();
      } else {
        await open(target);
      }
    } catch (e) {
      warn('seek failed, reopening', e.message);
      open(target).catch(err => failed(err.message));
    }
  }

  // --- Watch Together ---------------------------------------------------
  // Everyone starts paused at the same spot; it plays once the others are
  // ready, or when someone presses play. After that, whoever pauses, plays or
  // jumps moves everyone, and small drifts are corrected by a quiet jump.

  function startTogether() {
    if (!paused) { player.pause(); paused = true; markPaused(true); }
    renderLobby();
    link = new TogetherLink(together.room, together.uri, {
      state: () => ({ positionMs: seekTarget == null ? position : seekTarget, paused, ready: started && !buffering && !syncBusy }),
      apply: applyRemote,
      roster: list => { roster = list; renderTogether(); },
      notice: text => toast(text),
    });
    link.connect().catch(e => { warn('watch together failed', e.message); toast('Couldn\'t join Watch Together (' + e.message + ')'); });
  }

  function endLobby() {
    lobby = false;
    toggleClass(lobbyEl, 'hidden', true);
    toggleClass(el, 'in-lobby', false);
  }

  function renderLobby() {
    if (!lobby) return;
    const others = roster.filter(u => !u.self);
    lobbyEl.innerHTML = '';
    h('div', 'together-lobby-title', lobbyEl).textContent = together.host
      ? (others.length ? 'Everyone\'s here' : 'Waiting for your friends to join…')
      : 'Joined ' + (together.room.title || 'Watch Together');
    const hostUser = (together.room.users || []).find(u => u.id === together.room.createdBy);
    h('div', 'together-lobby-people', lobbyEl).textContent = others.length
      ? others.map(u => u.name + (u.ready ? ' ✓' : ' · getting ready')).join('   ·   ')
      : together.host ? 'They\'ll see an invite in Plex' : 'Waiting for ' + ((hostUser && (hostUser.title || hostUser.username)) || 'your friend') + ' to start';
    h('div', 'together-lobby-hint', lobbyEl).textContent = 'Press OK to start for everyone';
    toggleClass(lobbyEl, 'hidden', false);
    toggleClass(el, 'in-lobby', true);
  }

  function renderTogether() {
    const others = roster.filter(u => !u.self);
    setText(togetherEl, 'Watching together' + (others.length ? ' with ' + others.map(u => u.name).join(', ') : ' · waiting'));
    toggleClass(togetherEl, 'hidden', !link);
    renderLobby();
    // The host starts by itself once everyone invited is in and ready.
    if (lobby && together.host && others.length && others.every(u => u.ready) && paused && started) {
      toast('Everyone\'s ready');
      togglePause();
    }
  }

  async function applyRemote(r) {
    if (!started || syncBusy || seekTarget != null) { pendingRemote = r; return; }
    pendingRemote = null;
    if (r.paused !== paused) {
      if (lobby) endLobby();
      togglePause(true);
      toast(r.by + (r.paused ? ' paused' : ' pressed play'));
    }
    const diff = (position - r.positionMs) / 1000;
    const far = r.seek ? Math.abs(diff) > 1.5 : r.paused ? Math.abs(diff) > 2 : (diff >= 4 || diff <= -1.75);
    if (!far) return;
    if (r.seek) toast(r.by + ' jumped to ' + clock(r.positionMs));
    syncBusy = true;
    try {
      position = Math.max(0, r.positionMs);
      renderProgress(position);
      if (mode === 'direct') {
        await player.seek(position);
      } else {
        await open(position);
        if (paused || r.paused) { player.pause(); paused = true; markPaused(true); }
      }
    } catch (e) {
      warn('together seek failed', e.message);
    } finally {
      syncBusy = false;
      if (pendingRemote) applyRemote(pendingRemote);
    }
  }

  // --- Audio / subtitle picker ------------------------------------------

  const PANEL_COLS = [
    { name: 'Audio', icon: icons.audio },
    { name: 'Subtitles', icon: icons.subtitles },
    { name: 'Quality', icon: icons.quality },
    { name: 'Episode', icon: icons.tv },
  ];
  let panelCols = PANEL_COLS.slice(0, 3); // Episode only for episodes with neighbours
  let panelCol = 0;
  let panelIndex = [0, 0, 0];
  let panelLists = [[], [], []];

  // With more than one version, the Quality column starts with them; the
  // conversions listed under them apply to the version playing.
  function versionOptions() {
    const medias = item.Media || [];
    if (medias.length < 2) return [];
    return versionRows(medias).map((r, i) => ({ label: r.label, detail: r.detail, version: i, on: i === mediaIdx }));
  }

  function openPanel() {
    const audios = streamsOf(part, 2);
    const texts = streamsOf(part, 3);
    panelLists = [
      audios.map(s => ({ label: audioLabel(s), stream: s, on: s === audioStream })),
      [{ label: 'Off', stream: null, on: !subStream }].concat(texts.map(s => ({ label: subtitleLabel(s), stream: s, on: s === subStream }))),
      versionOptions().concat(qualitiesFor(media).map(q => ({ label: q.label, quality: q, on: q === quality }))),
    ];
    const eps = [];
    if (neighbors.prev) eps.push({ label: 'Previous  ·  ' + episodeLabel(neighbors.prev) + '  ' + neighbors.prev.title, episode: neighbors.prev });
    if (neighbors.next) eps.push({ label: 'Next  ·  ' + episodeLabel(neighbors.next) + '  ' + neighbors.next.title, episode: neighbors.next });
    if (eps.length) panelLists.push(eps);
    panelCols = PANEL_COLS.slice(0, panelLists.length);
    if (panelLists[2].some(o => o.version != null)) panelCols[2] = { name: 'Version', icon: icons.versions };
    toggleClass(panel, 'tracks-4', panelCols.length > 3);
    // External subtitle files are drawn by us, so their timing can be nudged.
    if (isSidecarText(subStream)) panelLists[1].push({ offset: true, label: timingLabel() });
    panelIndex = panelLists.map(l => Math.max(0, l.findIndex(x => x.on)));
    panelFirst = panelLists.map(() => 0);
    panelCol = 0;
    renderPanel();
    panel.classList.remove('hidden');
    hideOsd();
  }

  // Long lists (30 subtitle tracks...) scroll so the focused or chosen row is
  // always visible, with a row of context above and below. Rows have a fixed
  // height, so nothing needs measuring.
  const PANEL_ROW = 68;      // .tracks-opt height + margin
  const PANEL_VISIBLE = 11;  // rows that fit under the column heading
  let panelFirst = [];

  function scrollPanel(c) {
    const n = panelLists[c].length;
    if (n <= PANEL_VISIBLE) { panelFirst[c] = 0; return; }
    const i = panelIndex[c];
    let first = panelFirst[c] || 0;
    if (i < first + 1) first = i - 1;
    if (i > first + PANEL_VISIBLE - 2) first = i - PANEL_VISIBLE + 2;
    panelFirst[c] = Math.max(0, Math.min(first, n - PANEL_VISIBLE));
  }

  function renderPanel() {
    panel.innerHTML = '';
    panelCols.forEach((spec, c) => {
      const col = h('div', 'tracks-col', panel);
      const head = h('div', 'tracks-head', col);
      head.innerHTML = spec.icon;
      h('span', '', head).textContent = spec.name;
      scrollPanel(c);
      const clip = h('div', 'tracks-list', col);
      const listEl = h('div', 'tracks-track', clip);
      const first = panelFirst[c];
      const n = panelLists[c].length;
      toggleClass(clip, 'more-up', first > 0);
      toggleClass(clip, 'more-down', first + PANEL_VISIBLE < n);
      if (first) setTransform(listEl, 'translateY(' + (-first * PANEL_ROW) + 'px)');
      panelLists[c].forEach((opt, i) => {
        const row = h('div', 'tracks-opt' + (opt.offset ? ' tracks-adjust' : '') + (opt.detail ? ' two-line' : ''), listEl);
        if (opt.detail) {
          h('div', 'tracks-opt-label', row).textContent = opt.label;
          h('div', 'tracks-opt-detail', row).textContent = opt.detail;
        } else {
          row.textContent = opt.label;
        }
        toggleClass(row, 'on', opt.on);
        toggleClass(row, 'focus', c === panelCol && i === panelIndex[c]);
      });
    });
  }

  async function choose(col, opt) {
    const server = session.server;
    if (col === 3) { playEpisode(opt.episode); return; }
    if (col === 2 && opt.version != null) {
      panel.classList.add('hidden');
      if (opt.version !== mediaIdx) switchVersion(opt.version);
      return;
    }
    if (col === 2) {
      panel.classList.add('hidden');
      if (opt.quality === quality) return;
      quality = opt.quality;
      requestedQuality = quality.id;
      mode = decideMode();
      triedFallback = false;
      await open(position).catch(e => failed(e.message));
      return;
    }
    if (col === 0) audioStream = opt.stream;
    else subStream = opt.stream;
    // Remember the language for the rest of this show.
    if (col === 0) rememberShowTracks(showKeyOf(item), { audio: langOf(audioStream) });
    else rememberShowTracks(showKeyOf(item), { sub: subStream ? langOf(subStream) : null, subForced: !!(subStream && subStream.forced) });
    server.selectStreams(part.id, {
      audioStreamID: audioStream ? audioStream.id : undefined,
      subtitleStreamID: subStream ? subStream.id : 0,
    });
    panel.classList.add('hidden');
    const wanted = decideMode();
    if (wanted === 'direct' && mode === 'direct') {
      applyTracks();
      syncSidecar();
      showPlayback(null);
    } else if (mode === 'hls' && wanted === 'hls' && col === 1 && isSidecarText(subStream)) {
      syncSidecar();
      showPlayback(lastDecision);
    } else {
      mode = wanted;
      triedFallback = false;
      await open(position).catch(e => failed(e.message));
    }
  }

  // Green button: subtitles off, or back on with the last track used (else
  // the server's pick, else the first one).
  function toggleSubtitles() {
    const texts = streamsOf(part, 3);
    if (!texts.length) { toast('No subtitles for this video'); return; }
    let next = null;
    if (subStream) lastSub = subStream;
    else next = (lastSub && texts.indexOf(lastSub) >= 0 && lastSub) || texts.find(s => s.selected) || texts[0];
    toast(next ? 'Subtitles: ' + subtitleLabel(next) : 'Subtitles off');
    choose(1, { stream: next });
  }

  function timingLabel() {
    return '‹  Timing ' + offsetLabel(subOff) + '  ›';
  }

  function panelKey(action) {
    if (action === 'back' || action === 'up' && panelIndex[panelCol] === 0) { panel.classList.add('hidden'); return true; }
    const cur = panelLists[panelCol][panelIndex[panelCol]];
    if (cur && cur.offset) {
      // On the timing row, left/right adjust instead of switching columns.
      if (action === 'left' || action === 'right') {
        const step = action === 'right' ? SUB_OFFSET_STEP : -SUB_OFFSET_STEP;
        subOff = Math.max(-SUB_OFFSET_MAX, Math.min(SUB_OFFSET_MAX, subOff + step));
        setSubOffset(subStream.id, subOff);
        cur.label = timingLabel();
        renderPanel();
        return true;
      }
      if (action === 'enter') { panel.classList.add('hidden'); return true; }
    }
    if (action === 'left') panelCol = Math.max(0, panelCol - 1);
    if (action === 'right') panelCol = Math.min(panelCols.length - 1, panelCol + 1);
    if (action === 'up') panelIndex[panelCol]--;
    if (action === 'down') panelIndex[panelCol] = Math.min(panelLists[panelCol].length - 1, panelIndex[panelCol] + 1);
    if (action === 'enter') {
      const opt = panelLists[panelCol][panelIndex[panelCol]];
      if (opt) choose(panelCol, opt);
      return true;
    }
    renderPanel();
    return true;
  }

  // --- Ending -----------------------------------------------------------

  // The episode before (dir -1) or after (+1) this one, across seasons
  // (Specials only when watching Specials).
  async function neighborEpisode(dir) {
    const server = session.server;
    const eps = await server.children(item.parentRatingKey);
    const i = eps.findIndex(e => e.ratingKey === item.ratingKey);
    if (i >= 0 && eps[i + dir]) return eps[i + dir];
    const seasons = (await server.children(item.grandparentRatingKey))
      .filter(s => s.type === 'season' && (s.index > 0 || item.parentIndex === 0));
    const si = seasons.findIndex(s => s.ratingKey === item.parentRatingKey);
    const other = si >= 0 ? seasons[si + dir] : null;
    if (!other) return null;
    const list = await server.children(other.ratingKey);
    return (dir > 0 ? list[0] : list[list.length - 1]) || null;
  }

  // For the Episode column and the ⏮ ⏭ keys, looked up once playback runs.
  function loadNeighbors() {
    if (item.type !== 'episode') return;
    Promise.all([neighborEpisode(-1).catch(() => null), neighborEpisode(1).catch(() => null)])
      .then(([prev, next]) => { if (alive) neighbors = { prev, next }; });
  }

  async function finished() {
    position = duration;
    activeMarker = null;
    toggleClass(skipBtn, 'hidden', true);
    report('stopped');
    clearInterval(timelineTimer);
    player.close();
    if (item.type !== 'episode' || link) { exit(); return; }
    try { nextItem = neighbors.next || await neighborEpisode(1); } catch (e) { nextItem = null; }
    if (!alive) return;
    if (!nextItem) { exit(); return; }
    let left = 10;
    upnext.classList.remove('hidden');
    const render = () => {
      upnext.innerHTML = '';
      h('div', 'upnext-label', upnext).textContent = 'Up next in ' + left;
      h('div', 'upnext-title', upnext).textContent = episodeLabel(nextItem) + '   ' + nextItem.title;
      h('div', 'upnext-hint', upnext).textContent = 'OK to play now · Back to stop';
    };
    render();
    upnextTimer = setInterval(() => {
      left--;
      if (left <= 0) playNext();
      else render();
    }, 1000);
  }

  function playNext() {
    playEpisode(nextItem);
  }

  // Keep the quality and the track languages the user was watching with.
  function playEpisode(ep) {
    clearInterval(upnextTimer);
    const langs = {
      audio: langOf(audioStream),
      sub: subStream ? langOf(subStream) : null,
      subForced: !!(subStream && subStream.forced),
    };
    router.replace(PlayerScreen(ep, { offset: 0, quality: requestedQuality, langs }));
  }

  // Another file of the same title, from the same point and in the same languages.
  function switchVersion(i) {
    const langs = {
      audio: langOf(audioStream),
      sub: subStream ? langOf(subStream) : null,
      subForced: !!(subStream && subStream.forced),
    };
    rememberVersion(item, i);
    router.replace(PlayerScreen(item, { offset: position, quality: requestedQuality, mediaIndex: i, langs }));
  }

  function exit() {
    router.back();
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    // What was playing last (after any up-next episodes): the show's page goes back to it.
    if (item && item.type === 'episode') {
      session.lastPlayed = {
        key: item.ratingKey, season: item.parentRatingKey, show: item.grandparentRatingKey,
        finished: !!duration && position >= duration * 0.9,
      };
    }
    if (started && position < duration) report('stopped');
    [seekTimer, osdTimer, subTimer, signTimer, toastTimer].forEach(clearTimeout);
    dropThumbs();
    clearInterval(timelineTimer);
    clearInterval(upnextTimer);
    clearInterval(cueTimer);
    clearInterval(clockTimer);
    player.destroy();
    if (link) link.close();
    if (hlsStarted) session.server.stopTranscode(playSession);
    document.documentElement.classList.remove('playing');
    setScreenSaver(true);
    document.removeEventListener('visibilitychange', onVisibility);
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => background(true), 800);
  }

  function onVisibility() {
    if (document.hidden) {
      if (started && !paused) togglePause();
      player.suspend();
    } else {
      player.restore();
    }
  }

  return {
    el,
    name: 'player',
    onShow() {
      document.documentElement.classList.add('playing');
      setScreenSaver(false);
      document.addEventListener('visibilitychange', onVisibility);
      clearTimeout(resumeTimer);
      background(false);
      renderTitles();
      if (!started) start();
    },
    onKey(action) {
      if (!upnext.classList.contains('hidden')) {
        if (action === 'enter') { playNext(); return true; }
        if (action === 'back' || action === 'stop') { exit(); return true; }
        return true;
      }
      if (!panel.classList.contains('hidden')) return panelKey(action);
      switch (action) {
        case 'enter':
          if (seekTarget != null) commitSeek();
          // The skip button takes OK while it's showing, like other players
          // (Play/Pause still pauses).
          else if (activeMarker && !paused) skipMarker();
          else if (el.classList.contains('osd-on') || paused) togglePause();
          else showOsd();
          return true;
        case 'playpause': if (seekTarget != null) commitSeek(); else togglePause(); return true;
        case 'play': if (paused) togglePause(); return true;
        case 'pause': if (!paused) togglePause(); return true;
        case 'left': seekBy(-1); return true;
        case 'right': seekBy(1); return true;
        case 'rw': seekBy(-1, true); return true;
        case 'ff': seekBy(1, true); return true;
        case 'prev': if (link) toast('Not while watching together'); else if (neighbors.prev) playEpisode(neighbors.prev); else toast('This is the first episode'); return true;
        case 'next': if (link) toast('Not while watching together'); else if (neighbors.next) playEpisode(neighbors.next); else toast('This is the last episode'); return true;
        case 'up': case 'info': showOsd(); return true;
        case 'down': if (part) openPanel(); return true;
        // Green on remotes that have colour keys; CH ▲/▼ on the ones that don't.
        case 'green': case 'pageup': case 'pagedown': if (part) toggleSubtitles(); return true;
        case 'stop': exit(); return true;
        case 'back':
          if (seekTarget != null) { seekTarget = null; toggleClass(el, 'seeking', false); renderProgress(position); showOsd(); return true; }
          if (el.classList.contains('osd-on') && !paused) { hideOsd(); return true; }
          exit();
          return true;
      }
      return true;
    },
    onHide() {},
    destroy: teardown,
  };
}
