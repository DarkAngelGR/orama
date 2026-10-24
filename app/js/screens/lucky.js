// Lucky Draw: a poster reel spins and lands on an unwatched title picked to
// fit the user's taste (plex/taste.js). Yellow or "Draw again" spins again.
// With watchlist-sync reachable (plex/watchlist.js), some draws are movies you
// don't have yet, which can be sent to Radarr from here.
//
// The reel is one strip moved with a CSS transform transition (no layout or
// repaint while it spins); posters load through the shared image queue.
import { h, setText, toggleClass } from '../util/dom.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { load } from '../ui/images.js';
import { session } from '../session.js';
import { metaLine, clock } from '../util/format.js';
import * as icons from '../ui/icons.js';
import * as store from '../util/store.js';
import { openItem, playItem } from '../nav.js';
import { loadPool, buildProfile, draw, reasons } from '../plex/taste.js';
import * as watchlist from '../plex/watchlist.js';
import { log, warn, error } from '../util/log.js';

const POSTER_W = 216;
const POSTER_H = 324;
const STEP = 244;          // poster + gap
const REEL_LEN = 16;
const WIN_AT = 12;         // the pick's slot in the strip
const START_AT = 2;        // slot centred before the spin
const SPIN_MS = 1700;
const RECENT_MAX = 15;     // don't redraw the last few picks
const NEW_SHARE = 0.3;     // share of Anything/Movies draws that are movies you don't have
const KINDS = [
  { id: 'any', label: 'Anything' },
  { id: 'movie', label: 'Movies' },
  { id: 'show', label: 'Shows' },
  { id: 'new', label: 'New to you', external: true },
];

// translateX that centres slot i of the strip on the 1920 px screen.
const centre = i => 960 - (i * STEP + POSTER_W / 2);

