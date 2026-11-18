import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gate, reportBody } from '../app/js/util/report.js';
import {
  allow, take, percentile, elapsed, launchOrigin,
  formatStart, formatHome, formatPlay, formatFrames,
} from '../app/js/util/perf.js';

const TEN = 10 * 60 * 1000;

test('percentile is nearest rank', () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([16], 95), 16);
  assert.equal(percentile([10, 40, 20, 30], 95), 40);
  const many = [];
  for (let i = 1; i <= 100; i++) many.push(i);
  assert.equal(percentile(many, 95), 95);
  assert.equal(percentile(many, 100), 100);
});

test('perf budget is 6 per 10 min and does not drop a repeated message', () => {
  const state = { sent: [] };
  const t = 1000000;
  assert.equal(take(state, '   ', t), null);
  assert.equal(state.sent.length, 0);
  for (let i = 0; i < 6; i++) assert.equal(take(state, 'play 12 direct', t + i), 'play 12 direct');
  assert.equal(take(state, 'play 12 direct', t + 599999), null);
  assert.equal(take(state, 'play 12 direct', t + TEN), 'play 12 direct');
  const fresh = { sent: [] };
  assert.equal(allow(fresh, 0), true);
  assert.equal(fresh.sent.length, 1);
});

test('formats start, home, play, and frames', () => {
  assert.equal(formatStart(1500.4), 'start 1500');
  assert.equal(formatHome(80, false), 'home 80');
  assert.equal(formatHome(80.2, true), 'home 80 cached');
  assert.equal(formatPlay(12, 'hls'), 'play 12 hls');
  assert.equal(formatPlay(12, 'direct'), 'play 12 direct');
  assert.equal(formatPlay(9, 'other'), 'play 9 direct');
  assert.equal(formatFrames([16, 16, 16, 40]), 'frames p95 40 worst 40 n 4');
  assert.equal(formatFrames([16, 16, 16, 16], 50), 'frames p95 16 worst 50 n 4');
});

test('launch elapsed is never negative and prefers timeOrigin', () => {
  assert.equal(elapsed(1000, 1500), 500);
  assert.equal(elapsed(2000, 1000), 0);
  if (typeof performance !== 'undefined' && performance.timeOrigin) {
    assert.equal(launchOrigin(), performance.timeOrigin);
  }
});

test('perf text skips the error budget and the duplicate filter', () => {
  const state = { seen: new Map(), sent: [] };
  assert.equal(gate('perf', state, 'start 10', 0), 'start 10');
  assert.equal(gate('perf', state, 'start 10', 1), 'start 10');
  assert.equal(state.sent.length, 0);
  assert.equal(state.seen.size, 0);
  assert.equal(gate('error', state, 'start 10', 2), 'start 10');
  assert.equal(gate('error', state, 'start 10', 3), null);
  assert.equal(state.sent.length, 1);
  const body = reportBody({ level: 'perf', where: 'home', message: 'play 12 hls', version: '0.28.0', device: 'TV' });
  assert.equal(body.level, 'perf');
  assert.equal(body.message, 'play 12 hls');
});
