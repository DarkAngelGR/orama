// Sign in to a Jellyfin server: its address first, then a Quick Connect code
// to approve in any signed-in Jellyfin app (or a user name and password).
import { h, setText } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';
import * as store from '../util/store.js';
import { useJellyfin } from '../session.js';
import { error, log } from '../util/log.js';
import { PromptScreen } from './prompt.js';
import {
  normalizeAddress, publicInfo, quickConnectEnabled, quickConnectStart, quickConnectDone,
  signInWithQuickConnect, signInWithPassword,
} from '../plex/jellyfin.js';

export function JellyfinLoginScreen({ onDone }) {
  const el = h('div', 'screen login');
  const ambience = useAmbience({ topLeft: '1c2340', topRight: '13121f', bottomLeft: '161a33', bottomRight: '221a3d' });
  const left = h('div', 'login-art', el);
  const art = h('img', '', left);
  art.src = 'img/logo-560.png';
  const panel = h('div', 'login-panel', el);
  const title = h('h1', 'login-title', panel);
  title.textContent = 'Sign in to Jellyfin';
  const steps = h('ol', 'login-steps', panel);
  const code = h('div', 'login-code', panel);
  const status = h('div', 'login-status', panel);
  const hint = h('div', 'login-qr-label jf-hint', panel);

  let alive = true;
  let timer = 0;
  let base = '';
  let info = null;
  let mode = 'address';   // address | code | password | busy

  function askAddress(message) {
    mode = 'address';
    steps.innerHTML = '';
    setText(code, '');
    setText(status, message || '');
    setText(hint, 'Press OK to enter your Jellyfin server\'s address');
    router.push(PromptScreen({
      title: 'Jellyfin server address',
      hint: 'e.g. 192.168.1.10:8096',
      value: store.get('jfAddress', ''),
      onDone: v => { if (v) connect(v); else if (alive) setText(status, 'No address entered.'); },
    }));
  }

  async function connect(input) {
    clearTimeout(timer);
    mode = 'busy';
    base = normalizeAddress(input);
    setText(status, 'Connecting to ' + base.replace(/^https?:\/\//, '') + '…');
    try {
      info = await publicInfo(base);
      store.set('jfAddress', base.replace(/^http:\/\//, ''));
    } catch (e) {
      error('jellyfin connect failed', e);
      if (alive) { mode = 'address'; setText(status, 'No Jellyfin server answered at ' + base.replace(/^https?:\/\//, '') + '. Press OK to try another address.'); setText(hint, ''); }
      return;
    }
    if (!alive) return;
    setText(title, 'Sign in to ' + (info.ServerName || 'Jellyfin'));
    if (await quickConnectEnabled(base)) startCode();
    else {
      mode = 'password';
      steps.innerHTML = '';
      setText(code, '');
      setText(status, 'Quick Connect is off on this server.');
      setText(hint, 'Press OK to sign in with your user name and password');
    }
  }

  async function startCode() {
    try {
      const qc = await quickConnectStart(base);
      if (!alive) return;
      mode = 'code';
      steps.innerHTML = '';
      h('li', '', steps).innerHTML = 'On your phone or computer, open <b>Jellyfin</b> and go to your profile › <b>Quick Connect</b>';
      h('li', '', steps).textContent = 'Enter this code:';
      setText(code, qc.Code);
      setText(status, '');
      setText(hint, 'Press OK to use a user name and password instead');
      const expires = Date.now() + 9 * 60 * 1000;
      const poll = async () => {
        if (!alive || mode !== 'code') return;
        if (Date.now() > expires) { startCode(); return; }
        try {
          if (await quickConnectDone(base, qc.Secret)) {
            finish(await signInWithQuickConnect(base, qc.Secret));
            return;
          }
        } catch (e) {
          error('quick connect poll failed', e);
        }
        timer = setTimeout(poll, 2000);
      };
      timer = setTimeout(poll, 2000);
    } catch (e) {
      error('quick connect failed', e);
      mode = 'password';
      setText(status, 'Quick Connect didn\'t start (' + e.message + ').');
      setText(hint, 'Press OK to sign in with your user name and password');
    }
  }

  function askPassword() {
    clearTimeout(timer);
    mode = 'busy';
    router.push(PromptScreen({
      title: 'Jellyfin user name',
      onDone: user => {
        if (!user) { mode = 'password'; return; }
        router.push(PromptScreen({
          title: 'Password for ' + user,
          hint: 'Leave empty if there is none',
          secret: true,
          onDone: async pw => {
            setText(status, 'Signing in…');
            try {
              finish(await signInWithPassword(base, user, pw));
            } catch (e) {
              mode = 'password';
              setText(status, e.status === 401 ? 'Wrong user name or password.' : 'Couldn\'t sign in (' + e.message + ').');
              setText(hint, 'Press OK to try again');
            }
          },
        }));
      },
    }));
  }

  function finish(auth) {
    if (!alive) return;
    clearTimeout(timer);
    useJellyfin(base, info, auth);
    log('signed in to jellyfin as', auth.User && auth.User.Name);
    onDone();
  }

  setTimeout(() => { if (alive) askAddress(); }, 0);

  return {
    el,
    name: 'login',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (action !== 'enter') return false;
      if (mode === 'address') askAddress();
      else if (mode === 'code' || mode === 'password') askPassword();
      return true;
    },
    destroy() { alive = false; clearTimeout(timer); },
  };
}
