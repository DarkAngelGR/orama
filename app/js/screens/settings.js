// Account, server and diagnostics.
import { DEV, VERSION } from '../config.js';
import { h, toggleClass } from '../util/dom.js';
import { session, signOut, useServer } from '../session.js';
import { getServers, connect } from '../plex/auth.js';
import { setHud, hudEnabled } from '../ui/hud.js';
import * as router from '../router.js';
import { ServerPicker } from './login.js';
import { error } from '../util/log.js';
import { useAmbience, setLegacyGradients, legacyGradients } from '../ui/backdrop.js';
import { QUALITIES, qualityById, defaultQuality, setDefaultQuality } from '../player/options.js';
import { subSize, subBackground, cycleSubSize, toggleSubBackground } from '../player/subprefs.js';

// Cycles through the qualities; files smaller than the pick still play as Original.
function nextDefaultQuality() {
  const i = QUALITIES.indexOf(qualityById(defaultQuality()));
  setDefaultQuality(QUALITIES[(i + 1) % QUALITIES.length].id);
}

export function SettingsScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Settings';
  const list = h('div', 'settings-list', el);
  const foot = h('div', 'settings-foot', el);
  foot.textContent = 'FlexPlex ' + VERSION + (DEV ? ' (dev)' : '') + ' · ' + (session.server ? session.server.uri.replace(/X-Plex-Token=.*/, '') : '');

  let index = 0;
  let items = [];

  function build() {
    list.innerHTML = '';
    items = [
      { label: 'Server', value: session.server ? session.server.name : '—', run: switchServer },
      { label: 'Signed in as', value: session.user ? session.user.title : '—', run: doSignOut, action: 'Sign out' },
      { label: 'Default quality', value: qualityById(defaultQuality()).label, run: () => { nextDefaultQuality(); build(); } },
      { label: 'Subtitle size', value: subSize().label, run: () => { cycleSubSize(); build(); } },
      { label: 'Subtitle background', value: subBackground() ? 'On' : 'Off', run: () => { toggleSubBackground(); build(); } },
      { label: 'Performance overlay', value: hudEnabled() ? 'On' : 'Off', run: () => { setHud(!hudEnabled()); build(); } },
      // For before/after recordings: brings back the full-screen gradients that took ~2s per repaint.
      { label: 'Demo: original slow renderer', value: legacyGradients() ? 'On' : 'Off', run: () => { setLegacyGradients(!legacyGradients()); build(); } },
    ];
    items.forEach(it => {
      it.el = h('div', 'setting', list);
      h('span', 'setting-label', it.el).textContent = it.label;
      h('span', 'setting-value', it.el).textContent = it.value + (it.action ? '  ·  ' + it.action : '');
    });
    render();
  }

  function render() {
    items.forEach((it, i) => toggleClass(it.el, 'focus', i === index));
  }

  async function switchServer() {
    try {
      const servers = await getServers(session.token);
      if (servers.length === 1) {
        const uri = await connect(servers[0]);
        useServer(servers[0], uri);
        restart();
        return;
      }
      router.push(ServerPicker({ servers, onDone: restart }));
    } catch (e) {
      error('server list failed', e);
    }
  }

  function doSignOut() {
    signOut();
    restart();
  }

  function restart() {
    // Rebuild from scratch: app.js decides between login and home.
    window.dispatchEvent(new Event('flexplex:restart'));
  }

  build();

  return {
    el,
    name: 'settings',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
      if (action === 'enter') { items[index].run(); return true; }
      return false;
    },
  };
}
