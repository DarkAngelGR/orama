// A short message at the top of the screen, outside any one screen.
import { h, setText, toggleClass } from '../util/dom.js';

let el = null;
let timer = 0;

export function notice(text, ms = 7000) {
  if (!el) el = h('div', 'toast notice', document.getElementById('app') || document.body);
  setText(el, text);
  // next frame, so the fade-in runs on a fresh element
  requestAnimationFrame(() => toggleClass(el, 'on', true));
  clearTimeout(timer);
  timer = setTimeout(() => toggleClass(el, 'on', false), ms);
}
