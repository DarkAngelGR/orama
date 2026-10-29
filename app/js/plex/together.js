// Plex Watch Together: watch in sync with friends on Plex (Plex Web on a PC,
// or another Orama). Plex's own cloud service, undocumented; the protocol is
// as reverse engineered and live-verified in plex-for-kodi's
// docs/watch-together.md (2026-10). Two parts:
//   * rooms, at together.plex.tv (your plex.tv token): list, create, invite, leave
//   * a Syncplay WebSocket relay per room (syncplayHost:syncplayPort from the
//     room): everyone sends their play state once a second and follows whoever
//     last paused, played or jumped.
// The room id is the only secret the relay has, so it never goes in logs.
import { identity, clientId } from './client.js';
import { session } from '../session.js';
import { deviceInfo } from '../platform/tizen.js';
import { log, warn } from '../util/log.js';

const API = 'https://together.plex.tv';
const TV = 'https://plex.tv/api/v2';

async function call(base, path, { method = 'GET', body, timeout = 12000 } = {}) {
  const headers = Object.assign({ Accept: 'application/json', 'X-Plex-Token': session.token }, identity());
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
  try {
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) {
      const e = new Error(res.status === 404 ? 'That session has ended' : res.status === 403 ? 'You\'re not in that session' : 'Plex answered ' + res.status);
      e.status = res.status;
      throw e;   // (response bodies can leak internals: never shown or logged)
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

// --- rooms --------------------------------------------------------------------------

export function available() {
  return !!(session.token && session.server && session.server.kind !== 'jellyfin');
}

// Sessions you're in or invited to: [{ id, title, sourceUri, createdBy, users, endsAt, syncplayHost, syncplayPort }].
export async function rooms() {
  const r = await call(API, '/rooms');
  const now = Date.now() / 1000;
  return (r.rooms || []).filter(x => !x.endsAt || x.endsAt > now);
}

export function room(id) { return call(API, '/rooms/' + encodeURIComponent(id)); }

// "server://<machine>/com.plexapp.plugins.library/library/metadata/<key>" for this server's item.
export function sourceUriOf(item) {
  return 'server://' + session.server.id + '/com.plexapp.plugins.library/library/metadata/' + item.ratingKey;
}

// The rating key, when the room's title is on the server we're connected to (bare or provider:// form).
export function ratingKeyOf(uri) {
  const m = /server:\/\/([^/]+)\/.*\/library\/metadata\/(\d+)/.exec(String(uri || ''));
  if (!m) return null;
  return session.server && m[1] === session.server.id ? m[2] : null;
}

export async function createRoom(item, title) {
  return call(API, '/rooms', { method: 'POST', body: { sourceUri: sourceUriOf(item), title, users: null } });
}

export function invite(roomId, userIds) {
  return call(API, '/rooms/' + encodeURIComponent(roomId) + '/invite', { method: 'POST', body: { users: userIds } });
}

export function leave(roomId) {
  return call(API, '/rooms/' + encodeURIComponent(roomId), { method: 'DELETE' }).catch(() => {});
}

// People you can invite: Plex friends (and Plex Home members), [{ id, title, thumb }].
export async function friends() {
  const list = await call(TV, '/friends').catch(() => []);
  return (Array.isArray(list) ? list : []).map(f => ({ id: f.id, title: f.title || f.friendlyName || f.username, thumb: f.thumb }))
    .filter(f => f.id);
}

let me = null;
export async function myAccount() {
  if (me && me.token === session.token) return me;
  const u = await call(TV, '/user');
  me = { token: session.token, id: u.id, title: u.title || u.friendlyName || u.username || 'You' };
  return me;
}

// --- the relay ------------------------------------------------------------------------

const VERSION = '1.6.4';
const strip = s => String(s || '').replace(/_+$/, '');   // the relay adds _ to duplicate names
function parseIdentity(s) {
  try { return JSON.parse(strip(s)); } catch (e) { return null; }
}

// One room's live connection. hooks:
//   state() -> { positionMs, paused, ready }      what this TV is doing now
//   apply({ paused, positionMs, seek, by })      a friend paused / played / jumped / drifted
//   roster([{ key, name, ready, self }])          who's in the room
//   notice(text)
export class TogetherLink {
  constructor(roomRec, uri, hooks) {
    this.room = roomRec;
    this.uri = uri;
    this.hooks = hooks;
    this.users = new Map();      // relay key -> { id, name, ready }
    this.relayIgnore = 0;        // ignoringOnTheFly.server: mirrored back every tick
    this.avgRtt = 0;
    this.forward = 0;            // seconds to add to a playing friend's position
    this.lastServerRtt = 0;
    this.pending = null;         // a local pause/play/seek to announce on the next tick
    this.graceUntil = 0;         // ignore friends' state briefly after our own change
    this.sentReady = undefined;
    this.closed = false;
    this.retry = 0;
  }

  async connect() {
    const acct = await myAccount();
    const dev = deviceInfo();
    this.self = { deviceIdentifier: clientId, deviceName: ('Orama ' + (dev.model || 'TV')).slice(0, 24), userID: String(acct.id) };
    this.identity = JSON.stringify(this.self);
    this.myName = acct.title;
    this.open();
  }

  open() {
    if (this.closed) return;
    const ws = this.ws = new WebSocket('wss://' + this.room.syncplayHost + ':' + this.room.syncplayPort + '/ws');
    ws.onopen = () => {
      this.retry = 0;
      this.send({ Hello: { room: { name: this.room.id }, username: this.identity, version: VERSION } });
      // Per-connection state: announce it all again on every (re)connect.
      this.send({ Set: { file: { name: JSON.stringify({ ads: { playing: false }, uri: this.uri }) } } });
      this.sentReady = undefined;
      this.send({ List: {} });
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 1000);
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.State) this.onState(msg.State);
      if (msg.Set) this.onSet(msg.Set);
      if (msg.List) this.onList(msg.List);
      if (msg.Hello) log('together: relay', msg.Hello.realversion || '?');
      if (msg.Error) warn('together: relay error', JSON.stringify(msg.Error).slice(0, 120));
    };
    ws.onclose = () => {
      clearInterval(this.timer);
      if (this.closed) return;
      // Back in a moment (the socket can drop with the network); then everything is re-announced.
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(() => this.open(), 1000 * this.retry);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  isSelf(key) {
    const id = parseIdentity(key);
    return !!id && id.deviceIdentifier === this.self.deviceIdentifier && String(id.userID) === this.self.userID;
  }

  nameOf(key) {
    const id = parseIdentity(key);
    if (!id) return 'Someone';
    const u = this.users.get(strip(key));
    return (u && u.name) || id.deviceName || 'Someone';
  }

  // Our pause / play / jump, from the remote: announced on the next tick (now).
  local(change) {
    this.pending = Object.assign(this.pending || {}, change);
    this.graceUntil = Date.now() + 2500;
    this.tick();
  }

  tick() {
    if (!this.ws || this.ws.readyState !== 1) return;
    const st = this.hooks.state();
    if (st.ready !== this.sentReady) {
      this.sentReady = st.ready;
      this.send({ Set: { ready: { isReady: !!st.ready, manuallyInitiated: true } } });
    }
    const p = this.pending;
    this.pending = null;
    this.send({ State: {
      ping: { clientLatencyCalculation: performance.now() / 1000, clientRtt: this.clientRtt || 0, serverRtt: this.lastServerRtt, latencyCalculation: Date.now() / 1000 },
      playstate: { doSeek: !!(p && p.seek), paused: !!st.paused, position: Math.max(0, Math.round(st.positionMs / 1000)), setBy: null },
      ignoringOnTheFly: { client: 0, server: this.relayIgnore },
    } });
  }

  onState(s) {
    this.relayIgnore = (s.ignoringOnTheFly && s.ignoringOnTheFly.server) || 0;
    const ping = s.ping || {};
    if (typeof ping.serverRtt === 'number') this.lastServerRtt = ping.serverRtt;
    if (typeof ping.clientLatencyCalculation === 'number') {
      const rtt = performance.now() / 1000 - ping.clientLatencyCalculation;
      if (rtt >= 0 && rtt < 10 && ping.serverRtt >= 0) {
        this.clientRtt = rtt;
        this.avgRtt = this.avgRtt ? 0.85 * this.avgRtt + 0.15 * rtt : rtt;
        this.forward = this.avgRtt / 2 + (ping.serverRtt < rtt ? Math.min(2, rtt - ping.serverRtt) : 0);
      }
    }
    const ps = s.playstate;
    if (!ps || !ps.setBy || this.isSelf(ps.setBy)) return;     // nobody yet, or our own echo
    if (Date.now() < this.graceUntil) return;                  // our change is still on its way
    const target = (Number(ps.position) + (ps.paused ? 0 : this.forward)) * 1000;
    this.hooks.apply({ paused: !!ps.paused, positionMs: target, seek: !!ps.doSeek, by: this.nameOf(ps.setBy) });
  }

  onSet(set) {
    if (set.ready && set.ready.username) {
      const k = strip(set.ready.username);
      const u = this.users.get(k) || {};
      u.ready = set.ready.isReady;
      this.users.set(k, u);
      this.emitRoster();
    }
    if (set.user) {
      Object.keys(set.user).forEach(key => {
        const k = strip(key);
        const ev = set.user[key].event || {};
        if (ev.joined && !this.isSelf(key)) {
          this.users.set(k, Object.assign(this.users.get(k) || {}, { joined: true }));
          this.lookupNames();
          this.hooks.notice(this.nameOf(key) + ' joined');
          // Someone new: fresh names from the room's member list.
          room(this.room.id).then(rec => { if (rec && rec.users) { this.room.users = rec.users; this.lookupNames(); this.emitRoster(); } }, () => {});
        } else if (ev.left && !this.isSelf(key)) {      // our own "left" is only advisory
          const name = this.nameOf(key);
          this.users.delete(k);
          this.hooks.notice(name + ' left');
        }
        this.emitRoster();
      });
    }
  }

  onList(list) {
    const roomUsers = list[this.room.id] || list[Object.keys(list)[0]] || {};
    const keep = new Map();
    Object.keys(roomUsers).forEach(key => {
      const k = strip(key);
      keep.set(k, Object.assign(this.users.get(k) || {}, { ready: roomUsers[key].isReady }));
    });
    this.users = keep;
    this.lookupNames();
    this.emitRoster();
  }

  // Friendly names from the room's member list (the relay only knows user ids).
  lookupNames() {
    const byId = new Map((this.room.users || []).map(u => [String(u.id), u.title || u.username]));
    this.users.forEach((u, k) => {
      const id = parseIdentity(k);
      if (id && byId.has(String(id.userID))) u.name = byId.get(String(id.userID));
    });
  }

  emitRoster() {
    const list = [];
    this.users.forEach((u, k) => list.push({ key: k, name: this.isSelf(k) ? this.myName : (u.name || this.nameOf(k)), ready: u.ready, self: this.isSelf(k) }));
    this.hooks.roster(list);
  }

  others() {
    let n = 0;
    this.users.forEach((u, k) => { if (!this.isSelf(k)) n++; });
    return n;
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    try { if (this.ws) this.ws.close(); } catch (e) { /* closing anyway */ }
  }
}
