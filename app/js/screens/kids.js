// Settings › Kids mode. The PIN is asked for here and again before a profile
// switch or sign-out. Cancelling either prompt leaves kids mode as it was.
import { h, toggleClass, setTransform } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';
import { session } from '../session.js';
import { notice } from '../ui/notice.js';
import { PromptScreen } from './prompt.js';
import {
  enabled, read, LEVELS, levelById, setLevel, setOn, toggleLibrary, savePin, pinMatches, pinLockedFor,
} from '../util/kids.js';

const ROW = 110;
const VISIBLE = 6;

function askPin(title, hint) {
  return new Promise(resolve => {
    router.push(PromptScreen({
      title, hint, secret: true, numeric: true, placeholder: '4 digits',
      onDone: v => resolve(v || ''),
      onCancel: () => resolve(''),
    }));
  });
}

// True when the saved PIN was entered. Cancel and a wrong PIN are both false.
export function confirmPin() {
  return new Promise(resolve => {
    router.push(PromptScreen({
      title: 'Kids PIN',
      hint: 'Enter the 4-digit PIN',
      secret: true,
      numeric: true,
      onDone: async v => {
        if (await pinMatches(v)) { resolve(true); return; }
        const wait = pinLockedFor();
        notice(wait ? 'Too many tries. Try again in ' + Math.ceil(wait / 60000) + ' min' : 'Wrong PIN', 3000);
        resolve(false);
      },
      onCancel: () => resolve(false),
    }));
  });
}

export function KidsScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Kids mode';
  const clip = h('div', 'settings-list settings-clip', el);
  const list = h('div', 'settings-track', clip);
  const foot = h('div', 'settings-foot', el);
  foot.textContent = 'Applies to this TV. Unrated titles show only in libraries you mark.';

  let index = 0;
  let items = [];
  let libraries = [];
  let alive = true;

  function build() {
    list.innerHTML = '';
    const on = enabled();
    const level = levelById(read().level);
    const locked = () => notice('Turn kids mode off first', 3000);
    items = [{
      label: 'Maximum rating',
      value: level.label,
      run: () => {
        if (on) { locked(); return; }
        const i = LEVELS.findIndex(l => l.id === level.id);
        setLevel(LEVELS[(i + 1) % LEVELS.length].id);
        build();
      },
    }];
    if (!libraries.length) {
      items.push({ label: 'Libraries', value: 'Loading…', run: () => {} });
    }
    libraries.forEach(lib => {
      const marked = read().libraries.indexOf(String(lib.key)) >= 0;
      items.push({
        label: lib.title,
        value: marked ? 'Kids library' : 'Not a kids library',
        run: () => {
          if (on) { locked(); return; }
          toggleLibrary(lib.key);
          build();
        },
      });
    });
    items.push(on
      ? { label: 'Turn off', value: 'Asks for the PIN', run: turnOff }
      : { label: 'Turn on', value: 'Set a 4-digit PIN', run: turnOn });
    if (index >= items.length) index = items.length - 1;
    items.forEach(it => {
      it.el = h('div', 'setting', list);
      h('span', 'setting-label', it.el).textContent = it.label;
      h('span', 'setting-value', it.el).textContent = it.value;
    });
    render();
  }

  function render() {
    items.forEach((it, i) => toggleClass(it.el, 'focus', i === index));
    const first = Math.max(0, Math.min(index - (VISIBLE - 2), items.length - VISIBLE));
    setTransform(list, 'translateY(' + (-first * ROW) + 'px)');
  }

  async function turnOn() {
    if (enabled()) return;
    const first = await askPin('Choose a kids PIN', '4 digits. You need it to leave kids mode.');
    if (!alive || !first) return;
    if (!/^\d{4}$/.test(first)) { notice('Use 4 digits', 3000); return; }
    const again = await askPin('Enter the PIN again', 'Same 4 digits');
    if (!alive || !again) return;
    if (again !== first) { notice('Those PINs didn\'t match', 3000); return; }
    try { await savePin(first); }
    catch (e) { notice('Couldn\'t save the PIN', 3000); return; }
    if (!alive) return;
    setOn(true);
    notice('Kids mode is on', 2500);
    build();
  }

  async function turnOff() {
    if (!enabled()) return;
    if (!await confirmPin()) return;
    if (!alive) return;
    setOn(false);
    build();
  }

  async function loadLibraries() {
    try {
      libraries = session.server ? await session.server.sections() : [];
    } catch (e) {
      libraries = [];
    }
    if (alive) build();
  }

  build();
  loadLibraries();

  return {
    el,
    name: 'kids',
    onShow() { ambience.restore(); if (alive) build(); },
    destroy() { alive = false; },
    onKey(action) {
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
      if (action === 'enter' && items[index]) { items[index].run(); return true; }
      return false;
    },
  };
}
