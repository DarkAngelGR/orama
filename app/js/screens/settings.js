// Account, server and diagnostics. Two panes: categories on the left, the
// highlighted category's rows on the right.
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
import { pref as seasonPref, label as seasonLabel, cycle as cycleSeason } from '../ui/season.js';
import {
  QUALITIES, qualityById, defaultQuality, setDefaultQuality, forceDirect, setForceDirect, audioExtras, cycleAudioExtras, cwOpens, cycleCwOpens,
} from '../player/options.js';
import { subSize, subBackground, cycleSubSize, toggleSubBackground, subLang, cycleSubLang, audioLang, cycleAudioLang, subColor, cycleSubColor } from '../player/subprefs.js';
import * as watchlist from '../plex/watchlist.js';
import { DownloadsScreen } from './downloads.js';
import { UpdatesScreen } from './updates.js';
import { UsersScreen } from './users.js';
import * as themeMusic from '../ui/theme-music.js';
import * as updates from '../plex/updates.js';
import * as store from '../util/store.js';
import { activeTasteKey, aiTasteEnabled, autoFetchEnabled, setAiTaste, setAutoFetch } from '../plex/recommendations.js';
import { resetTaste } from '../util/taste.js';
import { ConfirmScreen } from './confirm.js';
import { KidsScreen, confirmPin } from './kids.js';
import { enabled as kidsOn, read as kidsState, setOn as setKids, levelById } from '../util/kids.js';
import { groupSettings } from './settings-groups.js';

const ROW = 110;    // .setting height + margin
const VISIBLE = 5;  // rows that fit in the right pane; more than this scrolls

// Cycles through the qualities; files smaller than the pick still play as Original.
function nextDefaultQuality() {
  const i = QUALITIES.indexOf(qualityById(defaultQuality()));
  setDefaultQuality(QUALITIES[(i + 1) % QUALITIES.length].id);
}

