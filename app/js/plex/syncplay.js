// Jellyfin SyncPlay (Watch Together). HTTP creates and joins a group; the
// /socket feed carries Play, Pause, Seek and Stop. The player follows those.
// Left out: speeding up or skipping to hide drift, and moving the group to
// the next episode. Loaded only when a group is opened.
import { session } from '../session.js';
import { clientId } from './client.js';
import { jfRequest } from './jellyfin.js';

const TICKS = 10000;

export function msOf(ticks) {
  return Math.round((Number(ticks) || 0) / TICKS);
}

export function ticksOf(ms) {
  return Math.round((Number(ms) || 0) * TICKS);
}

// A socket message the player can act on, or null.
export function syncMessage(msg) {
  if (!msg || !msg.MessageType) return null;
  if (msg.MessageType === 'SyncPlayCommand') {
    const d = msg.Data || {};
    if (d.Command !== 'Pause' && d.Command !== 'Unpause' && d.Command !== 'Seek' && d.Command !== 'Stop') return null;
    return {
      type: 'command', command: d.Command, when: d.When || '',
      positionMs: msOf(d.PositionTicks), playlistItemId: d.PlaylistItemId || '',
    };
  }
  if (msg.MessageType !== 'SyncPlayGroupUpdate') return null;
  const wrap = msg.Data || {};
  if (wrap.Type === 'PlayQueue') {
    const q = wrap.Data || {};
    const list = Array.isArray(q.Playlist) ? q.Playlist : [];
    const index = q.PlayingItemIndex >= 0 && q.PlayingItemIndex < list.length ? q.PlayingItemIndex : 0;
    const cur = list[index] || {};
    return {
      type: 'queue', itemId: cur.ItemId || '', playlistItemId: cur.PlaylistItemId || '',
      startMs: msOf(q.StartPositionTicks), reason: q.Reason || '',
    };
  }
  return { type: 'group', update: wrap.Type || '', data: wrap.Data || {} };
}

// What the player should do with a command. Seek does not change pause.
export function playbackOf(command) {
  if (!command || command.type !== 'command') return null;
  if (command.command === 'Stop') return { stop: true, by: 'The group' };
  if (command.command === 'Seek') return { positionMs: command.positionMs, seek: true, by: 'The group' };
  if (command.command === 'Pause' || command.command === 'Unpause') {
    return { paused: command.command === 'Pause', positionMs: command.positionMs, seek: false, by: 'The group' };
  }
  return null;
}

// Wait for a command that is due shortly. A time far away means the clock is off.
export function commandDelay(when, now) {
  const at = Date.parse(when || '');
  if (!at) return 0;
  const delta = at - now;
  if (delta <= 0 || delta > 5000) return 0;
  return delta;
}

// The server sends our own Pause/Seek back. Ignore that copy.
export function isEcho(sent, command, now) {
  if (!sent || !command || command.type !== 'command') return false;
  if (now > sent.until) return false;
  if (sent.command !== command.command) return false;
  if (command.command === 'Seek') return Math.abs((command.positionMs || 0) - (sent.positionMs || 0)) <= 2000;
  return true;
}

// Home row. The group list has no playing item, so the tile is the group name.
export function groupTile(g) {
  const people = Array.isArray(g && g.Participants) ? g.Participants.filter(Boolean) : [];
  return {
    ratingKey: 'sync-' + (g && g.GroupId || ''),
    type: 'movie',
    title: (g && g.GroupName) || 'Watch together',
    note: people.length ? people.join(', ') : ((g && g.State) || 'Join'),
    syncplay: { groupId: g && g.GroupId || '', name: (g && g.GroupName) || '' },
  };
}

function api(path, opts) {
  const s = session.server;
  if (!s) throw new Error('Not signed in');
  return jfRequest(s.uri, path, Object.assign({ token: session.token, timeout: 8000 }, opts));
}

function socketUrl() {
  const s = session.server;
  const base = String(s && s.uri || '').replace(/^http/i, 'ws').replace(/\/+$/, '');
  return base + '/socket?api_key=' + encodeURIComponent(session.token || '') + '&deviceId=' + encodeURIComponent(clientId);
}

export function listGroups() {
  return api('/SyncPlay/List').then(list => (Array.isArray(list) ? list : []).filter(g => g && g.GroupId));
}

export function createGroup(name) {
  return api('/SyncPlay/New', { method: 'POST', body: { GroupName: name || 'Watch together' } }).then(g => {
    if (!g || !g.GroupId) throw new Error('This Jellyfin did not return a group');
    return g;
  });
}

export function joinGroup(id) {
  return api('/SyncPlay/Join', { method: 'POST', body: { GroupId: id } });
}

export function leaveGroup() {
  return api('/SyncPlay/Leave', { method: 'POST' }).catch(() => {});
}

function closeSocket(ws) {
  if (!ws) return;
  ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
  try { ws.close(); } catch (e) { /* already closed */ }
}

