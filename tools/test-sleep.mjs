import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sleepChoices, setSleep, sleepMode, sleepDue, sleepAtEnd, clearSleep,
  noteActivity, noteAutoplay, shouldAskStillWatching, autoplayStreak, resetAutoplay,
  resetWatchForTests, STILL_AFTER, STILL_WAIT_MS, SLEEP_COUNTDOWN_S,
} from '../app/js/player/sleep.js';

test('sleep choices name the end of a movie or an episode', () => {
  resetWatchForTests();
  assert.equal(sleepChoices(true)[1].label, 'End of this movie');
  assert.equal(sleepChoices(false)[1].label, 'End of this episode');
  assert.deepEqual(sleepChoices(false).map(c => c.id), ['off', 'end', '30', '60', '90']);
});

test('a timed sleep is due at its deadline and end-of-title is not a clock', () => {
  resetWatchForTests();
  const t = 1_000_000;
  assert.equal(setSleep('30', t), '30');
  assert.equal(sleepMode(), '30');
  assert.equal(sleepDue(t + 30 * 60000 - 1), false);
  assert.equal(sleepDue(t + 30 * 60000), true);
  assert.equal(sleepAtEnd(), false);

  setSleep('end', t);
  assert.equal(sleepAtEnd(), true);
  assert.equal(sleepDue(t + 24 * 3600000), false);

  setSleep('nope', t);
  assert.equal(sleepMode(), 'off');
  clearSleep();
  assert.equal(sleepDue(t + 999999999), false);
});

test('still watching asks only after three untouched autoplays', () => {
  resetWatchForTests();
  assert.equal(STILL_AFTER, 3);
  assert.equal(STILL_WAIT_MS, 60000);
  assert.equal(SLEEP_COUNTDOWN_S, 10);
  assert.equal(shouldAskStillWatching(), false);
  noteAutoplay();
  noteAutoplay();
  assert.equal(autoplayStreak(), 2);
  assert.equal(shouldAskStillWatching(), false);
  noteAutoplay();
  assert.equal(shouldAskStillWatching(), true);
  noteActivity();
  assert.equal(autoplayStreak(), 0);
  assert.equal(shouldAskStillWatching(), false);
  noteAutoplay();
  noteAutoplay();
  noteAutoplay();
  resetAutoplay();
  assert.equal(shouldAskStillWatching(), false);
});
