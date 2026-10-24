// A movie or show from Plex's catalog that isn't on your server: details and
// "Add to Watchlist". With watchlist-sync running, an add is synced right away
// so Sonarr/Radarr start on it within seconds.
import { h, setText, toggleClass } from '../util/dom.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { session } from '../session.js';
import { metaLine } from '../util/format.js';
import * as icons from '../ui/icons.js';
import * as discover from '../plex/discover.js';
import * as watchlist from '../plex/watchlist.js';
import { warn, log } from '../util/log.js';

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

  let item = initial;
  let listed = null;          // on the Watchlist? null = unknown yet
  let busy = false;
  let buttons = [];
  let buttonIndex = 0;
  let alive = true;
  const id = initial.ratingKey; // the 24-hex catalog id

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

  function renderButtons() {
    buttonsEl.innerHTML = '';
    buttons = [];
    const add = (icon, label, run) => {
      const b = h('div', 'btn', buttonsEl);
      b.innerHTML = icon;
      h('span', '', b).textContent = label;
      buttons.push({ el: b, run });
    };
    if (busy) add(icons.uncheck, 'One moment…', () => {});
    else if (listed) add(icons.check, 'On your Watchlist  ·  Remove', remove);
    else add(icons.download, 'Add to Watchlist', addIt);
    buttonIndex = Math.min(buttonIndex, buttons.length - 1);
    buttons.forEach((b, i) => toggleClass(b.el, 'focus', i === buttonIndex));
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
    // Full details and Watchlist state in parallel; the search result already
    // has enough to paint.
    const [full, state] = await Promise.all([
      discover.item(id).catch(e => { warn('catalog item failed', e.message); return null; }),
      discover.onWatchlist(id).catch(e => { warn('watchlist state failed', e.message); return false; }),
    ]);
    if (!alive) return;
    if (full) { item = Object.assign({}, initial, full); renderInfo(); }
    listed = state;
    renderButtons();
  }

  renderInfo();
  renderButtons();
  load();

  return {
    el,
    name: 'catalog',
    onShow() { ambience.set(null); },
    onKey(action) {
      if (action === 'left') { buttonIndex = Math.max(0, buttonIndex - 1); renderButtons(); return true; }
      if (action === 'right') { buttonIndex = Math.min(buttons.length - 1, buttonIndex + 1); renderButtons(); return true; }
      if (action === 'enter' && buttons[buttonIndex]) { buttons[buttonIndex].run(); return true; }
      if (action === 'up' || action === 'down') return true;
      return false;
    },
    destroy() { alive = false; },
  };
}
