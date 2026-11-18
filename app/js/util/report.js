// Fire-and-forget reports to Watchlist Sync (POST /api/tv/log). Never throws
// and never waits. A missing companion, a 404 from an older one, and any
// network failure are ignored.
import { VERSION } from '../config.js';

const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 10;
const bucket = { seen: new Map(), sent: [] };
let whereOf = () => 'app';

export function setReportWhere(fn) {
  whereOf = fn || (() => 'app');
}

export function clip(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) : s;
}

// Drop passwords, tokens and Basic/Bearer secrets. A plain server address stays.
export function redact(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]*:[^/\s@]*@/gi, '$1');
  s = s.replace(/([?&#](?:X-Plex-Token|access_token|api[_-]?key|token|password|passwd|secret|auth)=)[^&#\s]*/gi, '$1redacted');
  s = s.replace(/\b(Bearer\s+)\S+/gi, '$1redacted');
  s = s.replace(/\b(Basic\s+)[A-Za-z0-9+/=]+/gi, '$1redacted');
  s = s.replace(/\b((?:X-Plex-Token|Authorization)\b["']?\s*[:=]\s*["']?)[^\s"',&]+/gi, '$1redacted');
  return s;
}

// The message to send, or null when it is empty, a repeat from the last minute,
// or the 11th new report in that minute. Repeats do not use up the 10 slots.
export function consider(state, message, now) {
  const msg = clip(redact(message).replace(/\s+/g, ' ').trim(), 500);
  if (!msg) return null;
  for (const [k, t] of state.seen) if (now - t >= WINDOW_MS) state.seen.delete(k);
  while (state.sent.length && now - state.sent[0] >= WINDOW_MS) state.sent.shift();
  if (state.seen.has(msg)) return null;
  if (state.sent.length >= MAX_PER_WINDOW) return null;
  state.seen.set(msg, now);
  state.sent.push(now);
  return msg;
}

export function reportBody({ level, where, message, version, device }) {
  const msg = clip(message, 500);
  if (!msg) return null;
  return {
    level: level === 'warn' ? 'warn' : 'error',
    message: msg,
    where: clip(where || 'app', 80) || 'app',
    version: clip(version, 20),
    device: clip(device, 40),
  };
}

function screen() {
  try { return whereOf() || 'app'; } catch (e) { return 'app'; }
}

export function report(level, where, message) {
  const place = where || screen();
  Promise.resolve().then(() => deliver(level, place, message)).catch(() => {});
}

async function deliver(level, where, message) {
  try {
    const ws = await import('../plex/watchlist.js');
    const base = ws.baseUrl();
    if (!base) return;
    const msg = consider(bucket, message, Date.now());
    if (!msg) return;
    let device = 'TV';
    try {
      const { deviceInfo } = await import('../platform/tizen.js');
      device = deviceInfo().name || device;
    } catch (e) {}
    const body = reportBody({ level, where, message: msg, version: VERSION, device });
    if (!body) return;
    const headers = { 'Content-Type': 'application/json' };
    const pw = ws.password();
    if (pw) {
      try { headers.Authorization = 'Basic ' + btoa('flexplex:' + pw); } catch (e) { return; }
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : 0;
    fetch(base + '/api/tv/log', {
      method: 'POST', headers, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined,
    }).catch(() => {}).finally(() => clearTimeout(timer));
  } catch (e) {}
}
