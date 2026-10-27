// "More info": everything Plex knows about a title, on one page. Works for
// library items (with file details) and catalog items (not on your server).
// Up/Down scroll the page; Back closes it.
import { h, setText, setTransform } from '../util/dom.js';
import { HeroArt } from '../ui/backdrop.js';
import { session } from '../session.js';
import { metaLine, duration, episodeLabel } from '../util/format.js';
import { scores } from '../util/ratings.js';
import * as router from '../router.js';
import { versionRows } from '../player/options.js';

const VIEW_H = 780;  // visible height of the scrolling area
const STEP = 320;    // px per Up/Down press
const CAST_MAX = 24;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// "2024-02-27" -> "27 February 2024"
export function longDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return '';
  return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}

const tags = list => (list || []).map(t => t.tag).filter(Boolean);

function size(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1073741824;
  return gb >= 1 ? gb.toFixed(1) + ' GB' : Math.round(bytes / 1048576) + ' MB';
}

function resolution(r) {
  if (!r) return '';
  if (/^4k$/i.test(r)) return '4K';
  if (/^\d+$/.test(r)) return r + 'p';
  return r.toUpperCase();
}

// One line per version on the server, e.g.
// "4K HEVC Dolby Vision  ·  MKV  ·  28.4 GB  ·  42 Mbps".
// With several versions, numbered and named as in the Version picker:
// "2. Final Cut · 4K Dolby Vision  ·  HEVC · TrueHD Atmos 7.1 · 58 GB".
function fileLines(item) {
  if ((item.Media || []).length > 1) {
    return versionRows(item.Media).map((r, i) => (i + 1) + '. ' + r.label + '  ·  ' + r.detail);
  }
  return (item.Media || []).map(m => {
    const part = (m.Part || [])[0] || {};
    const video = (part.Stream || []).find(s => s.streamType === 1);
    const parts = [video && video.displayTitle ? video.displayTitle
      : [resolution(m.videoResolution), (m.videoCodec || '').toUpperCase()].filter(Boolean).join(' ')];
    if (m.container) parts.push(m.container.toUpperCase());
    if (part.size) parts.push(size(part.size));
    if (m.bitrate) parts.push((m.bitrate / 1000).toFixed(m.bitrate >= 10000 ? 0 : 1) + ' Mbps');
    return parts.filter(Boolean).join('  ·  ');
  }).filter(Boolean);
}

// Distinct track names of one kind (2 = audio, 3 = subtitles) across versions.
function trackList(item, type) {
  const seen = new Set();
  (item.Media || []).forEach(m => ((m.Part || [])[0] || {}).Stream && m.Part[0].Stream
    .filter(s => s.streamType === type)
    .forEach(s => seen.add(type === 3 ? (s.language || s.displayTitle || 'Unknown') : (s.displayTitle || s.language || 'Unknown'))));
  return Array.from(seen);
}

// [label, value] pairs for the right-hand column; empty values are dropped.
export function facts(item) {
  const out = [];
  const add = (label, value) => { if (value) out.push([label, value]); };
  if (item.type === 'episode') {
    add('Show', item.grandparentTitle);
    add('Episode', episodeLabel(item) + (item.title ? '  ' + item.title : ''));
    add('Aired', longDate(item.originallyAvailableAt));
  } else if (item.type === 'show') {
    add('First aired', longDate(item.originallyAvailableAt) || item.year);
    add('Seasons', item.childCount);
    add('Episodes', item.leafCount);
  } else {
    add('Released', longDate(item.originallyAvailableAt) || item.year);
  }
  if (item.type !== 'show') add('Runtime', duration(item.duration));
  add('Rated', item.contentRating);
  add('Ratings', scores(item).map(s => s.label).join('\n'));
  add('Genres', tags(item.Genre).join(', '));
  add(tags(item.Director).length > 1 ? 'Directors' : 'Director', tags(item.Director).join(', '));
  add('Written by', tags(item.Writer).slice(0, 4).join(', '));
  add('Produced by', tags(item.Producer).slice(0, 4).join(', '));
  add(item.type === 'show' ? 'Network' : 'Studio', item.studio);
  add('Country', tags(item.Country).join(', '));
  if (item.originalTitle && item.originalTitle !== item.title) add('Original title', item.originalTitle);
  const files = fileLines(item);
  add(files.length > 1 ? 'Versions' : 'File', files.join('\n'));
  add('Audio', trackList(item, 2).slice(0, 6).join('\n'));
  add('Subtitles', trackList(item, 3).slice(0, 10).join(', '));
  return out;
}

export function InfoScreen(item) {
  const el = h('div', 'screen info');
  const art = new HeroArt(el, 'hero-art info-art');
  const head = h('div', 'info-head', el);
  const title = h('h1', 'info-title', head);
  const meta = h('div', 'info-meta', head);
  const view = h('div', 'info-view', el);
  const track = h('div', 'info-track', view);
  const left = h('div', 'info-left', track);
  const right = h('div', 'info-right', track);
  const hint = h('div', 'info-hint', el);

  let offset = 0;
  let maxOffset = -1; // measured on first scroll, once the page is laid out

  const isEpisode = item.type === 'episode';
  setText(title, isEpisode ? item.grandparentTitle || item.title : item.title);
  setText(meta, metaLine(item));
  const artPath = isEpisode ? (item.grandparentArt || item.art) : item.art;
  if (artPath && session.server) art.set(session.server.image(artPath, 1920, 1080));

  if (item.tagline) h('div', 'info-tagline', left).textContent = item.tagline;
  if (isEpisode && item.title) h('div', 'info-tagline', left).textContent = episodeLabel(item) + '   ' + item.title;
  h('p', 'info-summary', left).textContent = item.summary || 'No description available.';

  const cast = (item.Role || []).slice(0, CAST_MAX);
  if (cast.length) {
    h('div', 'info-label info-section', left).textContent = 'Cast';
    const grid = h('div', 'info-cast', left);
    cast.forEach(r => {
      const c = h('div', 'info-person', grid);
      h('div', 'info-name', c).textContent = r.tag;
      if (r.role) h('div', 'info-role', c).textContent = r.role;
    });
  }

  facts(item).forEach(([label, value]) => {
    const f = h('div', 'info-fact', right);
    h('div', 'info-label', f).textContent = label;
    h('div', 'info-value', f).textContent = String(value);
  });

  function measure() {
    if (maxOffset < 0) maxOffset = Math.max(0, track.offsetHeight - VIEW_H);
    return maxOffset;
  }

  function scroll(dir) {
    const max = measure();
    const next = Math.max(0, Math.min(max, offset + dir * STEP));
    if (next === offset) return;
    offset = next;
    setTransform(track, 'translate3d(0,' + -offset + 'px,0)');
    renderHint();
  }

  function renderHint() {
    const max = measure();
    setText(hint, max === 0 ? '' : offset >= max ? '▲  Scroll up' : offset === 0 ? '▼  More below' : '▲ ▼  Scroll');
  }

  return {
    el,
    name: 'info',
    onShow() { renderHint(); },
    onKey(action) {
      if (action === 'down' || action === 'right') { scroll(1); return true; }
      if (action === 'up' || action === 'left') { scroll(-1); return true; }
      if (action === 'enter' || action === 'info') { router.back(); return true; }
      return false;
    },
  };
}
