// "Are you sure?" for something that can't be undone. Cancel has the focus
// to start with, so a stray OK does nothing. While the action runs, keys
// are ignored and its progress shows underneath; on failure the message
// stays up and Back closes it.
import { h, setText, toggleClass } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';
import * as icons from '../ui/icons.js';

export function ConfirmScreen({ title, message, confirmLabel = 'Delete', run }) {
  const el = h('div', 'screen confirm');
  const ambience = useAmbience();
  h('h1', 'settings-title confirm-title', el).textContent = title;
  h('div', 'confirm-text', el).textContent = message;
  const bar = h('div', 'confirm-buttons', el);
  const status = h('div', 'confirm-status', el);

  const cancel = h('div', 'btn', bar);
  h('span', '', cancel).textContent = 'Cancel';
  const ok = h('div', 'btn btn-danger', bar);
  ok.innerHTML = icons.trash;
  h('span', '', ok).textContent = confirmLabel;

  let index = 0;     // 0 Cancel, 1 confirm
  let busy = false;
  let done = false;

  function render() {
    toggleClass(cancel, 'focus', !busy && index === 0);
    toggleClass(ok, 'focus', !busy && index === 1);
    toggleClass(bar, 'busy', busy);
  }

  async function go() {
    busy = true;
    render();
    try {
      await run(text => setText(status, text));
      done = true;
    } catch (e) {
      toggleClass(status, 'error', true);
      setText(status, e.message || String(e));
      busy = false;
      index = 0;
      render();
    }
  }

  render();

  return {
    el,
    name: 'confirm',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (busy || done) return true;
      if (action === 'left') { index = 0; render(); return true; }
      if (action === 'right') { index = 1; render(); return true; }
      if (action === 'enter') {
        if (index === 0) router.back();
        else { toggleClass(status, 'error', false); go(); }
        return true;
      }
      return action !== 'back';
    },
  };
}
