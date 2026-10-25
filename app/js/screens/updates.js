// Settings › Updates: the running version, the newest release, and installing
// it through the Orama installer on your server.
import { h, toggleClass, setText } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';
import * as updates from '../plex/updates.js';
import { VERSION } from '../config.js';
import { PromptScreen } from './prompt.js';

export function UpdatesScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Updates';
  const list = h('div', 'settings-list', el);
  const notes = h('div', 'settings-foot updates-notes', el);

  let index = 0;
  let items = [];
  let generation = 0;
  let poll = 0;
  let status = 'Checking…';
  let latest = null;       // { version, notes }
  let installer = null;    // installer status, when reachable
  let installerError = '';

  async function check(ask) {
    const gen = ++generation;
    status = 'Checking…';
    build();
    installer = null;
    installerError = '';
    try {
      installer = ask ? await updates.installerCheck() : await updates.installerStatus();
      if (ask) installer = await updates.installerStatus(); // also reports this TV's version
    } catch (e) {
      installerError = e.message;
    }
    if (gen !== generation) return;
    if (installer && installer.latest) latest = { version: installer.latest.version, notes: installer.latest.notes || '' };
    else {
      try { latest = await updates.githubLatest(); } catch (e) { latest = null; status = e.message; }
      if (gen !== generation) return;
    }
    if (installer && installer.busy) { status = 'Installing… Orama will close and reopen'; watch(); }
    else if (latest) status = updates.newer(latest.version, VERSION) ? 'Orama ' + latest.version + ' is available' : 'Up to date';
    else if (installer && installer.check_error) status = installer.check_error;
    build();
  }

  // While the installer works, show its progress (the app closes when the TV
  // installs the new version, so this mostly covers download and signing).
  function watch() {
    clearInterval(poll);
    poll = setInterval(async () => {
      try {
        const s = await updates.installerStatus();
        installer = s;
        const lastLine = (s.log || [])[s.log.length - 1] || '';
        status = s.busy ? 'Installing…  ' + lastLine.replace(/^\S+ \S+ /, '') : (s.last ? s.last.message : 'Done');
        if (!s.busy) clearInterval(poll);
        build();
      } catch (e) { /* the TV is probably swapping the app out */ }
    }, 1500);
  }

  async function install() {
    if (!latest) return;
    try {
      const r = await updates.startInstall(latest.version);
      status = r.already ? 'Already installing…' : 'Installing ' + latest.version + '… Orama will close and reopen';
      build();
      watch();
    } catch (e) {
      status = e.message;
      build();
    }
  }

  function build() {
    const base = updates.baseUrl();
    const m = updates.mode();
    const canInstall = !!(installer && latest && !installer.busy);
    const fresh = latest && updates.newer(latest.version, VERSION);
    list.innerHTML = '';
    items = [
      { label: 'Orama ' + VERSION, value: status, run: () => check(true), action: 'Check again' },
    ];
    if (canInstall) {
      items.push({ label: fresh ? 'Install ' + latest.version : 'Reinstall ' + latest.version,
        value: 'Through the installer on your server', run: install });
    }
    items.push(
      { label: 'Installer', value: installer ? 'Connected (' + base.replace(/^https?:\/\//, '') + ')' : (installerError || '—'), run: () => check(false) },
      { label: 'Connection', value: m === 'off' ? 'Off' : m === 'manual' ? 'Saved address' : 'Automatic',
        run: () => { updates.setMode(m === 'off' ? (updates.manualUrl() ? 'manual' : 'auto') : 'off'); check(false); } },
      { label: 'Address', value: base ? base.replace(/^https?:\/\//, '') : '—', run: editAddress },
      { label: 'Password', value: updates.password() ? 'Set' : 'None', run: editPassword },
    );
    index = Math.min(index, items.length - 1);
    items.forEach(it => {
      it.el = h('div', 'setting', list);
      h('span', 'setting-label', it.el).textContent = it.label;
      h('span', 'setting-value', it.el).textContent = it.value + (it.action ? '  ·  ' + it.action : '');
    });
    setText(notes, fresh && latest.notes ? 'What\'s new in ' + latest.version + ':\n' + latest.notes
      : installer ? '' : 'Updates install through the Orama installer on your server (port '
        + updates.DEFAULT_PORT + '); see installer/README.md on GitHub.');
    render();
  }

  function render() {
    items.forEach((it, i) => toggleClass(it.el, 'focus', i === index));
  }

  function editAddress() {
    router.push(PromptScreen({
      title: 'Installer address',
      hint: 'e.g. 192.168.1.10:' + updates.DEFAULT_PORT + '. Leave empty for automatic',
      value: updates.manualUrl().replace(/^https?:\/\//, ''),
      onDone: v => { updates.setManualUrl(v); check(false); },
    }));
  }

  function editPassword() {
    router.push(PromptScreen({
      title: 'Installer password',
      hint: 'Its PASSWORD setting, if you set one. Leave empty for none',
      secret: true,
      onDone: v => { updates.setPassword(v); check(false); },
    }));
  }

  check(false);

  return {
    el,
    name: 'updates',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
      if (action === 'enter') { items[index].run(); return true; }
      return false;
    },
    destroy() { generation++; clearInterval(poll); },
  };
}
