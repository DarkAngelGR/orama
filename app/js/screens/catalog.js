// A movie or show that isn't on your server: details and a way to get it.
// From Plex's catalog: "Add to Watchlist" (with watchlist-sync running, the add
// is synced right away so Sonarr/Radarr start on it within seconds). From
// Sonarr/Radarr (Jellyfin, through watchlist-sync): "Request" adds it there.
import { h, setText, toggleClass, setTransform } from '../util/dom.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { session } from '../session.js';
import { metaLine } from '../util/format.js';
import * as icons from '../ui/icons.js';
import * as discover from '../plex/discover.js';
import * as watchlist from '../plex/watchlist.js';
import * as downloads from '../plex/downloads.js';
import * as requests from '../plex/requests.js';
import { warn, log } from '../util/log.js';
import * as router from '../router.js';
import { openItem } from '../nav.js';

export function CatalogScreen(initial) {
  const el = h('div', 'screen detail catalog');
  const ambience = useAmbience();
  const art = new HeroArt(el, 'hero-art detail-art');
  const body = h('div', 'detail-body', el);
  const badge = h('div', 'catalog-badge', body);
  badge.textContent = 'Not on your server';
  const title = h('h1', 'detail-title', body);
  const sub = h('div', 'detail-sub', body);
  const meta = h('div', 'detail-meta', body);
  const tags = h('div', 'detail-tags', body);
  const summary = h('p', 'detail-summary', body);
  const buttonsEl = h('div', 'detail-buttons', body);
  const note = h('div', 'catalog-note', body);
  // Live download progress once Sonarr/Radarr have it (via watchlist-sync).
  const dl = h('div', 'catalog-dl', body);
  const dlText = h('div', 'catalog-dl-text', dl);
  const dlBar = h('div', 'catalog-dl-bar', dl);
  const dlFill = h('i', '', dlBar);
  let wasDownloading = false;

  let item = initial;
  let listed = null;          // on the Watchlist? null = unknown yet
  let busy = false;
  let buttons = [];
  let buttonIndex = 0;
  let alive = true;
  let checked = null;
  let canSearch = false;
  let unsubRequests;
  const id = initial.ratingKey; // the 24-hex catalog id (Plex) or 'movie:TMDB' / 'show:TVDB'
  const arr = !!initial.arr;    // from Sonarr/Radarr: requested there directly
  const svc = initial.type === 'show' ? 'Sonarr' : 'Radarr';

  function renderInfo() {
    setText(title, item.title);
    setText(sub, item.tagline || (item.type === 'show' ? 'TV series' : ''));
    setText(meta, metaLine(item));
    const genres = (item.Genre || []).slice(0, 3).map(g => g.tag);
    const people = (item.Director || []).slice(0, 1).map(d => 'Directed by ' + d.tag)
      .concat((item.Role || []).length ? ['Starring ' + item.Role.slice(0, 3).map(r => r.tag).join(', ')] : []);
    setText(tags, genres.concat(people).join('   ·   '));
    setText(summary, item.summary || '');
    // Plex resizes catalog art like its own (the transcoder takes outside URLs).
    art.set(item.art ? session.server.image(item.art, 1920, 1080) : '');
    ambience.set(null);
  }

  function playableItem(record) {
    if (checked && (!record || checked.at >= (record.checkedAt || 0))) return checked.availability.item;
    return record && record.state && record.state.playable;
  }

  function renderButtons() {
    buttonsEl.innerHTML = '';
    buttons = [];
    const add = (icon, label, run) => {
      const b = h('div', 'btn', buttonsEl);
      b.innerHTML = icon;
      h('span', '', b).textContent = label;
      buttons.push({ el: b, run });
    };
    const record = arr && requests.tracked(item);
    const playable = playableItem(record);
    const active = downloads.find(item);
    if (busy) add(icons.uncheck, 'One moment…', () => {});
    else if (arr) {
      if (playable) add(icons.play, 'Ready to play', () => openItem(playable));
      if (checked && checked.source) {
        if (!playable && item.arrStatus === 'none' && (!item.tasteReason || checked.availability.status === 'missing')) {
          add(icons.download, 'Request', () => requestIt(false));
        }
        if (item.missingFiles && canSearch && (!active || active.estimated) && !downloads.unavailable(item.type)) {
          add(icons.download, 'Search again', () => requestIt(true));
        }
        if (!buttons.length) add(icons.check, item.arrStatus === 'have' ? 'Waiting for library'
          : item.arrStatus === 'none' ? 'Check again' : 'Requested', load);
      } else if (!playable) {
        add(icons.uncheck, checked ? 'Check again' : 'Checking availability…', load);
      }
    }
    else if (listed) add(icons.check, 'On your Watchlist  ·  Remove', remove);
    else add(icons.download, 'Add to Watchlist', addIt);
    add(icons.info, 'More info', openInfo);
    buttonIndex = Math.min(buttonIndex, buttons.length - 1);
    buttons.forEach((b, i) => toggleClass(b.el, 'focus', i === buttonIndex));
  }

  function openInfo() {
    router.pushAsync(() => import('./info.js').then(m => m.InfoScreen(item)));
  }

  async function addIt() {
    if (busy) return;
    busy = true;
    setText(note, '');
    renderButtons();
    try {
      await discover.addToWatchlist(id);
      if (!alive) return;
      listed = true;
      log('watchlist add', item.title);
      setText(note, 'Added to your Watchlist.');
      await nudge();
    } catch (e) {
      if (alive) setText(note, 'Couldn\'t add it: ' + e.message);
    } finally {
      busy = false;
      if (alive) renderButtons();
    }
  }

  async function requestIt(search) {
    if (busy) return;
    busy = true;
    setText(note, '');
    renderButtons();
    try {
      const r = await requests.acquire(item, { search });
      if (!alive) return;
      log('requested', item.title, r.status);
      const label = {
        'dry-run': 'Dry run is on in Watchlist Sync.',
        'already-there': svc + ' already tracks this title.',
        added: 'Requested from ' + svc + '.',
        searching: svc + ' is searching for files.',
        active: svc + ' already has work in progress for this title.',
        have: 'This title is available or has files already.',
        'not-tracked': svc + ' has no matching entry.',
        unmonitored: 'This title is unmonitored in ' + svc + '.',
        unavailable: 'Could not verify availability. Check the companion connection.',
      }[r.status];
      setText(note, label || 'Check request status in Watchlist Sync.');
    } catch (e) {
      if (alive) setText(note, 'Couldn\'t request it: ' + e.message);
    } finally {
      busy = false;
      if (alive) { renderButtons(); showDownload(); load(); }
    }
  }

  // Ask watchlist-sync to sync now instead of on its next cycle.
  async function nudge() {
    const what = item.type === 'show' ? 'Sonarr' : 'Radarr';
    if (!watchlist.baseUrl()) {
      setText(note, 'Added to your Watchlist.');
      return;
    }
    try {
      await watchlist.syncNow();
      if (alive) setText(note, 'Added to your Watchlist. watchlist-sync is sending it to ' + what + ' now.');
    } catch (e) {
      warn('watchlist-sync nudge failed', e.message);
      if (alive) setText(note, 'Added to your Watchlist. watchlist-sync will pick it up on its next sync (' + e.message + ').');
    }
  }

  async function remove() {
    if (busy) return;
    busy = true;
    renderButtons();
    try {
      await discover.removeFromWatchlist(id);
      if (!alive) return;
      listed = false;
      // watchlist-sync never deletes on removal (see its README).
      setText(note, 'Removed from your Watchlist. Anything already sent to Sonarr/Radarr stays there.');
    } catch (e) {
      if (alive) setText(note, 'Couldn\'t remove it: ' + e.message);
    } finally {
      busy = false;
      if (alive) renderButtons();
    }
  }

  async function load() {
    if (arr) {
      const [result, capabilities] = await Promise.all([
        requests.inspectRequest(item, { fresh: true }),
        watchlist.info().catch(() => null),
      ]);
      if (!alive) return;
      checked = result;
      canSearch = !!(capabilities && capabilities.search_again);
      if (result.source) { item = Object.assign({}, item, result.source); renderInfo(); }
      renderButtons();
      showDownload();
      return;
    }
    // Full details and Watchlist state in parallel; the search result already
    // has enough to paint.
    const [full, state] = await Promise.all([
      discover.item(id).catch(e => { warn('catalog item failed', e.message); return null; }),
      discover.onWatchlist(id).catch(e => { warn('watchlist state failed', e.message); return false; }),
    ]);
    if (!alive) return;
    if (full) { item = Object.assign({}, initial, full); renderInfo(); showDownload(); }
    listed = state;
    renderButtons();
    showDownload();
  }

  function showDownload() {
    const record = arr && requests.tracked(item);
    const d = downloads.find(item) || (record && record.state && record.state.queue);
    if (arr) {
      const playable = playableItem(record);
      setText(badge, playable ? 'In your library' : 'Library availability');
      renderButtons();
      if (record || d || checked) {
        const status = record ? requests.describeRequest(record, d)
          : d ? downloads.describe(d)
          : playable ? 'Ready to play'
          : item.arrStatus === 'have' ? 'Importing · waiting for your library'
          : item.arrStatus === 'requested' ? 'Waiting for files'
          : !checked.source || checked.availability.status === 'unknown' ? 'Library availability unconfirmed' : '';
        setText(dlText, status);
        toggleClass(dl, 'on', !!status);
        const progress = d && ['downloading', 'paused', 'stalled'].includes(d.status) ? (d.progress || 0) / 100 : 0;
        toggleClass(dlBar, 'on', progress > 0);
        setTransform(dlFill, 'scaleX(' + Math.max(0.01, progress).toFixed(3) + ')');
        toggleClass(dl, 'failed', !!d && d.status === 'failed');
      }
      return;
    }
    if (d) {
      wasDownloading = true;
      setText(dlText, downloads.describe(d));
      const p = d.status === 'downloading' || d.status === 'paused' || d.status === 'stalled' ? (d.progress || 0) / 100 : 0;
      toggleClass(dlBar, 'on', p > 0);
      setTransform(dlFill, 'scaleX(' + Math.max(0.01, p).toFixed(3) + ')');
      toggleClass(dl, 'on', true);
      toggleClass(dl, 'failed', d.status === 'failed');
    } else if (wasDownloading) {
      // Left the queue after importing: Plex picks it up on its next scan.
      setText(dlText, downloads.unavailable(item.type) ? 'Status temporarily unavailable' : 'Checking your library');
      toggleClass(dlBar, 'on', false);
    } else if ((listed || item.arrStatus === 'requested') && downloads.isSupported() === false) {
      setText(dlText, 'Update watchlist-sync on your server to see download progress here');
      toggleClass(dlBar, 'on', false);
      toggleClass(dl, 'on', true);
    } else {
      toggleClass(dl, 'on', false);
    }
  }
  const unsubDownloads = downloads.subscribe(showDownload);

  renderInfo();
  renderButtons();
  load();

  return {
    el,
    name: 'catalog',
    onShow() {
      ambience.set(null);
      if (arr && !unsubRequests) unsubRequests = requests.subscribeRequests(showDownload, item);
    },
    onHide() { if (unsubRequests) { unsubRequests(); unsubRequests = null; } },
    onKey(action) {
      if (action === 'left') { buttonIndex = Math.max(0, buttonIndex - 1); renderButtons(); return true; }
      if (action === 'right') { buttonIndex = Math.min(buttons.length - 1, buttonIndex + 1); renderButtons(); return true; }
      if (action === 'enter' && buttons[buttonIndex]) { buttons[buttonIndex].run(); return true; }
      if (action === 'info') { openInfo(); return true; }
      if (action === 'up' || action === 'down') return true;
      return false;
    },
    destroy() { alive = false; unsubDownloads(); if (unsubRequests) unsubRequests(); },
  };
}
