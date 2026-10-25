// New Orama releases, and installing them through the Orama installer
// (installer/ in this repo), which runs on your server and does the signing
// and installing a TV app can't do for itself. Without the installer, Orama
// still asks GitHub directly so it can tell you an update is out.
import * as store from '../util/store.js';
import { VERSION } from '../config.js';
import { plexLanHost } from './watchlist.js';

export const DEFAULT_PORT = 8790;
export const GITHUB_REPO = 'DarkAngelGR/FlexPlex';

function parse(v) {
  return String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
}

// Is version a newer than b?
export function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

// 'auto' (the Plex server's host, port 8790), 'off', or 'manual'.
export function mode() { return store.get('upMode', 'auto'); }
export function setMode(m) { store.set('upMode', m === 'auto' ? undefined : m); }
export function manualUrl() { return store.get('upUrl', ''); }
export function password() { return store.get('upPassword', ''); }
export function setPassword(pw) { store.set('upPassword', pw || undefined); }

export function setManualUrl(url) {
  let u = (url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
  if (u && !/:\d+$/.test(u.replace(/^https?:\/\//i, ''))) u += ':' + DEFAULT_PORT;
  store.set('upUrl', u || undefined);
  if (u) setMode('manual');
  else if (mode() === 'manual') setMode('auto');
}

export function baseUrl() {
  const m = mode();
  if (m === 'off') return '';
  if (m === 'manual') return manualUrl();
  const host = plexLanHost();
  return host ? 'http://' + host + ':' + DEFAULT_PORT : '';
}

async function fetchJson(url, { method = 'GET', body, headers = {}, timeout = 8000 } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
  try {
    const res = await fetch(url, {
      method, headers: Object.assign(body !== undefined ? { 'Content-Type': 'application/json' } : {}, headers),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders() {
  const pw = password();
  return pw ? { Authorization: 'Basic ' + btoa('flexplex:' + pw) } : {};
}

// The installer's view: { installed, latest: {version, notes, ...},
// update_available, busy, last: {ok, message}, check_error }. Also tells it
// which version this TV runs.
export async function installerStatus() {
  const base = baseUrl();
  if (!base) throw new Error(mode() === 'off' ? 'The installer is off' : 'No local server address to try');
  let r;
  try {
    r = await fetchJson(base + '/api/status?installed=' + encodeURIComponent(VERSION), { headers: authHeaders() });
  } catch (e) {
    throw new Error('Can\'t reach the installer at ' + base.replace(/^https?:\/\//, ''));
  }
  if (r.status === 401) throw new Error('The installer needs its password');
  if (!r.ok || r.data.product !== 'flexplex-installer') throw new Error('That address isn\'t the Orama installer');
  return r.data;
}

export async function startInstall(version) {
  const r = await fetchJson(baseUrl() + '/api/install', { method: 'POST', body: version ? { version } : {}, headers: authHeaders() });
  if (r.status === 409) return { already: true };
  if (!r.ok) throw new Error(r.data.error || ('The installer answered ' + r.status));
  return r.data;
}

export async function installerCheck() {
  const r = await fetchJson(baseUrl() + '/api/check', { method: 'POST', headers: authHeaders(), timeout: 25000 });
  if (!r.ok) throw new Error(r.data.error || ('The installer answered ' + r.status));
  return r.data;
}

// Latest release straight from GitHub: { version, notes }.
export async function githubLatest() {
  const r = await fetchJson('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest',
    { headers: { Accept: 'application/vnd.github+json' }, timeout: 10000 });
  if (!r.ok) throw new Error(r.status === 404 ? 'No releases yet' : 'GitHub answered ' + r.status);
  return { version: String(r.data.tag_name || '').replace(/^v/i, ''), notes: r.data.body || '' };
}

// Latest version available, from the installer if it's there (it also means
// "can be installed from the TV"), else GitHub. { version, notes, viaInstaller }
export async function latest() {
  try {
    const s = await installerStatus();
    if (s.latest) return { version: s.latest.version, notes: s.latest.notes || '', viaInstaller: true };
  } catch (e) { /* fall back to GitHub */ }
  const g = await githubLatest();
  return Object.assign(g, { viaInstaller: false });
}

// Once per new version: should the home screen mention it?
export function shouldNotify(version) {
  if (!newer(version, VERSION) || store.get('upNotified') === version) return false;
  store.set('upNotified', version);
  return true;
}
