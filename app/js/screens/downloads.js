// Settings › Downloads: the watchlist-sync connection Lucky Draw uses to
// suggest and request movies you don't have.
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
  foot.textContent = 'Lucky Draw can suggest movies you don\'t have and add them to Radarr through '
    + 'watchlist-sync. It\'s found automatically when it runs on the same machine as Plex (port '
    + watchlist.DEFAULT_PORT + ').';

  let index = 0;
  let items = [];
  let status = 'Checking…';
  let generation = 0;

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
      status = 'Connected' + (i.radarr ? '' : ', but Radarr isn\'t set up in it') + (i.dry_run ? ' (dry run)' : '');
      if (!i.radarr) { build(); return; }
      // Connected isn't enough: check watchlist-sync can get movies from Radarr.
      status += ' · asking Radarr…';
      build();
      try {
        const s = await watchlist.suggestions();
        if (gen !== generation) return;
        status = status.replace(' · asking Radarr…', ' · ' + (s.items.length ? s.items.length + ' movies to suggest' : 'Radarr had no suggestions'));
      } catch (e) {
        if (gen !== generation) return;
        status = e.message;
      }
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
