// Timings for Watchlist Sync, level "perf". Timestamps only, unless a companion
// address is configured: then requestAnimationFrame runs while a key is held.
// shortcut: once an address is found we keep sampling until the next launch, even if Settings turns it off.
import { report } from './report.js';

const EVAL_AT = Date.now();
const BUDGET_MS = 10 * 60 * 1000;
const BUDGET_MAX = 6;
const FRAME_EVERY = BUDGET_MS;
const MAX_SAMPLES = 360;
const IDLE_MS = 500;

export function launchOrigin() {
  const p = typeof performance !== 'undefined' ? performance : null;
  if (p && typeof p.timeOrigin === 'number' && p.timeOrigin > 0) return p.timeOrigin;
  const nav = p && p.timing && p.timing.navigationStart;
  if (nav) return nav;
  return EVAL_AT;
}

export function elapsed(origin, now) {
  return Math.max(0, Math.round(now - origin));
}

export function sinceLaunch(now = Date.now()) {
  return elapsed(launchOrigin(), now);
}

// Nearest rank. Empty input is 0 so a quiet window still formats.
export function percentile(values, p) {
  const n = values && values.length;
  if (!n) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const i = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return s[i];
}

// Max BUDGET_MAX sends per BUDGET_MS. No message dedupe: a repeated "play 12 direct" still counts.
export function allow(state, now) {
  const sent = state.sent;
  while (sent.length && now - sent[0] >= BUDGET_MS) sent.shift();
  if (sent.length >= BUDGET_MAX) return false;
  sent.push(now);
  return true;
}

export function take(state, message, now) {
  const msg = String(message == null ? '' : message).replace(/\s+/g, ' ').trim();
  if (!msg) return null;
  return allow(state, now) ? msg : null;
}

export function formatStart(ms) {
  return 'start ' + Math.round(ms);
}

export function formatHome(ms, cached) {
  return 'home ' + Math.round(ms) + (cached ? ' cached' : '');
}

export function formatPlay(ms, kind) {
  return 'play ' + Math.round(ms) + ' ' + (kind === 'hls' ? 'hls' : 'direct');
}

export function formatFrames(samples, worstMs) {
  let worst = worstMs || 0;
  for (let i = 0; i < samples.length; i++) if (samples[i] > worst) worst = samples[i];
  return 'frames p95 ' + Math.round(percentile(samples, 95)) + ' worst ' + Math.round(worst) + ' n ' + samples.length;
}

const budget = { sent: [] };

function emit(message, now = Date.now()) {
  const msg = take(budget, message, now);
  if (msg) report('perf', '', msg);
  return !!msg;
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

let startSent = false;
export function markInteractive() {
  if (startSent) return;
  startSent = true;
  emit(formatStart(sinceLaunch()));
}

let homeAt = 0;
let homeSent = false;
export function homeEnter() {
  if (!homeAt) homeAt = nowMs();
}

export function homeReady(cached) {
  if (homeSent || !homeAt) return;
  homeSent = true;
  emit(formatHome(Math.max(0, nowMs() - homeAt), !!cached));
}

export function playDone(t0, kind) {
  if (t0 == null) return;
  emit(formatPlay(Math.max(0, nowMs() - t0), kind));
}

let wsOn = false;
let arming = false;
export function arm() {
  if (wsOn || arming) return;
  arming = true;
  import('../plex/watchlist.js').then(m => { wsOn = !!m.baseUrl(); }).catch(() => {}).finally(() => { arming = false; });
}

let sampling = false;
let lastFrame = 0;
let samples = [];
let worst = 0;
let idleTimer = 0;
let framesSentAt = 0;

function endBurst() {
  sampling = false;
  if (samples.length < 4) return;
  const now = Date.now();
  if (framesSentAt && now - framesSentAt < FRAME_EVERY) return;
  const sent = emit(formatFrames(samples, worst), now);
  framesSentAt = now;
  if (!sent) return;
  samples = [];
  worst = 0;
}

function frame(now) {
  if (!sampling) return;
  const dt = now - lastFrame;
  lastFrame = now;
  if (dt > 0 && dt < 1000) {
    if (dt > worst) worst = dt;
    if (samples.length < MAX_SAMPLES) samples.push(dt);
  }
  requestAnimationFrame(frame);
}

export function noteKey() {
  if (!wsOn) return;
  const now = nowMs();
  if (!sampling) {
    sampling = true;
    lastFrame = now;
    requestAnimationFrame(frame);
  }
  clearTimeout(idleTimer);
  idleTimer = setTimeout(endBurst, IDLE_MS);
}
