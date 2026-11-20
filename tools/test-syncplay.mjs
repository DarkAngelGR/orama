import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = globalThis.window || {};
if (!globalThis.localStorage || !localStorage.getItem) {
  globalThis.localStorage = new Map();
  localStorage.getItem = key => localStorage.get(key) ?? null;
  localStorage.setItem = (key, value) => localStorage.set(key, value);
  localStorage.removeItem = key => localStorage.delete(key);
}

const {
  syncMessage, playbackOf, commandDelay, isEcho, groupTile, msOf,
  clockOffset, clockSample, pingOffset, expectedAt, driftAction, queueFollow, advancePlan,
} = await import('../app/js/plex/syncplay.js');

test('SyncPlay commands become pause, seek and stop', () => {
  const pause = syncMessage({
    MessageType: 'SyncPlayCommand',
    Data: { Command: 'Pause', PositionTicks: 100000000, When: '2020-01-01T00:00:00.000Z', PlaylistItemId: 'p1' },
  });
  assert.equal(msOf(100000000), 10000);
  assert.equal(pause.command, 'Pause');
  assert.equal(pause.positionMs, 10000);
  assert.deepEqual(playbackOf(pause), { paused: true, positionMs: 10000, seek: false, by: 'The group' });

  const seek = syncMessage({ MessageType: 'SyncPlayCommand', Data: { Command: 'Seek', PositionTicks: 50000000 } });
  assert.equal(playbackOf(seek).seek, true);
  assert.equal(playbackOf(seek).paused, undefined);
  assert.deepEqual(playbackOf(syncMessage({ MessageType: 'SyncPlayCommand', Data: { Command: 'Stop' } })), { stop: true, by: 'The group' });
  assert.equal(playbackOf(syncMessage({ MessageType: 'SyncPlayCommand', Data: { Command: 'Buffer' } })), null);
  assert.equal(syncMessage({ MessageType: 'UserDataChanged', Data: {} }), null);
});

test('a play queue names the current item and ignores the rest', () => {
  const msg = syncMessage({
    MessageType: 'SyncPlayGroupUpdate',
    Data: {
      Type: 'PlayQueue',
      Data: {
        Playlist: [{ ItemId: 'old', PlaylistItemId: 'a' }, { ItemId: 'now', PlaylistItemId: 'b' }],
        PlayingItemIndex: 1,
        StartPositionTicks: 300000000,
        Reason: 'NewPlaylist',
      },
    },
  });
  assert.equal(msg.type, 'queue');
  assert.equal(msg.itemId, 'now');
  assert.equal(msg.playlistItemId, 'b');
  assert.equal(msg.startMs, 30000);
  assert.equal(syncMessage({ MessageType: 'SyncPlayGroupUpdate', Data: { Type: 'UserJoined', Data: { UserName: 'Sam' } } }).update, 'UserJoined');
});

test('our own command is ignored once, and a due command waits at most five seconds', () => {
  const now = 1_000_000;
  const pause = { type: 'command', command: 'Pause', positionMs: 0 };
  assert.equal(isEcho({ command: 'Pause', positionMs: 0, until: now + 1000 }, pause, now + 100), true);
  assert.equal(isEcho({ command: 'Pause', positionMs: 0, until: now + 1000 }, pause, now + 1001), false);
  assert.equal(isEcho({ command: 'Pause', positionMs: 0, until: now + 1000 }, { type: 'command', command: 'Seek', positionMs: 0 }, now), false);
  const seek = { type: 'command', command: 'Seek', positionMs: 5000 };
  assert.equal(isEcho({ command: 'Seek', positionMs: 5000, until: now + 1000 }, seek, now), true);
  assert.equal(isEcho({ command: 'Seek', positionMs: 5000, until: now + 1000 }, { type: 'command', command: 'Seek', positionMs: 9000 }, now), false);

  assert.equal(commandDelay('2020-01-01T00:00:01.000Z', Date.parse('2020-01-01T00:00:00.000Z')), 1000);
  assert.equal(commandDelay('2020-01-01T00:00:00.000Z', Date.parse('2020-01-01T00:00:02.000Z')), 0);
  assert.equal(commandDelay('2020-01-01T00:00:09.000Z', Date.parse('2020-01-01T00:00:00.000Z')), 0);
  assert.equal(commandDelay('', 0), 0);
});

