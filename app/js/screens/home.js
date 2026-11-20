// Home: hero for the focused item, nav bar, and Plex's home hubs as rows.
// The last hub payload is cached so a cold start paints instantly.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { Row } from '../ui/row.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { session, isJellyfin } from '../session.js';
import { metaLine } from '../util/format.js';
import { isFast } from '../input.js';
import * as store from '../util/store.js';
import * as icons from '../ui/icons.js';
import { openItem, playItem, openLibrary, openSearch, openSettings, openCatalogLookup, openCatalog } from '../nav.js';
import { error, log } from '../util/log.js';
import * as updates from '../plex/updates.js';
import * as notifications from '../plex/notifications.js';
import * as downloads from '../plex/downloads.js';
import { leftQueue, findReady, placeReady, queueId } from '../plex/ready.js';
import { notice } from '../ui/notice.js';
import { Picker } from '../ui/picker.js';
import * as watchlist from '../plex/watchlist.js';
import * as together from '../plex/together.js';
import { cwOpens } from '../player/options.js';
import * as motion from '../ui/motion.js';
import { activeTasteKey, discoverySections, prepareRecommendations, requestablePicks } from '../plex/recommendations.js';
import { readTaste, setFeedback } from '../util/taste.js';
import { currentRequests, describeRequest, subscribeRequests, tracked } from '../plex/requests.js';
import { arm, homeEnter, homeReady } from '../util/perf.js';
import { enabled as kidsOn, filterHubs, playbackBlocked } from '../util/kids.js';