// Join, then return the item the group is playing. null when it has no queue.
export function waitForQueue(groupId, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let ws;
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSocket(ws);
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(null, null), timeoutMs);
    try { ws = new WebSocket(socketUrl()); }
    catch (e) { finish(e); return; }
    ws.onopen = () => {
      try { ws.send('{"MessageType":"KeepAlive"}'); } catch (e) { /* closed */ }
      // Already in the group is fine. An idle group has nothing to play.
      joinGroup(groupId).catch(err => {
        if (!err || (err.status !== 400 && err.status !== 409)) throw err;
      }).then(() => api('/SyncPlay/' + encodeURIComponent(groupId))).then(g => {
        if (g && g.State === 'Idle') finish(null, null);
      }).catch(err => finish(err));
    };
    ws.onmessage = e => {
      let data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      const parsed = syncMessage(data);
      if (parsed && parsed.type === 'queue' && parsed.itemId) {
        finish(null, { itemId: parsed.itemId, playlistItemId: parsed.playlistItemId, startMs: parsed.startMs });
      }
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => { if (!settled) finish(null, null); };
  });
}

// One group's live connection. hooks: state(), apply(remote), roster(list), notice(text).
export class SyncPlayLink {
  constructor(opts, hooks) {
    this.opts = opts || {};
    this.hooks = hooks || {};
    this.ws = null;
    this.closed = false;
    this.playlistItemId = this.opts.playlistItemId || '';
    this.echo = null;
    this.lastReady = undefined;
    this.timer = 0;
    this.keep = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let opened = false;
      try { this.ws = new WebSocket(socketUrl()); }
      catch (e) { reject(e); return; }
      this.ws.onopen = () => {
        opened = true;
        try { this.ws.send('{"MessageType":"KeepAlive"}'); } catch (e) { /* closed */ }
        this.ws.onmessage = e => this.onMessage(e);
        this.keep = setInterval(() => {
          if (this.ws && this.ws.readyState === 1) {
            try { this.ws.send('{"MessageType":"KeepAlive"}'); } catch (e) { /* closed */ }
          }
        }, 30000);
        resolve();
      };
      this.ws.onerror = () => { /* onclose follows */ };
      this.ws.onclose = () => { if (!opened && !this.closed) reject(new Error('SyncPlay disconnected')); };
    }).then(() => {
      if (!this.opts.host) return null;
      return api('/SyncPlay/SetNewQueue', { method: 'POST', body: {
        PlayingQueue: [this.opts.itemId], PlayingItemPosition: 0, StartPositionTicks: ticksOf(this.opts.startMs),
      }});
    }).then(() => {
      api('/SyncPlay/Ping', { method: 'POST', body: { Ping: 1 } }).catch(() => {});
      this.timer = setInterval(() => this.report(), 1000);
      this.report();
      this.refresh().catch(() => {});
    });
  }

  onMessage(e) {
    if (this.closed) return;
    let data;
    try { data = JSON.parse(e.data); } catch (err) { return; }
    const parsed = syncMessage(data);
    if (!parsed) return;
    if (parsed.type === 'queue') {
      if (parsed.playlistItemId) this.playlistItemId = parsed.playlistItemId;
      if (parsed.itemId && this.opts.itemId && parsed.itemId !== this.opts.itemId) {
        if (this.hooks.notice) this.hooks.notice('The group moved to another title. This TV stays on the current one.');
      }
      this.lastReady = undefined;
      this.report();
      return;
    }
    if (parsed.type === 'group') {
      if (/UserJoined|UserLeft|GroupJoined/.test(parsed.update)) this.refresh().catch(() => {});
      return;
    }
    if (isEcho(this.echo, parsed, Date.now())) return;
    const action = playbackOf(parsed);
    if (!action) return;
    const wait = commandDelay(parsed.when, Date.now());
    setTimeout(() => { if (!this.closed && this.hooks.apply) this.hooks.apply(action); }, wait);
  }

  report() {
    if (this.closed || !this.playlistItemId || !this.hooks.state) return;
    const st = this.hooks.state();
    const ready = !!st.ready;
    if (ready === this.lastReady) return;
    this.lastReady = ready;
    api(ready ? '/SyncPlay/Ready' : '/SyncPlay/Buffering', { method: 'POST', body: {
      When: new Date().toISOString(),
      PositionTicks: ticksOf(st.positionMs),
      IsPlaying: !st.paused,
      PlaylistItemId: this.playlistItemId,
    }}).catch(() => {});
  }

  local(change) {
    if (this.closed || !this.hooks.state) return;
    const st = this.hooks.state();
    const command = change && change.seek ? 'Seek' : (st.paused ? 'Pause' : 'Unpause');
    this.echo = { command, positionMs: st.positionMs, until: Date.now() + 1500 };
    const path = command === 'Seek' ? '/SyncPlay/Seek' : command === 'Pause' ? '/SyncPlay/Pause' : '/SyncPlay/Unpause';
    const body = command === 'Seek' ? { PositionTicks: ticksOf(st.positionMs) } : undefined;
    api(path, { method: 'POST', body }).catch(() => {});
  }

  refresh() {
    if (!this.opts.groupId || !this.hooks.roster) return Promise.resolve();
    return api('/SyncPlay/' + encodeURIComponent(this.opts.groupId)).then(g => {
      if (this.closed || !g) return;
      const me = session.user && session.user.title;
      this.hooks.roster((g.Participants || []).map(name => ({ name, self: name === me, ready: false })));
    });
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.keep);
    closeSocket(this.ws);
    this.ws = null;
    leaveGroup();
  }
}