test('clock offset prefers a ping and otherwise the median of command timestamps', () => {
  assert.equal(pingOffset({ sent: 1000, requestReceived: 1500, responseSent: 1600, receivedAt: 1700 }), 200);
  assert.equal(pingOffset({ sent: 1000, receivedAt: 1700 }), null);
  const received = Date.parse('2020-01-01T00:00:02.000Z');
  assert.equal(clockSample({ emittedAt: '2020-01-01T00:00:02.200Z', when: '2020-01-01T00:00:09.000Z' }, received), 200);
  assert.equal(clockSample({ when: '2020-01-01T00:00:02.500Z' }, received), 500);
  assert.equal(clockSample({}, received), null);
  assert.equal(clockOffset([10, 40, 20, 80]), 30);
  assert.equal(clockOffset([]), null);
  const ping = syncMessage({ MessageType: 'SyncPlayCommand', Data: { Command: 'Ping', EmittedAt: '2020-01-01T00:00:02.200Z' } });
  assert.equal(ping.type, 'ping');
  assert.equal(playbackOf(ping), null);
});

test('drift is ignored while busy or just after a command, nudged when possible, otherwise sought', () => {
  assert.equal(driftAction({ driftMs: 100, canRate: true, sinceCommandMs: 9000 }), null);
  assert.equal(driftAction({ driftMs: 800, canRate: true, busy: true, sinceCommandMs: 9000 }), null);
  assert.equal(driftAction({ driftMs: 800, canRate: true, sinceCommandMs: 1000 }), null);
  const nudge = driftAction({ driftMs: -500, canRate: true, sinceCommandMs: 9000 });
  assert.equal(nudge.type, 'rate');
  assert.ok(nudge.rate > 1);
  assert.equal(driftAction({ driftMs: 500, canRate: false, sinceCommandMs: 9000 }), null);
  assert.equal(driftAction({ driftMs: 1500, canRate: false, sinceCommandMs: 9000 }).type, 'seek');
  assert.equal(driftAction({ driftMs: 4000, canRate: true, sinceCommandMs: 9000 }).type, 'seek');

  const now = Date.parse('2020-01-01T00:00:10.000Z');
  const anchor = { positionMs: 5000, when: '2020-01-01T00:00:05.000Z', paused: false };
  assert.equal(expectedAt(anchor, now, 0), 10000);
  assert.equal(expectedAt({ positionMs: 5000, paused: true }, now, 0), 5000);
});

test('a new queue item is followed, and the episode ending asks the group to move on', () => {
  const queue = syncMessage({
    MessageType: 'SyncPlayGroupUpdate',
    Data: {
      Type: 'PlayQueue',
      Data: {
        Playlist: [{ ItemId: 'ep1', PlaylistItemId: 'a' }, { ItemId: 'ep2', PlaylistItemId: 'b' }],
        PlayingItemIndex: 1,
        StartPositionTicks: 0,
      },
    },
  });
  assert.equal(queue.index, 1);
  assert.deepEqual(queueFollow('ep1', queue), { itemId: 'ep2', startMs: 0, playlistItemId: 'b' });
  assert.equal(queueFollow('ep2', queue), null);
  assert.deepEqual(advancePlan(queue, null), { kind: 'stop' });
  assert.deepEqual(advancePlan(queue, 'ep3'), { kind: 'queue-next', itemId: 'ep3' });
  assert.deepEqual(advancePlan({ items: queue.items, index: 0 }, 'ep3'), { kind: 'set', playlistItemId: 'b' });
  assert.deepEqual(advancePlan({ items: [{ itemId: 'ep1', playlistItemId: 'a' }], index: 0 }, 'ep2'), { kind: 'queue-next', itemId: 'ep2' });
  assert.deepEqual(advancePlan({ items: [{ itemId: 'ep1', playlistItemId: 'a' }], index: 0 }, null), { kind: 'stop' });
});

test('a group becomes a home tile named for the group, not a poster', () => {
  const tile = groupTile({ GroupId: 'g1', GroupName: 'Friday', Participants: ['Alex', 'Sam'], State: 'Playing' });
  assert.equal(tile.ratingKey, 'sync-g1');
  assert.equal(tile.title, 'Friday');
  assert.equal(tile.note, 'Alex, Sam');
  assert.equal(tile.syncplay.groupId, 'g1');
  assert.equal(groupTile({ GroupId: 'g2', State: 'Idle' }).note, 'Idle');
  assert.equal(groupTile(null).title, 'Watch together');
});
