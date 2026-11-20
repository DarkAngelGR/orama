// Sleep timer and the "still watching?" streak. The player draws the countdown;
// this only decides when each one fires. State lives here so it survives the
// player screen being replaced for the next episode.

export const STILL_AFTER = 3;
export const STILL_WAIT_MS = 60000;
export const SLEEP_COUNTDOWN_S = 10;

const MINUTES = { '30': 30, '60': 60, '90': 90 };

let mode = 'off';
let deadline = 0;
let streak = 0;

export function sleepChoices(movie) {
  return [
    { id: 'off', label: 'Off' },
    { id: 'end', label: movie ? 'End of this movie' : 'End of this episode' },
    { id: '30', label: '30 min' },
    { id: '60', label: '60 min' },
    { id: '90', label: '90 min' },
  ];
}

export function sleepMode() {
  return mode;
}

export function setSleep(id, now) {
  mode = id === 'end' || MINUTES[id] ? id : 'off';
  deadline = MINUTES[mode] ? now + MINUTES[mode] * 60000 : 0;
  return mode;
}

export function clearSleep() {
  mode = 'off';
  deadline = 0;
}

// A timed sleep (30/60/90) is due. "End of this title" is sleepAtEnd, not this.
export function sleepDue(now) {
  return deadline > 0 && now >= deadline;
}

export function sleepAtEnd() {
  return mode === 'end';
}

// A key was pressed: the viewer is here, so the autoplay streak starts over.
export function noteActivity() {
  streak = 0;
}

// An episode started because the up-next countdown ran out, not because of a key.
export function noteAutoplay() {
  streak += 1;
  return streak;
}

export function autoplayStreak() {
  return streak;
}

// Three episodes have already started on their own; don't start a fourth.
export function shouldAskStillWatching() {
  return streak >= STILL_AFTER;
}

export function resetAutoplay() {
  streak = 0;
}

export function resetWatchForTests() {
  mode = 'off';
  deadline = 0;
  streak = 0;
}
