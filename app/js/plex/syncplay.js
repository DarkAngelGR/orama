// Jellyfin SyncPlay (Watch Together). HTTP creates and joins a group; the
// /socket feed carries Play, Pause, Seek, Stop and playlist changes. The
// player follows those, nudges small drift, and moves with the group to the
// next episode. Loaded only when a group is opened.
import { session } from '../session.js';
import { clientId } from './client.js';
import { jfRequest } from './jellyfin.js';

const TICKS = 10000;
const DRIFT_IGNORE_MS = 150;
const DRIFT_SEEK_MS = 1000;
const DRIFT_LARGE_MS = 2000;
const DRIFT_HOLD_MS = 4000;
const CLOCK_WINDOW = 7;

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
    if (d.Command === 'Ping') return { type: 'ping', when: d.When || '', emittedAt: d.EmittedAt || '' };
    if (d.Command !== 'Pause' && d.Command !== 'Unpause' && d.Command !== 'Seek' && d.Command !== 'Stop') return null;
    return {
      type: 'command', command: d.Command, when: d.When || '', emittedAt: d.EmittedAt || '',
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
      startMs: msOf(q.StartPositionTicks), reason: q.Reason || '', index,
      items: list.map(it => ({ itemId: (it && it.ItemId) || '', playlistItemId: (it && it.PlaylistItemId) || '' })),
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

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Server clock minus local clock, from a rolling window of samples.
export function clockOffset(samples) {
  const ok = (samples || []).filter(n => Number.isFinite(n)).slice(-CLOCK_WINDOW);
  return ok.length ? median(ok) : null;
}

// One sample from a command the socket just delivered. EmittedAt is when the
// server sent it. When is the scheduled instant, used only if EmittedAt is absent.
export function clockSample(parsed, receivedAt) {
  if (!parsed || !Number.isFinite(receivedAt)) return null;
  const server = Date.parse(parsed.emittedAt || parsed.when || '');
  return Number.isFinite(server) ? server - receivedAt : null;
}

// NTP-style offset from GET /GetUtcTime. Positive means the server is ahead.
export function pingOffset(times) {
  if (!times) return null;
  const { sent, receivedAt, requestReceived, responseSent } = times;
  if (![sent, receivedAt, requestReceived, responseSent].every(Number.isFinite)) return null;
  return ((requestReceived - sent) + (responseSent - receivedAt)) / 2;
}

// Where the group should be now. `offsetMs` is server clock minus local clock.
export function expectedAt(anchor, now, offsetMs) {
  if (!anchor) return null;
  const base = anchor.positionMs || 0;
  if (anchor.paused) return base;
  const when = Date.parse(anchor.when || '');
  if (!Number.isFinite(when)) return base;
  return base + (now + (Number(offsetMs) || 0) - when);
}

// driftMs is local position minus the group's. Null means leave playback alone.
export function driftAction({ driftMs, canRate = false, busy = false, sinceCommandMs = DRIFT_HOLD_MS, holdMs = DRIFT_HOLD_MS } = {}) {
  if (busy || sinceCommandMs < holdMs || !Number.isFinite(driftMs)) return null;
  const abs = Math.abs(driftMs);
  if (abs < DRIFT_IGNORE_MS) return null;
  if (abs > DRIFT_LARGE_MS) return { type: 'seek' };
  if (canRate) {
    const rate = Math.max(0.92, Math.min(1.08, 1 - driftMs / 4000));
    if (Math.abs(rate - 1) < 0.01) return null;
    return { type: 'rate', rate };
  }
  if (abs > DRIFT_SEEK_MS) return { type: 'seek' };
  return null;
}

// The group's playlist moved to a different item.
export function queueFollow(currentId, queue) {
  if (!queue || queue.type !== 'queue' || !queue.itemId || queue.itemId === currentId) return null;
  return { itemId: queue.itemId, startMs: queue.startMs || 0, playlistItemId: queue.playlistItemId || '' };
}

// How to ask the group for the next episode when ours ends.
export function advancePlan(queue, localNextId) {
  const items = (queue && queue.items) || [];
  const index = queue && Number.isFinite(queue.index) ? queue.index : -1;
  const next = items[index + 1];
  if (next && next.playlistItemId) return { kind: 'set', playlistItemId: next.playlistItemId };
  if (localNextId) return { kind: 'queue-next', itemId: localNextId };
  return { kind: 'stop' };
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

// One group's live connection. hooks: state(), apply(remote), roster(list),
// notice(text), follow(item), canRate(), rate(n).
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
    this.correctTimer = 0;
    this.clockTimer = 0;
    this.commandSamples = [];
    this.pingOffsetMs = null;
    this.anchor = null;
    this.lastCommandAt = 0;
    this.queue = null;
    this.nudging = false;
  }

  offsetMs() {
    return this.pingOffsetMs != null ? this.pingOffsetMs : clockOffset(this.commandSamples);
  }

  noteCommandClock(parsed, receivedAt) {
    const sample = clockSample(parsed, receivedAt);
    if (sample == null) return;
    this.commandSamples.push(sample);
    if (this.commandSamples.length > CLOCK_WINDOW) this.commandSamples.shift();
  }

  // GET /GetUtcTime is the clock ping. If it gives nothing, command timestamps fill in.
  syncClock() {
    if (this.closed) return;
    const sent = Date.now();
    api('/GetUtcTime').then(data => {
      if (this.closed || !data) return;
      const receivedAt = Date.now();
      const requestReceived = Date.parse(data.RequestReceptionTime);
      const responseSent = Date.parse(data.ResponseTransmissionTime);
      const sample = pingOffset({ sent, receivedAt, requestReceived, responseSent });
      if (sample == null) return;
      this.pingOffsetMs = sample;
      const rtt = Math.max(0, Math.round((receivedAt - sent) - (responseSent - requestReceived)));
      api('/SyncPlay/Ping', { method: 'POST', body: { Ping: rtt } }).catch(() => {});
    }).catch(() => {});
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
      this.syncClock();
      this.clockTimer = setInterval(() => this.syncClock(), 20000);
      this.timer = setInterval(() => this.report(), 1000);
      this.correctTimer = setInterval(() => this.correct(), 3000);
      this.report();
      this.refresh().catch(() => {});
    });
  }

  onMessage(e) {
    if (this.closed) return;
    let data;
    try { data = JSON.parse(e.data); } catch (err) { return; }
    const receivedAt = Date.now();
    const parsed = syncMessage(data);
    if (!parsed) return;
    if (parsed.type === 'ping') {
      this.noteCommandClock(parsed, receivedAt);
      return;
    }
    if (parsed.type === 'queue') {
      this.queue = parsed;
      if (parsed.playlistItemId) this.playlistItemId = parsed.playlistItemId;
      const jump = queueFollow(this.opts.itemId, parsed);
      if (jump && this.hooks.follow) this.hooks.follow(jump);
      else if (jump && this.hooks.notice) this.hooks.notice('The group moved to another title.');
      this.lastReady = undefined;
      this.report();
      return;
    }
    if (parsed.type === 'group') {
      if (/UserJoined|UserLeft|GroupJoined/.test(parsed.update)) this.refresh().catch(() => {});
      return;
    }
    if (this.pingOffsetMs == null) this.noteCommandClock(parsed, receivedAt);
    if (isEcho(this.echo, parsed, receivedAt)) return;
    const action = playbackOf(parsed);
    if (!action) return;
    this.lastCommandAt = receivedAt;
    if (parsed.command === 'Pause' || parsed.command === 'Unpause') {
      this.anchor = { positionMs: parsed.positionMs, when: parsed.when, paused: parsed.command === 'Pause' };
    } else if (parsed.command === 'Seek') {
      this.anchor = { positionMs: parsed.positionMs, when: parsed.when, paused: !!(this.anchor && this.anchor.paused) };
    }
    if (this.nudging && this.hooks.rate) { this.hooks.rate(1); this.nudging = false; }
    const wait = commandDelay(parsed.when, receivedAt);
    setTimeout(() => { if (!this.closed && this.hooks.apply) this.hooks.apply(action); }, wait);
  }

  correct() {
    if (this.closed || !this.anchor || this.anchor.paused || !this.hooks.state) return;
    const st = this.hooks.state();
    const since = this.lastCommandAt ? Date.now() - this.lastCommandAt : DRIFT_HOLD_MS;
    const expected = expectedAt(this.anchor, Date.now(), this.offsetMs());
    const action = driftAction({
      driftMs: expected == null ? NaN : st.positionMs - expected,
      canRate: !!(this.hooks.canRate && this.hooks.canRate()),
      busy: !st.ready || !!st.paused || !!st.busy,
      sinceCommandMs: since,
    });
    if (!action) {
      if (this.nudging && this.hooks.rate) { this.hooks.rate(1); this.nudging = false; }
      return;
    }
    this.lastCommandAt = Date.now();
    if (action.type === 'rate' && this.hooks.rate) {
      this.nudging = true;
      this.hooks.rate(action.rate);
      return;
    }
    if (this.nudging && this.hooks.rate) { this.hooks.rate(1); this.nudging = false; }
    if (this.hooks.apply) this.hooks.apply({ positionMs: Math.max(0, expected), seek: true, quiet: true, by: 'The group' });
  }

  // Ask the group to move on. The PlayQueue update loads the item.
  advance(localNextId) {
    const plan = advancePlan(this.queue, localNextId);
    if (plan.kind === 'set') {
      api('/SyncPlay/SetPlaylistItem', { method: 'POST', body: { PlaylistItemId: plan.playlistItemId } }).catch(() => {});
    } else if (plan.kind === 'queue-next') {
      api('/SyncPlay/Queue', { method: 'POST', body: { ItemIds: [plan.itemId], Mode: 'QueueNext' } })
        .then(() => api('/SyncPlay/NextItem', { method: 'POST' }))
        .catch(() => {});
    }
    return plan;
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
    this.lastCommandAt = Date.now();
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

  close({ leave = true } = {}) {
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.keep);
    clearInterval(this.correctTimer);
    clearInterval(this.clockTimer);
    if (this.nudging && this.hooks.rate) this.hooks.rate(1);
    closeSocket(this.ws);
    this.ws = null;
    if (leave) leaveGroup();
  }
}
