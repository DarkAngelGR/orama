// "Who's watching?": the Plex Home profiles on this account. Switching gives
// that profile its own Continue Watching, watched state and restrictions.
import { h, setText, toggleClass } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';
import { session, useProfile, useServer, useJellyfin, isJellyfin } from '../session.js';
import { homeUsers, switchHomeUser, getServers, connect } from '../plex/auth.js';
import {
  publicUsers, savedJellyfinUser, userMe, quickConnectEnabled, quickConnectStart, quickConnectDone,
  signInWithQuickConnect, signInWithPassword, rememberJellyfinUser,
} from '../plex/jellyfin.js';
import { PromptScreen } from './prompt.js';
import { confirmPin } from './kids.js';
import { enabled as kidsOn, setOn as setKids } from '../util/kids.js';
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
  const codeEl = h('div', 'login-code users-code hidden', el);
  const note = h('div', 'users-note', el);

  let users = [];
  let index = 0;
  let busy = false;
  let alive = true;
  let mode = 'list';   // list | code
  let round = 0;
  let codeTimer = 0;
  let unlocked = false;  // kids PIN already accepted on this screen
  let leaveKids = false; // a different profile was chosen after that PIN

  // Cards are built once; moving only moves the highlight, so the pictures
  // never reload (rebuilding them on every press made them flicker).
  let cards = [];
  function build() {
    list.innerHTML = '';
    cards = users.map(u => {
      const card = h('div', 'user', list);
      const face = h('div', 'user-face', card);
      h('span', 'user-initials', face).textContent = initials(u.title);
      if (u.thumb) {
        const img = h('img', '', face);
        img.onload = () => { img.style.opacity = 1; };
        img.src = u.thumb;
      }
      const name = h('div', 'user-name', card);
      name.textContent = u.title;
      if (u.protected) { const lock = h('span', 'user-lock', name); lock.innerHTML = LOCK; }
      if (session.user && u.uuid === session.user.uuid) h('div', 'user-current', card).textContent = 'Watching now';
      return card;
    });
    render();
  }

  function render() {
    cards.forEach((card, i) => toggleClass(card, 'focus', i === index));
  }

  async function load() {
    try {
      if (isJellyfin()) {
        users = (await publicUsers(session.server.uri)).map(u => ({
          title: u.title, uuid: u.id, thumb: u.thumb, hasPassword: u.hasPassword, protected: u.hasPassword,
        }));
      } else {
        users = await homeUsers(session.accountToken);
      }
    } catch (e) {
      error('home users failed', e);
      if (onDone) { onDone(); return; }
      setText(note, e.status === 401 ? 'This account can\'t switch profiles (only the account holder can).' : 'Couldn\'t load profiles (' + e.message + ')');
      return;
    }
    if (!alive) return;
    if (users.length < 2 && onDone) { onDone(); return; }
    index = Math.max(0, users.findIndex(u => session.user && u.uuid === session.user.uuid));
    if (!users.length) setText(note, isJellyfin() ? 'No public users on this server.' : 'No Plex Home profiles on this account.');
    build();
  }

  function finishJellyfin(auth) {
    const info = { ServerName: session.server.name, Id: session.server.id };
    useJellyfin(session.server.uri, info, auth);
    if (leaveKids) setKids(false);
    log('switched jellyfin user', auth.User && auth.User.Name);
    if (onDone) onDone();
    else { session.skipProfileOnce = true; window.dispatchEvent(new Event('flexplex:restart')); }
  }

  function showList() {
    mode = 'list';
    round++;
    clearTimeout(codeTimer);
    toggleClass(list, 'hidden', false);
    toggleClass(codeEl, 'hidden', true);
    setText(codeEl, '');
  }

  async function startCode(u) {
    const gen = ++round;
    clearTimeout(codeTimer);
    mode = 'code';
    try {
      const qc = await quickConnectStart(session.server.uri);
      if (!alive || gen !== round) return;
      toggleClass(list, 'hidden', true);
      toggleClass(codeEl, 'hidden', false);
      setText(codeEl, qc.Code);
      setText(note, 'On a phone already signed in as ' + u.title + ', open Quick Connect and enter this code. OK for a password.');
      const poll = async () => {
        if (!alive || gen !== round || mode !== 'code') return;
        try {
          if (await quickConnectDone(session.server.uri, qc.Secret)) {
            const auth = await signInWithQuickConnect(session.server.uri, qc.Secret);
            if (!alive || gen !== round) return;
            if (!auth.User || auth.User.Id !== u.uuid) {
              rememberJellyfinUser(session.server.id, auth);
              showList();
              setText(note, 'That signed in as ' + ((auth.User && auth.User.Name) || 'someone else') + ', not ' + u.title + '.');
              return;
            }
            finishJellyfin(auth);
            return;
          }
        } catch (e) {
          error('quick connect poll failed', e);
        }
        if (alive && gen === round && mode === 'code') codeTimer = setTimeout(poll, 2000);
      };
      codeTimer = setTimeout(poll, 2000);
    } catch (e) {
      error('quick connect failed', e);
      if (!alive || gen !== round) return;
      showList();
      setText(note, 'Quick Connect didn\'t start. Press OK to use a password.');
      u.forcePassword = true;
    }
  }

  function askPassword(u) {
    showList();
    router.push(PromptScreen({
      title: 'Password for ' + u.title,
      hint: u.hasPassword ? 'OK to save, Back to cancel' : 'Leave empty if this user has none',
      secret: true,
      onDone: async pw => {
        if (!alive) return;
        if (pw == null) return;
        busy = true;
        setText(note, 'Signing in as ' + u.title + '…');
        try {
          const auth = await signInWithPassword(session.server.uri, u.title, pw);
          if (!alive) return;
          finishJellyfin(auth);
        } catch (e) {
          error('jellyfin sign-in failed', e);
          if (alive) setText(note, e.status === 401 ? 'Wrong password for ' + u.title : 'Couldn\'t sign in (' + e.message + ')');
        } finally {
          busy = false;
        }
      },
    }));
  }

  // Same profile, or kids mode off: no PIN. A different profile asks once.
  async function allowSwitch(u) {
    if (!kidsOn() || unlocked) return true;
    if (session.user && u.uuid === session.user.uuid) return true;
    if (!await confirmPin()) return false;
    unlocked = true;
    leaveKids = true;
    return true;
  }

  async function chooseJellyfin(u) {
    if (busy) return;
    if (session.user && u.uuid === session.user.uuid && !onDone) { router.back(); return; }
    if (!await allowSwitch(u)) return;
    if (u.forcePassword) { askPassword(u); return; }
    busy = true;
    setText(note, 'Switching to ' + u.title + '…');
    const saved = savedJellyfinUser(session.server.id, u.uuid);
    if (saved) {
      try {
        const me = await userMe(session.server.uri, saved.token);
        if (!alive) { busy = false; return; }
        if (me && me.Id === u.uuid) {
          finishJellyfin({ AccessToken: saved.token, User: me, ServerId: session.server.id });
          busy = false;
          return;
        }
      } catch (e) { /* saved token no longer works */ }
    }
    if (!alive) { busy = false; return; }
    if (!u.hasPassword) {
      try {
        const auth = await signInWithPassword(session.server.uri, u.title, '');
        if (!alive) { busy = false; return; }
        finishJellyfin(auth);
        busy = false;
        return;
      } catch (e) { /* ask another way */ }
    }
    if (!alive) { busy = false; return; }
    try {
      if (await quickConnectEnabled(session.server.uri)) {
        busy = false;
        startCode(u);
        return;
      }
    } catch (e) { /* password instead */ }
    busy = false;
    if (alive) askPassword(u);
  }

  async function choose(u, pin) {
    if (isJellyfin()) { chooseJellyfin(u); return; }
    if (busy) return;
    if (session.user && u.uuid === session.user.uuid && !onDone) { router.back(); return; }
    if (!await allowSwitch(u)) return;
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
      if (!alive) return;
      if (!switched || !switched.authToken) throw new Error('Plex didn\'t switch');
      // Same server, but with this profile's own access token.
      const servers = await getServers(switched.authToken);
      if (!alive) return;
      const current = session.server && servers.find(s => s.clientIdentifier === session.server.id);
      const resource = current || servers[0];
      if (!resource) throw new Error(u.title + ' has no access to a Plex server');
      const uri = await connect(resource);
      if (!alive) return;
      useProfile(switched.authToken, Object.assign({}, u, switched, { title: u.title, thumb: u.thumb }));
      useServer(resource, uri);
      if (leaveKids) setKids(false);
      log('switched profile', u.title);
      if (onDone) onDone();
      else { session.skipProfileOnce = true; window.dispatchEvent(new Event('flexplex:restart')); }
    } catch (e) {
      error('profile switch failed', e);
      if (alive) setText(note, e.status === 401 ? 'Wrong PIN for ' + u.title : 'Couldn\'t switch to ' + u.title + ' (' + e.message + ')');
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
      if (mode === 'code') {
        if (action === 'enter' && users[index]) { askPassword(users[index]); return true; }
        if (action === 'back') { showList(); setText(note, ''); return true; }
        return true;
      }
      if (action === 'left') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'right') { index = Math.min(users.length - 1, index + 1); render(); return true; }
      if (action === 'enter' && users[index]) { choose(users[index]); return true; }
      return action === 'up' || action === 'down';
    },
    destroy() { alive = false; round++; clearTimeout(codeTimer); },
  };
}
