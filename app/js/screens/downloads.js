// Settings › Downloads: the watchlist-sync connection. Adding a title to your
// Watchlist from search asks it to sync right away.
import { h, toggleClass } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';
import * as watchlist from '../plex/watchlist.js';
import { PromptScreen } from './prompt.js';

export function DownloadsScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Downloads';
  const list = h('div', 'settings-list', el);
  const foot = h('div', 'settings-foot downloads-foot', el);
  foot.textContent = 'Titles you add to your Watchlist from search go to Sonarr/Radarr through '
    + 'watchlist-sync. FlexPlex asks it to sync right away. It\'s found automatically when it runs '
    + 'on the same machine as Plex (port ' + watchlist.DEFAULT_PORT + ').';

  let index = 0;
  let items = [];
  let status = 'Checking…';
  let generation = 0;

  // "· Sonarr ✓ · Radarr can't be reached": watchlist-sync is only useful when it
  // can reach them (an unreachable address is the usual problem).
  function arrStatus(i) {
    if (!i.radarr && !i.sonarr) return ', but Sonarr/Radarr aren\'t set up in it';
    if (i.signed_in === false) return ', but it isn\'t signed in to Plex';
    const part = (name, on, ok) => !on ? '' : ok === false ? '  ·  ' + name + ' can\'t be reached' : '  ·  ' + name + ' ✓';
    return part('Sonarr', i.sonarr, i.sonarr_ok) + part('Radarr', i.radarr, i.radarr_ok);
  }

  async function check() {
    const gen = ++generation;
    const base = watchlist.baseUrl();
    if (!base) {
      status = watchlist.mode() === 'off' ? 'Off' : 'No local Plex address to try; set the address below';
      build();
      return;
    }
    status = 'Checking ' + base.replace(/^https?:\/\//, '') + '…';
    build();
    try {
      const i = await watchlist.info();
      if (gen !== generation) return;
      status = 'Connected' + (i.dry_run ? ' (dry run)' : '') + arrStatus(i);
    } catch (e) {
      if (gen !== generation) return;
      status = e.message;
    }
    build();
  }

  function build() {
    const m = watchlist.mode();
    const base = watchlist.baseUrl();
    list.innerHTML = '';
    items = [
      { label: 'watchlist-sync', value: status, run: check, action: 'Check again' },
      { label: 'Connection', value: m === 'off' ? 'Off' : m === 'manual' ? 'Saved address' : 'Automatic',
        run: () => { watchlist.setMode(m === 'off' ? (watchlist.manualUrl() ? 'manual' : 'auto') : 'off'); check(); } },
      { label: 'Address', value: base ? base.replace(/^https?:\/\//, '') : '—', run: editAddress },
      { label: 'Password', value: watchlist.password() ? 'Set' : 'None', run: editPassword },
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

  function editAddress() {
    router.push(PromptScreen({
      title: 'watchlist-sync address',
      hint: 'e.g. 192.168.178.30:' + watchlist.DEFAULT_PORT + '. Leave empty for automatic',
      value: watchlist.manualUrl().replace(/^https?:\/\//, ''),
      placeholder: watchlist.plexLanHost() ? watchlist.plexLanHost() + ':' + watchlist.DEFAULT_PORT : '192.168.1.10:' + watchlist.DEFAULT_PORT,
      onDone: v => { watchlist.setManualUrl(v); check(); },
    }));
  }

  function editPassword() {
    router.push(PromptScreen({
      title: 'watchlist-sync password',
      hint: 'Its UI_PASSWORD, if you set one. Leave empty for none',
      secret: true,
      onDone: v => { watchlist.setPassword(v); check(); },
    }));
  }

  check();

  return {
    el,
    name: 'downloads',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
      if (action === 'enter') { items[index].run(); return true; }
      return false;
    },
    destroy() { generation++; },
  };
}
