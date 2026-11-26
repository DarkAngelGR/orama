// Seasonal theme. Auto is on from 1 Dec through 6 Jan, local time.
// Snow and lights are created only while it is on, and removed when it is
// turned off, so nothing keeps animating in the background.
import { h } from '../util/dom.js';
import * as store from '../util/store.js';

const KEY = 'season';
const FLAKES = 36;
const BULBS = 28;
const BULB = ['#E5484D', '#2F9E6B', '#F5C451', '#ffffff'];
const HAT = '<svg viewBox="0 0 44 28" aria-hidden="true"><path fill="#E5484D" d="M8 24 20 4l14 20z"/><rect x="2" y="21" width="36" height="6" rx="3" fill="#fff"/><circle cx="34" cy="7" r="4" fill="#fff"/><rect x="14" y="14" width="12" height="3" fill="#2F9E6B"/></svg>';

export function pref() {
  const v = store.get(KEY);
  return v === 'on' || v === 'off' ? v : 'auto';
}

export function label(p) {
  if (p === 'on') return 'Christmas · always';
  if (p === 'off') return 'Off';
  return 'Auto · 1 Dec – 6 Jan';
}

// `pref` is 'on' | 'off' | 'auto' (anything else, including a missing value).
// `date` is the TV's local clock. December 1 and January 6 are both on.
export function seasonActive(p, date) {
  if (p === 'on') return true;
  if (p === 'off') return false;
  const d = date instanceof Date ? date : new Date();
  const m = d.getMonth();
  const day = d.getDate();
  return (m === 11 && day >= 1) || (m === 0 && day <= 6);
}

export function seasonOn() {
  return document.documentElement.classList.contains('xmas');
}

export function cycle() {
  const next = { auto: 'on', on: 'off', off: 'auto' }[pref()];
  store.set(KEY, next === 'auto' ? undefined : next);
  apply();
}

export function apply(date) {
  const on = seasonActive(pref(), date || new Date());
  document.documentElement.classList.toggle('xmas', on);
  const screens = document.querySelectorAll('.screen.home, .screen.library, .screen.search');
  for (let i = 0; i < screens.length; i++) dress(screens[i], on);
}

// Home and Library get snow and lights. Any of those screens, plus Search,
// gets the hat, because they share the rail.
export function dress(el, on) {
  if (!el) return;
  const active = on != null ? on : seasonOn();
  const scenic = el.classList.contains('home') || el.classList.contains('library');
  syncSnow(el, active && scenic);
  syncLights(el, active && scenic);
  syncHat(el, active);
}

function childByClass(el, name) {
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].classList.contains(name)) return el.children[i];
  }
  return null;
}

function syncSnow(el, on) {
  const layer = childByClass(el, 'snow');
  if (!on) { if (layer) layer.remove(); return; }
  if (layer) return;
  const snow = h('div', 'snow');
  for (let i = 0; i < FLAKES; i++) {
    const f = h('i', '', snow);
    const size = 4 + (i % 3);
    f.style.left = ((i * 53) % 100) + '%';
    f.style.width = size + 'px';
    f.style.height = size + 'px';
    f.style.opacity = String(0.28 + (i % 5) * 0.08);
    f.style.animationDuration = (10 + (i % 8)) + 's';
    f.style.animationDelay = (-i * 0.7) + 's';
    f.style.setProperty('--dx', ((i % 7) - 3) * 14 + 'px');
  }
  // Above the backdrop, below the title and the tiles that are added after it.
  const art = childByClass(el, 'hero-art');
  if (art && art.nextSibling) el.insertBefore(snow, art.nextSibling);
  else if (art) el.appendChild(snow);
  else el.insertBefore(snow, el.firstChild);
}

function syncLights(el, on) {
  const strand = childByClass(el, 'xmas-lights');
  if (!on) { if (strand) strand.remove(); return; }
  if (strand) return;
  const lights = h('div', 'xmas-lights', el);
  for (let i = 0; i < BULBS; i++) {
    const b = h('i', '', lights);
    b.style.left = (24 + i * 68) + 'px';
    b.style.background = BULB[i % BULB.length];
    b.style.animationDelay = ((i % 8) * 0.18) + 's';
  }
}

function syncHat(el, on) {
  const mark = el.querySelector('.rail-mark');
  if (!mark) return;
  const hat = mark.querySelector('.rail-hat');
  if (!on) { if (hat) hat.remove(); return; }
  if (hat) return;
  const node = h('div', 'rail-hat', mark);
  node.innerHTML = HAT;
}
