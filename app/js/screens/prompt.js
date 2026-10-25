// A one-field text entry (address, password). Focusing the input brings up
// Samsung's on-screen keyboard; Done or OK saves, Back cancels.
import { h } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';

const IME_DONE = 65376;
const IME_CANCEL = 65385;

export function PromptScreen({ title, hint = '', value = '', placeholder = '', secret = false, numeric = false, onDone }) {
  const el = h('div', 'screen prompt');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = title;
  const bar = h('div', 'search-bar prompt-bar', el);
  const input = h('input', 'search-input prompt-input', bar);
  input.type = secret ? 'password' : 'text';
  if (numeric) { input.inputMode = 'numeric'; input.setAttribute('pattern', '[0-9]*'); }
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  h('div', 'prompt-hint', el).textContent = (hint ? hint + '  ·  ' : '') + 'OK to save, Back to cancel';

  let done = false;
  function save() {
    if (done) return;
    done = true;
    input.blur();
    router.back();
    onDone(input.value.trim());
  }

  input.addEventListener('keydown', e => {
    if (e.keyCode === IME_DONE || e.keyCode === 13) save();
    else if (e.keyCode === IME_CANCEL) input.blur();
  });

  return {
    el,
    name: 'prompt',
    onShow() { ambience.restore(); setTimeout(() => input.focus(), 50); },
    onHide() { input.blur(); },
    onKey(action) {
      if (action === 'enter') {
        if (document.activeElement === input) save();
        else input.focus();
        return true;
      }
      if (action === 'back') { input.blur(); return false; }
      if (action === 'up' || action === 'down') { input.focus(); return true; }
      return true;
    },
  };
}
