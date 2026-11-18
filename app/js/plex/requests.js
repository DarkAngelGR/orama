import { session } from '../session.js';
import * as store from '../util/store.js';
import { profileKey } from '../util/taste.js';
import { matchMedia, mediaKey } from './availability.js';
import * as downloads from './downloads.js';
import * as watchlist from './watchlist.js';

const listeners = new Map();
const pending = new Map();
const refreshing = new Map();
let timer;
let cursor = 0;

function activeScope() {
  const viewer = profileKey(session.user, session.server);
  const companion = watchlist.baseUrl();
  return viewer && companion ? 'requests:' + JSON.stringify([viewer, companion]) : '';
}

export function currentRequests() {
  return read(activeScope());
}

function read(scope) {
  if (!scope) return [];
  const cutoff = Date.now() - 30 * 86400000;
  return store.get(scope, []).filter(row => row.requestedAt >= cutoff);
}

function notify() {
  for (const fn of listeners.keys()) {
    try { fn(); } catch (e) { /* Other screens can still receive the update. */ }
  }
}

function storeRequest(scope, row) {
  const list = read(scope);
  const previous = list.find(r => r.key === row.key);
  if (JSON.stringify(previous) === JSON.stringify(row)) return;
  const next = previous ? list.map(r => r.key === row.key ? row : r) : [row].concat(list);
  store.set(scope, next.slice(0, 24));
  if (scope === activeScope()) notify();
}

export function tracked(item) {
  return read(activeScope()).find(r => r.key === mediaKey(item));
}

function removeStaged(scope, key, triggerId) {
  const list = read(scope);
  const next = list.filter(row => row.key !== key || row.triggerId !== triggerId);
  if (list.length === next.length) return;
  store.set(scope, next);
  if (scope === activeScope()) notify();
}

export async function inspectRequest(item, { fresh = false } = {}) {
  const scope = activeScope();
  const server = session.server;
  const kind = item.type;
  const id = kind === 'show' ? item.tvdb : item.tmdb;
  if (!scope || !id || !server) return { availability: { status: 'unknown' }, source: null };
  const [availability, found] = await Promise.all([
    server.findPlayable(item, { fresh }).catch(() => ({ status: 'unknown' })),
    watchlist.lookup(kind, { id, fresh }).catch(() => null),
  ]);
  if (scope !== activeScope() || server !== session.server) return { availability: { status: 'unknown' }, source: null };
  const source = (found || []).find(x => matchMedia(item, x) === true) || null;
  return { availability, source, at: Date.now() };
}

export function requestStatus(previous, availability, arrStatus, queue, unavailable) {
  if (availability && availability.status === 'ready') {
    return { status: 'ready', unavailable, playable: availability.item, queue };
  }
  if (unavailable && (previous.status !== 'ready' || !availability || availability.status === 'unknown')) {
    return { ...previous, unavailable: true };
  }
  if (queue && !queue.estimated) return { status: queue.status, unavailable, queue };
  const status = arrStatus === 'have' || previous.status === 'importing' && !arrStatus ? 'importing'
    : arrStatus === 'requested' ? 'waiting' : 'requested';
  return { status, unavailable, checking: !availability || availability.status === 'unknown' };
}