// Once per app start, a few seconds after home appears: is there a newer
// Orama? Mentioned once per version.
let updateChecked = false;
function checkForUpdate() {
  if (kidsOn() || updateChecked) return;
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
const TASTE_ROW = 'orama.for-you';

export function libraryItem(it) {
  return !!(it && it.ratingKey && !it.download && !it.catalog &&
    (it.jellyfin === true || /^\d+$/.test(String(it.ratingKey))));
}

function slimHub(hub) {
  // Keep the cache small: only fields the home screen renders.
  const keep = ['ratingKey', 'key', 'type', 'title', 'grandparentTitle', 'parentTitle', 'year', 'thumb', 'art',
    'grandparentThumb', 'grandparentArt', 'parentThumb', 'index', 'parentIndex', 'duration', 'viewOffset',
    'viewCount', 'leafCount', 'viewedLeafCount', 'childCount', 'contentRating', 'audienceRating', 'summary',
    'audienceRatingImage', 'rating', 'ratingImage', 'librarySectionID',
    'originallyAvailableAt', 'UltraBlurColors', 'grandparentRatingKey', 'parentRatingKey', 'Image', 'jellyfin'];
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
  homeEnter();
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
  let kidsBadge = null;
  let kidsWas = kidsOn();
  function paintKids() {
    const on = kidsOn();
    if (on && !kidsBadge) {
      kidsBadge = h('div', 'kids-badge', top);
      kidsBadge.textContent = 'Kids';
    } else if (!on && kidsBadge) {
      kidsBadge.remove();
      kidsBadge = null;
    }
  }
  paintKids();

  const info = h('div', 'hero-info', el);
  let heroItem = null;
  const heroLogo = h('img', 'hero-logo', info);
  const heroTitle = h('h1', 'hero-title', info);
  const heroMeta = h('div', 'hero-meta', info);
  const heroSummary = h('p', 'hero-summary', info);

  const rowsClip = h('div', 'home-rows', el);
  rowsClip.style.top = ROWS_TOP + 'px';
  const track = h('div', 'rows-track', rowsClip);
  const empty = h('div', 'home-empty', el);
  const holdHint = h('div', 'home-hint', el);
  holdHint.textContent = 'Hold OK for options';
  const picker = new Picker(el);

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
  let queueSnap = null;    // last queue, so a title leaving it can be announced
  let waitingReady = [];   // left the queue, not in the library yet
  let readyItems = [];     // library items to pin at the front of Recently Added
  const readyTold = new Set();
  let upItems = [];        // episodes airing soon (Sonarr's calendar), as tiles
  let upLoadedAt = 0;
  let upcomingGen = 0;
  let togetherItems = [];  // Watch Together sessions you're invited to, at the top
  let togetherTimer = 0;
  let togetherGen = 0;
  let syncItems = [];      // Jellyfin SyncPlay groups, same row
  let syncTimer = 0;
  let syncGen = 0;
  let discoverHubs = [];   // titles you don't have yet (watchlist-sync), at the bottom
  let discoverLoadedAt = 0;
  let tasteItems = [];
  let worthItems = [];
  let requestItems = [];
  let shownTasteKey = '';
  let tasteRequest = 0;
  let loadGen = 0;
  let worthSignature = '';

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
    if (item !== heroItem) motion.replay(info, 'hero-swap');
    heroItem = item;
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
    if (item.request) {
      setText(heroMeta, describeRequest(item.request));
      setText(heroSummary, '');
    } else if (item.download) {
      setText(heroMeta, (item.year ? item.year + '  ·  ' : '') + downloads.describe(item.download));
      setText(heroSummary, '');
    } else if (item.upcoming) {
      const u = item.upcoming;
      setText(heroMeta, item.note + (u.title ? '  ·  ' + u.title : ''));
      setText(heroSummary, u.overview || '');
    } else {
      setText(heroMeta, item.tasteReason || ((item.type === 'episode' ? item.title + '  ·  ' : '') + metaLine(item)));
      setText(heroSummary, item.summary || '');
    }
    ambience.set(item.UltraBlurColors);
    clearTimeout(artTimer);
    artTimer = setTimeout(() => hero.set(server.image(heroArtPath(item), 1344, 756)), isFast() ? 350 : 120);
  }

  function onFocusItem(item) {
    updateHint();
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
    updateHint();
  }

  // The server's rows plus, when something is downloading, a "Downloading"
  // row right after Continue Watching.
  // and a "Coming up" row after the recently added ones.
  function composed() {
    let hubs = placeReady(plexHubs, readyItems);
    if (togetherItems.length) {
      hubs = [{ hubIdentifier: 'flexplex.together', title: 'Watch Together', type: 'movie', size: togetherItems.length, Metadata: togetherItems }].concat(hubs);
    }
    if (syncItems.length) {
      hubs = [{ hubIdentifier: 'orama.syncplay', title: 'Watch Together', type: 'movie', size: syncItems.length, Metadata: syncItems }].concat(hubs);
    }
    const downloads = dlItems.filter(item => !tracked(item.download));
    if (downloads.length) {
      const at = hubs.findIndex(hb => !/continue|ondeck/i.test(hb.hubIdentifier));
      const i = at < 0 ? hubs.length : at;
      const row = { hubIdentifier: 'flexplex.downloads', title: 'Downloading', type: 'movie', size: downloads.length, Metadata: downloads };
      hubs = hubs.slice(0, i).concat([row], hubs.slice(i));
    }
    if (requestItems.length) {
      const at = hubs.findIndex(hb => !/continue|ondeck|downloads/i.test(hb.hubIdentifier));
      const i = at < 0 ? hubs.length : at;
      const row = { hubIdentifier: 'orama.requests', title: 'Requests', type: 'movie', size: requestItems.length, Metadata: requestItems };
      hubs = hubs.slice(0, i).concat([row], hubs.slice(i));
    }
    if (upItems.length) {
      let last = -1;
      hubs.forEach((hb, i) => { if (/recentlyadded|downloads|continue|ondeck/i.test(hb.hubIdentifier)) last = i; });
      const row = { hubIdentifier: 'flexplex.upcoming', title: 'Coming up', type: 'show', size: upItems.length, Metadata: upItems };
      hubs = hubs.slice(0, last + 1).concat([row], hubs.slice(last + 1));
    }
    if (discoverHubs.length && watchlist.discoverEnabled()) hubs = hubs.concat(discoverHubs);
    if (tasteItems.length) {
      hubs = hubs.concat([{ hubIdentifier: TASTE_ROW, title: 'For you', type: 'movie', size: tasteItems.length, Metadata: tasteItems }]);
    }
    const worth = watchlist.discoverEnabled() ? worthItems.filter(item => !tracked(item)) : [];
    if (worth.length) {
      hubs = hubs.concat([{ hubIdentifier: 'orama.worth-requesting', title: 'Worth requesting', type: 'movie', size: worth.length, Metadata: worth }]);
    }
    return filterHubs(hubs);
  }

  async function loadTaste() {
    const key = activeTasteKey();
    const profile = readTaste(key);
    const request = ++tasteRequest;
    try {
      if (key !== shownTasteKey) {
        shownTasteKey = key;
        if (tasteItems.length || worthItems.length) { tasteItems = []; worthItems = []; setHubs(composed()); }
      }
      if (!profile.length) {
        worthSignature = '';
        if (tasteItems.length || worthItems.length) { tasteItems = []; worthItems = []; setHubs(composed()); }
        return;
      }
      const picks = await prepareRecommendations(null, plexHubs).picks({ waitForAI: true });
      if (request !== tasteRequest || key !== activeTasteKey()) return;
      tasteItems = picks.slice(0, 12).map(({ item, reason }) => ({ ...item, tasteReason: reason }));
      setHubs(composed());
      loadWorthRequesting();
    } catch (e) {
      if (request === tasteRequest) error('for you row failed', e);
    }
  }

  async function loadWorthRequesting() {
    const key = activeTasteKey();
    const profile = readTaste(key);
    if (!profile.length || !discoverHubs.length || !watchlist.discoverEnabled()) return;
    const signature = JSON.stringify([key, profile, watchlist.baseUrl(), discoverLoadedAt, Math.floor(Date.now() / 60000)]);
    if (signature === worthSignature) return;
    worthSignature = signature;
    try {
      const picks = await requestablePicks(discoverHubs.map(hub => ({ items: hub.Metadata })));
      if (signature !== worthSignature || key !== activeTasteKey() || !readTaste(key).length) return;
      worthItems = picks.slice(0, 8).map(({ item, reason }) => ({ ...item, tasteReason: reason }));
      setHubs(composed());
    } catch (e) {
      if (signature === worthSignature) worthSignature = '';
    }
  }

  // Watch Together invitations (Plex): checked now and every minute while Home is up.
  const togetherMeta = new Map();
  const togetherSeen = new Set();
  async function loadTogether() {
    clearTimeout(togetherTimer);
    togetherTimer = 0;
    if (!together.available()) return;
    const gen = ++togetherGen;
    try {
      const rooms = await together.rooms();
      if (gen !== togetherGen) return;
      const acct = await together.myAccount().catch(() => null);
      if (gen !== togetherGen) return;
      const items = [];
      for (const room of rooms) {
        const rk = together.ratingKeyOf(room.sourceUri);
        if (!rk) continue;                      // on someone else's server
        let meta = togetherMeta.get(rk);
        if (!meta) {
          meta = await session.server.metadata(rk).catch(() => null);
          if (gen !== togetherGen) return;
          if (!meta) continue;
          togetherMeta.set(rk, meta);
        }
        const host = (room.users || []).find(u => u.id === room.createdBy);
        const mine = acct && room.createdBy === acct.id;
        items.push(Object.assign({}, meta, {
          ratingKey: 'together-' + room.id, together: room, togetherItem: meta,
          note: mine ? 'Your session' : 'From ' + ((host && (host.title || host.username)) || 'a friend'),
        }));
      }
      if (gen !== togetherGen) return;
      // A new invitation: say so (it's in the Watch Together row at the top).
      const fresh = items.find(i => !togetherSeen.has(i.ratingKey) && !/^Your/.test(i.note));
      items.forEach(i => togetherSeen.add(i.ratingKey));
      if (fresh && visible) notice(fresh.note.replace(/^From /, '') + ' invited you to watch ' + (fresh.together.title || fresh.title) + ' together · it\'s at the top of Home', 8000);
      const changed = items.map(i => i.ratingKey).join() !== togetherItems.map(i => i.ratingKey).join();
      togetherItems = items;
      if (changed) setHubs(composed());
    } catch (e) { /* plex.tv unreachable: try again next minute */ }
    // Hide clears the timer started at the top, so a quick trip off Home
    // used to stop the minute poll until the next full reload.
    if (gen === togetherGen && visible) togetherTimer = setTimeout(loadTogether, 60000);
  }

  // Jellyfin SyncPlay groups, same minute cadence as Plex Watch Together.
  async function loadSync() {
    clearTimeout(syncTimer);
    syncTimer = 0;
    if (!isJellyfin()) return;
    const gen = ++syncGen;
    try {
      const sync = await import('../plex/syncplay.js');
      const groups = await sync.listGroups();
      if (gen !== syncGen) return;
      const items = groups.map(sync.groupTile);
      const changed = items.map(i => i.ratingKey).join() !== syncItems.map(i => i.ratingKey).join();
      syncItems = items;
      if (changed) setHubs(composed());
    } catch (e) { /* this Jellyfin has no SyncPlay, or it is unreachable */ }
    if (gen === syncGen && visible) syncTimer = setTimeout(loadSync, 60000);
  }

  async function joinSyncGroup(group) {
    notice('Joining ' + (group.name || 'Watch together') + '…', 8000);
    try {
      const sync = await import('../plex/syncplay.js');
      const play = await sync.waitForQueue(group.groupId);
      if (!visible) return;
      if (!play || !play.itemId) { notice('That group isn\'t playing anything yet', 5000); return; }
      const meta = await session.server.metadata(play.itemId);
      if (!visible) return;
      if (playbackBlocked(meta)) {
        notice('Kids mode is on. This is above the rating.', 5000);
        sync.leaveGroup();
        return;
      }
      playItem(meta, {
        offset: play.startMs || 0,
        together: {
          syncplay: true, host: false, joined: true, groupId: group.groupId,
          itemId: play.itemId, playlistItemId: play.playlistItemId, startMs: play.startMs || 0,
          room: { title: group.name || 'Watch together', users: [] },
        },
      });
    } catch (e) {
      if (visible) notice('Couldn\'t join (' + e.message + ')', 6000);
    }
  }

  // Trending and recommended titles you don't have, from Radarr/Sonarr via
  // watchlist-sync; OK opens their page with Request. Every 3 hours at most.
  async function loadDiscover() {
    if (Date.now() - discoverLoadedAt < 3 * 3600000 || !watchlist.baseUrl() || !watchlist.discoverEnabled()) return;
    discoverLoadedAt = Date.now();
    try {
      const sections = await discoverySections();
      discoverHubs = sections.filter(s => s.items.length).map(s => ({
        hubIdentifier: 'flexplex.discover.' + s.id, title: s.title, type: 'movie', size: s.items.length, Metadata: s.items,
      }));
      setHubs(composed());
      loadWorthRequesting();
    } catch (e) { discoverLoadedAt = 0; /* watchlist-sync not there right now */ }
  }

  const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function airLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000);
    const day = days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : WEEKDAY[d.getDay()];
    return day + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function upcomingTile(u) {
    const se = 'S' + String(u.season).padStart(2, '0') + 'E' + String(u.episode).padStart(2, '0');
    return {
      ratingKey: 'up-' + (u.tvdb || u.show) + '-' + u.season + '-' + u.episode,
      type: 'show', title: u.show, year: u.year, thumb: u.poster || '', art: u.fanart || '',
      note: se + '  ·  ' + airLabel(u.air), upcoming: u,
    };
  }

  // Once at start and every 30 minutes; quietly nothing without watchlist-sync.
  async function loadUpcoming() {
    if (Date.now() - upLoadedAt < 30 * 60000 || !watchlist.baseUrl()) return;
    const gen = ++upcomingGen;
    upLoadedAt = Date.now();
    try {
      const r = await watchlist.upcoming(7);
      if (gen !== upcomingGen) return;
      upItems = r && r.items ? r.items.map(upcomingTile) : [];
      setHubs(composed());
    } catch (e) {
      // The stamp was taken before the request. Leaving it set hides the row
      // for half an hour after a blip, including the next time Home is shown.
      if (gen === upcomingGen) upLoadedAt = 0;
    }
  }

  function selectItem(item) {
    if (item.request) {
      if (item.request.state.playable) openItem(item.request.state.playable);
      else openCatalog(item.request.item);
      return;
    }
    if (item.upcoming) { openCatalogLookup({ title: item.title, year: item.year, kind: 'show', id: item.upcoming.tvdb }).catch(e => error('show lookup failed', e)); return; }
    if (item.arr) { openCatalog(item); return; }
    if (item.syncplay) { joinSyncGroup(item.syncplay); return; }
    if (item.together) {
      const room = item.together;
      playItem(item.togetherItem, { offset: 0, together: { room, uri: room.sourceUri, host: false } });
      return;
    }
    if (item.download) openDownload(item.download);
    // Settings › OK on Continue Watching: resume straight away.
    else if (cwOpens() === 'play' && isContinueRow(rows[rowIndex]) && (item.type === 'episode' || item.type === 'movie')) playItem(item);
    else openItem(item);
  }

  // A download's catalog page (details, Watchlist), found by title and year.
  async function openDownload(d) {
    try {
      await openCatalogLookup({ title: d.title, year: d.year, kind: d.kind, id: d.kind === 'show' ? d.tvdb : d.tmdb });
    } catch (e) {
      error('download lookup failed', e);
    }
  }

  function setHubs(hubs, fromCache) {
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
    setText(empty, rows.length ? '' : 'Nothing here yet. Add some media to your server.');
    const cur = rows[rowIndex] && rows[rowIndex].current();
    if (cur) showHero(cur);
    if (!reportedPaint && rows.length) {
      reportedPaint = true;
      log('home rows ready at ' + Math.round(performance.now()) + 'ms after page start');
      homeReady(fromCache);
    }
  }

  async function load() {
    const server = session.server;
    const user = session.user;
    const gen = ++loadGen;
    loadedAt = Date.now();
    if (!server) {
      if (!rows.length) setText(empty, 'Couldn\'t load your library. Press OK to retry.');
      return;
    }
    try {
      const [sections, hubs] = await Promise.all([server.sections(), server.hubs()]);
      if (gen !== loadGen || session.server !== server || session.user !== user) return;
      buildNav(sections);
      plexHubs = hubs;
      absorbReady();
      setHubs(composed());
      store.set('homeCache', { server: server.id, sections, hubs: hubs.map(slimHub) });
      loadTaste();
      loadUpcoming();
      loadDiscover();
      loadTogether();
      loadSync();
    } catch (e) {
      error('home load failed', e);
      if (gen === loadGen && !rows.length) setText(empty, 'Couldn\'t load from ' + (server.name || 'the server') + '. Press OK to retry.');
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

  // The queue poll already running for the Downloading row. A title that
  // leaves it is remembered until a library refresh shows it in Recently Added.
  function noteQueue(list) {
    if (queueSnap) {
      leftQueue(queueSnap, list).forEach(d => {
        const id = queueId(d);
        if (id && !waitingReady.some(w => queueId(w) === id)) waitingReady.push(d);
      });
    }
    queueSnap = list.slice();
  }

  function absorbReady() {
    if (waitingReady.length) {
      const done = new Set();
      findReady(waitingReady, plexHubs).forEach(hit => {
        const id = queueId(hit.download);
        done.add(id);
        if (!readyTold.has(id)) {
          readyTold.add(id);
          if (visible) notice((hit.download.title || hit.item.title) + ' is ready to watch');
        }
        readyItems = [hit.item].concat(readyItems.filter(it => it.ratingKey !== hit.item.ratingKey));
      });
      if (done.size) waitingReady = waitingReady.filter(d => !done.has(queueId(d)));
    }
    // Drop a pin once that title is no longer in Recently Added.
    const still = new Set();
    plexHubs.forEach(h => {
      if (!/recentlyadded/i.test(h.hubIdentifier || '')) return;
      (h.Metadata || []).forEach(it => { if (it && it.ratingKey) still.add(it.ratingKey); });
    });
    readyItems = readyItems.filter(it => still.has(it.ratingKey)).slice(0, 12);
  }

  function onDownloads(list) {
    noteQueue(list);
    absorbReady();
    dlItems = list.map(downloads.asItem);
    setHubs(composed());
  }
  let unsubDownloads = downloads.subscribe(onDownloads);
  function onRequests() {
    requestItems = currentRequests().map(row => ({ ...row.item, ratingKey: 'request-' + row.key, request: row }));
    setHubs(composed());
  }
  let unsubRequests = subscribeRequests(onRequests);

  const cached = store.get('homeCache');
  if (cached && session.server && cached.server === session.server.id) {
    buildNav(cached.sections || []);
    plexHubs = cached.hubs || [];
    setHubs(composed(), true);
  } else {
    buildNav([]);
  }
  // The web font swaps in after first paint and changes the label widths.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderNav, () => {});
  load();

  // --- Hold OK on a tile: remove from Continue Watching, watched / unwatched ---
  function isContinueRow(row) {
    return !!row && /continue|ondeck/i.test(row.hubId || '');
  }

  function updateHint() {
    const row = rows[rowIndex];
    toggleClass(holdHint, 'on', zone === 'rows' && !picker.isOpen &&
      (isContinueRow(row) || (row && row.hubId === TASTE_ROW)) && libraryItem(row.current()));
  }

  function openTileMenu() {
    const row = rows[rowIndex];
    const it = row && row.current();
    if (!libraryItem(it)) return;
    const server = session.server;
    const watched = it.type === 'show' ? it.viewedLeafCount >= it.leafCount : !!it.viewCount;
    const opts = [];
    const tasteKey = row.hubId === TASTE_ROW ? activeTasteKey() : '';
    if (tasteKey) opts.push({ label: 'More like this', value: 'more' }, { label: 'Not for me', value: 'less' });
    if (isContinueRow(row) || it.viewOffset) opts.push({ label: 'Remove from Continue Watching', value: 'remove' });
    if (!watched || it.viewOffset) opts.push({ label: 'Mark as watched', value: 'watched' });
    if (watched) opts.push({ label: 'Mark as unwatched', value: 'unwatched' });
    else if (it.viewOffset) opts.push({ label: 'Clear progress', value: 'unwatched' });
    if (it.type === 'episode' && it.grandparentRatingKey) opts.push({ label: 'Go to show', value: 'show' });
    opts.push({ label: 'Open', value: 'open' });
    toggleClass(holdHint, 'on', false);
    picker.open(it.grandparentTitle || it.title, opts, async v => {
      updateHint();
      try {
        if (v === 'open') return selectItem(it);
        if (v === 'more' || v === 'less') {
          setFeedback(tasteKey, it, v);
          if (v === 'less') {
            tasteItems = tasteItems.filter(item => item.ratingKey !== it.ratingKey);
            setHubs(composed());
          }
          loadTaste();
          return;
        }
        if (v === 'show') return openItem({ ratingKey: it.grandparentRatingKey, type: 'show', title: it.grandparentTitle });
        if (v === 'remove') await server.removeFromContinueWatching(it.ratingKey);
        if (v === 'watched') await server.scrobble(it.ratingKey);
        if (v === 'unwatched') await server.unscrobble(it.ratingKey);
        notice(v === 'remove' ? 'Removed from Continue Watching' : v === 'watched' ? 'Marked as watched'
          : watched ? 'Marked as unwatched' : 'Progress cleared', 3000);
        server.invalidate();
        load();
      } catch (e) {
        error('tile action failed', e);
        notice('The server didn\'t accept that (' + e.message + ')', 5000);
      }
    });
  }

  function activateNav(n) {
    if (n.id === 'section') openLibrary(n.section);
    else if (n.id === 'search') openSearch();
    else if (n.id === 'settings') openSettings();
  }

  return {
    el,
    name: 'home',
    onShow() {
      arm();
      const returning = !visible;
      visible = true;
      if (!unsubDownloads) unsubDownloads = downloads.subscribe(onDownloads);
      if (!unsubRequests) unsubRequests = subscribeRequests(onRequests);
      ambience.restore();
      paintKids();
      if (kidsOn() !== kidsWas) { kidsWas = kidsOn(); stale = true; }
      checkForUpdate();
      renderNav(); // widths can't be measured while the screen was hidden
      const profile = readTaste(activeTasteKey());
      if (!profile.length && (tasteItems.length || worthItems.length)) loadTaste();
      // Coming back from playback: progress and Continue Watching changed.
      if (stale || Date.now() - loadedAt > 5000 || (returning && profile.length)) { stale = false; load(); }
      else if (returning) { loadTogether(); loadSync(); }
    },
    onHide() {
      visible = false;
      if (unsubDownloads) { unsubDownloads(); unsubDownloads = null; } // no polling behind other screens
      if (unsubRequests) { unsubRequests(); unsubRequests = null; }
      clearTimeout(togetherTimer);
      togetherTimer = 0;
      clearTimeout(syncTimer);
      syncTimer = 0;
    },
    destroy() {
      tasteRequest++;
      loadGen++;
      upcomingGen++;
      togetherGen++;
      syncGen++;
      worthSignature = '';
      clearTimeout(artTimer);
      clearTimeout(heroTimer);
      clearTimeout(togetherTimer);
      clearTimeout(syncTimer);
      unsubscribe();
      if (unsubDownloads) unsubDownloads();
      if (unsubRequests) unsubRequests();
    },
    wantsHold() {
      return zone === 'rows' && !picker.isOpen && libraryItem(rows[rowIndex] && rows[rowIndex].current());
    },
    onKey(action) {
      if (picker.isOpen) {
        const handled = picker.onKey(action);
        if (!picker.isOpen) updateHint();
        return handled;
      }
      if (action === 'hold') { openTileMenu(); return true; }
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
