// Video backend: Samsung AVPlay (hardware decode, plays straight to the video
// plane under the web layer) on a Samsung TV. webOS and desktop browsers use
// <video>; webOS hardware-decodes mp4, mkv and HLS through that element.
//
// listener: { onTime(ms), onBuffering(bool), onEnd(), onError(msg), onSubtitle(text, durationMs) }
import { isWebOS } from './tizen.js';

function avplayBackend(container, listener) {
  const av = webapis.avplay;
  const obj = document.createElement('object');
  obj.type = 'application/avplayer';
  obj.className = 'av-object';
  container.appendChild(obj);
  let opened = false;

  const api = {
    open(url, { uhd = false } = {}) {
      api.close();
      av.open(url);
      opened = true;
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      if (uhd) {
        try { av.setStreamingProperty('SET_MODE_4K', 'TRUE'); } catch (e) { /* not a UHD panel */ }
      }
      av.setListener({
        onbufferingstart: () => listener.onBuffering(true),
        onbufferingprogress: () => {},
        onbufferingcomplete: () => listener.onBuffering(false),
        oncurrentplaytime: ms => listener.onTime(ms),
        onstreamcompleted: () => listener.onEnd(),
        onerror: e => listener.onError(String(e)),
        onevent: () => {},
        onsubtitlechange: (duration, text) => listener.onSubtitle(text, Number(duration)),
        ondrmevent: () => {},
      });
    },
    prepare() {
      return new Promise((resolve, reject) => av.prepareAsync(resolve, e => reject(new Error(String(e && e.name || e)))));
    },
    play() { av.play(); },
    pause() { av.pause(); },
    seek(ms) {
      return new Promise((resolve, reject) => av.seekTo(Math.max(0, Math.floor(ms)), resolve, e => reject(new Error(String(e && e.name || e)))));
    },
    time() {
      try { return av.getCurrentTime(); } catch (e) { return 0; }
    },
    state() {
      try { return av.getState(); } catch (e) { return 'NONE'; }
    },
    tracks() {
      let info = [];
      try { info = av.getTotalTrackInfo() || []; } catch (e) {}
      return {
        audio: info.filter(t => t.type === 'AUDIO').map(t => t.index),
        text: info.filter(t => t.type === 'TEXT').map(t => t.index),
      };
    },
    // TEXT tracks with their language, from AVPlay's extra_info JSON
    // ({"track_lang":"gre","fourCC":"TTXT",...}).
    textTracks() {
      let info = [];
      try { info = av.getTotalTrackInfo() || []; } catch (e) {}
      return info.filter(t => t.type === 'TEXT').map(t => {
        let x = {};
        try { x = JSON.parse(t.extra_info || '{}'); } catch (e) {}
        return { index: t.index, lang: x.track_lang || x.language || '', fourCC: x.fourCC || '' };
      });
    },
    selectAudio(avIndex) {
      try { av.setSelectTrack('AUDIO', avIndex); return true; } catch (e) { return false; }
    },
    selectText(avIndex) {
      try {
        if (avIndex == null) { av.setSilentSubtitle(true); return true; }
        av.setSelectTrack('TEXT', avIndex);
        av.setSilentSubtitle(false);
        return true;
      } catch (e) { return false; }
    },
    // setSpeed only takes trick-play steps, not a small catch-up nudge.
    canRate() { return typeof av.setPlaybackRate === 'function'; },
    setRate(rate) {
      if (!api.canRate()) return false;
      try { av.setPlaybackRate(rate); return true; } catch (e) { return false; }
    },
    suspend() { try { av.suspend(); } catch (e) {} },
    restore() { try { av.restore(); } catch (e) {} },
    close() {
      if (!opened) return;
      opened = false;
      try { av.stop(); } catch (e) {}
      try { av.close(); } catch (e) {}
    },
    destroy() {
      api.close();
      if (obj.parentNode) obj.parentNode.removeChild(obj);
    },
  };
  return api;
}