export function acquire(item, { search = false, triggerId = '', allowed = () => true } = {}) {
  const scope = activeScope();
  const key = mediaKey(item);
  if (!scope || !key) return Promise.resolve({ status: 'unavailable' });
  const lock = scope + key;
  if (pending.has(lock)) return pending.get(lock);
  const user = session.user && session.user.title;
  const request = (async () => {
    const current = await inspectRequest(item, { fresh: true });
    if (scope !== activeScope() || !current.source || !allowed()) return { status: 'unavailable' };
    if (!search && current.availability.status === 'ready') return { status: 'have', item: current.availability.item };
    if (!search && (triggerId || item.tasteReason) && current.availability.status !== 'missing') return { status: 'unavailable' };
    if (triggerId && current.source.arrStatus !== 'none') return { status: 'already-there' };
    const previous = read(scope).find(r => r.key === key);
    const { type, title, year, tmdb, tvdb, imdb, thumb } = item;
    const row = {
      key, item: { type, title, year, tmdb, tvdb, imdb, thumb, catalog: true, arr: true, ratingKey: item.ratingKey },
      requestedAt: previous ? previous.requestedAt : Date.now(),
      auto: !!(previous && previous.auto),
    };
    if (triggerId) storeRequest(scope, { ...row, triggerId, state: { status: 'checking-auto' } });
    let result;
    try {
      result = triggerId ? await watchlist.autoFetch(item, triggerId)
        : search ? await watchlist.searchAgain(item)
        : current.source.arrStatus === 'none' ? await watchlist.requestTitle(item, user) : { status: 'already-there' };
    } catch (e) {
      if (!triggerId) throw e;
      if (!e.status || e.status >= 500) return { status: 'pending' };
      removeStaged(scope, key, triggerId);
      throw e;
    }
    if (triggerId && result.status === 'pending') return result;
    if (triggerId && result.status !== 'added') {
      removeStaged(scope, key, triggerId);
      return result;
    }
    if (['added', 'searching', 'active', 'pending', 'already-there'].includes(result.status)) {
      storeRequest(scope, {
        ...row, auto: !!triggerId || row.auto,
        state: { status: result.status === 'searching' ? 'searching' : 'requested', unavailable: false },
      });
    }
    return result;
  })().finally(() => pending.delete(lock));
  pending.set(lock, request);
  return request;
}

async function refresh(row, scope) {
  const lock = scope + row.key;
  if (refreshing.has(lock)) return;
  refreshing.set(lock, true);
  try {
    if (row.triggerId) {
      const result = await watchlist.autoFetchStatus(row.item, row.triggerId).catch(() => null);
      if (scope !== activeScope() || !result) return;
      const latest = read(scope).find(r => r.key === row.key);
      if (!latest || latest.triggerId !== row.triggerId) return;
      if (result.status === 'added') {
        const { triggerId, ...confirmed } = row;
        row = { ...confirmed, auto: true, state: { status: 'requested', unavailable: false } };
        storeRequest(scope, row);
      } else {
        if (result.status !== 'pending' && (result.status !== 'not-recorded' || Date.now() - row.requestedAt >= 120000)) {
          removeStaged(scope, row.key, row.triggerId);
        }
        return;
      }
    }
    const { availability, source } = await inspectRequest(row.item);
    if (scope !== activeScope()) return;
    const latest = read(scope).find(r => r.key === row.key);
    if (!latest || latest !== row && JSON.stringify(latest) !== JSON.stringify(row)) return;
    const queue = downloads.find(row.item);
    const state = requestStatus(row.state, availability, source && source.arrStatus, queue,
      downloads.unavailable(row.item.type) || !source);
    if (state.queue) {
      const { status, progress, timeleft, detail } = state.queue;
      state.queue = { status, progress, timeleft, detail };
    }
    if (state.playable) {
      const { ratingKey, title, type, jellyfin } = state.playable;
      state.playable = { ratingKey, title, type, jellyfin };
    }
    storeRequest(scope, { ...row, state, checkedAt: Date.now() });
  } finally {
    refreshing.delete(lock);
  }
}

function tick() {
  if (refreshing.size) return;
  const scope = activeScope();
  const list = read(scope);
  const key = Array.from(listeners.values()).find(Boolean);
  const next = list.find(r => r.key === key) || list[cursor++ % (list.length || 1)];
  if (next) refresh(next, scope).catch(() => {});
}

export function subscribeRequests(fn, item) {
  listeners.set(fn, item ? mediaKey(item) : '');
  if (!timer) { tick(); timer = setInterval(tick, 10000); }
  fn();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) { clearInterval(timer); timer = null; }
  };
}

export function describeRequest(row, live) {
  const state = row.state;
  const queue = live && !live.estimated ? live : state.queue;
  return [row.auto ? 'Auto-requested' : '', downloads.describe(queue || state),
    state.status === 'ready' && queue ? downloads.describe(state) : '',
    state.unavailable ? 'Status temporarily unavailable' : state.checking ? 'Checking your library' : '']
    .filter(Boolean).join(' · ');
}
