// Theme music on title pages, like Plex: the show's (or movie's) theme fades
// in quietly while its page is open and fades out when you leave or play.
// One <audio> element for the whole app; moving between pages of the same show
// keeps the song going.
import * as store from '../util/store.js';

const VOLUME = 0.3;
const FADE_IN_MS = 1500;
const FADE_OUT_MS = 700;
const STEP_MS = 50;

let audio = null;
let current = '';
let fadeTimer = 0;
let stopTimer = 0;

export function enabled() {
  return store.get('themeMusic', true) !== false;
}

export function setEnabled(on) {
  store.set('themeMusic', on ? undefined : false);
  if (!on) stop(true);
}

function fadeTo(target, ms, then) {
  clearInterval(fadeTimer);
  const start = audio.volume;
  const steps = Math.max(1, Math.round(ms / STEP_MS));
  let i = 0;
  fadeTimer = setInterval(() => {
    i++;
    audio.volume = Math.max(0, Math.min(1, start + (target - start) * (i / steps)));
    if (i >= steps) { clearInterval(fadeTimer); if (then) then(); }
  }, STEP_MS);
}

// url: the full theme URL (with token); '' stops.
export function play(url) {
  clearTimeout(stopTimer);
  if (!url || !enabled()) { stop(); return; }
  if (url === current && audio && !audio.paused) { fadeTo(VOLUME, 400); return; }
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => { current = ''; });
    audio.addEventListener('error', () => { current = ''; });
  }
  current = url;
  audio.volume = 0;
  audio.src = url;
  const p = audio.play();
  if (p && p.catch) p.catch(() => { current = ''; });
  fadeTo(VOLUME, FADE_IN_MS);
}

// Stop shortly after a page goes away, unless the next page plays the same theme.
export function stopSoon() {
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => stop(), 250);
}

export function stop(now) {
  clearTimeout(stopTimer);
  if (!audio || !current) return;
  const done = () => { audio.pause(); audio.removeAttribute('src'); try { audio.load(); } catch (e) { /* ignore */ } current = ''; };
  if (now) { clearInterval(fadeTimer); done(); } else fadeTo(0, FADE_OUT_MS, done);
}

export function nowPlaying() {
  return current && audio && !audio.paused ? { url: current, volume: audio.volume } : null;
}
