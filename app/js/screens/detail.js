// Detail page for a movie, show, season (opens its show) or episode.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { Row } from '../ui/row.js';
import { Picker } from '../ui/picker.js';
import { session } from '../session.js';
import { metaLine, clock, episodeLabel, duration } from '../util/format.js';
import { longDate } from './info.js';
import { clearLogo } from './home.js';
import * as icons from '../ui/icons.js';
import * as router from '../router.js';
import { playItem, openPerson, openItem, openCatalogLookup } from '../nav.js';
import * as watchlist from '../plex/watchlist.js';
import * as together from '../plex/together.js';
import * as downloads from '../plex/downloads.js';
import * as themeMusic from '../ui/theme-music.js';
import { error } from '../util/log.js';
import {
  streamsOf, audioLabel, subtitleLabel, qualitiesFor, effectiveQuality, defaultQuality,
  versionTitle, versionRows, rememberedVersion, rememberVersion,
} from '../player/options.js';
import { ConfirmScreen } from './confirm.js';
import { pickTracks, rememberShowTracks, showKeyOf, langsOf, rememberShowGenres, learnShowGenres } from '../player/tracks.js';
import { ownsServer } from '../session.js';
import { removeFromWatchlist } from '../plex/discover.js';
import { notice, hideNotice } from '../ui/notice.js';
import { subLang } from '../player/subprefs.js';
import * as lang from '../util/lang.js';

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
  const seasonsTrack = h('div', 'detail-seasons-track', seasonsEl);
  const episodesWrap = h('div', 'detail-episodes', body);
  const epInfo = h('div', 'detail-epinfo', body);
  const epHead = h('div', 'detail-epinfo-head', epInfo);
  const epSummary = h('p', 'detail-epinfo-summary', epInfo);
  // Cast with photos; placed under the play options for movies, under the
  // episodes for shows.
  const castWrap = h('div', 'detail-cast');
  let cast = null;          // { row, items }
  // The rest of a movie's collection (e.g. the trilogy), owned or not, from
  // Radarr via watchlist-sync. Sits between the play options and the cast.
  const collWrap = h('div', 'detail-cast detail-collection');
  let coll = null;          // { row, items }
  let collFor = '';
  // Bonus material from the files: behind the scenes, deleted scenes,
  // featurettes, interviews, trailers. At the bottom of the page.
  const extrasWrap = h('div', 'detail-cast detail-extras');
  let extrasRow = null;     // { row, items }
  const picker = new Picker(el);
  optionsEl.style.display = 'none';

  let item = initial;
  let buttons = [];
  let buttonIndex = 0;
  let options = [];
  let optionIndex = 0;
  let seasons = [];
  let seasonIndex = 0;
  let loadedOnce = false;   // load() ran before: a reload keeps your place
  let episodes = null;
  let zone = 'buttons';
  let alive = true;
  let shown = false;
  let shownNow = true;   // on top (not behind the player or another page)

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
      opts.full = choice.full;   // already loaded: the player needn't ask again
    }
    return opts;
  }

  function play(t, offset) {
    if (t) playItem(t, playOpts(t, offset));
  }

  // Plex Watch Together: pick a friend, start a session, and play paused until
  // they join (they get an invite in Plex, e.g. Plex Web on a PC).
  async function watchTogether(t) {
    let people;
    try {
      notice('Looking up your Plex friends…', 3000);
      people = await together.friends();
    } catch (e) {
      notice('Couldn\'t reach plex.tv (' + e.message + ')', 5000);
      return;
    }
    hideNotice();
    if (!alive) return;
    if (!people.length) { notice('Add them as a friend on Plex first (plex.tv › Friends)', 6000); return; }
    picker.open('Watch together with', people.map(p => ({ label: p.title, value: p.id })), async id => {
      notice('Starting Watch Together…', 4000);
      try {
        const title = t.type === 'episode'
          ? (t.grandparentTitle || '') + ' – S' + (t.parentIndex || 0) + ' • E' + (t.index || 0) + ' – ' + t.title : t.title;
        const room = await together.createRoom(t, title);
        const invited = await together.invite(room.id, [id]).catch(() => room);
        hideNotice();
        if (!alive) return;
        playItem(t, Object.assign(playOpts(t, t.viewOffset || 0), {
          together: { room: Object.assign({}, room, invited && invited.users ? { users: invited.users } : {}), uri: together.sourceUriOf(t), host: true },
        }));
      } catch (e) {
        notice('Couldn\'t start Watch Together (' + e.message + ')', 6000);
      }
    });
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
    if (trailer) add(icons.film, 'Trailer', () => playItem(trailer, { offset: 0 }));
    if (t && together.available()) add(icons.together, 'Watch together', () => watchTogether(t));
    add(icons.info, 'More info', openInfo);
    if ((item.type === 'movie' || item.type === 'show') && session.server && session.server.owned !== false) {
      add(icons.trash, 'Delete', askDelete);
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

  // Start from the same tracks the player would pick: this show's remembered
  // languages, else the server's selection, with audio the TV can play.
  function resetStreams() {
    const picked = pickTracks(choice.full, currentPart());
    choice.audioId = picked.audio ? picked.audio.id : undefined;
    choice.subId = picked.sub ? picked.sub.id : 0;
  }

  function rememberPick() {
    const part = currentPart();
    const a = streamsOf(part, 2).find(x => x.id === choice.audioId);
    const sub = choice.subId ? streamsOf(part, 3).find(x => x.id === choice.subId) : null;
    rememberShowTracks(showKeyOf(choice.full), langsOf(a, sub));
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
    await learnShowGenres(full, session.server);
    const now = target();
    if (!alive || !now || now.ratingKey !== t.ratingKey) return;
    choice = { key: t.ratingKey, full, mediaIndex: rememberedVersion(full), audioId: undefined, subId: 0 };
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
    if (multiVersion) {
      add(icons.versions, 'Version', versionTitle(media) + '  (' + (choice.mediaIndex + 1) + ' of ' + choice.full.Media.length + ')', pickVersion);
    }
    add(icons.quality, 'Quality', q.kbps ? q.label : 'Original', pickQuality);
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

  // Which file to play, when the server has more than one.
  function pickVersion() {
    const opts = versionRows(choice.full.Media).map((r, i) => ({
      label: r.label, detail: r.detail, on: i === choice.mediaIndex, value: i,
    }));
    picker.open('Version', opts, i => {
      if (i === choice.mediaIndex) return;
      choice.mediaIndex = i;
      rememberVersion(choice.full, i);
      resetStreams();
      renderOptions();
    });
  }

  // Original, or converted down to a cap.
  function pickQuality() {
    const media = currentMedia();
    const cur = effectiveQuality(quality, media);
    const opts = qualitiesFor(media).map(x => ({ label: x.label, on: cur.id === x.id, value: x.id }));
    picker.open('Quality', opts, id => { quality = id; renderOptions(); });
  }

  function pickAudio() {
    const opts = streamsOf(currentPart(), 2).map(s => ({ label: audioLabel(s), on: s.id === choice.audioId, value: s.id }));
    picker.open('Audio', opts, id => { choice.audioId = id; saveStreams(); rememberPick(); renderOptions(); });
  }

  function pickSubtitles() {
    const opts = [{ label: 'Off', on: !choice.subId, value: 0 }]
      .concat(streamsOf(currentPart(), 3).map(s => ({ label: subtitleLabel(s), on: s.id === choice.subId, value: s.id })));
    if (watchlist.baseUrl() && (choice.full.type === 'movie' || choice.full.type === 'episode')) {
      opts.push({ label: 'Find more subtitles (Bazarr)…', value: 'bazarr' });
    }
    picker.open('Subtitles', opts, id => {
      if (id === 'bazarr') { findSubtitles(); return; }
      choice.subId = id; saveStreams(); rememberPick(); renderOptions();
    });
  }

  // --- More subtitles through Bazarr (via watchlist-sync) ---------------------

  const LANG_NAMES = { el: 'Greek', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', tr: 'Turkish' };
  const langName = c => LANG_NAMES[c] || String(c || '?').toUpperCase();
  let searching = false;

  async function subtitleQuery(t) {
    if (t.type === 'movie') return { kind: 'movie', tmdb: Number(guidOf(t, 'tmdb')) || 0, imdb: guidOf(t, 'imdb') };
    const show = await session.server.metadata(t.grandparentRatingKey);
    return { kind: 'episode', tvdb: Number(guidOf(show || {}, 'tvdb')) || 0, imdb: guidOf(show || {}, 'imdb'),
      season: t.parentIndex, episode: t.index };
  }

  async function findSubtitles() {
    if (searching || !choice) return;
    const t = choice.full;
    const pref = subLang().id;
    const want = pref === 'auto' || pref === 'off' ? '' : pref;
    searching = true;
    notice('Searching for ' + (want ? langName(want) + ' ' : '') + 'subtitles… this can take a minute', 170000);
    try {
      const q = Object.assign(await subtitleQuery(t), { lang: want });
      const r = await watchlist.searchSubtitles(q);
      if (!alive || !choice || choice.full !== t) return;
      hideNotice();
      if (!r.results.length) {
        notice('Bazarr found no ' + (want ? langName(want) + ' ' : '') + 'subtitles for this', 6000);
        return;
      }
      const opts = r.results.map((x, i) => ({
        value: i,
        label: x.score + '%  ·  ' + langName(x.language) + (x.hi ? ' (HI)' : '') + (x.forced ? ' (forced)' : '') +
          '  ·  ' + x.provider + (x.release ? '  ·  ' + x.release : ''),
      }));
      picker.open((want ? langName(want) + ' ' : '') + 'subtitles · Bazarr', opts, i => getSubtitle(t, r.token, i, r.results[i]));
    } catch (e) {
      error('subtitle search failed', e);
      notice(e.message || 'Subtitle search failed', 8000);
    } finally {
      searching = false;
    }
  }

  // Download it, then wait for Plex to see the new file and select it.
  async function getSubtitle(t, token, index, result) {
    const server = session.server;
    notice('Downloading ' + langName(result.language) + ' subtitles…', 60000);
    try {
      const before = new Set(streamsOf(currentPart(), 3).map(s => s.id));
      await watchlist.downloadSubtitle(token, index);
      await server.refresh(t.ratingKey);
      for (let tries = 0; tries < 10 && alive; tries++) {
        await new Promise(res => setTimeout(res, 3000));
        server.invalidate();
        const full = await server.metadata(t.ratingKey);
        if (!alive || !choice || choice.key !== t.ratingKey || !full) return;
        const media = (full.Media || [])[choice.mediaIndex] || (full.Media || [])[0];
        const part = media && media.Part && media.Part[0];
        const fresh = streamsOf(part, 3).find(s => !before.has(s.id) && lang.ofStream(s) === result.language) ||
          streamsOf(part, 3).find(s => !before.has(s.id));
        if (fresh) {
          fullCache.set(t.ratingKey, full);
          choice.full = full;
          choice.subId = fresh.id;
          saveStreams();
          rememberPick();
          renderOptions();
          notice(langName(result.language) + ' subtitles added and selected', 5000);
          return;
        }
      }
      notice('Downloaded. Your server hasn\'t picked the file up yet: check again in a minute.', 8000);
    } catch (e) {
      error('subtitle download failed', e);
      notice(e.message || 'Download failed', 8000);
    }
  }

  // --------------------------------------------------------------------------

  function renderSeasons() {
    seasonsTrack.innerHTML = '';
    seasons.forEach(s => { s.el = h('div', 'pill', seasonsTrack); s.el.textContent = s.title; });
    seasonsOffset = -1;
    renderFocus();
  }

  // Slide the season strip so the current season is always on screen, with
  // a pill or two of context on the left. Layout is read only here.
  let seasonsOffset = -1;
  function scrollSeasons() {
    const cur = seasons[seasonIndex];
    if (!cur || !cur.el) return;
    const viewW = seasonsEl.offsetWidth;
    const trackW = seasonsTrack.scrollWidth;
    if (!viewW) return; // not laid out yet (screen hidden)
    const left = cur.el.offsetLeft;
    const right = left + cur.el.offsetWidth;
    let next = seasonsOffset < 0 ? 0 : seasonsOffset;
    const pad = 240;
    if (right > next + viewW - pad) next = right - viewW + pad;
    if (left < next + pad) next = left - pad;
    next = Math.max(0, Math.min(next, Math.max(0, trackW - viewW)));
    if (next === seasonsOffset) return;
    seasonsOffset = next;
    setTransform(seasonsTrack, 'translate3d(' + (-next) + 'px,0,0)');
  }

  // The title's theme song (a show's for its seasons and episodes too).
  function themeUrl() {
    const path = item.theme || item.parentTheme || item.grandparentTheme;
    return path ? session.server.url(path) : '';
  }

  function playTheme() {
    // Nothing known yet (details still loading): leave a playing theme alone.
    const url = themeUrl();
    if (shownNow && url) themeMusic.play(url);
  }

  // --- Deleting the movie/show: Radarr/Sonarr first (through watchlist-sync),
  // so it isn't downloaded again, then Plex, then the Watchlist.

  function guidOf(it, scheme) {
    const re = new RegExp('^' + scheme + '://(\\w+)');
    const g = (it.Guid || []).map(x => re.exec(x.id || '')).find(Boolean);
    return g ? g[1] : '';
  }

  function askDelete() {
    const show = item.type === 'show';
    const svc = show ? 'Sonarr' : 'Radarr';
    router.push(ConfirmScreen({
      title: 'Delete ' + item.title + '?',
      message: (show ? 'Every season and episode of this show' : 'This movie') + ' and its files will be deleted from your server. '
        + (watchlist.baseUrl() ? 'If ' + svc + ' has it, it\'s removed there too, so it won\'t download again. ' : '')
        + 'This can\'t be undone.',
      run: runDelete,
    }));
  }

  async function runDelete(say) {
    const server = session.server;
    const kind = item.type === 'show' ? 'show' : 'movie';
    const title = item.title;
    say('Checking…');
    const owned = await ownsServer();
    const jf = server.kind === 'jellyfin';
    const app = jf ? 'Jellyfin' : 'Plex';
    if (owned === false) throw new Error(jf ? 'Only a Jellyfin administrator can delete. Sign in as one first.' : 'Only the server owner can delete. Switch to their profile first.');
    if (owned === null) throw new Error('Couldn\'t check with plex.tv who owns this server. Nothing was deleted.');
    let full = item;
    if (!full.Guid) full = (await server.metadata(item.ratingKey)) || item;

    let arr = null;
    if (watchlist.baseUrl()) {
      const svc = kind === 'show' ? 'Sonarr' : 'Radarr';
      say('Removing from ' + svc + '…');
      try {
        arr = await watchlist.deleteTitle({ kind, title, tmdb: Number(guidOf(full, 'tmdb')) || 0,
          tvdb: Number(guidOf(full, 'tvdb')) || 0, imdb: guidOf(full, 'imdb') });
      } catch (e) {
        // Automatic mode only guesses watchlist-sync runs next to Plex: nothing
        // answering there means it isn't installed, so Plex alone deletes.
        const absent = e.status === 0 && watchlist.mode() === 'auto' && !/in time/.test(e.message);
        if (!absent) {
          if (e.status === 404) throw new Error('Update watchlist-sync on your server to delete from ' + svc + '. Nothing was deleted.');
          throw new Error(e.message + '. Nothing was deleted: removing it from ' + app + ' alone would make ' + svc + ' download it again.');
        }
      }
      if (arr && arr.dry_run) throw new Error('watchlist-sync is in dry-run mode, so ' + svc + ' would download it again. Nothing was deleted.');
    }

    say('Removing from ' + app + '…');
    let after = '';
    try {
      await server.deleteItem(item.ratingKey);
    } catch (e) {
      if (arr && arr.deleted) {
        // The files are gone already; a scan lets Plex notice.
        if (full.librarySectionID) server.scanSection(full.librarySectionID);
        after = ' ' + app + ' will drop it after its scan.';
      } else if (e.status === 401 || e.status === 403) {
        throw new Error(jf ? 'Jellyfin refused: give your user "Allow media deletion" in Jellyfin › Dashboard › Users.' : 'Plex refused: turn on "Allow media deletion" in Plex › Settings › Library.');
      } else {
        throw new Error(app + ' couldn\'t delete it (' + e.message + ').');
      }
    }
    const catalogId = (/^plex:\/\/\w+\/(\w+)/.exec(full.guid || '') || [])[1];
    if (catalogId && !jf) removeFromWatchlist(catalogId).catch(() => {});
    server.invalidate();

    router.back(); // the confirmation
    router.back(); // this page
    notice('Deleted ' + title + (arr && arr.deleted ? ' (and from ' + (kind === 'show' ? 'Sonarr' : 'Radarr') + ')' : '') + '.' + after);
  }

  function tmdbOf(it) {
    const g = (it.Guid || []).map(x => /^tmdb:\/\/(\d+)/.exec(x.id || '')).find(Boolean);
    return g ? Number(g[1]) : 0;
  }

  // Library items for the parts we own (by title and year), so they open
  // their own page; the rest open the catalog page with Add to Watchlist.
  async function libraryMatch(part) {
    try {
      const hubs = await session.server.search(part.title);
      const all = [].concat(...hubs.map(hb => hb.Metadata || []));
      return all.find(m => m.type === 'movie' && (!part.year || Math.abs((m.year || 0) - part.year) <= 1)) || null;
    } catch (e) {
      return null;
    }
  }

  function partNote(p) {
    const d = downloads.current().find(x => x.kind === 'movie' && x.tmdb === p.tmdb);
    if (d) return downloads.describe(d).split('  ·  ').slice(0, 2).join(' · ');
    if (p.inRadarr && p.monitored) return 'Wanted · on its way';
    return 'Not in your library';
  }

  async function renderCollection() {
    if (item.type !== 'movie' || !watchlist.baseUrl()) return;
    const tmdb = tmdbOf(item);
    if (!tmdb || collFor === String(tmdb)) return;
    collFor = String(tmdb);
    let c;
    try { c = await watchlist.collection(tmdb); } catch (e) { return; }
    if (!alive || !c || !c.movies) return;
    const others = c.movies.filter(p => p.tmdb !== tmdb);
    if (!others.length) return;
    const items = await Promise.all(others.map(async p => {
      if (p.hasFile) {
        const m = await libraryMatch(p);
        if (m) return m;
      }
      return { ratingKey: 'coll-' + p.tmdb, type: 'movie', title: p.title, year: p.year, thumb: p.poster || '',
        note: partNote(p), lookup: { title: p.title, year: p.year, kind: 'movie', id: p.tmdb } };
    }));
    if (!alive) return;
    if (collWrap.parentNode !== body) body.insertBefore(collWrap, castWrap.parentNode === body ? castWrap : seasonsEl);
    const onSelect = it => (it.lookup ? openCatalogLookup(it.lookup) : openItem(it));
    if (!coll) {
      const row = new Row({ title: c.title || 'Collection', kind: 'poster', caption: true, items, onSelect });
      collWrap.appendChild(row.el);
      collWrap.style.height = row.height + 'px';
      coll = { row, items };
    } else {
      coll.items = items;
      coll.row.setItems(items);
    }
  }

  function renderCast() {
    const roles = (item.Role || []).filter(r => r.tag).slice(0, 30);
    if (!roles.length) {
      if (castWrap.parentNode) castWrap.parentNode.removeChild(castWrap);
      cast = null;
      return;
    }
    const people = roles.map((r, i) => ({
      ratingKey: 'person-' + (r.id || i), type: 'person', title: r.tag, role: r.role || '',
      thumb: r.thumb || '', filter: r.filter || (r.id ? 'actor=' + r.id : ''), id: r.id,
    }));
    // Movies: right after the options. Shows: after the episodes.
    const before = isShowLike() ? null : seasonsEl;
    if (castWrap.parentNode !== body || (before && castWrap.nextSibling !== before)) body.insertBefore(castWrap, before);
    if (!cast) {
      const row = new Row({ title: 'Cast', kind: 'person', caption: true, items: people, onSelect: p => openPerson(p) });
      row.el.classList.add('row-person');
      castWrap.appendChild(row.el);
      castWrap.style.height = row.height + 'px'; // rows are absolutely positioned
      cast = { row, items: people };
    } else {
      cast.items = people;
      cast.row.setItems(people);
    }
  }

  function renderFocus() {
    buttons.forEach((b, i) => toggleClass(b.el, 'focus', zone === 'buttons' && i === buttonIndex));
    options.forEach((o, i) => toggleClass(o.el, 'focus', zone === 'options' && i === optionIndex));
    seasons.forEach((s, i) => {
      toggleClass(s.el, 'focus', zone === 'seasons' && i === seasonIndex);
      toggleClass(s.el, 'current', i === seasonIndex);
    });
    scrollSeasons();
    if (episodes) episodes.row.setActive(zone === 'episodes');
    if (cast) cast.row.setActive(zone === 'cast');
    if (coll) coll.row.setActive(zone === 'collection');
    if (extrasRow) extrasRow.row.setActive(zone === 'extras');
    const shifted = zone === 'seasons' || zone === 'episodes' || zone === 'cast' || zone === 'collection' || zone === 'extras';
    let shift = SHIFT + (options.length ? OPTIONS_H : 0);
    // Cast / collection rows: slide them up to the middle of the screen (read once per focus change).
    if (zone === 'cast') shift = Math.max(0, castWrap.offsetTop - 430);
    if (zone === 'collection') shift = Math.max(0, collWrap.offsetTop - 330);
    if (zone === 'extras') shift = Math.max(0, extrasWrap.offsetTop - 330);
    setTransform(body, shifted ? 'translateY(' + (-shift) + 'px)' : 'translateY(0)');
    toggleClass(el, 'shifted', shifted);
  }

  // Description of the highlighted episode, under the row. Season listings
  // normally include it; if not, fetch that one episode (after a short pause,
  // so holding Right doesn't fire a request per episode).
  const epFull = new Map();
  let epTimer = 0;
  function showEpisode(ep) {
    clearTimeout(epTimer);
    if (!ep) { setText(epHead, ''); setText(epSummary, ''); return; }
    const bits = [episodeLabel(ep) + '   ' + (ep.title || '')];
    if (ep.originallyAvailableAt) bits.push(longDate(ep.originallyAvailableAt));
    if (ep.duration) bits.push(duration(ep.duration));
    setText(epHead, bits.join('   ·   '));
    const text = ep.summary || (epFull.get(ep.ratingKey) || {}).summary;
    setText(epSummary, text || '');
    if (text || epFull.has(ep.ratingKey)) return;
    epTimer = setTimeout(() => {
      session.server.metadata(ep.ratingKey).then(full => {
        epFull.set(ep.ratingKey, full || {});
        if (alive && episodes && episodes.row.current() === ep) setText(epSummary, (full && full.summary) || '');
      }, () => epFull.set(ep.ratingKey, {}));
    }, 350);
  }

  // focus: { key, next } lands on that episode (or the one after it); without
  // it, on the first unwatched one. Returns 'past-end' when the one after is
  // in the next season.
  async function loadEpisodes(season, focus) {
    const kids = await session.server.children(season.ratingKey);
    if (!alive) return;
    if (!episodes) {
      const row = new Row({
        kind: 'episode', caption: true, items: kids,
        onFocus: ep => showEpisode(ep),
        onSelect: ep => play(ep, ep.viewOffset || 0),
      });
      episodesWrap.appendChild(row.el);
      episodes = { row, items: kids };
    } else {
      episodes.items = kids;
      episodes.row.setItems(kids);
    }
    const at = focus && focus.key ? kids.findIndex(k => k.ratingKey === focus.key) : -1;
    if (at >= 0 && focus.next && at === kids.length - 1) {
      episodes.row.focusIndex(at);
      renderFocus();
      return 'past-end';
    }
    if (at >= 0) {
      episodes.row.focusIndex(focus.next ? at + 1 : at);
    } else {
      // Land on the first unwatched episode.
      const next = kids.findIndex(k => !k.viewCount || k.viewOffset);
      episodes.row.focusIndex(next >= 0 ? next : 0);
    }
    renderFocus();
    return '';
  }

  // The title's extras: the first trailer gets a button, and all of them a row.
  let trailer = null;
  async function loadTrailer() {
    if (item.type !== 'movie' && item.type !== 'show') return;
    try {
      const extras = await session.server.extras(item.ratingKey);
      if (!alive) return;
      renderExtras(extras);
      const t = extras.find(x => x.extraType === 1 || x.subtype === 'trailer' || x.extraType === '1') || null;
      if (t && trailer && t.ratingKey === trailer.ratingKey) return;
      trailer = t;
      renderButtons();
    } catch (e) { /* no extras: no button, no row */ }
  }

  const EXTRA_LABELS = {
    trailer: 'Trailer', deletedScene: 'Deleted scene', behindTheScenes: 'Behind the scenes', featurette: 'Featurette',
    interview: 'Interview', sceneOrSample: 'Scene', scene: 'Scene', short: 'Short', clip: 'Clip',
  };
  const EXTRA_BY_NUMBER = { 1: 'trailer', 2: 'deletedScene', 3: 'interview', 5: 'behindTheScenes', 6: 'sceneOrSample', 10: 'featurette', 11: 'short' };   // Plex's extraType numbers

  function renderExtras(extras) {
    const list = (extras || []).filter(x => x && x.ratingKey).map(x => {
      const kind = x.subtype || EXTRA_BY_NUMBER[x.extraType] || 'clip';
      return Object.assign({}, x, { extraLabel: EXTRA_LABELS[kind] || 'Extra' });
    });
    if (!list.length) {
      if (extrasWrap.parentNode) extrasWrap.parentNode.removeChild(extrasWrap);
      extrasRow = null;
      return;
    }
    if (extrasWrap.parentNode !== body) body.appendChild(extrasWrap);
    if (!extrasRow) {
      const row = new Row({ title: 'Extras', kind: 'episode', caption: true, items: list, onSelect: x => playItem(x) });
      extrasWrap.appendChild(row.el);
      extrasWrap.style.height = row.height + 'px';
      extrasRow = { row, items: list };
    } else {
      extrasRow.items = list;
      extrasRow.row.setItems(list);
    }
  }

  async function load() {
    try {
      // Coming back (from the player, an episode's page…): keep your place in
      // the seasons and episodes instead of starting over at season 1.
      const reloading = loadedOnce;
      const keepSeason = reloading && seasons[seasonIndex] ? seasons[seasonIndex].ratingKey : null;
      const keepEp = reloading && episodes && episodes.row.current() ? episodes.row.current().ratingKey : null;
      let key = item.ratingKey;
      let preferSeason = null;
      if (item.type === 'season') { preferSeason = item.ratingKey; key = item.parentRatingKey; }
      const full = await session.server.metadata(key);
      if (!alive || !full) return;
      item = full;
      rememberShowGenres(full);   // anime? decides the default audio/subtitles
      // Fresh metadata carries the server's current track selection (which
      // the player may have changed), so rebuild the choices from it.
      choice = null;
      fullCache.clear();
      renderHeader();
      renderCast();
      renderCollection();
      loadTrailer();
      playTheme();
      if (isShowLike()) {
        seasons = (await session.server.children(item.ratingKey)).filter(s => s.type === 'season');
        if (!alive) return;
        const deckSeason = item.onDeck ? seasons.findIndex(s => s.ratingKey === item.onDeck.parentRatingKey) : -1;
        const pref = preferSeason ? seasons.findIndex(s => s.ratingKey === preferSeason) : -1;
        // Back from playing an episode of this show: that episode (or the next
        // one, if you finished it). Otherwise where you were.
        const lp = session.lastPlayed;
        const fromPlayer = reloading && lp && String(lp.show) === String(item.ratingKey) ? lp : null;
        if (fromPlayer) session.lastPlayed = null;
        const placeSeason = fromPlayer ? fromPlayer.season : keepSeason;
        const place = placeSeason ? seasons.findIndex(s => s.ratingKey === placeSeason) : -1;
        seasonIndex = place >= 0 ? place : pref >= 0 ? pref : (deckSeason >= 0 ? deckSeason : 0);
        renderSeasons();
        if (seasons[seasonIndex]) {
          const focus = place < 0 ? null : fromPlayer ? { key: fromPlayer.key, next: fromPlayer.finished } : { key: keepEp };
          const landed = await loadEpisodes(seasons[seasonIndex], focus);
          if (!alive) return;
          if (landed === 'past-end' && seasons[seasonIndex + 1]) {
            // Finished a season's last episode: on to the next season.
            seasonIndex++;
            renderSeasons();
            await loadEpisodes(seasons[seasonIndex]);
          }
        }
      }
      loadedOnce = true;
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

  function openInfo() {
    router.pushAsync(() => import('./info.js').then(m => m.InfoScreen(item)));
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
    if (coll) order.push('collection');
    if (cast) order.push('cast');
    if (extrasRow) order.push('extras');
    const i = order.indexOf(zone) + dir;
    if (i < 0 || i >= order.length) return;
    zone = order[i];
    renderFocus();
  }

  return {
    el,
    name: 'detail',
    onShow() {
      shownNow = true;
      playTheme();
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
      if ((action === 'play' || action === 'playpause') && zone === 'extras') { extrasRow.row.select(); return true; }
      if ((action === 'play' || action === 'playpause') && zone === 'collection') {
        const c = coll.row.current();
        if (c && !c.lookup) playItem(c);
        return true;
      }
      if (action === 'play' || action === 'playpause') {
        const t = zone === 'episodes' ? episodes.row.current() : target();
        if (t) play(t, t.viewOffset || 0);
        return true;
      }
      if (zone === 'buttons') {
        if (action === 'left') { buttonIndex = Math.max(0, buttonIndex - 1); renderFocus(); return true; }
        if (action === 'right') { buttonIndex = Math.min(buttons.length - 1, buttonIndex + 1); renderFocus(); return true; }
        if (action === 'enter' && buttons[buttonIndex]) { buttons[buttonIndex].run(); return true; }
        if (action === 'info') { openInfo(); return true; }
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
      } else if (zone === 'collection') {
        if (action === 'left') { coll.row.move(-1); return true; }
        if (action === 'right') { coll.row.move(1); return true; }
        if (action === 'enter') { coll.row.select(); return true; }
      } else if (zone === 'extras') {
        if (action === 'left') { extrasRow.row.move(-1); return true; }
        if (action === 'right') { extrasRow.row.move(1); return true; }
        if (action === 'enter' || action === 'play' || action === 'playpause') { extrasRow.row.select(); return true; }
      } else if (zone === 'cast') {
        if (action === 'left') { cast.row.move(-1); return true; }
        if (action === 'right') { cast.row.move(1); return true; }
        if (action === 'enter') { cast.row.select(); return true; }
      } else if (zone === 'episodes') {
        if (action === 'left') { episodes.row.move(-1); return true; }
        if (action === 'right') { episodes.row.move(1); return true; }
        if (action === 'enter') { episodes.row.select(); return true; }
        if (action === 'info') { router.push(DetailScreen(episodes.row.current())); return true; }
      }
      if (action === 'back' && zone !== 'buttons') { zone = 'buttons'; renderFocus(); return true; }
      return false;
    },
    onHide() { shownNow = false; themeMusic.stopSoon(); },
    destroy() { alive = false; themeMusic.stopSoon(); },
  };
}
