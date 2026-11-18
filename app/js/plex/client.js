// Shared request plumbing for plex.tv and Plex Media Server.
import { VERSION } from '../config.js';
import { deviceInfo } from '../platform/tizen.js';
import * as store from '../util/store.js';
import { uuid } from '../util/format.js';

export const PRODUCT = 'Orama';

let clientId = store.get('clientId');
if (!clientId) {
  clientId = uuid();
  store.set('clientId', clientId);
}
export { clientId };

const device = deviceInfo();

// Identity params, also needed as query params on URLs we hand to AVPlay
// (which can't send headers).
export function identity() {
  return {
    'X-Plex-Product': PRODUCT,
    'X-Plex-Version': VERSION,
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Platform': device.platform,
    'X-Plex-Platform-Version': '6.5',
    'X-Plex-Device': device.model,
    'X-Plex-Device-Name': device.name,
    'X-Plex-Model': device.model,
  };
}

export function query(params) {
  const parts = [];
  for (const k in params) {
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  return parts.join('&');
}

export function withQuery(url, params) {
  const q = query(params);
  if (!q) return url;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + q;
}

export class HttpError extends Error {
  constructor(status, url) {
    super('HTTP ' + status + ' from ' + url.split('?')[0].replace(/^https?:\/\/[^/]+/, ''));
    this.status = status;
  }
}

export function unreadable(url) {
  const err = new HttpError(0, url || '');
  err.message = 'The server sent an unreadable response';
  return err;
}

// Objects, arrays and booleans are all real API bodies. null and broken text are not.
export function readJson(text, url) {
  const raw = text == null ? '' : String(text);
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    if (data == null) throw unreadable(url);
    return data;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw unreadable(url);
  }
}

export function asTimeout(e) {
  if (!e || e.name !== 'AbortError') return e;
  const err = new Error('The server didn\'t answer in time');
  err.name = 'AbortError';
  err.status = 0;
  return err;
}

export async function request(url, { method = 'GET', token, params, timeout = 15000, body, raw } = {}) {
  const headers = Object.assign({ Accept: 'application/json' }, identity());
  if (token) headers['X-Plex-Token'] = token;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
  const full = withQuery(url, params);
  try {
    const res = await fetch(full, { method, headers, body, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new HttpError(res.status, full);
    if (raw) return res;
    return readJson(await res.text(), full);
  } catch (e) {
    throw asTimeout(e);
  } finally {
    clearTimeout(timer);
  }
}