function shuffle(a, random = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function LuckyScreen() {
  const el = h('div', 'screen lucky');
  const ambience = useAmbience();
  const art = new HeroArt(el, 'hero-art lucky-art');

  const head = h('header', 'lucky-head', el);
  const titles = h('div', '', head);
  h('h1', 'lucky-title', titles).textContent = 'Lucky Draw';
  const subEl = h('div', 'lucky-sub', titles);
  subEl.textContent = 'Picked for you from what you watch';
  const kindsEl = h('div', 'lucky-kinds', head);
  const hint = h('div', 'lucky-hint', el);
  hint.innerHTML = '<i class="key-yellow"></i> Draw again';
  const statusEl = h('div', 'lucky-status', el);

  const reelClip = h('div', 'lucky-reel', el);
  const strip = h('div', 'lucky-strip', reelClip);
  const slots = [];
  for (let i = 0; i < REEL_LEN; i++) {
    const slot = h('div', 'lucky-slot', strip);
    slot.style.left = i * STEP + 'px';
    const frame = h('div', 'tile-frame', slot);
    frame.style.width = POSTER_W + 'px';
    frame.style.height = POSTER_H + 'px';
    const img = h('img', 'tile-img', frame);
    const ph = h('div', 'tile-ph', frame);
    slots.push({ slot, img, ph });
  }

  const info = h('div', 'lucky-info', el);
  const nameEl = h('h2', 'lucky-name', info);
  const metaEl = h('div', 'lucky-meta', info);
  const whyEl = h('div', 'lucky-why', info);
  const summaryEl = h('p', 'lucky-summary', info);
  const noteEl = h('div', 'lucky-note', info);
  const buttonsEl = h('div', 'lucky-buttons', info);

  let pool = null;            // { watched, candidates, external }
  let profile = null;
  let pick = null;
  let request = null;         // for an external pick: null | 'busy' | 'done'
  let kindId = store.get('luckyKind', 'any');
  let zone = 'buttons';
  let buttons = [];
  let buttonIndex = 0;
  let spinning = false;
  let loadFailed = false;
  let spinTimer = 0;
  let alive = true;
  let drawId = 0;

  const external = () => (pool && pool.external) || [];
  const kinds = () => KINDS.filter(k => !k.external || external().length);
  const kind = () => kinds().find(k => k.id === kindId) || KINDS[0];

  function renderKinds() {
    kindsEl.innerHTML = '';
    kinds().forEach(k => {
      const p = h('div', 'pill', kindsEl);
      p.textContent = k.label;
      toggleClass(p, 'current', k === kind());
      toggleClass(p, 'focus', zone === 'kinds' && k === kind());
    });
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
    if (loadFailed) {
      add(icons.restart, 'Try again', start);
      renderFocus();
      return;
    }
    if (!pool) { renderFocus(); return; } // still loading
    if (pick) {
      const it = pick.item;
      if (it.external) {
        if (request === 'busy') add(icons.download, 'Adding…', () => {});
        else if (request === 'done') add(icons.check, 'Requested', () => {});
        else add(icons.download, 'Download it', download);
      } else {
        if (it.viewOffset) add(icons.play, 'Resume ' + clock(it.viewOffset), () => playItem(it, { offset: it.viewOffset }));
        else add(icons.play, it.type === 'show' ? 'Play first episode' : 'Play', () => playItem(it, { offset: 0 }));
        add(icons.info, 'Details', () => openItem(it));
      }
    }
    add(icons.dice, pick ? 'Draw again' : 'Draw', spin);
    buttonIndex = Math.min(buttonIndex, buttons.length - 1);
    renderFocus();
  }

  function renderFocus() {
    buttons.forEach((b, i) => toggleClass(b.el, 'focus', zone === 'buttons' && i === buttonIndex && !spinning));
    renderKinds();
  }

  function message(text) {
    setText(nameEl, '');
    setText(metaEl, '');
    whyEl.innerHTML = '';
    setText(noteEl, '');
    setText(summaryEl, text);
  }

  function remember(key) {
    const recent = store.get('luckyRecent', []).filter(k => k !== key);
    recent.unshift(key);
    store.set('luckyRecent', recent.slice(0, RECENT_MAX));
  }

  function poster(item) {
    if (!item) return '';
    if (item.external) return item.thumbUrl || '';
    return item.thumb ? session.server.image(item.thumb, POSTER_W, POSTER_H) : '';
  }

  // Your library, and now and then (or always, for "New to you") a movie
  // you don't have.
  function nextPick() {
    const avoid = store.get('luckyRecent', []);
    const k = kind().id;
    const ext = external();
    if (k === 'new') return draw(ext, profile, { avoid });
    const fresh = ext.some(x => avoid.indexOf(x.ratingKey) < 0);
    if (k !== 'show' && fresh && Math.random() < NEW_SHARE) {
      const p = draw(ext, profile, { avoid });
      if (p) return p;
    }
    return draw(pool.candidates, profile, { kind: k, avoid });
  }

  // Fill the strip: decoys around the pick, which sits in slot WIN_AT.
  function fillReel(chosen) {
    const k = kind().id;
    const source = k === 'new' ? external()
      : pool.candidates.concat(k === 'show' ? [] : external()).filter(c => k === 'any' || c.type === k);
    const decoys = shuffle(source.filter(c => c !== chosen)).slice(0, REEL_LEN - 1);
    // Exactly one poster per slot, the pick in WIN_AT; small libraries repeat
    // decoys (or the pick itself, if it's the only title).
    const items = slots.map((_, i) => (i === WIN_AT ? chosen
      : decoys.length ? decoys[(i < WIN_AT ? i : i - 1) % decoys.length] : chosen));
    slots.forEach((s, i) => {
      const it = items[i];
      setText(s.ph, it ? it.title : '');
      load(s.img, poster(it));
      toggleClass(s.slot, 'win', false);
      toggleClass(s.slot, 'dim', false);
    });
  }

  function spin() {
    if (spinning || !pool) return;
    const next = nextPick();
    if (!next) {
      pick = null;
      const k = kind();
      message(k.id === 'any' ? 'You\'ve watched everything. Impressive.'
        : k.id === 'new' ? 'No new suggestions right now.'
        : 'Nothing unwatched in ' + k.label.toLowerCase() + '.');
      renderButtons();
      return;
    }
    pick = next;
    request = null;
    remember(pick.item.ratingKey);
    log('lucky pick', pick.item.title, pick.value.toFixed(2), pick.item.external ? '(not in library)' : '', pick.wildcard ? '(wildcard)' : '');
    spinning = true;
    toggleClass(el, 'spinning', true);
    message('');
    fillReel(pick.item);
    // Jump back to the start without animating, then spin to the pick.
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(' + centre(START_AT) + 'px)';
    void strip.offsetWidth; // commit the start position before animating
    strip.style.transition = 'transform ' + SPIN_MS + 'ms cubic-bezier(0.12, 0.8, 0.18, 1)';
    strip.style.transform = 'translateX(' + centre(WIN_AT) + 'px)';
    clearTimeout(spinTimer);
    spinTimer = setTimeout(land, SPIN_MS + 60);
    renderFocus();
  }

  function land() {
    if (!alive || !spinning) return;
    spinning = false;
    toggleClass(el, 'spinning', false);
    slots.forEach((s, i) => {
      toggleClass(s.slot, 'win', i === WIN_AT);
      toggleClass(s.slot, 'dim', i !== WIN_AT);
    });
    showPick(pick);
    zone = 'buttons';
    buttonIndex = 0;
    renderButtons();
  }

  function showPick(p) {
    const it = p.item;
    setText(nameEl, it.title);
    setText(metaEl, metaLine(it));
    whyEl.innerHTML = '';
    const chips = reasons(p, profile);
    if (it.external) {
      h('span', 'lucky-chip lucky-chip-new', whyEl).textContent = 'Not in your library';
      chips.splice(2);
    }
    chips.forEach(r => { h('span', 'lucky-chip', whyEl).textContent = r; });
    setText(noteEl, it.external ? 'Want it? Download it and it\'ll show up in Plex when it\'s ready.' : '');
    ambience.set(it.UltraBlurColors);
    if (it.external) {
      setText(summaryEl, it.summary || '');
      art.set(it.artUrl || '');
      return;
    }
    setText(summaryEl, '');
    art.set(it.art ? session.server.image(it.art, 1920, 1080) : '');
    // The pool skips summaries to stay light; fetch the pick's full details.
    const id = ++drawId;
    session.server.metadata(it.ratingKey).then(full => {
      if (!alive || id !== drawId || !full) return;
      setText(summaryEl, full.summary || '');
      setText(metaEl, metaLine(full)); // full details name the scores (IMDb, RT, TMDB)
      if (full.UltraBlurColors) ambience.set(full.UltraBlurColors);
    }).catch(e => error('lucky details failed', e));
  }

  async function download() {
    if (!pick || !pick.item.external || request) return;
    const it = pick.item;
    request = 'busy';
    setText(noteEl, 'Sending to Radarr…');
    renderButtons();
    try {
      const res = await watchlist.requestMovie(it.tmdbId, it.title);
      if (!alive || pick.item !== it) return;
      request = 'done';
      pool.external = external().filter(x => x !== it);
      setText(noteEl, {
        added: 'Added. Radarr is searching for it; it\'ll show up in Plex when it\'s downloaded.',
        'already-present': 'It\'s already in Radarr, so it may still be downloading.',
        'already-requested': 'Already requested.',
        'dry-run': 'watchlist-sync is in dry run, so nothing was added.',
      }[res.status] || 'Requested.');
      log('lucky request', it.title, res.status);
    } catch (e) {
      if (!alive || pick.item !== it) return;
      request = null;
      setText(noteEl, e.message || 'Couldn\'t add it.');
      warn('lucky request failed', it.title, e.message);
    }
    renderButtons();
  }

  // Movies you don't have, from watchlist-sync. When it's set up but gives
  // none, say why at the bottom of the screen instead of failing silently.
  async function loadExternal() {
    if (!watchlist.baseUrl()) return [];
    try {
      const res = await watchlist.suggestions();
      if (!res.items.length) setText(statusEl, 'New movies: Radarr had no suggestions');
      return res.items;
    } catch (e) {
      warn('watchlist-sync suggestions unavailable:', e.message);
      // Automatic mode with nothing listening is the normal "not installed" case.
      if (!(watchlist.mode() === 'auto' && e.status === 0 && /reach watchlist-sync/.test(e.message))) {
        setText(statusEl, 'New movies unavailable: ' + e.message);
      }
      return [];
    }
  }

  async function start() {
    loadFailed = false;
    pool = null;
    message('Shuffling your library…');
    renderButtons();
    // Suggestions can take a while (Radarr builds its Discover list on
    // demand), so the first spin uses the library and they join when ready.
    const extLoad = loadExternal();
    try {
      const loaded = await loadPool(session.server);
      if (!alive) return;
      pool = Object.assign(loaded, { external: [] });
      profile = buildProfile(pool.watched);
      log('lucky pool', pool.watched.length, 'watched,', pool.candidates.length, 'unwatched');
      spin();
      const ext = await extLoad;
      if (!alive || !pool || !ext.length) return;
      pool.external = ext;
      subEl.textContent = 'Picked for you from what you watch, including movies you don\'t have';
      log('lucky: ' + ext.length + ' movies not in library');
      renderKinds();
    } catch (e) {
      error('lucky load failed', e);
      loadFailed = true;
      message('Couldn\'t load your library.');
      renderButtons();
    }
  }

  strip.style.transform = 'translateX(' + centre(START_AT) + 'px)';
  renderKinds();
  start();

  return {
    el,
    name: 'lucky',
    onShow() { if (pick) ambience.set(pick.item.UltraBlurColors); else ambience.restore(); },
    onKey(action) {
      if (action === 'yellow') { spin(); return true; }
      if (spinning) return action !== 'back';
      if (action === 'play' || action === 'playpause') {
        if (pick && !pick.item.external) playItem(pick.item, { offset: pick.item.viewOffset || 0 });
        return true;
      }
      if (action === 'up') { zone = 'kinds'; renderFocus(); return true; }
      if (action === 'down') { zone = 'buttons'; renderFocus(); return true; }
      if (zone === 'kinds') {
        if (action === 'left' || action === 'right') {
          const list = kinds();
          const i = list.indexOf(kind());
          kindId = list[(i + (action === 'right' ? 1 : list.length - 1)) % list.length].id;
          store.set('luckyKind', kindId);
          renderKinds();
          return true;
        }
        if (action === 'enter') { zone = 'buttons'; spin(); return true; }
      } else {
        if (action === 'left') { buttonIndex = Math.max(0, buttonIndex - 1); renderFocus(); return true; }
        if (action === 'right') { buttonIndex = Math.min(buttons.length - 1, buttonIndex + 1); renderFocus(); return true; }
        if (action === 'enter' && buttons[buttonIndex]) { buttons[buttonIndex].run(); return true; }
      }
      if (action === 'back' && zone === 'kinds') { zone = 'buttons'; renderFocus(); return true; }
      return false;
    },
    destroy() { alive = false; clearTimeout(spinTimer); },
  };
}
