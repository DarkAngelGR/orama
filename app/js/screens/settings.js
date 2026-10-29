// Account, server and diagnostics.
import { DEV, VERSION } from '../config.js';
import { h, toggleClass, setTransform } from '../util/dom.js';
import { session, signOut, useServer, isJellyfin } from '../session.js';
import { getServers, connect } from '../plex/auth.js';
import { setHud, hudEnabled } from '../ui/hud.js';
import * as router from '../router.js';
import { ServerPicker } from './login.js';
import { error } from '../util/log.js';
import { useAmbience, setLegacyGradients, legacyGradients } from '../ui/backdrop.js';
import * as motion from '../ui/motion.js';
import {
  QUALITIES, qualityById, defaultQuality, setDefaultQuality, forceDirect, setForceDirect, audioExtras, cycleAudioExtras, cwOpens, cycleCwOpens,
} from '../player/options.js';
import { subSize, subBackground, cycleSubSize, toggleSubBackground, subLang, cycleSubLang, subColor, cycleSubColor } from '../player/subprefs.js';
import * as watchlist from '../plex/watchlist.js';
import { DownloadsScreen } from './downloads.js';
import { UpdatesScreen } from './updates.js';
import { UsersScreen } from './users.js';
import * as themeMusic from '../ui/theme-music.js';
import * as updates from '../plex/updates.js';
import * as store from '../util/store.js';

const ROW = 110;     // .setting height + margin
const VISIBLE = 6;   // rows that fit above the footer

// Cycles through the qualities; files smaller than the pick still play as Original.
function nextDefaultQuality() {
  const i = QUALITIES.indexOf(qualityById(defaultQuality()));
  setDefaultQuality(QUALITIES[(i + 1) % QUALITIES.length].id);
}

export function SettingsScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Settings';
  // A clip with a sliding track, so the list can outgrow the screen.
  const clip = h('div', 'settings-list settings-clip', el);
  const list = h('div', 'settings-track', clip);
  const foot = h('div', 'settings-foot', el);
  foot.textContent = 'Orama ' + VERSION + (DEV ? ' (dev)' : '') + ' by Aggelos (DarkAngelGR) · ' + (session.server ? session.server.uri.replace(/X-Plex-Token=.*/, '') : '');

  let index = 0;
  let items = [];

  function build() {
    list.innerHTML = '';
    items = [].concat(isJellyfin() ? [
      // Jellyfin: one server per sign-in, no Plex Home profiles.
      { label: 'Server', value: session.server.name + ' (Jellyfin)', run: () => {} },
      { label: 'User', value: session.user ? session.user.title : '—', run: () => {} },
      { label: 'Sign out', value: 'To switch server or user', run: doSignOut },
    ] : [
      { label: 'Server', value: session.server ? session.server.name : '—', run: switchServer },
      { label: 'Profile', value: session.user ? session.user.title : '—', run: () => router.push(UsersScreen()), action: 'Switch' },
      { label: 'Who\'s watching at start', value: store.get('askProfile') ? 'Ask' : 'Last profile', run: () => { store.set('askProfile', store.get('askProfile') ? undefined : true); build(); } },
      { label: 'Sign out', value: '', run: doSignOut },
    ]).concat([
      { label: 'Default quality', value: qualityById(defaultQuality()).label, run: () => { nextDefaultQuality(); build(); } },
      { label: 'Audio formats', value: audioExtras().label, run: () => { cycleAudioExtras(); build(); } },
      { label: 'Force direct play', value: forceDirect() ? 'On · never convert' : 'Off · convert only when needed', run: () => { setForceDirect(!forceDirect()); build(); } },
      { label: 'Theme music', value: themeMusic.enabled() ? 'On' : 'Off', run: () => { themeMusic.setEnabled(!themeMusic.enabled()); build(); } },
      { label: 'Subtitle language', value: subLang().label, run: () => { cycleSubLang(); build(); } },
      { label: 'Subtitle size', value: subSize().label, run: () => { cycleSubSize(); build(); } },
      { label: 'Subtitle colour', value: subColor().label, run: () => { cycleSubColor(); build(); } },
      { label: 'Subtitle background', value: subBackground() ? 'On' : 'Off', run: () => { toggleSubBackground(); build(); } },
      { label: 'OK on Continue Watching', value: cwOpens() === 'play' ? 'Keep watching' : 'Open the page', run: () => { cycleCwOpens(); build(); } },
      { label: 'Updates', value: updates.newer(store.get('upLatest'), VERSION) ? store.get('upLatest') + ' available' : 'Orama ' + VERSION,
        run: () => router.push(UpdatesScreen()) },
      { label: 'Downloads (watchlist-sync)', value: watchlist.mode() === 'off' ? 'Off' : watchlist.baseUrl() ? watchlist.baseUrl().replace(/^https?:\/\//, '') : 'Not set',
        run: () => router.push(DownloadsScreen()) },
      { label: 'Performance overlay', value: hudEnabled() ? 'On' : 'Off', run: () => { setHud(!hudEnabled()); build(); } },
      // For before/after recordings: brings back the full-screen gradients that took ~2s per repaint.
      { label: 'Discover rows on Home', value: watchlist.discoverEnabled() ? 'On · trending and recommended to request' : 'Off', run: () => { watchlist.setDiscoverEnabled(!watchlist.discoverEnabled()); build(); } },
      { label: 'Animations', value: motion.enabled() ? 'On' : 'Off · everything appears at once', run: () => { motion.setEnabled(!motion.enabled()); build(); } },
      { label: 'Demo: original slow renderer', value: legacyGradients() ? 'On' : 'Off', run: () => { setLegacyGradients(!legacyGradients()); build(); } },
    ]);
    items.forEach(it => {
      it.el = h('div', 'setting', list);
      h('span', 'setting-label', it.el).textContent = it.label;
      h('span', 'setting-value', it.el).textContent = it.value + (it.action ? '  ·  ' + it.action : '');
    });
    render();
  }

  function render() {
    items.forEach((it, i) => toggleClass(it.el, 'focus', i === index));
    const first = Math.max(0, Math.min(index - (VISIBLE - 2), items.length - VISIBLE));
    setTransform(list, 'translateY(' + (-first * ROW) + 'px)');
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
    onShow() { ambience.restore(); build(); }, // Downloads may have changed
    onKey(action) {
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
      if (action === 'enter') { items[index].run(); return true; }
      return false;
    },
  };
}
