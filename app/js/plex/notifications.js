// Live news from the Plex server: library scans in progress, and items added,
// changed or removed. Uses the server's notification WebSocket (the same feed
// Plex's own apps use); if that can't connect, falls back to asking for
// /activities every 15 s.
//
// subscribe(fn) calls fn({ activities }) whenever the list of running library
// activities changes, and fn({ changed: true }) (debounced) after the library's
// contents change. It returns an unsubscribe function; the connection only
// runs while someone is subscribed.
import { session } from '../session.js';
import { warn } from '../util/log.js';

const POLL_MS = 15000;
const CHANGE_DEBOUNCE_MS = 4000;
const LIBRARY_TYPES = { 1: 1, 2: 1, 3: 1, 4: 1 }; // movie, show, season, episode
const DONE = 5, DELETED = 9;                      // timeline states that change what's listed

const listeners = new Set();
let ws = null;
let server = null;
let retry = 0;
let retryTimer = 0;
let pollTimer = 0;
let changeTimer = 0;
const activities = new Map(); // uuid -> { type, title, subtitle, progress, sectionId }

function emit(ev) {
  listeners.forEach(fn => { try { fn(ev); } catch (e) { warn('notification listener failed', e.message); } });
}

export function current() {
  return Array.from(activities.values());
}

function emitActivities() {
  emit({ activities: current() });
}

function libraryChanged() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => emit({ changed: true }), CHANGE_DEBOUNCE_MS);
}

// Only library work is interesting here (not transcodes, backups, ...).
function isLibrary(a) {
  return a && typeof a.type === 'string' && a.type.indexOf('library.') === 0;
}

function slim(a) {
  return {
    type: a.type, title: a.title || '', subtitle: a.subtitle || '',
    progress: typeof a.progress === 'number' ? a.progress : -1,
    sectionId: a.Context && a.Context.librarySectionID ? String(a.Context.librarySectionID) : '',
  };
}

function onActivity(list) {
  let touched = false;
  (list || []).forEach(n => {
    const a = n.Activity || {};
    const id = n.uuid || a.uuid;
    if (!id || !isLibrary(a)) return;
    if (n.event === 'ended') {
      if (activities.delete(id)) { touched = true; libraryChanged(); }
    } else {
      activities.set(id, slim(a));
      touched = true;
    }
  });
  if (touched) emitActivities();
}

function onTimeline(list) {
  if ((list || []).some(t => LIBRARY_TYPES[t.type] && (t.state === DONE || t.state === DELETED)
      && t.identifier === 'com.plexapp.plugins.library')) {
    libraryChanged();
  }
}

function onMessage(e) {
  let data;
  try { data = JSON.parse(e.data); } catch (err) { return; }
  const c = data && data.NotificationContainer;
  if (!c) return;
  if (c.type === 'activity') onActivity(c.ActivityNotification);
  else if (c.type === 'timeline') onTimeline(c.TimelineEntry);
}

function wsUrl(s) {
  const base = s.uri.replace(/^http/i, 'ws').replace(/\/+$/, '');
  return base + '/:/websockets/notifications?X-Plex-Token=' + encodeURIComponent(s.token);
}

function connect() {
  server = session.server;
  if (!server || typeof WebSocket === 'undefined') { startPolling(); return; }
  let opened = false;
  try {
    ws = new WebSocket(wsUrl(server));
  } catch (e) {
    startPolling();
    return;
  }
  ws.onopen = () => {
    opened = true;
    retry = 0;
    stopPolling();
    poll(); // pick up a scan that was already running
  };
  ws.onmessage = onMessage;
  ws.onclose = () => {
    ws = null;
    if (!listeners.size) return;
    // Couldn't connect at all, or dropped: poll meanwhile, retry with backoff.
    if (!opened || retry > 2) startPolling();
    retry++;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (listeners.size && !ws) connect(); }, Math.min(60000, 2000 * Math.pow(2, retry)));
  };
  ws.onerror = () => { /* onclose follows */ };
}

async function poll() {
  const s = session.server;
  if (!s) return;
  let list;
  try {
    const mc = await s.get('/activities');
    list = (mc.Activity || []).filter(isLibrary);
  } catch (e) {
    return; // not allowed (shared user) or unreachable: just show nothing
  }
  const seen = new Set();
  let touched = false;
  list.forEach(a => {
    seen.add(a.uuid);
    const before = activities.get(a.uuid);
    const now = slim(a);
    if (!before || before.progress !== now.progress || before.subtitle !== now.subtitle) touched = true;
    activities.set(a.uuid, now);
  });
  Array.from(activities.keys()).forEach(id => {
    if (!seen.has(id)) { activities.delete(id); touched = true; libraryChanged(); }
  });
  if (touched) emitActivities();
}

function startPolling() {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, POLL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = 0;
}

function disconnect() {
  clearTimeout(retryTimer);
  clearTimeout(changeTimer);
  stopPolling();
  if (ws) { ws.onclose = null; try { ws.close(); } catch (e) { /* already closed */ } }
  ws = null;
  activities.clear();
  retry = 0;
}

export function subscribe(fn) {
  listeners.add(fn);
  // A different server (switched in Settings) needs a fresh connection.
  if (server && session.server !== server) disconnect();
  if (!ws && !pollTimer) connect();
  else fn({ activities: current() });
  return () => {
    listeners.delete(fn);
    if (!listeners.size) disconnect();
  };
}
