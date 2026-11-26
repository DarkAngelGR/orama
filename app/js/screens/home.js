// Home: hero for the focused item, nav bar, and Plex's home hubs as rows.
// The last hub payload is cached so a cold start paints instantly.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { Row } from '../ui/row.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { session, isJellyfin } from '../session.js';
import { metaParts, heroEyebrow } from '../util/format.js';
import { isFast } from '../input.js';
import * as store from '../util/store.js';
import { openItem, playItem, activateRail, openCatalogLookup, openCatalog } from '../nav.js';
import { error, log } from '../util/log.js';
import * as updates from '../plex/updates.js';
import * as notifications from '../plex/notifications.js';
import * as downloads from '../plex/downloads.js';
import { leftQueue, findReady, placeReady, queueId } from '../plex/ready.js';
import { notice } from '../ui/notice.js';
import { showLogo } from '../ui/logo.js';
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
import { libraryItem, openTitleMenu } from '../ui/tilemenu.js';
import { Rail, mountClock } from '../ui/rail.js';
import { dress, seasonOn } from '../ui/season.js';

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

const ROWS_TOP = 790;
// Home rows are clipped at the rail (112). 64 more puts the focused tile at x=176.
const ROW_INSET = 64;
const TASTE_ROW = 'orama.for-you';

export { libraryItem };

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

