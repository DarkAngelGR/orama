// A short message at the top of the screen, outside any one screen.
import { h, setText, toggleClass } from '../util/dom.js';
import { report } from '../util/report.js';

let el = null;
let timer = 0;

function shownFailure(text) {
  return /couldn'?t|could not|failed|can'?t|cannot|didn'?t|did not/i.test(String(text || ''));
}

export function notice(text, ms = 7000) {
  if (shownFailure(text)) {
    try { report('error', '', text); } catch (e) {}
  }
  if (!el) el = h('div', 'toast notice', document.getElementById('app') || document.body);
  setText(el, text);
  // next frame, so the fade-in runs on a fresh element
  requestAnimationFrame(() => toggleClass(el, 'on', true));
  clearTimeout(timer);
  timer = setTimeout(() => toggleClass(el, 'on', false), ms);
}

export function hideNotice() {
  if (!el) return;
  clearTimeout(timer);
  toggleClass(el, 'on', false);
}