export function SettingsScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Settings';
  const catsEl = h('div', 'settings-cats', el);
  // The right pane clips; its track slides if a category ever grows past the pane.
  const pane = h('div', 'settings-pane', el);
  const list = h('div', 'settings-track', pane);
  const foot = h('div', 'settings-foot', el);
  foot.textContent = 'Orama ' + VERSION + (DEV ? ' (dev)' : '') + ' by Aggelos (DarkAngelGR) · ' + (session.server ? session.server.uri.replace(/X-Plex-Token=.*/, '') : '');

  let focus = 'cats'; // 'cats' | 'rows'
  let cat = 0;
  let row = 0;
  let groups = [];
  let current = [];
  let alive = true;

  function makeRows() {
    const tasteKey = activeTasteKey();
    const kidsRow = {
      label: 'Kids mode',
      value: kidsOn() ? 'On · ' + levelById(kidsState().level).label : 'Off',
      run: () => router.push(KidsScreen()),
    };
    if (kidsOn()) {
      return [
        kidsRow,
        isJellyfin()
          ? { label: 'User', value: session.user ? session.user.title : '—', run: () => router.push(UsersScreen()), action: 'Switch' }
          : { label: 'Profile', value: session.user ? session.user.title : '—', run: () => router.push(UsersScreen()), action: 'Switch' },
        { label: 'Sign out', value: isJellyfin() ? 'To switch server' : '', run: doSignOut },
      ];
    }
    return [kidsRow].concat(isJellyfin() ? [
      { label: 'Server', value: session.server.name + ' (Jellyfin)', run: () => {} },
      { label: 'User', value: session.user ? session.user.title : '—', run: () => router.push(UsersScreen()), action: 'Switch' },
      { label: 'Who\'s watching at start', value: store.get('askProfile') ? 'Ask' : 'Last user', run: () => { store.set('askProfile', store.get('askProfile') ? undefined : true); build(); } },
      { label: 'Sign out', value: 'To switch server', run: doSignOut },
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
      { label: 'Audio language', value: audioLang().label, run: () => { cycleAudioLang(); build(); } },
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
      { label: 'Discover rows on Home', value: watchlist.discoverEnabled() ? 'On · trending and recommended to request' : 'Off', run: () => { watchlist.setDiscoverEnabled(!watchlist.discoverEnabled()); build(); } },
      ...(tasteKey ? [
        { label: 'AI recommendations', value: aiTasteEnabled(tasteKey) ? 'On · shares titles and genres with your model provider' : 'Off · enabling shares titles and genres with your model provider',
          run: () => { setAiTaste(tasteKey, !aiTasteEnabled(tasteKey)); build(); } },
        { label: 'Auto-fetch movies', value: autoFetchEnabled(tasteKey) ? 'On · uses the Watchlist Sync household limit' : 'Off · automatically requests a movie after playback',
          run: () => { setAutoFetch(tasteKey, !autoFetchEnabled(tasteKey)); build(); } },
        { label: 'Reset taste profile', value: 'Clear this viewer’s recommendations', run: () => router.push(ConfirmScreen({
          title: 'Reset taste profile?',
          message: 'This clears the viewing signals and feedback Orama saved for this viewer.',
          confirmLabel: 'Reset',
          run: () => { resetTaste(tasteKey); router.back(); },
        })) },
      ] : []),
      { label: 'Animations', value: motion.enabled() ? 'On' : 'Off · everything appears at once', run: () => { motion.setEnabled(!motion.enabled()); build(); } },
      { label: 'Seasonal theme', value: seasonLabel(seasonPref()), run: () => { cycleSeason(); build(); } },
      // For before/after recordings: brings back the full-screen gradients that took ~2s per repaint.
      { label: 'Demo: original slow renderer', value: legacyGradients() ? 'On' : 'Off', run: () => { setLegacyGradients(!legacyGradients()); build(); } },
    ]);
  }

  function build() {
    const keep = groups[cat] && groups[cat].id;
    groups = groupSettings(makeRows());
    const again = keep ? groups.findIndex(g => g.id === keep) : 0;
    cat = again >= 0 ? again : 0;
    if (row >= groups[cat].items.length) row = Math.max(0, groups[cat].items.length - 1);
    catsEl.innerHTML = '';
    groups.forEach(g => {
      g.el = h('div', 'setting settings-cat', catsEl);
      h('span', 'setting-label', g.el).textContent = g.title;
    });
    fillRows();
  }

  function fillRows() {
    current = groups[cat].items;
    list.innerHTML = '';
    current.forEach(it => {
      it.el = h('div', 'setting', list);
      h('span', 'setting-label', it.el).textContent = it.label;
      h('span', 'setting-value', it.el).textContent = it.value + (it.action ? '  ·  ' + it.action : '');
    });
    render();
  }

  function render() {
    groups.forEach((g, i) => {
      toggleClass(g.el, 'focus', focus === 'cats' && i === cat);
      toggleClass(g.el, 'selected', focus === 'rows' && i === cat);
    });
    current.forEach((it, i) => toggleClass(it.el, 'focus', focus === 'rows' && i === row));
    const first = focus === 'rows'
      ? Math.max(0, Math.min(row - (VISIBLE - 2), current.length - VISIBLE))
      : 0;
    setTransform(list, 'translateY(' + (-first * ROW) + 'px)');
  }

  function moveCat(delta) {
    const next = Math.max(0, Math.min(groups.length - 1, cat + delta));
    if (next === cat) return;
    cat = next;
    row = 0;
    fillRows();
  }

  async function switchServer() {
    try {
      const servers = await getServers(session.token);
      if (!alive) return;
      if (servers.length === 1) {
        const uri = await connect(servers[0]);
        if (!alive) return;
        useServer(servers[0], uri);
        restart();
        return;
      }
      if (!alive) return;
      router.push(ServerPicker({ servers, onDone: restart }));
    } catch (e) {
      error('server list failed', e);
    }
  }

  async function doSignOut() {
    if (kidsOn()) {
      if (!await confirmPin()) return;
      setKids(false);
    }
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
    destroy() { alive = false; },
    onKey(action) {
      if (focus === 'cats') {
        if (action === 'up') { moveCat(-1); return true; }
        if (action === 'down') { moveCat(1); return true; }
        // Right or OK enters the category on its first row. Back is left to the router.
        if (action === 'right' || action === 'enter') { focus = 'rows'; row = 0; render(); return true; }
        return false;
      }
      if (action === 'up') { row = Math.max(0, row - 1); render(); return true; }
      if (action === 'down') { row = Math.min(current.length - 1, row + 1); render(); return true; }
      if (action === 'enter') { current[row].run(); return true; }
      if (action === 'left') { focus = 'cats'; render(); return true; }
      return false;
    },
  };
}
