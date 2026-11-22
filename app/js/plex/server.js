// Plex Media Server API, scoped to the features this client uses.
import { request, withQuery, identity, unreadable } from './client.js';
import { plexProfileExtra } from '../player/caps.js';
import { hasPlayableMedia, matchMedia, mediaIds, playbackState } from './availability.js';
import { asObj } from '../util/shape.js';
import { listingFilter } from '../util/kids.js';
import { plexListingParams } from './filters.js';

const SUPPORTED_HUB_TYPES = { movie: 1, show: 1, episode: 1, season: 1, mixed: 1, clip: 1 };

export class Server {
  constructor({ uri, token, name, id, owned }) {
    this.owned = owned;
    this.uri = uri;
    this.token = token;
    this.name = name;
    this.id = id;
    this.cache = new Map();
  }

  async get(path, params, { maxAge = 0, timeout } = {}) {
    const key = withQuery(path, params);
    if (maxAge) {
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.t < maxAge) return hit.data;
    }
    const json = await request(this.uri + path, { token: this.token, params, timeout });
    if (!asObj(json)) throw unreadable(this.uri + path);
    const data = json.MediaContainer || json;
    if (!asObj(data)) throw unreadable(this.uri + path);
    if (maxAge) this.cache.set(key, { t: Date.now(), data });
    return data;
  }

  invalidate() {
    this.cache.clear();
  }

  // Posters/backdrops resized (and optionally blurred) by the server, so the TV
  // only ever downloads and decodes pixels it actually shows.
  image(path, width, height, { blur = 0, quality = 85, format = 'jpeg' } = {}) {
    if (!path) return '';
    return withQuery(this.uri + '/photo/:/transcode', {
      width, height, minSize: 1, upscale: 1, blur: blur || undefined,
      quality, format, url: path, 'X-Plex-Token': this.token,
    });
  }

  url(path, params) {
    return withQuery(this.uri + path, Object.assign({ 'X-Plex-Token': this.token }, params));
  }

  // Genre, year, decade, resolution and content rating, as this library lists them.
  // A missing endpoint is an empty list, not a failed screen.
  async sectionFilters(sectionId) {
    const names = ['genre', 'year', 'decade', 'resolution', 'contentRating'];
    const out = {};
    await Promise.all(names.map(async name => {
      try {
        const mc = await this.get('/library/sections/' + sectionId + '/' + name, null, { maxAge: 600000 });
        out[name] = (mc.Directory || []).filter(d => d && d.key != null && d.key !== '').map(d => ({
          key: String(d.key), title: d.title || String(d.key),
        }));
      } catch (e) {
        out[name] = [];
      }
    }));
    return out;
  }

  async sections() {
    const mc = await this.get('/library/sections', null, { maxAge: 300000 });
    return (mc.Directory || []).filter(d => d.type === 'movie' || d.type === 'show');
  }

  async hubs() {
    const mc = await this.get('/hubs', { count: 24, includeExternalMedia: 0 });
    return (mc.Hub || []).filter(h => h.size > 0 && SUPPORTED_HUB_TYPES[h.type] && h.Metadata);
  }

  async sectionHubs(sectionId) {
    const mc = await this.get('/hubs/sections/' + sectionId, { count: 24 });
    return (mc.Hub || []).filter(h => h.size > 0 && SUPPORTED_HUB_TYPES[h.type] && h.Metadata);
  }

  // unwatched: only titles not watched yet (shows: with unwatched episodes).
  // filters: { genre, year, decade, resolution, contentRating } from the section lists.
  async items(sectionId, start, size, { sort = 'titleSort', type, unwatched = false, filters } = {}) {
    const params = plexListingParams({
      sort, type, unwatched, filters, start, size, kids: listingFilter('plex', sectionId),
    });
    params.excludeFields = 'summary,tagline';
    const mc = await this.get('/library/sections/' + sectionId + '/all', params, { timeout: 40000 }); // a big library on a busy server can be slow
    return { total: mc.totalSize != null ? mc.totalSize : mc.size, items: mc.Metadata || [] };
  }

  // --- smart search (util/smart.js) ---

  // Every genre name in the movie and show libraries.
  async genreNames() {
    const secs = await this.sections();
    const lists = await Promise.all(secs.map(s => this.get('/library/sections/' + s.key + '/genre', null, { maxAge: 600000 })
      .then(mc => (mc.Directory || []).map(d => ({ section: String(s.key), key: d.key, title: d.title })))
      .catch(() => [])));
    this.genreIndex = [].concat(...lists);
    return Array.from(new Set(this.genreIndex.map(g => g.title)));
  }

  // A person on this server by name, from search's actor/director results:
  // { name, filter: 'actor=921' } or null.
  async findPerson(name, role) {
    const mc = await this.get('/hubs/search', { query: name, limit: 10 });
    const want = String(name).toLowerCase();
    const hubs = (mc.Hub || []).filter(hb => hb.type === 'actor' || hb.type === 'director');
    hubs.sort((a, b) => (b.type === role) - (a.type === role));
    for (const hb of hubs) {
      const d = (hb.Directory || []).find(x => {
        const t = String(x.tag || '').toLowerCase();
        return t === want || (want.length > 3 && (t.split(' ').pop() === want || t.indexOf(want) === 0));
      });
      if (d) return { name: d.tag, filter: d.filter || (hb.type + '=' + d.id), role: hb.type };
    }
    return null;
  }

  // Titles matching a parsed smart search, best first.
  async smartSearch(f, person) {
    const SORT = { rating: 'audienceRating:desc', newest: 'originallyAvailableAt:desc', oldest: 'originallyAvailableAt' };
    if (f.genres.length && !this.genreIndex) await this.genreNames();
    const secs = (await this.sections()).filter(s => !f.type || s.type === f.type);
    const found = await Promise.all(secs.map(async s => {
      const type = s.type === 'show' ? 2 : 1;
      const params = { type, sort: SORT[f.sort] || 'audienceRating:desc', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': f.limit || 300 };
      if (f.genres.length) {
        // The first wish's genre as this library names it; the rest are checked on the TV.
        const g = this.genreIndex.find(x => x.section === String(s.key) && f.genres[0].includes(x.title));
        if (!g) return [];
        params.genre = g.key;
      }
      if (f.yearFrom && f.yearTo === f.yearFrom + 9 && f.yearFrom % 10 === 0) params.decade = f.yearFrom;
      else if (f.yearFrom && f.yearFrom === f.yearTo) params.year = f.yearFrom;
      if (f.watched === false) params[type === 2 ? 'unwatchedLeaves' : 'unwatched'] = 1;
      if (person && person.filter) {
        const [k, v] = person.filter.split('=');
        params[k] = v;
      }
      const kid = listingFilter('plex', s.key);
      if (kid) Object.assign(params, kid);
      try {
        const mc = await this.get('/library/sections/' + s.key + '/all', params, { timeout: 30000 });
        return mc.Metadata || [];
      } catch (e) {
        return [];
      }
    }));
    return [].concat(...found);
  }

  async metadata(ratingKey, { checkFiles = false } = {}) {
    // includeMarkers: intro/credits ranges, for the player's skip button.
    const mc = await this.get('/library/metadata/' + ratingKey, {
      includeOnDeck: 1, includeExtras: 0, includeMarkers: 1, includeGuids: 1, includeChapters: 1,
      checkFiles: checkFiles ? 1 : undefined,
    }, checkFiles ? { timeout: 6000 } : undefined);
    const item = (mc.Metadata || [])[0];
    if (item && mc.OnDeck && mc.OnDeck.Metadata) item.onDeck = mc.OnDeck.Metadata[0];
    if (item) item._at = Date.now();   // when fetched: the player reuses fresh details
    return item;
  }

  // Delete a movie or show, files included. Plex allows it only for the
  // server owner, with Settings › Library › "Allow media deletion" on.
  deleteItem(ratingKey) {
    return request(this.uri + '/library/metadata/' + ratingKey, { method: 'DELETE', token: this.token, raw: true, timeout: 30000 });
  }

  // Scan a library section for changes (e.g. files another app deleted).
  scanSection(sectionId) {
    return request(this.uri + '/library/sections/' + sectionId + '/refresh', { token: this.token, raw: true }).catch(() => {});
  }

  // Ask Plex to re-read a title's files (e.g. a subtitle file Bazarr replaced).
  refresh(ratingKey) {
    return request(this.uri + '/library/metadata/' + ratingKey + '/refresh', { method: 'PUT', token: this.token, raw: true }).catch(() => {});
  }

  // Trailers, featurettes etc. for a movie or show: local extras files and the
  // ones Plex itself provides.
  async extras(ratingKey) {
    const mc = await this.get('/library/metadata/' + ratingKey + '/extras', null, { maxAge: 600000 });
    return mc.Metadata || [];
  }

  // The seek preview pictures Plex made for a file (a BIF file), when it has
  // any (Settings › Library › "Generate video preview thumbnails").
  async previewThumbs(part) {
    if (!part || !part.id || !/sd/.test(part.indexes || '')) return null;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : 0;
    try {
      const r = await fetch(this.url('/library/parts/' + part.id + '/indexes/sd'), { signal: ctrl ? ctrl.signal : undefined });
      if (!r.ok) throw new Error('Plex answered ' + r.status);
      return r.arrayBuffer();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('The server didn\'t answer in time');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async children(ratingKey) {
    const mc = await this.get('/library/metadata/' + ratingKey + '/children', { excludeAllLeaves: 1 });
    return mc.Metadata || [];
  }

  async search(q) {
    const mc = await this.get('/hubs/search', { query: q, limit: 30, includeCollections: 0 });
    return (mc.Hub || []).filter(h => h.size > 0 && SUPPORTED_HUB_TYPES[h.type] && h.Metadata);
  }

  // Which of these plex:// guids does this server hold? (type 1 = movie,
  // 2 = show; at most 40 guids per request, as verified by plx-native.)
  async ownedGuids(guids, type) {
    const owned = new Set();
    for (let i = 0; i < guids.length; i += 40) {
      const mc = await this.get('/library/all', { type, guid: guids.slice(i, i + 40).join(',') });
      (mc.Metadata || []).forEach(m => m.guid && owned.add(m.guid));
    }
    return owned;
  }

  async findPlayable(item) {
    const ids = mediaIds(item);
    const provider = (ids.kind === 'show' ? ['tvdb', 'tmdb', 'imdb'] : ['tmdb', 'imdb']).find(p => ids[p]);
    if (!provider || !ids.title) return { status: 'unknown' };
    try {
      const mc = await this.get('/library/matches', {
        type: ids.kind === 'show' ? 2 : 1, title: ids.title, year: ids.year,
        guid: provider + '://' + ids[provider], includeFullMetadata: 1,
      }, { timeout: 6000 });
      if (!Array.isArray(mc.Metadata) && Number(mc.size) !== 0) return { status: 'unknown' };
      const matches = mc.Metadata || [];
      const checked = await Promise.all(matches.slice(0, 4).map(async match => {
        if (!match.ratingKey) return null;
        const full = await this.metadata(match.ratingKey, { checkFiles: ids.kind === 'movie' });
        if (!full || ids.kind !== 'show' || matchMedia(item, full) !== true) return full;
        const limit = 50;
        let start = 0;
        while (start < 5000) {
          const leaves = await this.get('/library/metadata/' + full.ratingKey + '/allLeaves', {
            'X-Plex-Container-Start': start, 'X-Plex-Container-Size': limit,
          }, { timeout: 6000 });
          const episodes = leaves.Metadata || [];
          for (const episode of episodes) {
            if (!episode.ratingKey || !hasPlayableMedia(episode)) continue;
            const detail = await this.metadata(episode.ratingKey, { checkFiles: true });
            if (detail && hasPlayableMedia(detail)) return { ...full, playableEpisode: true };
          }
          start += episodes.length;
          if (!episodes.length || (leaves.totalSize != null ? start >= leaves.totalSize : episodes.length < limit)) break;
        }
        return full;
      }));
      return playbackState(item, checked.filter(Boolean), matches.length <= 4 && checked.every(Boolean));
    } catch (e) {
      return { status: 'unknown' };
    }
  }

  timeline(params) {
    return request(this.uri + '/:/timeline', { token: this.token, params, timeout: 8000 }).catch(() => {});
  }

  // Drop it from Continue Watching without changing its watched state.
  removeFromContinueWatching(ratingKey) {
    return request(this.uri + '/actions/removeFromContinueWatching', {
      method: 'PUT', token: this.token, params: { ratingKey }, raw: true, timeout: 8000,
    });
  }

  scrobble(ratingKey) {
    return request(this.uri + '/:/scrobble', {
      token: this.token, params: { identifier: 'com.plexapp.plugins.library', key: ratingKey },
    });
  }

  unscrobble(ratingKey) {
    return request(this.uri + '/:/unscrobble', {
      token: this.token, params: { identifier: 'com.plexapp.plugins.library', key: ratingKey },
    });
  }

  // HLS URL for content the TV can't direct play. Video is passed through when
  // possible; only the audio (e.g. DTS) or container gets converted.
  // forceVideo: convert the picture even when it could be copied (Dolby Vision
  // profile 5, which the TV can't show; Plex tone maps it).
  transcodeUrl(item, { session, offsetMs = 0, mediaIndex = 0, maxBitrate = 40000, resolution = '3840x2160', audioStreamID, subtitleStreamID, forceVideo = false } = {}) {
    const extra = plexProfileExtra();
    return withQuery(this.uri + '/video/:/transcode/universal/start.m3u8', Object.assign({}, identity(), {
      path: '/library/metadata/' + item.ratingKey,
      mediaIndex, partIndex: 0,
      protocol: 'hls', fastSeek: 1,
      directPlay: 0, directStream: forceVideo ? 0 : 1, directStreamAudio: 1,
      offset: Math.floor(offsetMs / 1000),
      videoQuality: 100, videoResolution: resolution, maxVideoBitrate: maxBitrate,
      subtitles: subtitleStreamID ? 'burn' : 'none', subtitleSize: 100,
      audioBoost: 100, location: 'lan', copyts: 1,
      session, 'X-Plex-Session-Identifier': session,
      'X-Plex-Client-Profile-Extra': extra,
      'X-Plex-Token': this.token,
    }));
  }

  // Selected audio/subtitle streams are stored per part on the server.
  selectStreams(partId, { audioStreamID, subtitleStreamID }) {
    return request(this.uri + '/library/parts/' + partId, {
      method: 'PUT', token: this.token,
      params: { audioStreamID, subtitleStreamID, allParts: 1 },
    }).catch(() => {});
  }

  stopTranscode(session) {
    return request(this.uri + '/video/:/transcode/universal/stop', {
      token: this.token, params: { session }, timeout: 5000,
    }).catch(() => {});
  }
}
