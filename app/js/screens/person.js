// An actor: their photo and everything on your server they appear in, one row
// per library. Opened from a title's Cast row.
import { h, setText, setTransform } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import { Row } from '../ui/row.js';
import { session } from '../session.js';
import { openItem, playItem } from '../nav.js';
import { error } from '../util/log.js';

const ROWS_TOP = 330;

export function PersonScreen(person) {
  const el = h('div', 'screen person');
  const ambience = useAmbience();
  const head = h('div', 'person-head', el);
  const photo = h('div', 'person-photo', head);
  const img = h('img', '', photo);
  const initials = h('span', '', photo);
  const text = h('div', 'person-text', head);
  h('h1', 'person-name', text).textContent = person.title;
  const sub = h('div', 'person-sub', text);
  const clip = h('div', 'person-rows', el);
  clip.style.top = ROWS_TOP + 'px';
  const track = h('div', 'rows-track', clip);

  let rows = [];
  let rowIndex = 0;
  let alive = true;

  setText(initials, String(person.title || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase());
  if (person.thumb && session.server) {
    img.onload = () => { img.style.opacity = 1; initials.style.display = 'none'; };
    img.src = session.server.image(person.thumb, 240, 240);
  }
  setText(sub, 'Looking on your server…');

  function render() {
    let y = 0;
    rows.forEach((r, i) => {
      setTransform(r.el, 'translateY(' + y + 'px)');
      r.setActive(i === rowIndex);
      r.top = y;
      y += r.height;
    });
    setTransform(track, 'translateY(' + (-(rows[rowIndex] ? rows[rowIndex].top : 0)) + 'px)');
  }

  // Plex gives each role a filter like "actor=12345" that works in any library.
  function filterParams() {
    const params = {};
    String(person.filter || '').split('&').forEach(kv => {
      const [k, v] = kv.split('=');
      if (k && v) params[k] = decodeURIComponent(v);
    });
    return params;
  }

  async function load() {
    const params = filterParams();
    if (!Object.keys(params).length) { setText(sub, 'No filmography for this person'); return; }
    try {
      const sections = await session.server.sections();
      const found = await Promise.all(sections.map(s =>
        session.server.get('/library/sections/' + s.key + '/all', Object.assign({ sort: 'year:desc' }, params))
          .then(mc => ({ section: s, items: mc.Metadata || [] }))
          .catch(() => ({ section: s, items: [] }))));
      if (!alive) return;
      const withItems = found.filter(f => f.items.length);
      const total = withItems.reduce((n, f) => n + f.items.length, 0);
      setText(sub, total ? total + (total === 1 ? ' title' : ' titles') + ' on your server' : 'Nothing else on your server with ' + person.title);
      rows = withItems.map(f => {
        const row = new Row({ title: f.section.title, kind: 'poster', caption: true, items: f.items, onSelect: item => openItem(item) });
        track.appendChild(row.el);
        return row;
      });
      render();
    } catch (e) {
      error('person load failed', e);
      if (alive) setText(sub, 'Couldn\'t look this up (' + e.message + ')');
    }
  }

  load();

  return {
    el,
    name: 'person',
    onShow() { ambience.restore(); },
    onKey(action) {
      const row = rows[rowIndex];
      if (!row) return false;
      switch (action) {
        case 'left': row.move(-1); return true;
        case 'right': row.move(1); return true;
        case 'up': if (rowIndex > 0) { rowIndex--; render(); } return true;
        case 'down': if (rowIndex < rows.length - 1) { rowIndex++; render(); } return true;
        case 'enter': row.select(); return true;
        case 'play': case 'playpause': if (row.current()) playItem(row.current()); return true;
      }
      return false;
    },
    destroy() { alive = false; },
  };
}
