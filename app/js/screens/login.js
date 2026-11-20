// Sign in with a plex.tv/link code (or by scanning the QR code with a phone),
// then pick a server.
import { h, setText } from '../util/dom.js';
import { createPin, checkPin, authAppUrl, getUser, getServers, connect } from '../plex/auth.js';
import { signIn, useServer, session } from '../session.js';
import * as router from '../router.js';
import { error, log } from '../util/log.js';
import { useAmbience } from '../ui/backdrop.js';
import { toggleClass } from '../util/dom.js';

export function LoginScreen({ onDone }) {
  const el = h('div', 'screen login');
  const ambience = useAmbience({ topLeft: '27204a', topRight: '13121f', bottomLeft: '1a1830', bottomRight: '221a3d' });
  const left = h('div', 'login-art', el);
  const art = h('img', '', left);
  art.src = 'img/logo-560.png';
  const panel = h('div', 'login-panel', el);
  h('h1', 'login-title', panel).textContent = 'Sign in to Plex';
  const steps = h('ol', 'login-steps', panel);
  h('li', '', steps).innerHTML = 'On your phone or computer, go to <b>plex.tv/link</b>';
  h('li', '', steps).textContent = 'Enter this code:';
  const code = h('div', 'login-code', panel);
  const qrWrap = h('div', 'login-qr', panel);
  const qrBox = h('div', 'login-qr-box', qrWrap);
  h('div', 'login-qr-label', qrWrap).textContent = 'or scan to sign in';
  const status = h('div', 'login-status', panel);
  const other = h('div', 'btn login-other', panel);
  h('span', '', other).textContent = 'Use a Jellyfin server instead';

  let timer = 0;
  let alive = true;
  let onOther = false;
  let pinGen = 0;

  function pinCurrent(gen) {
    return alive && gen === pinGen;
  }

  async function start() {
    const gen = ++pinGen;
    clearTimeout(timer);
    try {
      setText(status, '');
      const pin = await createPin();
      if (!pinCurrent(gen)) return;
      setText(code, pin.code);
      const qrcode = (await import('../vendor/qrcode.js')).default;   // only needed here
      if (!pinCurrent(gen)) return;
      const qr = qrcode(0, 'M');
      qr.addData(authAppUrl(pin.code));
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
      const expires = Date.now() + (pin.expiresIn || 900) * 1000 - 5000;
      const poll = async () => {
        if (!pinCurrent(gen)) return;
        if (Date.now() > expires) { start(); return; }
        try {
          const token = await checkPin(pin.id);
          if (!pinCurrent(gen)) return;
          if (token) { await finish(token, gen); return; }
        } catch (e) {
          error('pin poll failed', e);
        }
        // OK asks for a fresh code while this poll is still in flight. Writing
        // `timer` here would orphan that poll and let the old code sign in.
        if (!pinCurrent(gen)) return;
        timer = setTimeout(poll, 2000);
      };
      timer = setTimeout(poll, 2000);
    } catch (e) {
      error('createPin failed', e);
      if (!pinCurrent(gen)) return;
      setText(status, 'Can\'t reach plex.tv. Retrying…');
      timer = setTimeout(start, 4000);
    }
  }

  async function finish(token, gen) {
    setText(status, 'Signed in. Finding your servers…');
    const user = await getUser(token);
    if (!pinCurrent(gen)) return;
    signIn(token, user);
    log('signed in as', session.user.title);
    const servers = await getServers(token);
    if (!pinCurrent(gen)) return;
    if (!servers.length) {
      setText(status, 'No Plex Media Servers on this account.');
      return;
    }
    if (servers.length === 1) {
      setText(status, 'Connecting to ' + servers[0].name + '…');
      const uri = await connect(servers[0]);
      if (!pinCurrent(gen)) return;
      useServer(servers[0], uri);
      onDone();
      return;
    }
    router.replace(ServerPicker({ servers, onDone }));
  }

  start();

  return {
    el,
    name: 'login',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (action === 'down' || action === 'up') { onOther = action === 'down'; toggleClass(other, 'focus', onOther); return true; }
      if (action === 'enter') {
        if (onOther) router.pushAsync(() => import('./jellyfin-login.js').then(m => m.JellyfinLoginScreen({ onDone })));
        else start();
        return true;
      }
      return false;
    },
    destroy() {
      alive = false;
      pinGen++;
      clearTimeout(timer);
    },
  };
}

export function ServerPicker({ servers, onDone }) {
  const el = h('div', 'screen picker');
  const ambience = useAmbience();
  h('h1', 'picker-title', el).textContent = 'Choose a server';
  const list = h('div', 'picker-list', el);
  const status = h('div', 'login-status', el);
  const buttons = servers.map(s => {
    const b = h('div', 'btn btn-wide', list);
    h('span', '', b).textContent = s.name;
    h('small', '', b).textContent = s.owned ? 'Your server' : 'Shared by ' + (s.sourceTitle || 'a friend');
    return b;
  });
  let index = 0;
  let alive = true;
  let busy = false;
  const render = () => buttons.forEach((b, i) => b.classList.toggle('focus', i === index));
  render();

  return {
    el,
    name: 'picker',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (busy && action !== 'back') return true;
      if (action === 'up' || action === 'down') {
        index = Math.max(0, Math.min(servers.length - 1, index + (action === 'down' ? 1 : -1)));
        render();
        return true;
      }
      if (action === 'enter') {
        const s = servers[index];
        busy = true;
        setText(status, 'Connecting to ' + s.name + '…');
        connect(s).then(uri => {
          if (!alive) return;
          useServer(s, uri);
          onDone();
        }, e => {
          busy = false;
          if (alive) setText(status, e.message);
        });
        return true;
      }
      return false;
    },
    destroy() { alive = false; },
  };
}
