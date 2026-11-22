// A whole library as a virtualized poster grid, loaded page by page.
// Up from the top row reaches Sort, Show and Filter (Left / Right pick one,
// OK changes it; the yellow button changes the sort too, on remotes that have
// one). All three are remembered per library and profile. CH▲/CH▼ jump by letter
// (title sort) or by page. Hold OK opens the title menu.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import * as store from '../util/store.js';
import { Grid } from '../ui/grid.js';
import { KINDS } from '../ui/tile.js';
import { Picker } from '../ui/picker.js';
import { libraryItem, openTitleMenu } from '../ui/tilemenu.js';
import { useAmbience } from '../ui/backdrop.js';
import { session, isJellyfin } from '../session.js';
import { enabled as kidsOn, filterItems, listingFilter } from '../util/kids.js';
import { openItem, playItem } from '../nav.js';
import { error } from '../util/log.js';
import { metaLine } from '../util/format.js';
import { lettersIfCurrent } from '../util/shape.js';
import { notice } from '../ui/notice.js';
import { plexLetterParams, jellyfinListingParams, hasActiveFilters, filterButtonLabel, filterBits } from '../plex/filters.js';

const PAGE = 140;
// Same geometry as the Grid below (.grid left 80 + .grid-track left/top 16/12).
const GRID_TOP = 200;
const GRID_H = 880;
const GRID_COLS = 7;
const GRID_GAP_X = 41;
const GRID_GAP_Y = 28;
const GRID_CAP = 70;
const SORTS = [
  { id: 'titleSort', label: 'A–Z' },
  { id: 'addedAt:desc', label: 'Recently added' },
  { id: 'originallyAvailableAt:desc', label: 'Release date' },
  { id: 'audienceRating:desc', label: 'Rating' },
];

// Sort and filter per library and profile, newest last, capped.
const MAX_VIEWS = 100;

function viewKey(section) {
  return ((session.user && session.user.uuid) || '') + ':' + (session.server ? session.server.name : '') + ':' + section.key;
}

function savedView(section) {
  return (store.get('libView', {}) || {})[viewKey(section)] || {};
}

const FILTER_KEYS = ['genre', 'genreTitle', 'year', 'yearTitle', 'decade', 'decadeTitle', 'resolution', 'resolutionTitle', 'contentRating', 'contentRatingTitle'];

function saveView(section, view) {
  const all = store.get('libView', {}) || {};
  const key = viewKey(section);
  delete all[key];
  if (view.sort !== SORTS[0].id || view.unwatched || hasActiveFilters(view)) {
    const stored = { sort: view.sort, unwatched: !!view.unwatched };
    FILTER_KEYS.forEach(k => { if (view[k]) stored[k] = view[k]; });
    all[key] = stored;
  }
  const keys = Object.keys(all);
  keys.slice(0, Math.max(0, keys.length - MAX_VIEWS)).forEach(k => delete all[k]);
  store.set('libView', keys.length ? all : undefined);
}

