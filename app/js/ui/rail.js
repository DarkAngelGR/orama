// Left icon rail shared by Home, Library and Search. Closed it is 112px of
// icons; Left from the first column opens it. Labels fade in over a gradient
// (no blur). Right or Back closes it. OK navigates.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import * as icons from './icons.js';
import { session } from '../session.js';

export const MARK_SVG = '<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M6 8l16 14-16 14zM22 8l16 14-16 14z" fill="#F5C451"/></svg>';

// Matches .rail-row height + margin in app.css. The list scrolls by this stride.
const STRIDE = 82;
const VIEW = 760;

function iconFor(section) {
  if (section && section.type === 'show') return icons.tv;
  return icons.film;
}

export function mountClock(parent) {
  const el = h('div', 'clock', parent);
  const tick = () => {
    const d = new Date();
    setText(el, String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  };
  tick();
  const id = setInterval(tick, 15000);
  return () => clearInterval(id);
}

// current: 'home' | 'search' | 'settings' | a library section key.
export function Rail(parent, { current, onActivate }) {
  const el = h('nav', 'rail', parent);
  h('div', 'rail-bg', el);
  const mark = h('div', 'rail-mark', el);
  mark.innerHTML = MARK_SVG;
  const clip = h('div', 'rail-clip', el);
  const list = h('div', 'rail-list', clip);
  const foot = h('div', 'rail-foot', el);
  const av = h('div', 'rail-av', foot);
  const who = h('div', 'rail-who', foot);
  const name = h('div', 'rail-name', who);
  const serverEl = h('div', 'rail-server', who);

  let items = [];
  let index = 0;
  let open = false;

  function paintWho() {
    const user = (session.user && (session.user.title || session.user.username)) || '';
    const initials = String(user).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    setText(av, initials || '');
    setText(name, user);
    setText(serverEl, session.server ? session.server.name : '');
  }

  function isCurrent(n) {
    if (n.id === 'section') return String(n.section.key) === String(current);
    return n.id === current;
  }

  function scroll() {
    const focus = (open ? index : Math.max(0, items.findIndex(isCurrent))) * STRIDE;
    const max = Math.max(0, items.length * STRIDE - VIEW);
    const y = Math.round(Math.max(0, Math.min(max, focus - VIEW / 2 + STRIDE / 2)));
    setTransform(list, 'translateY(' + (-y) + 'px)');
  }

  function render() {
    items.forEach((n, i) => {
      toggleClass(n.el, 'on', isCurrent(n));
      toggleClass(n.el, 'focus', open && i === index);
    });
    toggleClass(el, 'open', open);
    scroll();
  }

  function setSections(sections) {
    list.innerHTML = '';
    items = [{ id: 'home', label: 'Home', icon: icons.home }]
      .concat((sections || []).map(s => ({ id: 'section', label: s.title, icon: iconFor(s), section: s })))
      .concat([
        { id: 'search', label: 'Search', icon: icons.search },
        { id: 'settings', label: 'Settings', icon: icons.gear },
      ]);
    const cur = items.findIndex(isCurrent);
    index = cur >= 0 ? cur : 0;
    items.forEach(n => {
      n.el = h('div', 'rail-row', list);
      const ic = h('div', 'rail-ic', n.el);
      ic.innerHTML = n.icon;
      const lab = h('span', 'rail-label', n.el);
      lab.textContent = n.label;
    });
    render();
  }

  function openRail() {
    const cur = items.findIndex(isCurrent);
    if (cur >= 0) index = cur;
    open = true;
    render();
  }

  function closeRail() {
    open = false;
    render();
  }

  // true when the key was consumed. 'closed' when Right/Back dismissed it.
  function onKey(action) {
    if (!open) return false;
    if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
    if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
    if (action === 'right' || action === 'back') { closeRail(); return 'closed'; }
    if (action === 'enter') {
      const n = items[index];
      closeRail();
      if (n && !isCurrent(n)) onActivate(n);
      return true;
    }
    return true;
  }

  paintWho();
  setSections([]);

  return { el, setSections, openRail, closeRail, onKey, isOpen: () => open, paintWho };
}
