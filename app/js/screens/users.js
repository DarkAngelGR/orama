// "Who's watching?": the Plex Home profiles on this account. Switching gives
// that profile its own Continue Watching, watched state and restrictions.
import { h, setText, toggleClass } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';
import { session, useProfile, useServer } from '../session.js';
import { homeUsers, switchHomeUser, getServers, connect } from '../plex/auth.js';
import { PromptScreen } from './prompt.js';
import { error, log } from '../util/log.js';

const LOCK = '<svg viewBox="0 0 24 24"><rect fill="currentColor" x="5" y="10.5" width="14" height="10" rx="2.5"/><path fill="none" stroke="currentColor" stroke-width="2.4" d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// onDone: called after a switch at startup (or when there's nothing to pick);
// without it, a switch restarts the app as the new profile.
export function UsersScreen({ onDone } = {}) {
  const el = h('div', 'screen users');
  const ambience = useAmbience();
  h('h1', 'users-title', el).textContent = 'Who\'s watching?';
  const list = h('div', 'users-list', el);
  const note = h('div', 'users-note', el);

  let users = [];
  let index = 0;
  let busy = false;
  let alive = true;

  function render() {
    list.innerHTML = '';
    users.forEach((u, i) => {
      const card = h('div', 'user', list);
      const face = h('div', 'user-face', card);
      if (u.thumb) {
        const img = h('img', '', face);
        img.onload = () => { img.style.opacity = 1; };
        img.src = u.thumb;
      }
      h('span', 'user-initials', face).textContent = initials(u.title);
      const name = h('div', 'user-name', card);
      name.textContent = u.title;
      if (u.protected) { const lock = h('span', 'user-lock', name); lock.innerHTML = LOCK; }
      if (session.user && u.uuid === session.user.uuid) h('div', 'user-current', card).textContent = 'Watching now';
      toggleClass(card, 'focus', i === index);
    });
  }

  async function load() {
    try {
      users = await homeUsers(session.accountToken);
    } catch (e) {
      error('home users failed', e);
      if (onDone) { onDone(); return; }
      setText(note, e.status === 401 ? 'This account can\'t switch profiles (only the account holder can).' : 'Couldn\'t load profiles (' + e.message + ')');
      return;
    }
    if (!alive) return;
    if (users.length < 2 && onDone) { onDone(); return; }
    index = Math.max(0, users.findIndex(u => session.user && u.uuid === session.user.uuid));
    if (!users.length) setText(note, 'No Plex Home profiles on this account.');
    render();
  }

  async function choose(u, pin) {
    if (busy) return;
    if (session.user && u.uuid === session.user.uuid && !onDone) { router.back(); return; }
    if (u.protected && !pin) {
      router.push(PromptScreen({
        title: 'PIN for ' + u.title, hint: 'The 4-digit Plex Home PIN', secret: true, numeric: true,
        onDone: v => { if (v) choose(u, v); },
      }));
      return;
    }
    busy = true;
    setText(note, 'Switching to ' + u.title + '…');
    try {
      const switched = await switchHomeUser(session.accountToken, u.uuid, pin);
      if (!switched || !switched.authToken) throw new Error('Plex didn\'t switch');
      // Same server, but with this profile's own access token.
      const servers = await getServers(switched.authToken);
      const current = session.server && servers.find(s => s.clientIdentifier === session.server.id);
      const resource = current || servers[0];
      if (!resource) throw new Error(u.title + ' has no access to a Plex server');
      const uri = await connect(resource);
      useProfile(switched.authToken, Object.assign({}, u, switched, { title: u.title, thumb: u.thumb }));
      useServer(resource, uri);
      log('switched profile', u.title);
      if (onDone) onDone();
      else { session.skipProfileOnce = true; window.dispatchEvent(new Event('flexplex:restart')); }
    } catch (e) {
      error('profile switch failed', e);
      setText(note, e.status === 401 ? 'Wrong PIN for ' + u.title : 'Couldn\'t switch to ' + u.title + ' (' + e.message + ')');
    } finally {
      busy = false;
    }
  }

  load();

  return {
    el,
    name: 'users',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (action === 'left') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'right') { index = Math.min(users.length - 1, index + 1); render(); return true; }
      if (action === 'enter' && users[index]) { choose(users[index]); return true; }
      return action === 'up' || action === 'down';
    },
    destroy() { alive = false; },
  };
}