export function LibraryScreen(section) {
  const el = h('div', 'screen library');
  const ambience = useAmbience();
  const head = h('header', 'lib-head', el);
  h('h1', 'lib-title', head).textContent = section.title;
  const count = h('div', 'lib-count', head);
  const sortEl = h('div', 'lib-sort', head);
  const filterEl = h('div', 'lib-sort lib-filter', head);
  const moreEl = h('div', 'lib-sort lib-more', head);
  const picker = new Picker(el);
  if (kidsOn()) {
    const badge = h('div', 'kids-badge', head);
    badge.textContent = 'Kids';
  }
  const focusInfo = h('div', 'lib-focus', el);
  const hint = h('div', 'lib-hint', el);
  hint.textContent = '▲ Sort & filter   ·   CH ▲▼ Jump';

  const saved = savedView(section);
  let sortIndex = Math.max(0, SORTS.findIndex(s => s.id === saved.sort));
  let unwatched = !!saved.unwatched;
  const filters = {};
  FILTER_KEYS.forEach(k => { if (saved[k]) filters[k] = saved[k]; });
  let onSort = false;        // focus on the Sort / Show / Filter buttons instead of the grid
  let headIndex = 0;         // 0 = Sort, 1 = Show, 2 = Filter
  let filterLists = null;
  let pages = new Map();     // page -> 'loading' | true
  let items = [];
  let letters = [];          // [{ title: 'A', start: 0 }]
  let generation = 0;

  const type = section.type === 'show' ? 2 : 1;

  // The Grid calls back while it's being built (before `grid` is assigned);
  // those early calls are skipped, and reload() below loads the first page.
  let grid = null;
  grid = new Grid({
    cols: GRID_COLS, gapX: GRID_GAP_X, gapY: GRID_GAP_Y, captionH: GRID_CAP,
    top: GRID_TOP, height: GRID_H, total: 0,
    getItem: i => items[i],
    onFocus: (item, index) => {
      if (!grid) return;
      if (!item) { setText(focusInfo, ''); return; }
      setText(focusInfo, item.title + '   ' + metaLine(item));
      ambience.set(item.UltraBlurColors);
    },
    onSelect: item => openItem(item),
    onNeed: (start, end) => {
      if (!grid) return;
      for (let p = Math.floor(start / PAGE); p <= Math.floor(end / PAGE); p++) loadPage(p);
    },
  });
  el.appendChild(grid.el);

  // Static poster boxes in the grid's slots until the first page arrives.
  // Painted under the grid so the focus ring still sits on the first cell.
  let placeholders = null;
  function showPlaceholders() {
    if (placeholders) return;
    const size = KINDS.grid;
    const stepX = size.w + GRID_GAP_X;
    const stepY = size.h + GRID_CAP + GRID_GAP_Y;
    const rows = Math.ceil((GRID_H - 12) / stepY);
    const ph = h('div', 'lib-ph');
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const box = h('div', 'lib-ph-tile', ph);
        box.style.width = size.w + 'px';
        box.style.height = size.h + 'px';
        setTransform(box, 'translate(' + (c * stepX) + 'px,' + (r * stepY) + 'px)');
      }
    }
    el.insertBefore(ph, grid.el);
    placeholders = ph;
  }
  function hidePlaceholders() {
    if (!placeholders) return;
    placeholders.remove();
    placeholders = null;
  }

  // What's going on while the first page isn't there yet.
  let failures = 0;
  let retryTimer = 0;
  function status(text) {
    setText(focusInfo, text);
  }

  async function loadPage(p) {
    if (pages.has(p)) return;
    if (grid.total && p * PAGE >= grid.total) return;
    pages.set(p, 'loading');
    const gen = generation;
    if (p === 0 && !items.length) showPlaceholders();
    try {
      const res = await session.server.items(section.key, p * PAGE, PAGE, { sort: SORTS[sortIndex].id, type, unwatched, filters });
      if (gen !== generation) return;
      let page = res.items;
      let total = res.total;
      if (kidsOn()) {
        page.forEach(it => { if (!it.librarySectionID) it.librarySectionID = section.key; });
        const kept = filterItems(page, section.key);
        const dropped = page.length - kept.length;
        page = kept;
        // shortcut: dropped titles shrink this page, a short gap before the next page if the server ignores the rating filter.
        if (dropped) total = Math.max(kept.length, total - dropped);
      }
      page.forEach((it, i) => { items[p * PAGE + i] = it; });
      pages.set(p, true);
      failures = 0;
      if (p === 0) hidePlaceholders();
      if (p === 0 && !page.length) {
        status(hasActiveFilters(filters) ? 'Nothing matches these filters'
          : unwatched ? 'Nothing unwatched in ' + section.title : section.title + ' is empty');
      }
      if (grid.total !== total) {
        grid.setTotal(total);
        const bits = filterBits(filters);
        setText(count, total + (unwatched ? ' unwatched' : '') + (section.type === 'show' ? ' show' : ' movie') + (total === 1 ? '' : 's') + (bits.length ? ' · ' + bits.join(' · ') : ''));
      } else {
        grid.refresh();
      }
      if (p === 0 && page[0]) grid.onFocus(grid.current());
    } catch (e) {
      pages.delete(p);
      error('library page failed', section.title, p, e);
      if (gen !== generation) return;
      // Try again by itself a few times (the server may be busy scanning).
      failures++;
      const why = /abort/i.test(e.name + e.message) ? 'the server took too long' : e.message;
      clearTimeout(retryTimer);
      if (failures <= 3) {
        if (p === 0 && !items.length) {
          hidePlaceholders();
          status('Couldn\'t load ' + section.title + ' (' + why + '). Trying again…');
        }
        retryTimer = setTimeout(() => { if (gen === generation) loadPage(p); }, 2000 * failures);
      } else if (p === 0 && !items.length) {
        hidePlaceholders();
        status('Couldn\'t load ' + section.title + ' (' + why + '). Press OK to try again.');
      }
    }
  }

  async function loadLetters() {
    const gen = generation;
    // Drop the previous index immediately. A reply for the old sort can still
    // be in flight, and applying it would jump by the wrong titles.
    letters = [];
    if (SORTS[sortIndex].id !== 'titleSort') return;
    try {
      const kind = isJellyfin() ? 'jellyfin' : 'plex';
      const kids = listingFilter(kind, section.key);
      const params = kind === 'jellyfin'
        ? Object.assign({ type }, jellyfinListingParams({ filters, unwatched, kids }))
        : plexLetterParams({ type, unwatched, filters, kids });
      const mc = await session.server.get('/library/sections/' + section.key + '/firstCharacter', params);
      const next = lettersIfCurrent(gen, generation, mc && mc.Directory);
      if (next) letters = next;
    } catch (e) { /* letter jump just won't work */ }
  }

  function reload() {
    generation++;
    failures = 0;
    clearTimeout(retryTimer);
    pages = new Map();
    items = [];
    setText(sortEl, 'Sort: ' + SORTS[sortIndex].label);
    setText(filterEl, 'Show: ' + (unwatched ? 'Unwatched' : 'All'));
    setText(moreEl, filterButtonLabel(filters));
    setText(count, '');
    grid.total = 0;
    grid.index = 0;
    grid.refresh();
    loadPage(0);
    loadLetters();
  }
  reload();

  function currentView() {
    return Object.assign({ sort: SORTS[sortIndex].id, unwatched }, filters);
  }

  function setSortFocus(on) {
    onSort = on;
    toggleClass(sortEl, 'focus', on && headIndex === 0);
    toggleClass(filterEl, 'focus', on && headIndex === 1);
    toggleClass(moreEl, 'focus', on && headIndex === 2);
    toggleClass(grid.ring, 'on', !on);
  }

  function cycleSort(dir) {
    sortIndex = (sortIndex + dir + SORTS.length) % SORTS.length;
    saveView(section, currentView());
    reload();
  }

  function toggleUnwatched() {
    unwatched = !unwatched;
    saveView(section, currentView());
    reload();
  }

  function rememberFilters() {
    saveView(section, currentView());
    reload();
  }

  function clearOne(field) {
    filters[field] = undefined;
    filters[field + 'Title'] = undefined;
    if (field === 'year' || field === 'decade') {
      filters.year = undefined; filters.yearTitle = undefined;
      filters.decade = undefined; filters.decadeTitle = undefined;
    }
  }

  function chooseFilterValue(field, opt) {
    clearOne(field);
    if (opt && opt.key) {
      const slot = opt.field || field;
      filters[slot] = opt.key;
      filters[slot + 'Title'] = opt.title || opt.key;
    }
    rememberFilters();
  }

  function openValuePicker(field, title, values) {
    const opts = [{ label: 'Any', value: null }].concat(values.map(v => ({
      label: v.title, value: v, on: filters[v.field || field] === v.key,
    })));
    picker.open(title, opts, opt => chooseFilterValue(field, opt));
  }

  function yearValues(lists) {
    const decades = (lists.decade || []).map(d => Object.assign({ field: 'decade' }, d));
    const years = (lists.year || []).map(d => Object.assign({ field: 'year' }, d));
    return decades.concat(years);
  }

  async function openFilters() {
    const gen = generation;
    if (!filterLists) {
      setText(focusInfo, 'Loading filters…');
      try {
        filterLists = await session.server.sectionFilters(section.key);
      } catch (e) {
        error('library filters failed', e);
        if (gen === generation) setText(focusInfo, 'Couldn\'t load filters');
        return;
      }
      if (gen !== generation) return;
    }
    const lists = filterLists || {};
    const mark = title => title ? ' · ' + title : '';
    const opts = [];
    if (lists.genre && lists.genre.length) opts.push({ label: 'Genre' + mark(filters.genreTitle), value: 'genre' });
    if ((lists.year && lists.year.length) || (lists.decade && lists.decade.length)) {
      opts.push({ label: 'Year' + mark(filters.yearTitle || filters.decadeTitle), value: 'year' });
    }
    if (lists.resolution && lists.resolution.length) opts.push({ label: 'Resolution' + mark(filters.resolutionTitle), value: 'resolution' });
    if (!isJellyfin() && lists.contentRating && lists.contentRating.length) {
      opts.push({ label: 'Content rating' + mark(filters.contentRatingTitle), value: 'contentRating' });
    }
    if (hasActiveFilters(filters)) opts.push({ label: 'Clear filters', value: 'clear' });
    if (!opts.length) { setText(focusInfo, 'This library has no filters'); return; }
    picker.open('Filter', opts, value => {
      if (value === 'clear') {
        FILTER_KEYS.forEach(k => { filters[k] = undefined; });
        rememberFilters();
        return;
      }
      if (value === 'year') openValuePicker('year', 'Year', yearValues(lists));
      else if (value === 'genre') openValuePicker('genre', 'Genre', lists.genre);
      else if (value === 'resolution') openValuePicker('resolution', 'Resolution', lists.resolution);
      else if (value === 'contentRating') openValuePicker('contentRating', 'Content rating', lists.contentRating);
    });
  }

  function openGridMenu() {
    const it = grid.current();
    if (!libraryItem(it)) return;
    openTitleMenu(picker, it, { continueRow: !!it.viewOffset, kids: kidsOn() }, {
      open: openItem,
      play: playItem,
      server: session.server,
      notice,
      refresh: () => grid.refresh(),
      onError: e => error('tile action failed', e),
    });
  }

  function jump(dir) {
    if (letters.length) {
      const i = grid.index;
      let li = letters.findIndex((l, k) => i >= l.start && (k === letters.length - 1 || i < letters[k + 1].start));
      li = Math.max(0, Math.min(letters.length - 1, li + dir));
      grid.focusIndex(letters[li].start);
      setText(focusInfo, letters[li].title);
    } else {
      grid.focusIndex(grid.index + dir * grid.cols * 3);
    }
  }

  return {
    el,
    name: 'library',
    onShow() { ambience.restore(); },
    destroy() { generation++; clearTimeout(retryTimer); },
    wantsHold() {
      return !onSort && !picker.isOpen && libraryItem(grid.current());
    },
    onKey(action) {
      if (picker.isOpen) return picker.onKey(action);
      if (action === 'hold') { openGridMenu(); return true; }
      if (onSort) {
        switch (action) {
          case 'enter':
            if (headIndex === 0) cycleSort(1);
            else if (headIndex === 1) toggleUnwatched();
            else openFilters();
            return true;
          case 'left': headIndex = Math.max(0, headIndex - 1); setSortFocus(true); return true;
          case 'right': headIndex = Math.min(2, headIndex + 1); setSortFocus(true); return true;
          case 'yellow': cycleSort(1); return true;
          case 'down': case 'back': setSortFocus(false); return true;
          case 'up': return true;
        }
        return false;
      }
      switch (action) {
        case 'left': grid.move(-1, 0); return true;
        case 'right': grid.move(1, 0); return true;
        case 'up':
          if (grid.index < grid.cols) setSortFocus(true);
          else grid.move(0, -1);
          return true;
        case 'down': grid.move(0, 1); return true;
        case 'pageup': jump(-1); return true;
        case 'pagedown': jump(1); return true;
        case 'enter':
          if (!items.length) { reload(); return true; } // nothing loaded: try again
          grid.select(); return true;
        case 'play': case 'playpause': if (grid.current()) playItem(grid.current()); return true;
        case 'yellow': cycleSort(1); return true;
        case 'back':
          if (grid.index > grid.cols * 2) { grid.focusIndex(0); return true; }
          return false;
      }
      return false;
    },
  };
}