export function HomeScreen() {
  homeEnter();
  const el = h('div', 'screen home');
  const ambience = useAmbience();
  const hero = new HeroArt(el, 'hero-art home-art');

  const stopClock = mountClock(el);
  // "Scanning Movies · 42%" while the server works on a library.
  const libStatus = h('div', 'lib-status', el);
  h('i', 'lib-status-spin', libStatus);
  const libStatusText = h('span', '', libStatus);
  let kidsBadge = null;
  let kidsWas = kidsOn();
  function paintKids() {
    const on = kidsOn();
    if (on && !kidsBadge) {
      kidsBadge = h('div', 'kids-badge', el);
      kidsBadge.textContent = 'Kids';
    } else if (!on && kidsBadge) {
      kidsBadge.remove();
      kidsBadge = null;
    }
  }
  paintKids();

  const info = h('div', 'hero-info', el);
  let heroItem = null;
  const heroEye = h('div', 'hero-eyebrow', info);
  const heroLogo = h('img', 'hero-logo', info);
  const heroTitle = h('h1', 'hero-title', info);
  const heroMeta = h('div', 'hero-meta', info);
  const heroSummary = h('p', 'hero-summary', info);
  const heroActions = h('div', 'hero-actions', info);
  let actionBtns = [];
  let actionIndex = 0;

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

  const rail = Rail(el, { current: 'home', onActivate: activateRail });

  function paintMeta(parts) {
    heroMeta.textContent = '';
    parts.forEach(p => {
      if (!p || !p.text) return;
      const s = h('span', p.chip ? 'chip' : 'meta-bit', heroMeta);
      s.textContent = p.text;
    });
  }

  function paintActions(item) {
    heroActions.textContent = '';
    actionBtns = [];
    const add = (label, primary, run) => {
      const b = h('div', 'btn' + (primary ? ' primary' : ''), heroActions);
      b.textContent = (primary ? '▶  ' : '') + label;
      actionBtns.push({ el: b, run });
    };
    if (!item) { renderActions(); return; }
    const playable = item.type === 'movie' || item.type === 'episode' || item.type === 'show' || item.type === 'season' || item.type === 'clip';
    const resume = playable && item.viewOffset && item.duration > item.viewOffset && !item.together && !item.syncplay;
    if (item.together || item.syncplay) add('Join', true, () => selectItem(item));
    else if (item.request || item.download || item.upcoming || item.arr) add('Open', true, () => selectItem(item));
    else if (playable) {
      add(resume ? 'Resume' : 'Play', true, () => playItem(item, resume ? { offset: item.viewOffset } : undefined));
      if (resume) add('From the start', false, () => playItem(item, { offset: 0 }));
    } else add('Open', true, () => selectItem(item));
    if (libraryItem(item)) add('More', false, () => openTileMenu());
    if (actionIndex >= actionBtns.length) actionIndex = 0;
    renderActions();
  }

  function renderActions() {
    actionBtns.forEach((b, i) => toggleClass(b.el, 'focus', zone === 'actions' && i === actionIndex));
  }

  function festiveEye(eye) {
    return seasonOn() && eye ? 'Merry Christmas · ' + eye : eye;
  }

  function showHero(item) {
    if (!item) return;
    if (item !== heroItem) motion.replay(info, 'hero-swap');
    heroItem = item;
    const server = session.server;
    const row = rows[rowIndex];
    setText(heroEye, festiveEye(heroEyebrow(row && row.title, item)));
    setText(heroTitle, item.type === 'episode' ? item.grandparentTitle : item.title);
    showLogo(heroLogo, heroTitle, item, p => server.image(p, 720, 220, { format: 'png' }));
    if (item.request) {
      paintMeta([{ text: describeRequest(item.request) }]);
      setText(heroSummary, '');
    } else if (item.download) {
      paintMeta([{ text: (item.year ? item.year + '  ·  ' : '') + downloads.describe(item.download) }]);
      setText(heroSummary, '');
    } else if (item.upcoming) {
      const u = item.upcoming;
      paintMeta([{ text: item.note + (u.title ? '  ·  ' + u.title : '') }]);
      setText(heroSummary, u.overview || '');
    } else if (item.tasteReason) {
      paintMeta([{ text: item.tasteReason }].concat(metaParts(item)));
      setText(heroSummary, item.summary || '');
    } else {
      const parts = metaParts(item);
      if (item.type === 'episode' && item.title) parts.unshift({ text: item.title });
      paintMeta(parts);
      setText(heroSummary, item.summary || '');
    }
    paintActions(item);
    ambience.set(item.UltraBlurColors);
    clearTimeout(artTimer);
    artTimer = setTimeout(() => hero.set(server.image(heroArtPath(item), 1920, 1080)), isFast() ? 350 : 120);
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
        const row = new Row({
          title: hb.title, kind: 'land', inset: ROW_INSET, items: hb.Metadata,
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
      rail.setSections(sections);
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
    rail.setSections(cached.sections || []);
    plexHubs = cached.hubs || [];
    setHubs(composed(), true);
  }
  load();

  // --- Hold OK on a tile: remove from Continue Watching, watched / unwatched ---
  function isContinueRow(row) {
    return !!row && /continue|ondeck/i.test(row.hubId || '');
  }

  function updateHint() {
    const row = rows[rowIndex];
    toggleClass(holdHint, 'on', zone === 'rows' && !picker.isOpen && libraryItem(row && row.current()));
  }

  function openTileMenu() {
    const row = rows[rowIndex];
    const it = row && row.current();
    if (!libraryItem(it)) return;
    const tasteKey = row.hubId === TASTE_ROW ? activeTasteKey() : '';
    const extra = tasteKey ? [{ label: 'More like this', value: 'more' }, { label: 'Not for me', value: 'less' }] : [];
    toggleClass(holdHint, 'on', false);
    openTitleMenu(picker, it, { continueRow: isContinueRow(row), kids: kidsOn(), extra }, {
      select: selectItem,
      open: openItem,
      play: playItem,
      server: session.server,
      notice,
      refresh: () => load(),
      onError: e => error('tile action failed', e),
      onExtra: v => {
        if (v !== 'more' && v !== 'less') return false;
        setFeedback(tasteKey, it, v);
        if (v === 'less') {
          tasteItems = tasteItems.filter(item => item.ratingKey !== it.ratingKey);
          setHubs(composed());
        }
        loadTaste();
        updateHint();
        return true;
      },
    });
  }

  function openRail() {
    rail.openRail();
    toggleClass(el, 'rail-open', true);
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
      rail.paintWho();
      dress(el);
      if (heroItem) setText(heroEye, festiveEye(heroEyebrow(rows[rowIndex] && rows[rowIndex].title, heroItem)));
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
      stopClock();
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
      if (rail.isOpen()) {
        const handled = rail.onKey(action);
        toggleClass(el, 'rail-open', rail.isOpen());
        return handled !== false;
      }
      if (zone === 'actions') {
        if (action === 'left' && actionIndex === 0) { openRail(); return true; }
        if (action === 'left') { actionIndex--; renderActions(); return true; }
        if (action === 'right') { actionIndex = Math.min(actionBtns.length - 1, actionIndex + 1); renderActions(); return true; }
        if (action === 'up') { openRail(); return true; }
        if (action === 'down' && rows.length) { zone = 'rows'; renderActions(); renderRows(); return true; }
        if (action === 'enter' && actionBtns[actionIndex]) { actionBtns[actionIndex].run(); return true; }
        if ((action === 'play' || action === 'playpause') && actionBtns[0]) { actionBtns[0].run(); return true; }
        return action !== 'back';
      }
      const row = rows[rowIndex];
      if (!row) {
        if (action === 'up' || action === 'left') { openRail(); return true; }
        if (action === 'enter') { load(); return true; }
        return false;
      }
      switch (action) {
        case 'left':
          if (!row.move(-1)) openRail();
          return true;
        case 'right': row.move(1); return true;
        case 'up':
          if (rowIndex === 0) {
            if (actionBtns.length) { zone = 'actions'; renderActions(); renderRows(); }
            else openRail();
            return true;
          }
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
