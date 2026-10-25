// Home: hero for the focused item, nav bar, and Plex's home hubs as rows.
// The last hub payload is cached so a cold start paints instantly.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { Row } from '../ui/row.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { session } from '../session.js';
import { metaLine } from '../util/format.js';
import { isFast } from '../input.js';
import * as store from '../util/store.js';
import * as icons from '../ui/icons.js';
import { openItem, playItem, openLibrary, openSearch, openSettings, openCatalogLookup } from '../nav.js';
import { error, log } from '../util/log.js';
import * as updates from '../plex/updates.js';
import * as notifications from '../plex/notifications.js';
import * as downloads from '../plex/downloads.js';
import { notice } from '../ui/notice.js';

// Once per app start, a few seconds after home appears: is there a newer
// Orama? Mentioned once per version.
let updateChecked = false;
function checkForUpdate() {
  if (updateChecked) return;
  updateChecked = true;
  setTimeout(() => {
    updates.latest().then(l => {
      if (!l || !l.version) return;
      store.set('upLatest', l.version);
      if (updates.shouldNotify(l.version)) notice('Orama ' + l.version + ' is available  ·  Settings › Updates');
    }, () => {});
  }, 6000);
}

const ROWS_TOP = 600;
const NAV_PAD = 80; // wider than the 64px edge fade in app.css

function slimHub(hub) {
  // Keep the cache small: only fields the home screen renders.
  const keep = ['ratingKey', 'key', 'type', 'title', 'grandparentTitle', 'parentTitle', 'year', 'thumb', 'art',
    'grandparentThumb', 'grandparentArt', 'parentThumb', 'index', 'parentIndex', 'duration', 'viewOffset',
    'viewCount', 'leafCount', 'viewedLeafCount', 'childCount', 'contentRating', 'audienceRating', 'summary',
    'audienceRatingImage', 'rating', 'ratingImage',
    'originallyAvailableAt', 'UltraBlurColors', 'grandparentRatingKey', 'parentRatingKey', 'Image'];
  return {
    hubIdentifier: hub.hubIdentifier, title: hub.title, type: hub.type,
    Metadata: hub.Metadata.map(m => {
      const o = {};
      for (const k of keep) if (m[k] !== undefined) o[k] = m[k];
      return o;
    }),
  };
}

export function heroArtPath(item) {
  if (item.type === 'episode' || item.type === 'season') return item.grandparentArt || item.art;
  return item.art;
}

export function clearLogo(item) {
  const img = (item.Image || []).find(i => i.type === 'clearLogo');
  return img ? img.url : '';
}

