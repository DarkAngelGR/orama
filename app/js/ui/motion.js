// Small, cheap animations: screens easing in, menus sliding in, the home
// hero's text settling when it changes. Only opacity and transform, which the
// TV's GPU does on its own, and never anything that holds up a key press.
// Off while a key is held (html.fast) and when Settings › Animations is off.
import * as store from '../util/store.js';

const root = document.documentElement;

export function enabled() {
  return store.get('animations') !== false;
}

export function setEnabled(on) {
  store.set('animations', on ? undefined : false);
  apply();
}

export function apply() {
  root.classList.toggle('no-motion', !enabled());
}

// Play a one-shot CSS animation again. Two classes with identical keyframes
// take turns, so it restarts without forcing a layout.
export function replay(el, name) {
  if (!enabled() || root.classList.contains('fast')) return;
  const a = name + '-a';
  const b = name + '-b';
  if (el.classList.contains(a)) { el.classList.remove(a); el.classList.add(b); }
  else { el.classList.remove(b); el.classList.add(a); }
}

// A screen coming up: 'fwd' when it's new, 'back' when returning to it.
// (A screen that was hidden replays its animation by itself when it's shown.)
export function enter(el, dir) {
  el.classList.remove(dir === 'back' ? 'enter-fwd' : 'enter-back');
  el.classList.add(dir === 'back' ? 'enter-back' : 'enter-fwd');
}