function videoBackend(container, listener) {
  const v = document.createElement('video');
  v.className = 'av-object';
  container.appendChild(v);
  let active = false;
  let buffering = false;
  let audioPick = null;
  let textPick = undefined;
  const hooked = typeof WeakSet === 'function' ? new WeakSet() : null;

  function setBuffering(on) {
    if (buffering === on) return;
    buffering = on;
    listener.onBuffering(on);
  }

  function eachText(fn) {
    const list = v.textTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || t.kind === 'metadata' || t.kind === 'chapters') continue;
      fn(t, i);
    }
  }

  function hookText(track) {
    if (!track || (hooked && hooked.has(track)) || track._oramaHook) return;
    if (hooked) hooked.add(track);
    else track._oramaHook = true;
    track.oncuechange = () => {
      if (textPick == null) return;
      const list = v.textTracks;
      if (!list || list[textPick] !== track) return;
      const cues = track.activeCues;
      if (!cues || !cues.length) { listener.onSubtitle('', 0); return; }
      let text = '';
      for (let i = 0; i < cues.length; i++) text += (i ? '\n' : '') + (cues[i].text || '');
      listener.onSubtitle(text, 0);
    };
  }

  function applyText() {
    let ok = textPick == null;
    try {
      eachText((t, i) => {
        hookText(t);
        const on = textPick != null && i === textPick;
        t.mode = on ? 'hidden' : 'disabled';
        if (on) ok = true;
      });
    } catch (e) { return false; }
    return ok;
  }

  function applyAudio() {
    const list = v.audioTracks;
    if (!list || audioPick == null) return false;
    try {
      if (!list[audioPick]) return false;
      list[audioPick].enabled = true;
      for (let i = 0; i < list.length; i++) if (i !== audioPick) list[i].enabled = false;
      return true;
    } catch (e) { return false; }
  }

  v.addEventListener('timeupdate', () => listener.onTime(v.currentTime * 1000));
  v.addEventListener('waiting', () => setBuffering(true));
  v.addEventListener('stalled', () => setBuffering(true));
  v.addEventListener('playing', () => setBuffering(false));
  v.addEventListener('seeked', () => setBuffering(false));
  v.addEventListener('ended', () => { setBuffering(false); listener.onEnd(); });
  v.addEventListener('error', () => {
    if (!active) return;
    listener.onError('video error ' + (v.error && v.error.code));
  });
  if (v.textTracks) v.textTracks.onaddtrack = () => { if (textPick !== undefined) applyText(); };
  if (v.audioTracks) v.audioTracks.onaddtrack = () => { if (audioPick != null) applyAudio(); };

  return {
    open(url) {
      active = true;
      buffering = false;
      v.src = url;
    },
    prepare() {
      return new Promise((resolve, reject) => {
        const fail = () => reject(new Error('load failed'));
        v.addEventListener('loadedmetadata', resolve, { once: true });
        v.addEventListener('error', fail, { once: true });
        v.load();
      });
    },
    play() {
      try {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(e => {
          if (!active || (e && e.name === 'AbortError')) return;
          listener.onError((e && e.message) || 'play failed');
        });
      } catch (e) {
        if (active) listener.onError(e.message || 'play failed');
      }
    },
    pause() { v.pause(); },
    seek(ms) {
      const target = Math.max(0, ms) / 1000;
      if (!isNaN(v.currentTime) && Math.abs(v.currentTime - target) < 0.04 && !v.seeking) return Promise.resolve();
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = err => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          v.removeEventListener('seeked', onSeeked);
          v.removeEventListener('error', onError);
          if (err) reject(err); else resolve();
        };
        const onSeeked = () => finish();
        const onError = () => finish(new Error('seek failed'));
        const timer = setTimeout(() => finish(new Error('seek timed out')), 8000);
        v.addEventListener('seeked', onSeeked);
        v.addEventListener('error', onError);
        try { v.currentTime = target; }
        catch (e) { finish(e instanceof Error ? e : new Error(String(e))); }
      });
    },
    time() { return v.currentTime * 1000; },
    state() {
      if (!active || v.readyState === 0) return 'IDLE';
      if (buffering || v.seeking) return 'BUFFERING';
      if (v.ended) return 'IDLE';
      if (v.paused) return 'PAUSED';
      return 'PLAYING';
    },
    tracks() {
      const audio = [];
      const list = v.audioTracks;
      if (list) for (let i = 0; i < list.length; i++) audio.push(i);
      const text = [];
      eachText((t, i) => text.push(i));
      return { audio, text };
    },
    textTracks() {
      const out = [];
      eachText((t, i) => out.push({ index: i, lang: t.language || '', fourCC: '' }));
      return out;
    },
    selectAudio(avIndex) {
      audioPick = avIndex;
      return applyAudio();
    },
    selectText(avIndex) {
      textPick = avIndex == null ? null : avIndex;
      if (textPick == null) {
        try { listener.onSubtitle('', 0); } catch (e) {}
      }
      return applyText();
    },
    canRate() { return true; },
    setRate(rate) {
      try { v.playbackRate = rate; return true; } catch (e) { return false; }
    },
    suspend() {},
    restore() {},
    close() {
      active = false;
      buffering = false;
      v.removeAttribute('src');
      try { v.load(); } catch (e) {}
    },
    destroy() {
      active = false;
      v.removeAttribute('src');
      if (v.parentNode) v.parentNode.removeChild(v);
    },
  };
}

export function createPlayer(container, listener) {
  if (!isWebOS() && typeof webapis !== 'undefined' && webapis.avplay) return avplayBackend(container, listener);
  return videoBackend(container, listener);
}
