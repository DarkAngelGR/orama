// Detail page for a movie, show, season (opens its show) or episode.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { Row } from '../ui/row.js';
import { Picker } from '../ui/picker.js';
import { session } from '../session.js';
import { metaLine, clock, episodeLabel } from '../util/format.js';
import { clearLogo } from './home.js';
import * as icons from '../ui/icons.js';
import * as router from '../router.js';
import { playItem } from '../nav.js';
import { error } from '../util/log.js';
import {
  streamsOf, audioLabel, subtitleLabel, qualitiesFor, effectiveQuality, defaultQuality, versionLabel,
} from '../player/options.js';

const SHIFT = 400;    // how far the body slides up to reveal seasons/episodes
const OPTIONS_H = 64; // .detail-options height + margin, added to SHIFT when shown

export function DetailScreen(initial, { autoplay = false } = {}) {
  const el = h('div', 'screen detail');
  const ambience = useAmbience(initial.UltraBlurColors);
  const art = new HeroArt(el, 'hero-art detail-art');
  const body = h('div', 'detail-body', el);
  const logo = h('img', 'detail-logo', body);
  const title = h('h1', 'detail-title', body);
  const sub = h('div', 'detail-sub', body);
  const meta = h('div', 'detail-meta', body);
  const tags = h('div', 'detail-tags', body);
  const summary = h('p', 'detail-summary', body);
  const buttonsEl = h('div', 'detail-buttons', body);
  const optionsEl = h('div', 'detail-options', body);
  const seasonsEl = h('div', 'detail-seasons', body);
  const episodesWrap = h('div', 'detail-episodes', body);
  const picker = new Picker(el);
  optionsEl.style.display = 'none';

  let item = initial;
  let buttons = [];
  let buttonIndex = 0;
  let options = [];
  let optionIndex = 0;
  let seasons = [];
  let seasonIndex = 0;
  let episodes = null;
  let zone = 'buttons';
  let alive = true;
  let shown = false;

  // Pre-play choices. Quality applies to anything played from this screen;
  // version and tracks belong to one title (`choice.key`), the Play target.
  let quality = defaultQuality();
  let choice = null; // { key, full, mediaIndex, audioId, subId }
  const fullCache = new Map();

  const isShowLike = () => item.type === 'show';

  function renderHeader() {
    const server = session.server;
    const logoPath = clearLogo(item);
    const showTitle = item.type === 'episode' ? item.grandparentTitle : item.title;
    if (logoPath) {
      logo.src = server.image(logoPath, 720, 240, { format: 'png' });
      logo.style.display = '';
      title.style.display = 'none';
    } else {
      logo.style.display = 'none';
      title.style.display = '';
      setText(title, showTitle);
    }
    setText(sub, item.type === 'episode' ? episodeLabel(item) + '   ' + item.title : (item.tagline || ''));
    setText(meta, metaLine(item));
    const genres = (item.Genre || []).slice(0, 3).map(g => g.tag);
    const people = (item.Director || []).slice(0, 1).map(d => 'Directed by ' + d.tag)
      .concat((item.Role || []).length ? ['Starring ' + item.Role.slice(0, 3).map(r => r.tag).join(', ')] : []);
    setText(tags, genres.concat(people).join('   ·   '));
    setText(summary, item.summary || '');
    ambience.set(item.UltraBlurColors);
    const artPath = item.type === 'episode' ? (item.grandparentArt || item.art) : item.art;
    art.set(server.image(artPath, 1920, 1080));
  }

  function target() {
    // What Play acts on: the item itself, or for a show the next episode.
    if (!isShowLike()) return item;
    if (item.onDeck) return item.onDeck;
    if (!episodes) return null;
    const eps = episodes.items;
    return eps.find(e => e.viewOffset) || eps.find(e => !e.viewCount) || eps[0] || null;
  }

  // Player options for `t`: the picked quality always, the picked version and
  // tracks only when `t` is the title they were picked for.
  function playOpts(t, offset) {
    const opts = { offset, quality };
    if (choice && t && t.ratingKey === choice.key) {
      opts.mediaIndex = choice.mediaIndex;
      opts.audioStreamID = choice.audioId;
      opts.subtitleStreamID = choice.subId;
    }
    return opts;
  }

  function play(t, offset) {
    if (t) playItem(t, playOpts(t, offset));
  }

  function renderButtons() {
    buttonsEl.innerHTML = '';
    buttons = [];
    const t = target();
    const add = (icon, label, run) => {
      const b = h('div', 'btn', buttonsEl);
      b.innerHTML = icon;
      h('span', '', b).textContent = label;
      buttons.push({ el: b, run });
    };
    if (t) {
      const prefix = isShowLike() ? episodeLabel(t) + '  ' : '';
      if (t.viewOffset) {
        add(icons.play, prefix + 'Resume ' + clock(t.viewOffset), () => play(t, t.viewOffset));
        add(icons.restart, 'From the start', () => play(t, 0));
      } else {
        add(icons.play, isShowLike() ? 'Play ' + prefix : 'Play', () => play(t, 0));
      }
    }
    const watched = isShowLike() ? item.viewedLeafCount >= item.leafCount : !!item.viewCount;
    add(watched ? icons.check : icons.uncheck, watched ? 'Watched' : 'Mark watched', toggleWatched);
    if (item.type === 'episode' && item.grandparentRatingKey) {
      add(icons.tv, 'Go to show', () => router.push(DetailScreen({ ratingKey: item.grandparentRatingKey, type: 'show', title: item.grandparentTitle })));
    }
    buttonIndex = Math.min(buttonIndex, buttons.length - 1);
    renderFocus();
  }

  // --- Quality / audio / subtitles, picked before playing ------------------

  function hasStreams(it) {
    const m = it && it.Media && it.Media[0];
    return !!(m && m.Part && m.Part[0] && m.Part[0].Stream);
  }

  function currentMedia() {
    const medias = choice.full.Media || [];
    return medias[choice.mediaIndex] || medias[0];
  }

  function currentPart() {
    const m = currentMedia();
    return m && m.Part && m.Part[0];
  }

  // Start from what the server has selected for this version (the user's
  // language preferences, or what they last picked in any Plex app).
  function resetStreams() {
    const part = currentPart();
    const audios = streamsOf(part, 2);
    const a = audios.find(s => s.selected) || audios[0];
    const s = streamsOf(part, 3).find(x => x.selected);
    choice.audioId = a ? a.id : undefined;
    choice.subId = s ? s.id : 0;
  }

  async function prepareChoice() {
    const t = target();
    if (!t || !t.ratingKey || (t.type !== 'movie' && t.type !== 'episode')) {
      choice = null;
      renderOptions();
      return;
    }
    if (choice && choice.key === t.ratingKey) { renderOptions(); return; }
    let full = t === item && hasStreams(item) ? item : fullCache.get(t.ratingKey);
    if (!full) {
      // A show's next episode comes from a list without stream details.
      full = await session.server.metadata(t.ratingKey);
      if (!alive || !full) return;
      fullCache.set(t.ratingKey, full);
    }
    const now = target();
    if (!now || now.ratingKey !== t.ratingKey) return;
    choice = { key: t.ratingKey, full, mediaIndex: 0, audioId: undefined, subId: 0 };
    if (!currentPart()) { choice = null; renderOptions(); return; }
    resetStreams();
    renderOptions();
  }

  function renderOptions() {
    optionsEl.innerHTML = '';
    options = [];
    if (!choice) {
      optionsEl.style.display = 'none';
      if (zone === 'options') zone = 'buttons';
      renderFocus();
      return;
    }
    optionsEl.style.display = '';
    const media = currentMedia();
    const part = currentPart();
    const multiVersion = (choice.full.Media || []).length > 1;
    const q = effectiveQuality(quality, media);
    const add = (icon, name, value, open) => {
      const o = h('div', 'opt', optionsEl);
      o.innerHTML = icon;
      h('span', 'opt-name', o).textContent = name;
      h('span', 'opt-value', o).textContent = value;
      options.push({ el: o, open });
    };
    add(icons.quality, 'Quality', q.kbps ? q.label : (multiVersion ? versionLabel(media) : 'Original'), pickQuality);
    const audios = streamsOf(part, 2);
    if (audios.length > 1) {
      const a = audios.find(s => s.id === choice.audioId);
      add(icons.audio, 'Audio', a ? audioLabel(a) : '—', pickAudio);
    }
    const texts = streamsOf(part, 3);
    if (texts.length) {
      const s = choice.subId ? texts.find(x => x.id === choice.subId) : null;
      add(icons.subtitles, 'Subtitles', s ? subtitleLabel(s) : 'Off', pickSubtitles);
    }
    optionIndex = Math.max(0, Math.min(optionIndex, options.length - 1));
    renderFocus();
  }

  // Remember track picks on the server, like the in-player picker does, so
  // they stick for this title in every Plex app.
  function saveStreams() {
    const part = currentPart();
    if (!part || part.id == null) return;
    session.server.selectStreams(part.id, { audioStreamID: choice.audioId, subtitleStreamID: choice.subId || 0 });
  }

  function pickQuality() {
    const media = currentMedia();
    const medias = choice.full.Media || [];
    const cur = effectiveQuality(quality, media);
    const opts = [];
    if (medias.length > 1) {
      medias.forEach((m, i) => opts.push({
        label: 'Original · ' + versionLabel(m),
        on: !cur.kbps && i === choice.mediaIndex,
        value: { mediaIndex: i, quality: 'original' },
      }));
    } else {
      opts.push({ label: 'Original', on: !cur.kbps, value: { mediaIndex: 0, quality: 'original' } });
    }
    qualitiesFor(media).filter(x => x.kbps).forEach(x => opts.push({
      label: x.label, on: cur.id === x.id, value: { mediaIndex: choice.mediaIndex, quality: x.id },
    }));
    picker.open('Quality', opts, v => {
      const versionChanged = v.mediaIndex !== choice.mediaIndex;
      choice.mediaIndex = v.mediaIndex;
      quality = v.quality;
      if (versionChanged) resetStreams();
      renderOptions();
    });
  }

  function pickAudio() {
    const opts = streamsOf(currentPart(), 2).map(s => ({ label: audioLabel(s), on: s.id === choice.audioId, value: s.id }));
    picker.open('Audio', opts, id => { choice.audioId = id; saveStreams(); renderOptions(); });
  }

  function pickSubtitles() {
    const opts = [{ label: 'Off', on: !choice.subId, value: 0 }]
      .concat(streamsOf(currentPart(), 3).map(s => ({ label: subtitleLabel(s), on: s.id === choice.subId, value: s.id })));
    picker.open('Subtitles', opts, id => { choice.subId = id; saveStreams(); renderOptions(); });
  }

  // --------------------------------------------------------------------------

  function renderSeasons() {
    seasonsEl.innerHTML = '';
    seasons.forEach(s => { s.el = h('div', 'pill', seasonsEl); s.el.textContent = s.title; });
    renderFocus();
  }

  function renderFocus() {
    buttons.forEach((b, i) => toggleClass(b.el, 'focus', zone === 'buttons' && i === buttonIndex));
    options.forEach((o, i) => toggleClass(o.el, 'focus', zone === 'options' && i === optionIndex));
    seasons.forEach((s, i) => {
      toggleClass(s.el, 'focus', zone === 'seasons' && i === seasonIndex);
      toggleClass(s.el, 'current', i === seasonIndex);
    });
    if (episodes) episodes.row.setActive(zone === 'episodes');
    const shifted = zone === 'seasons' || zone === 'episodes';
    const shift = SHIFT + (options.length ? OPTIONS_H : 0);
    setTransform(body, shifted ? 'translateY(' + (-shift) + 'px)' : 'translateY(0)');
    toggleClass(el, 'shifted', shifted);
  }

  async function loadEpisodes(season) {
    const kids = await session.server.children(season.ratingKey);
    if (!alive) return;
    if (!episodes) {
      const row = new Row({
        kind: 'episode', caption: true, items: kids,
        onSelect: ep => play(ep, ep.viewOffset || 0),
      });
      episodesWrap.appendChild(row.el);
      episodes = { row, items: kids };
    } else {
      episodes.items = kids;
      episodes.row.setItems(kids);
    }
    // Land on the first unwatched episode.
    const next = kids.findIndex(k => !k.viewCount || k.viewOffset);
    episodes.row.focusIndex(next >= 0 ? next : 0);
    renderFocus();
  }

  async function load() {
    try {
      let key = item.ratingKey;
      let preferSeason = null;
      if (item.type === 'season') { preferSeason = item.ratingKey; key = item.parentRatingKey; }
      const full = await session.server.metadata(key);
      if (!alive || !full) return;
      item = full;
      // Fresh metadata carries the server's current track selection (which
      // the player may have changed), so rebuild the choices from it.
      choice = null;
      fullCache.clear();
      renderHeader();
      if (isShowLike()) {
        seasons = (await session.server.children(item.ratingKey)).filter(s => s.type === 'season');
        if (!alive) return;
        const deckSeason = item.onDeck ? seasons.findIndex(s => s.ratingKey === item.onDeck.parentRatingKey) : -1;
        const pref = preferSeason ? seasons.findIndex(s => s.ratingKey === preferSeason) : -1;
        seasonIndex = pref >= 0 ? pref : (deckSeason >= 0 ? deckSeason : 0);
        renderSeasons();
        if (seasons[seasonIndex]) await loadEpisodes(seasons[seasonIndex]);
      }
      renderButtons();
      if (autoplay) {
        autoplay = false;
        const t = target();
        if (t) play(t, t.viewOffset || 0);
        return;
      }
      prepareChoice().catch(e => error('play options failed', e));
    } catch (e) {
      error('detail load failed', e);
      setText(summary, 'Couldn\'t load details.');
    }
  }

  async function toggleWatched() {
    const server = session.server;
    const watched = isShowLike() ? item.viewedLeafCount >= item.leafCount : !!item.viewCount;
    try {
      if (watched) await server.unscrobble(item.ratingKey);
      else await server.scrobble(item.ratingKey);
      server.invalidate();
      await load();
    } catch (e) {
      error('toggle watched failed', e);
    }
  }

  if (item.title) renderHeader();
  renderButtons();
  load();

  function moveZone(dir) {
    const order = ['buttons'];
    if (options.length) order.push('options');
    if (seasons.length > 1) order.push('seasons');
    if (episodes) order.push('episodes');
    const i = order.indexOf(zone) + dir;
    if (i < 0 || i >= order.length) return;
    zone = order[i];
    renderFocus();
  }

  return {
    el,
    name: 'detail',
    onShow() {
      ambience.restore();
      // Back from the player: refresh resume points and watched state.
      if (shown) {
        session.server.invalidate();
        load();
      }
      shown = true;
    },
    onKey(action) {
      if (picker.isOpen) return picker.onKey(action);
      if (action === 'up') { moveZone(-1); return true; }
      if (action === 'down') { moveZone(1); return true; }
      if (action === 'play' || action === 'playpause') {
        const t = zone === 'episodes' ? episodes.row.current() : target();
        if (t) play(t, t.viewOffset || 0);
        return true;
      }
      if (zone === 'buttons') {
        if (action === 'left') { buttonIndex = Math.max(0, buttonIndex - 1); renderFocus(); return true; }
        if (action === 'right') { buttonIndex = Math.min(buttons.length - 1, buttonIndex + 1); renderFocus(); return true; }
        if (action === 'enter' && buttons[buttonIndex]) { buttons[buttonIndex].run(); return true; }
      } else if (zone === 'options') {
        if (action === 'left') { optionIndex = Math.max(0, optionIndex - 1); renderFocus(); return true; }
        if (action === 'right') { optionIndex = Math.min(options.length - 1, optionIndex + 1); renderFocus(); return true; }
        if (action === 'enter' && options[optionIndex]) { options[optionIndex].open(); return true; }
      } else if (zone === 'seasons') {
        if (action === 'left' || action === 'right') {
          const next = seasonIndex + (action === 'right' ? 1 : -1);
          if (next >= 0 && next < seasons.length) {
            seasonIndex = next;
            renderFocus();
            loadEpisodes(seasons[seasonIndex]).catch(e => error('episodes failed', e));
          }
          return true;
        }
        if (action === 'enter') { moveZone(1); return true; }
      } else if (zone === 'episodes') {
        if (action === 'left') { episodes.row.move(-1); return true; }
        if (action === 'right') { episodes.row.move(1); return true; }
        if (action === 'enter') { episodes.row.select(); return true; }
        if (action === 'info') { router.push(DetailScreen(episodes.row.current())); return true; }
      }
      if (action === 'back' && zone !== 'buttons') { zone = 'buttons'; renderFocus(); return true; }
      return false;
    },
    destroy() { alive = false; },
  };
}
