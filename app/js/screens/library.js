// A whole library as a virtualized poster grid, loaded page by page.
// Up from the top row reaches the sort button (OK / Left / Right change it; the
// yellow button does too, on remotes that have one). CH▲/CH▼ jump by letter
// (title sort) or by page.
import { h, setText, toggleClass } from '../util/dom.js';
import { Grid } from '../ui/grid.js';
import { useAmbience } from '../ui/backdrop.js';
import { session } from '../session.js';
import { prefetch } from '../ui/images.js';
import { isFast } from '../input.js';
import { openItem, playItem } from '../nav.js';
import { error } from '../util/log.js';
import { metaLine } from '../util/format.js';

const PAGE = 140;
const SORTS = [
  { id: 'titleSort', label: 'A–Z' },
  { id: 'addedAt:desc', label: 'Recently added' },
  { id: 'originallyAvailableAt:desc', label: 'Release date' },
  { id: 'audienceRating:desc', label: 'Rating' },
];

export function LibraryScreen(section) {
  const el = h('div', 'screen library');
  const ambience = useAmbience();
  const head = h('header', 'lib-head', el);
  h('h1', 'lib-title', head).textContent = section.title;
  const count = h('div', 'lib-count', head);
  const sortEl = h('div', 'lib-sort', head);
  const focusInfo = h('div', 'lib-focus', el);
  const hint = h('div', 'lib-hint', el);
  hint.textContent = '▲ Sort   ·   CH ▲▼ Jump';

  let sortIndex = 0;
  let onSort = false;        // focus on the sort button instead of the grid
  let pages = new Map();     // page -> 'loading' | true
  let items = [];
  let letters = [];          // [{ title: 'A', start: 0 }]
  let generation = 0;

  const type = section.type === 'show' ? 2 : 1;

  // The Grid calls back while it's being built (before `grid` is assigned);
  // those early calls are skipped, and reload() below loads the first page.
  let grid = null;
  grid = new Grid({
    top: 200, height: 880, total: 0,
    getItem: i => items[i],
    onFocus: (item, index) => {
      if (!grid) return;
      // Warm posters for the row just past the recycled pool.
      if (!isFast()) {
        const start = (Math.floor(index / grid.cols) + grid.poolRows - 1) * grid.cols;
        for (let i = start; i < start + grid.cols; i++) {
          if (items[i]) prefetch(session.server.image(items[i].thumb, 216, 324));
        }
      }
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
    if (p === 0 && !items.length) status('Loading ' + section.title + '…');
    try {
      const res = await session.server.items(section.key, p * PAGE, PAGE, { sort: SORTS[sortIndex].id, type });
      if (gen !== generation) return;
      res.items.forEach((it, i) => { items[p * PAGE + i] = it; });
      pages.set(p, true);
      failures = 0;
      if (p === 0 && !res.items.length) status(section.title + ' is empty');
      if (grid.total !== res.total) {
        grid.setTotal(res.total);
        setText(count, res.total + (section.type === 'show' ? ' shows' : ' movies'));
      } else {
        grid.refresh();
      }
      if (p === 0 && res.items[0]) grid.onFocus(grid.current());
    } catch (e) {
      pages.delete(p);
      error('library page failed', section.title, p, e);
      if (gen !== generation) return;
      // Try again by itself a few times (the server may be busy scanning).
      failures++;
      const why = /abort/i.test(e.name + e.message) ? 'the server took too long' : e.message;
      clearTimeout(retryTimer);
      if (failures <= 3) {
        if (p === 0 && !items.length) status('Couldn\'t load ' + section.title + ' (' + why + '). Trying again…');
        retryTimer = setTimeout(() => { if (gen === generation) loadPage(p); }, 2000 * failures);
      } else if (p === 0 && !items.length) {
        status('Couldn\'t load ' + section.title + ' (' + why + '). Press OK to try again.');
      }
    }
  }

  async function loadLetters() {
    letters = [];
    if (SORTS[sortIndex].id !== 'titleSort') return;
    try {
      const mc = await session.server.get('/library/sections/' + section.key + '/firstCharacter', { type });
      let start = 0;
      letters = (mc.Directory || []).map(d => {
        const l = { title: d.title, start };
        start += d.size;
        return l;
      });
    } catch (e) { /* letter jump just won't work */ }
  }

  function reload() {
    generation++;
    failures = 0;
    clearTimeout(retryTimer);
    pages = new Map();
    items = [];
    setText(sortEl, 'Sort: ' + SORTS[sortIndex].label);
    grid.total = 0;
    grid.index = 0;
    grid.refresh();
    loadPage(0);
    loadLetters();
  }
  reload();

  function setSortFocus(on) {
    onSort = on;
    toggleClass(sortEl, 'focus', on);
    toggleClass(grid.ring, 'on', !on);
  }

  function cycleSort(dir) {
    sortIndex = (sortIndex + dir + SORTS.length) % SORTS.length;
    reload();
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
    onKey(action) {
      if (onSort) {
        switch (action) {
          case 'enter': case 'right': cycleSort(1); return true;
          case 'left': cycleSort(-1); return true;
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