export function HomeScreen() {
  const el = h('div', 'screen home');
  const ambience = useAmbience();
  const hero = new HeroArt(el, 'hero-art home-art');

  const top = h('header', 'topbar', el);
  const brand = h('div', 'brand', top);
  h('img', 'brand-mark', brand).src = 'img/logo-mark.png';
  const brandText = h('div', 'brand-text', brand);
  h('img', 'brand-wordmark', brandText).src = 'img/wordmark.png';
  h('div', 'brand-by', brandText).textContent = 'by DarkAngelGR';
  // The nav is a clip with a sliding track, so any number of libraries fits.
  const navEl = h('nav', 'nav', top);
  const navTrack = h('div', 'nav-track', navEl);
  // "Scanning Movies · 42%" while the server works on a library.
  const libStatus = h('div', 'lib-status', top);
  h('i', 'lib-status-spin', libStatus);
  const libStatusText = h('span', '', libStatus);
  const who = h('div', 'topbar-who', top);
  setText(who, (session.user && session.user.title ? session.user.title + '  ·  ' : '') + (session.server ? session.server.name : ''));

  const info = h('div', 'hero-info', el);
  const heroLogo = h('img', 'hero-logo', info);
  const heroTitle = h('h1', 'hero-title', info);
  const heroMeta = h('div', 'hero-meta', info);
  const heroSummary = h('p', 'hero-summary', info);

  const rowsClip = h('div', 'home-rows', el);
  rowsClip.style.top = ROWS_TOP + 'px';
  const track = h('div', 'rows-track', rowsClip);
  const empty = h('div', 'home-empty', el);

  let rows = [];
  let offsets = [];
  let rowIndex = 0;
  let zone = 'rows';
  let navItems = [];
  let navIndex = 0;
  let navScroll = 0;
  let loadedAt = 0;
  let heroTimer = 0;
  let artTimer = 0;
  let reportedPaint = false;
  let visible = true;
  let stale = false;       // the library changed while another screen was on top
  let plexHubs = [];       // the server's hubs, before the Downloading row is added
  let dlItems = [];        // downloads in progress, as tiles

  function buildNav(sections) {
    navTrack.innerHTML = '';
    navItems = [{ label: 'Home', id: 'home' }]
      .concat(sections.map(s => ({ label: s.title, id: 'section', section: s })))
      .concat([{ label: 'Search', id: 'search', icon: icons.search }, { label: 'Settings', id: 'settings', icon: icons.gear }]);
    navIndex = Math.min(navIndex, navItems.length - 1);
    navItems.forEach((n, i) => {
      if (n.icon && !navItems[i - 1].icon) h('i', 'nav-sep', navTrack);
      n.el = h('div', 'nav-item' + (n.icon ? ' nav-icon' : ''), navTrack);
      if (n.icon) n.el.innerHTML = n.icon;
      else h('span', '', n.el).textContent = n.label;
    });
    renderNav();
  }

  // Slide the track just enough to keep the focused item clear of the edge fades.
  function scrollNav() {
    const room = navEl.clientWidth;
    if (!room) return; // hidden screen: nothing to measure
    const max = Math.max(0, navTrack.offsetWidth - room);
    const n = navItems[navIndex];
    if (zone === 'nav' && n) {
      const left = n.el.offsetLeft;
      const right = left + n.el.offsetWidth;
      if (left - NAV_PAD < navScroll) navScroll = left - NAV_PAD;
      else if (right + NAV_PAD > navScroll + room) navScroll = right + NAV_PAD - room;
    }
    navScroll = Math.round(Math.max(0, Math.min(max, navScroll)));
    setTransform(navTrack, 'translateX(' + (-navScroll) + 'px)');
    toggleClass(navEl, 'more-left', navScroll > 0);
    toggleClass(navEl, 'more-right', navScroll < max - 1);
  }

  function renderNav() {
    scrollNav(); // measure before the class writes below dirty the style
    navItems.forEach((n, i) => {
      toggleClass(n.el, 'focus', zone === 'nav' && i === navIndex);
      toggleClass(n.el, 'current', n.id === 'home');
    });
    toggleClass(el, 'in-nav', zone === 'nav');
  }

  function showHero(item) {
    if (!item) return;
    const logoPath = clearLogo(item);
    const server = session.server;
    if (logoPath && item.type !== 'episode') {
      heroLogo.src = server.image(logoPath, 640, 200, { format: 'png' });
      heroLogo.style.display = '';
      heroTitle.style.display = 'none';
    } else {
      heroLogo.style.display = 'none';
      heroTitle.style.display = '';
      setText(heroTitle, item.type === 'episode' ? item.grandparentTitle : item.title);
    }
    if (item.download) {
      setText(heroMeta, (item.year ? item.year + '  ·  ' : '') + downloads.describe(item.download));
      setText(heroSummary, '');
    } else {
      setText(heroMeta, (item.type === 'episode' ? item.title + '  ·  ' : '') + metaLine(item));
      setText(heroSummary, item.summary || '');
    }
    ambience.set(item.UltraBlurColors);
    clearTimeout(artTimer);
    artTimer = setTimeout(() => hero.set(server.image(heroArtPath(item), 1344, 756)), isFast() ? 350 : 120);
  }

  function onFocusItem(item) {
    clearTimeout(heroTimer);
    // While a key is held, skip the text repaint until the user settles.
    if (isFast()) heroTimer = setTimeout(() => showHero(item), 160);
    else showHero(item);
  }

  function layoutRows() {
    offsets = [];
    let y = 0;
    rows.forEach(r => {
      offsets.push(y);
      setTransform(r.el, 'translateY(' + y + 'px)');
      y += r.height;
    });
  }

  function renderRows() {
    rows.forEach((r, i) => {
      r.setActive(zone === 'rows' && i === rowIndex);
      toggleClass(r.el, 'above', i < rowIndex);
    });
    setTransform(track, 'translateY(' + (-(offsets[rowIndex] || 0)) + 'px)');
  }

  // The server's rows plus, when something is downloading, a "Downloading"
  // row right after Continue Watching.
  function composed() {
    if (!dlItems.length) return plexHubs;
    const at = plexHubs.findIndex(hb => !/continue|ondeck/i.test(hb.hubIdentifier));
    const i = at < 0 ? plexHubs.length : at;
    const row = { hubIdentifier: 'flexplex.downloads', title: 'Downloading', type: 'movie', size: dlItems.length, Metadata: dlItems };
    return plexHubs.slice(0, i).concat([row], plexHubs.slice(i));
  }

  function selectItem(item) {
    if (item.download) openDownload(item.download);
    else openItem(item);
  }

  // A download's catalog page (details, Watchlist), found by title and year.
  async function openDownload(d) {
    try {
      await openCatalogLookup({ title: d.title, year: d.year, kind: d.kind });
    } catch (e) {
      error('download lookup failed', e);
    }
  }

  function setHubs(hubs) {
    const sameShape = hubs.length === rows.length && hubs.every((hb, i) => rows[i].hubId === hb.hubIdentifier);
    const focusedKey = rows[rowIndex] && rows[rowIndex].current() && rows[rowIndex].current().ratingKey;
    const focusedHub = rows[rowIndex] && rows[rowIndex].hubId;
    if (sameShape) {
      hubs.forEach((hb, i) => rows[i].setItems(hb.Metadata, i === rowIndex ? focusedKey : null));
    } else {
      track.innerHTML = '';
      rows = hubs.map(hb => {
        const wide = /continue|ondeck/i.test(hb.hubIdentifier);
        const row = new Row({
          title: hb.title, kind: wide ? 'wide' : 'poster', items: hb.Metadata,
          onFocus: onFocusItem, onSelect: selectItem,
        });
        row.hubId = hb.hubIdentifier;
        track.appendChild(row.el);
        return row;
      });
      // Stay on the same row and item when a row appears or goes above it.
      const again = focusedHub ? rows.findIndex(r => r.hubId === focusedHub) : -1;
      rowIndex = again >= 0 ? again : Math.min(rowIndex, Math.max(0, rows.length - 1));
      if (again >= 0 && focusedKey) {
        const k = rows[again].items.findIndex(it => it.ratingKey === focusedKey);
        if (k > 0) rows[again].focusIndex(k);
      }
      layoutRows();
    }
    renderRows();
    setText(empty, rows.length ? '' : 'Nothing here yet. Add some media to your Plex server.');
    const cur = rows[rowIndex] && rows[rowIndex].current();
    if (cur) showHero(cur);
    if (!reportedPaint && rows.length) {
      reportedPaint = true;
      log('home rows ready at ' + Math.round(performance.now()) + 'ms after page start');
    }
  }

  async function load() {
    const server = session.server;
    loadedAt = Date.now();
    try {
      const [sections, hubs] = await Promise.all([server.sections(), server.hubs()]);
      buildNav(sections);
      plexHubs = hubs;
      setHubs(composed());
      store.set('homeCache', { server: server.id, sections, hubs: hubs.map(slimHub) });
    } catch (e) {
      error('home load failed', e);
      if (!rows.length) setText(empty, 'Couldn\'t load from ' + server.name + '. Press OK to retry.');
    }
  }

  function showStatus(list) {
    if (!list.length) { toggleClass(libStatus, 'on', false); return; }
    const a = list[0];
    let text = a.title || 'Updating library';
    if (a.progress >= 0) text += '  ·  ' + Math.round(a.progress) + '%';
    if (list.length > 1) text += '  ·  +' + (list.length - 1);
    setText(libStatusText, text);
    toggleClass(libStatus, 'on', true);
  }

  // New or removed media shows up by itself: reload the rows (keeping focus)
  // when the server says the library changed.
  const unsubscribe = notifications.subscribe(ev => {
    if (ev.activities) showStatus(ev.activities);
    if (ev.changed) {
      session.server.invalidate();
      if (visible) load();
      else stale = true;
    }
  });

  function onDownloads(list) {
    dlItems = list.map(downloads.asItem);
    setHubs(composed());
  }
  let unsubDownloads = downloads.subscribe(onDownloads);

  const cached = store.get('homeCache');
  if (cached && session.server && cached.server === session.server.id) {
    buildNav(cached.sections || []);
    plexHubs = cached.hubs || [];
    setHubs(composed());
  } else {
    buildNav([]);
  }
  // The web font swaps in after first paint and changes the label widths.
  if (document.fonts) document.fonts.ready.then(renderNav);
  load();

  function activateNav(n) {
    if (n.id === 'section') openLibrary(n.section);
    else if (n.id === 'search') openSearch();
    else if (n.id === 'settings') openSettings();
  }

  return {
    el,
    name: 'home',
    onShow() {
      visible = true;
      if (!unsubDownloads) unsubDownloads = downloads.subscribe(onDownloads);
      ambience.restore();
      checkForUpdate();
      renderNav(); // widths can't be measured while the screen was hidden
      // Coming back from playback: progress and Continue Watching changed.
      if (stale || Date.now() - loadedAt > 5000) { stale = false; load(); }
    },
    onHide() {
      visible = false;
      if (unsubDownloads) { unsubDownloads(); unsubDownloads = null; } // no polling behind other screens
    },
    destroy() {
      unsubscribe();
      if (unsubDownloads) unsubDownloads();
    },
    onKey(action) {
      if (zone === 'nav') {
        if (action === 'left') { navIndex = Math.max(0, navIndex - 1); renderNav(); return true; }
        if (action === 'right') { navIndex = Math.min(navItems.length - 1, navIndex + 1); renderNav(); return true; }
        if (action === 'down' && rows.length) { zone = 'rows'; renderNav(); renderRows(); return true; }
        if (action === 'enter') { activateNav(navItems[navIndex]); return true; }
        if (action === 'back') return false;
        return true;
      }
      const row = rows[rowIndex];
      if (!row) {
        if (action === 'up') { zone = 'nav'; renderNav(); return true; }
        if (action === 'enter') { load(); return true; }
        return false;
      }
      switch (action) {
        case 'left': row.move(-1); return true;
        case 'right': row.move(1); return true;
        case 'up':
          if (rowIndex === 0) { zone = 'nav'; renderNav(); renderRows(); return true; }
          rowIndex--; renderRows(); onFocusItem(rows[rowIndex].current()); return true;
        case 'down':
          if (rowIndex < rows.length - 1) { rowIndex++; renderRows(); onFocusItem(rows[rowIndex].current()); }
          return true;
        case 'enter': row.select(); return true;
        case 'play': case 'playpause': if (row.current()) playItem(row.current()); return true;
        case 'back':
          // Back from deep in the rows returns to the top first.
          if (rowIndex > 0 || row.index > 0) {
            rowIndex = 0; rows.forEach(r => r.focusIndex(0)); renderRows(); onFocusItem(rows[0].current());
            return true;
          }
          return false;
      }
      return false;
    },
  };
}
