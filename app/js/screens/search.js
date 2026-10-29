// Search across the server. Focusing the input brings up Samsung's on-screen
// keyboard; results update as you type.
import { h, setText, setTransform } from '../util/dom.js';
import { Row } from '../ui/row.js';
import { session, isJellyfin } from '../session.js';
import { openItem, playItem, openCatalog } from '../nav.js';
import * as discover from '../plex/discover.js';
import * as watchlist from '../plex/watchlist.js';
import { parse as parseSmart, label as smartLabel, matches as smartMatches } from '../util/smart.js';
import { error, warn } from '../util/log.js';
import * as icons from '../ui/icons.js';
import { useAmbience } from '../ui/backdrop.js';

const CATALOG_MAX = 20;
const IME_DONE = 65376;
const IME_CANCEL = 65385;

export function SearchScreen() {
  const el = h('div', 'screen search');
  const ambience = useAmbience();
  const bar = h('div', 'search-bar', el);
  const icon = h('div', 'search-icon', bar);
  icon.innerHTML = icons.search;
  const input = h('input', 'search-input', bar);
  input.type = 'text';
  input.placeholder = 'Search movies and shows, on your server and beyond';
  input.setAttribute('autocomplete', 'off');
  const status = h('div', 'search-status', el);
  const clip = h('div', 'search-rows', el);
  const track = h('div', 'rows-track', clip);

  let rows = [];
  let rowIndex = -1; // -1 = input
  let timer = 0;
  let query = '';
  let generation = 0;

  async function run(q) {
    query = q;
    const gen = ++generation;
    if (q.length < 2) { setRows([]); setText(status, ''); return; }
    setText(status, 'Searching…');
    // Plex's catalog is searched alongside your server; its row joins below
    // your results when it arrives, so typing stays as quick as before.
    // On Jellyfin, which has no catalog, Sonarr/Radarr's (through watchlist-sync).
    // Not for a filter like "80s horror": that describes your library, not a title to get.
    const filterOnly = genreList && (p => p && !p.personGuess)(parseSmart(q, genreList));
    const catalog = filterOnly ? Promise.resolve([])
      : (isJellyfin() ? arrSearch(q) : discover.search(q)).catch(e => { warn('catalog search failed', e.message); return []; });
    // "80s horror", "unwatched comedies": a filtered row on top, when the
    // words describe titles rather than name one.
    const smart = smartRow(q).catch(e => { warn('smart search failed', e.message); return null; });
    let hubs = [];
    try {
      hubs = await session.server.search(q);
      if (gen !== generation) return;
      setRows(hubs);
    } catch (e) {
      error('search failed', e);
      if (gen === generation) setText(status, 'Search failed');
    }
    const sm = await smart;
    if (gen !== generation) return;
    if (sm) {
      hubs = [sm].concat(hubs);
      const at = rowIndex;
      setRows(hubs);
      if (at >= 0) { rowIndex = Math.min(rows.length - 1, at + 1); render(); }   // stay on the same row
    }
    const elsewhere = await notOwned(await catalog, hubs);
    if (gen !== generation) return;
    if (elsewhere.length) {
      addRow({ title: 'Not on your server', Metadata: elsewhere.slice(0, CATALOG_MAX), onSelect: openCatalog });
    }
    setText(status, hubs.length || elsewhere.length ? '' : 'Nothing found for “' + q + '”');
  }

  let genreList = null;
  async function smartRow(q) {
    const server = session.server;
    if (!server.smartSearch) return null;
    if (!genreList) genreList = await server.genreNames().catch(() => []);
    const f = parseSmart(q, genreList);
    if (!f) return null;
    let person = null;
    if (f.person) {
      person = await server.findPerson(f.person, f.personRole === 'director' ? 'director' : 'actor').catch(() => null);
      if (!person) return null;      // not a name after all: just a title search
      if (f.personRole === undefined && person.role) f.personRole = person.role;
    }
    const seen = new Set();
    let items = (await server.smartSearch(f, person)).filter(it => {
      if (seen.has(it.ratingKey) || !smartMatches(f, it)) return false;
      seen.add(it.ratingKey);
      return true;
    });
    const rating = it => it.audienceRating || it.rating || 0;
    if (f.sort === 'newest') items.sort((a, b) => (b.year || 0) - (a.year || 0));
    else if (f.sort === 'oldest') items.sort((a, b) => (a.year || 9999) - (b.year || 9999));
    else items.sort((a, b) => rating(b) - rating(a));
    items = items.slice(0, 60);
    if (!items.length) return null;
    return { title: smartLabel(f, person && person.name), type: 'mixed', hubIdentifier: 'smart', Metadata: items };
  }

  // Movies and shows from Radarr/Sonarr, alternating, minus what's downloaded.
  async function arrSearch(q) {
    if (!watchlist.baseUrl()) return [];
    const [movies, shows] = await Promise.all([
      watchlist.lookup('movie', { q }).catch(e => { warn('radarr lookup failed', e.message); return []; }),
      watchlist.lookup('show', { q }).catch(e => { warn('sonarr lookup failed', e.message); return []; }),
    ]);
    const a = (movies || []).filter(m => m.arrStatus !== 'have');
    const b = (shows || []).filter(m => m.arrStatus !== 'have');
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) out.push(a[i]);
      if (b[i]) out.push(b[i]);
    }
    return out;
  }

  // Catalog results minus what this server already has (matched by plex://
  // guid: first against the results above, then asking the server).
  async function notOwned(items, hubs) {
    if (!items.length) return [];
    const local = new Set();
    hubs.forEach(hub => hub.Metadata.forEach(m => {
      if (m.guid) local.add(m.guid);
      (m.Guid || []).forEach(g => g.id && local.add(m.type + ':' + g.id));
    }));
    let rest = items.filter(m => !(m.guid && local.has(m.guid)) &&
      !(m.arr && (m.Guid || []).some(g => local.has(m.type + ':' + g.id))));
    try {
      for (const [type, kind] of [[1, 'movie'], [2, 'show']]) {
        const guids = rest.filter(m => m.type === kind && m.guid).map(m => m.guid);
        if (!guids.length) continue;
        const owned = await session.server.ownedGuids(guids, type);
        rest = rest.filter(m => !owned.has(m.guid));
      }
    } catch (e) {
      warn('owned check failed', e.message);
    }
    return rest;
  }

  function makeRow(hub, y) {
    const row = new Row({
      title: hub.title, kind: hub.type === 'episode' ? 'episode' : 'poster',
      caption: true, items: hub.Metadata, onSelect: hub.onSelect || (item => openItem(item)),
    });
    setTransform(row.el, 'translateY(' + y + 'px)');
    row.y = y;
    track.appendChild(row.el);
    return row;
  }

  function setRows(hubs) {
    track.innerHTML = '';
    let y = 0;
    rows = hubs.map(hub => {
      const row = makeRow(hub, y);
      y += row.height;
      return row;
    });
    if (rowIndex >= rows.length) rowIndex = rows.length - 1;
    render();
  }

  // Append without rebuilding the rows above, so focus doesn't jump.
  function addRow(hub) {
    const last = rows[rows.length - 1];
    rows.push(makeRow(hub, last ? last.y + last.height : 0));
    render();
  }

  function render() {
    rows.forEach((r, i) => r.setActive(i === rowIndex));
    el.classList.toggle('in-input', rowIndex < 0);
    const y = rowIndex > 0 ? rows[rowIndex].y : 0;
    setTransform(track, 'translateY(' + (-y) + 'px)');
  }

  function focusInput() {
    rowIndex = -1;
    render();
    input.focus();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value.trim()), 350);
  });
  input.addEventListener('keydown', e => {
    if (e.keyCode === IME_DONE || e.keyCode === 13) {
      input.blur();
      run(input.value.trim());
      if (rows.length) { rowIndex = 0; render(); }
    } else if (e.keyCode === IME_CANCEL) {
      input.blur();
    }
  });

  // The library's genres, for smart search, fetched while you type.
  if (session.server && session.server.genreNames) session.server.genreNames().then(g => { genreList = g; }, () => {});

  return {
    el,
    name: 'search',
    onShow() {
      ambience.restore();
      if (rowIndex < 0) setTimeout(focusInput, 50);
    },
    onHide() { input.blur(); },
    onKey(action) {
      if (rowIndex < 0) {
        if (action === 'down' && rows.length) { input.blur(); rowIndex = 0; render(); return true; }
        if (action === 'enter') { input.focus(); return true; }
        if (action === 'back') { input.blur(); return false; }
        return true;
      }
      const row = rows[rowIndex];
      switch (action) {
        case 'left': row.move(-1); return true;
        case 'right': row.move(1); return true;
        case 'up': if (rowIndex === 0) focusInput(); else { rowIndex--; render(); } return true;
        case 'down': if (rowIndex < rows.length - 1) { rowIndex++; render(); } return true;
        case 'enter': row.select(); return true;
        case 'play': case 'playpause': {
          const it = row.current();
          if (it) { if (it.catalog) openCatalog(it); else playItem(it); } // nothing to play yet
          return true;
        }
        case 'back': focusInput(); return true;
      }
      return false;
    },
    destroy() { clearTimeout(timer); generation++; },
  };
}
