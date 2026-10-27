// Jellyfin server, with the same methods as the Plex Server class (server.js).
// Jellyfin items are translated into the Plex-shaped objects the screens
// already use (ratingKey, type, thumb, Media[].Part[].Stream[], ...), so every
// screen works unchanged with either server.
//
// Routes are the long-standing /Users/{userId}/... ones, which Jellyfin 10.8
// and every later version answer.
import { withQuery, HttpError } from './client.js';
import { clientId } from './client.js';
import { VERSION } from '../config.js';

const TICKS = 10000; // Jellyfin counts time in 100 ns ticks; Plex in ms

function authHeader(token) {
  return 'MediaBrowser Client="Orama", Device="Samsung TV", DeviceId="' + clientId + '", Version="' + VERSION + '"' +
    (token ? ', Token="' + token + '"' : '');
}

// fetch with Jellyfin's auth header, a timeout, and JSON in/out.
export async function jfRequest(base, path, { method = 'GET', token, params, body, timeout = 15000, raw } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
  const url = withQuery(base.replace(/\/+$/, '') + path, params);
  const headers = { Accept: 'application/json', 'X-Emby-Authorization': authHeader(token) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new HttpError(res.status, url);
    if (raw) return res;
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

// --- signing in --------------------------------------------------------------------

// "192.168.1.10" -> "http://192.168.1.10:8096"; keeps a given scheme and port.
export function normalizeAddress(input) {
  let u = String(input || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  if (!/:\d+$/.test(u.replace(/^https?:\/\//i, '').split('/')[0]) && /^http:/i.test(u)) u += ':8096';
  return u;
}

// { ServerName, Id, Version } or throws.
export function publicInfo(base) {
  return jfRequest(base, '/System/Info/Public', { timeout: 8000 });
}

export async function quickConnectEnabled(base) {
  try { return (await jfRequest(base, '/QuickConnect/Enabled', { timeout: 8000 })) === true; } catch (e) { return false; }
}

// { Code, Secret }
export function quickConnectStart(base) {
  return jfRequest(base, '/QuickConnect/Initiate', { method: 'POST' });
}

export async function quickConnectDone(base, secret) {
  const r = await jfRequest(base, '/QuickConnect/Connect', { params: { secret } });
  return !!r.Authenticated;
}

// Both return { AccessToken, User: { Id, Name, Policy: { IsAdministrator } }, ServerId }.
export function signInWithQuickConnect(base, secret) {
  return jfRequest(base, '/Users/AuthenticateWithQuickConnect', { method: 'POST', body: { Secret: secret } });
}

export function signInWithPassword(base, username, password) {
  return jfRequest(base, '/Users/AuthenticateByName', { method: 'POST', body: { Username: username, Pw: password || '' } });
}

// --- translating items -------------------------------------------------------------

const TYPES = { Movie: 'movie', Series: 'show', Season: 'season', Episode: 'episode', Trailer: 'clip', Video: 'clip', Person: 'person' };
const ms = t => (t ? Math.round(t / TICKS) : 0);
const epoch = d => (d ? Math.floor(Date.parse(d) / 1000) : undefined);

function img(id, type, tag, index) {
  if (!id || !tag) return '';
  return '/Items/' + id + '/Images/' + type + (index != null ? '/' + index : '') + '?tag=' + encodeURIComponent(tag);
}

function resolution(w, h) {
  if (w >= 3200 || h >= 2000) return '4k';
  if (w >= 1800 || h >= 1000) return '1080';
  if (w >= 1200 || h >= 700) return '720';
  return w ? 'sd' : '';
}

function streamOf(itemId, src, s) {
  const type = { Video: 1, Audio: 2, Subtitle: 3 }[s.Type];
  if (!type) return null;
  const codec = String(s.Codec || '').toLowerCase();
  const out = {
    id: s.Index, index: s.Index, streamType: type, codec,
    displayTitle: s.DisplayTitle || '', title: s.Title || '',
    language: s.Language || '', languageCode: s.Language || '',
    selected: type === 2 ? s.Index === src.DefaultAudioStreamIndex : type === 3 ? s.Index === src.DefaultSubtitleStreamIndex : false,
    forced: !!s.IsForced, hearingImpaired: !!s.IsHearingImpaired,
  };
  if (type === 1) {
    out.width = s.Width; out.height = s.Height;
    if (s.VideoRangeType && !/sdr/i.test(s.VideoRangeType) && !/hdr|dolby|dovi/i.test(out.displayTitle)) {
      out.displayTitle += /dovi/i.test(s.VideoRangeType) ? ' Dolby Vision' : ' HDR';
    }
  }
  if (type === 2) { out.channels = s.Channels; out.audioChannelLayout = s.ChannelLayout; }
  // Text subtitles (embedded or not): Jellyfin hands them out as .srt, and Orama
  // draws them itself. Picture subtitles (PGS, VobSub) get burned in instead.
  if (type === 3 && s.IsTextSubtitleStream !== false && !/pgs|dvd|dvb|vobsub/.test(codec)) {
    out.key = '/Videos/' + itemId + '/' + src.Id + '/Subtitles/' + s.Index + '/Stream.srt';
    out.codec = 'srt';
  }
  return out;
}

function mediaOf(it) {
  return (it.MediaSources || []).map(src => {
    const streams = (src.MediaStreams || it.MediaStreams || []).map(s => streamOf(it.Id, src, s)).filter(Boolean);
    const v = streams.find(s => s.streamType === 1) || {};
    const container = String(src.Container || '').split(',')[0].toLowerCase();
    return {
      id: src.Id, container, videoCodec: v.codec || '', title: (it.MediaSources || []).length > 1 ? src.Name || '' : '', bitrate: src.Bitrate ? Math.round(src.Bitrate / 1000) : 0,
      width: v.width, height: v.height, videoResolution: resolution(v.width || 0, v.height || 0),
      Part: [{
        id: src.Id, container, size: src.Size, file: src.Path || '',
        key: '/Videos/' + it.Id + '/stream?static=true&mediaSourceId=' + encodeURIComponent(src.Id),
        Stream: streams,
      }],
    };
  });
}

export function toPlex(it) {
  const ud = it.UserData || {};
  const type = TYPES[it.Type] || 'clip';
  const tags = it.ImageTags || {};
  const people = it.People || [];
  const ids = it.ProviderIds || {};
  const leaf = it.RecursiveItemCount || 0;
  const o = {
    ratingKey: it.Id, key: it.Id, type, title: it.Name || '', jellyfin: true,
    year: it.ProductionYear, summary: it.Overview || '', tagline: (it.Taglines || [])[0] || '',
    contentRating: it.OfficialRating || '', duration: ms(it.RunTimeTicks),
    viewOffset: ms(ud.PlaybackPositionTicks) || undefined, viewCount: ud.Played ? 1 : 0,
    lastViewedAt: epoch(ud.LastPlayedDate), addedAt: epoch(it.DateCreated),
    originallyAvailableAt: it.PremiereDate ? it.PremiereDate.slice(0, 10) : undefined,
    index: it.IndexNumber, parentIndex: it.ParentIndexNumber,
    thumb: img(it.Id, 'Primary', tags.Primary),
    art: img(it.Id, 'Backdrop', (it.BackdropImageTags || [])[0], 0) ||
      img(it.ParentBackdropItemId, 'Backdrop', (it.ParentBackdropImageTags || [])[0], 0),
    Guid: Object.keys(ids).filter(k => /^(tmdb|imdb|tvdb)$/i.test(k) && ids[k]).map(k => ({ id: k.toLowerCase() + '://' + ids[k] })),
    Genre: (it.Genres || []).map(tag => ({ tag })),
    Director: people.filter(p => p.Type === 'Director').map(p => ({ tag: p.Name })),
    Writer: people.filter(p => p.Type === 'Writer').map(p => ({ tag: p.Name })),
    Role: people.filter(p => p.Type === 'Actor' || p.Type === 'GuestStar').map(p => ({
      tag: p.Name, role: p.Role || '', id: p.Id, thumb: img(p.Id, 'Primary', p.PrimaryImageTag), filter: 'person=' + p.Id,
    })),
    studio: ((it.Studios || [])[0] || {}).Name,
    Rating: [],
  };
  if (it.CommunityRating) {
    o.audienceRating = Math.round(it.CommunityRating * 10) / 10;
    o.audienceRatingImage = 'themoviedb://image.rating';
    o.Rating.push({ image: 'themoviedb://image.rating', value: o.audienceRating, type: 'audience' });
  }
  if (it.CriticRating != null) {
    o.rating = it.CriticRating / 10;
    o.ratingImage = it.CriticRating >= 60 ? 'rottentomatoes://image.rating.ripe' : 'rottentomatoes://image.rating.rotten';
    o.Rating.push({ image: o.ratingImage, value: o.rating, type: 'critic' });
  }
  if (type === 'episode') {
    o.parentRatingKey = it.SeasonId; o.grandparentRatingKey = it.SeriesId;
    o.grandparentTitle = it.SeriesName || ''; o.parentTitle = it.SeasonName || '';
    o.grandparentThumb = img(it.SeriesId, 'Primary', it.SeriesPrimaryImageTag);
    o.parentThumb = o.grandparentThumb;
    o.grandparentArt = img(it.ParentBackdropItemId, 'Backdrop', (it.ParentBackdropImageTags || [])[0], 0);
  }
  if (type === 'season') {
    o.parentRatingKey = it.SeriesId || it.ParentId; o.parentTitle = it.SeriesName || '';
    o.parentThumb = img(it.SeriesId, 'Primary', it.SeriesPrimaryImageTag);
    if (!o.thumb) o.thumb = o.parentThumb;
    o.leafCount = leaf; o.viewedLeafCount = ud.Played ? leaf : Math.max(0, leaf - (ud.UnplayedItemCount || 0));
  }
  if (type === 'show') {
    o.childCount = it.ChildCount; o.leafCount = leaf;
    o.viewedLeafCount = ud.Played ? leaf : Math.max(0, leaf - (ud.UnplayedItemCount || 0));
  }
  if (type === 'clip' && it.Type === 'Trailer') { o.extraType = 1; o.subtype = 'trailer'; }
  if (it.MediaSources) o.Media = mediaOf(it);
  return o;
}

// --- the server ----------------------------------------------------------------------

const LIST_FIELDS = 'Overview,ProviderIds,PrimaryImageAspectRatio,ChildCount,RecursiveItemCount,DateCreated,PremiereDate,OfficialRating,CommunityRating,CriticRating';
const SORTS = {
  titleSort: ['SortName', 'Ascending'], 'addedAt:desc': ['DateCreated,SortName', 'Descending'],
  'originallyAvailableAt:desc': ['PremiereDate,ProductionYear,SortName', 'Descending'],
  'audienceRating:desc': ['CommunityRating,SortName', 'Descending'],
};

export class JellyfinServer {
  // rec: { kind: 'jellyfin', uri, token, name, id, userId, admin }
  constructor(rec) {
    this.kind = 'jellyfin';
    this.uri = rec.uri;
    this.token = rec.token;
    this.name = rec.name;
    this.id = rec.id;
    this.userId = rec.userId;
    this.owned = !!rec.admin; // only administrators may delete
    this.cache = new Map();
    this.playing = {};        // itemId -> { session, method } while reporting progress
  }

  req(path, opts = {}) {
    return jfRequest(this.uri, path, Object.assign({ token: this.token }, opts));
  }

  async cached(key, maxAge, fn) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.t < maxAge) return hit.data;
    const data = await fn();
    this.cache.set(key, { t: Date.now(), data });
    return data;
  }

  invalidate() { this.cache.clear(); }

  image(path, width, height, { blur = 0, quality = 85 } = {}) {
    if (!path) return '';
    if (/^https?:/i.test(path)) return path; // e.g. a TMDB poster from watchlist-sync
    return withQuery(this.uri + path, { maxWidth: width, maxHeight: height, quality, blur: blur || undefined });
  }

  url(path, params) {
    return withQuery(this.uri + path, Object.assign({ api_key: this.token }, params));
  }

  u(path) { return '/Users/' + this.userId + path; }

  // A few Plex paths the screens ask for directly.
  async get(path, params = {}) {
    if (path === '/identity') return this.req('/System/Info', { timeout: 8000 });
    let m = /^\/library\/sections\/([^/]+)\/firstCharacter$/.exec(path);
    if (m) return { Directory: await this.letters(m[1], params) };
    m = /^\/library\/sections\/([^/]+)\/all$/.exec(path);
    if (m && params.person) {
      const r = await this.req(this.u('/Items'), { params: {
        ParentId: m[1], PersonIds: params.person, Recursive: true, IncludeItemTypes: 'Movie,Series',
        SortBy: 'ProductionYear,SortName', SortOrder: 'Descending', Fields: LIST_FIELDS,
      } });
      return { Metadata: (r.Items || []).map(toPlex) };
    }
    throw new Error('Not available on Jellyfin: ' + path);
  }

  async sections() {
    return this.cached('views', 300000, async () => {
      const r = await this.req(this.u('/Views'));
      return (r.Items || []).filter(v => v.CollectionType === 'movies' || v.CollectionType === 'tvshows')
        .map(v => ({ key: v.Id, title: v.Name, type: v.CollectionType === 'movies' ? 'movie' : 'show' }));
    });
  }

  async hubs() {
    const views = await this.sections();
    const fields = { Fields: LIST_FIELDS, EnableImageTypes: 'Primary,Backdrop,Thumb' };
    const [resume, next, ...latest] = await Promise.all([
      this.req(this.u('/Items/Resume'), { params: Object.assign({ Limit: 24, MediaTypes: 'Video' }, fields) }).catch(() => ({})),
      this.req('/Shows/NextUp', { params: Object.assign({ UserId: this.userId, Limit: 24 }, fields) }).catch(() => ({})),
      ...views.map(v => this.req(this.u('/Items/Latest'), { params: Object.assign({ ParentId: v.key, Limit: 24 }, fields) }).catch(() => [])),
    ]);
    const hubs = [
      { hubIdentifier: 'home.continue', title: 'Continue Watching', type: 'mixed', Metadata: (resume.Items || []).map(toPlex) },
      { hubIdentifier: 'home.ondeck', title: 'Next Up', type: 'episode', Metadata: (next.Items || []).map(toPlex) },
    ];
    views.forEach((v, i) => hubs.push({
      hubIdentifier: (v.type === 'movie' ? 'movie' : 'tv') + '.recentlyadded.' + v.key,
      title: 'Recently Added ' + v.title, type: v.type, Metadata: (latest[i] || []).map(toPlex),
    }));
    return hubs.map(hb => Object.assign(hb, { size: hb.Metadata.length })).filter(hb => hb.size);
  }

  async sectionHubs() { return []; }

  async items(sectionId, start, size, { sort = 'titleSort', type, unwatched = false } = {}) {
    const [by, order] = SORTS[sort] || SORTS.titleSort;
    const r = await this.req(this.u('/Items'), { timeout: 40000, params: {
      ParentId: sectionId, Recursive: true, IncludeItemTypes: type === 2 ? 'Series' : 'Movie',
      StartIndex: start, Limit: size, SortBy: by, SortOrder: order, Fields: 'ProviderIds,ChildCount,RecursiveItemCount,PremiereDate,CommunityRating',
      Filters: unwatched ? 'IsUnplayed' : undefined, EnableTotalRecordCount: true,
    } });
    return { total: r.TotalRecordCount || 0, items: (r.Items || []).map(toPlex) };
  }

  // Plex's "first character" index for the letter jump: titles in A–Z order,
  // grouped by first letter ('#' for anything else), in the order they appear.
  async letters(sectionId, { type, unwatched, unwatchedLeaves } = {}) {
    const r = await this.req(this.u('/Items'), { timeout: 40000, params: {
      ParentId: sectionId, Recursive: true, IncludeItemTypes: String(type) === '2' ? 'Series' : 'Movie',
      SortBy: 'SortName', SortOrder: 'Ascending', Fields: 'SortName', EnableImages: false, EnableUserData: false,
      Filters: unwatched || unwatchedLeaves ? 'IsUnplayed' : undefined,
    } });
    const dirs = [];
    (r.Items || []).forEach(it => {
      const c = String(it.SortName || it.Name || '').trim().charAt(0).toUpperCase();
      const title = /[A-Z]/.test(c) ? c : '#';
      const last = dirs[dirs.length - 1];
      if (last && last.title === title) last.size++;
      else dirs.push({ title, size: 1 });
    });
    return dirs;
  }

  async metadata(id) {
    const it = await this.req(this.u('/Items/' + id));
    const item = toPlex(it);
    const extras = [];
    if (item.type === 'show') {
      extras.push(this.req('/Shows/NextUp', { params: { UserId: this.userId, SeriesId: id, Limit: 1, Fields: LIST_FIELDS } })
        .then(r => { if (r.Items && r.Items[0]) item.onDeck = toPlex(r.Items[0]); }).catch(() => {}));
    }
    if (item.type === 'movie' || item.type === 'episode') {
      // Intro/credits ranges (Jellyfin 10.10+ media segments, e.g. from the
      // Intro Skipper plugin), for the player's skip button.
      extras.push(this.req('/MediaSegments/' + id, { timeout: 5000 }).then(r => {
        item.Marker = (r.Items || []).filter(s => s.Type === 'Intro' || s.Type === 'Outro').map(s => ({
          type: s.Type === 'Intro' ? 'intro' : 'credits', startTimeOffset: ms(s.StartTicks), endTimeOffset: ms(s.EndTicks),
          final: s.Type === 'Outro',
        }));
      }).catch(() => {}));
    }
    if (item.type !== 'clip') {
      extras.push(this.req('/Items/' + id + '/ThemeSongs', { params: { userId: this.userId, inheritFromParent: true }, timeout: 5000 })
        .then(r => { const s = (r.Items || [])[0]; if (s) item.theme = '/Audio/' + s.Id + '/stream?static=true'; }).catch(() => {}));
    }
    await Promise.all(extras);
    return item;
  }

  async children(id) {
    const r = await this.req(this.u('/Items'), { params: {
      ParentId: id, SortBy: 'ParentIndexNumber,IndexNumber,SortName', SortOrder: 'Ascending',
      Fields: 'Overview,ProviderIds,ChildCount,RecursiveItemCount,PremiereDate',
    } });
    return (r.Items || []).map(toPlex);
  }

  async search(q) {
    const r = await this.req(this.u('/Items'), { params: {
      searchTerm: q, Recursive: true, IncludeItemTypes: 'Movie,Series,Episode', Limit: 60, Fields: 'ProviderIds,PremiereDate',
    } });
    const all = (r.Items || []).map(toPlex);
    return [['movie', 'Movies'], ['show', 'Shows'], ['episode', 'Episodes']]
      .map(([type, title]) => ({ type, title, hubIdentifier: 'search.' + type, Metadata: all.filter(x => x.type === type) }))
      .map(hb => Object.assign(hb, { size: hb.Metadata.length })).filter(hb => hb.size);
  }

  async extras(id) {
    const list = await this.req(this.u('/Items/' + id + '/LocalTrailers'), { timeout: 8000 }).catch(() => []);
    return (Array.isArray(list) ? list : []).map(it => Object.assign(toPlex(it), { extraType: 1, subtype: 'trailer' }));
  }

  async previewThumbs() { return null; }       // Jellyfin's trickplay isn't a BIF file
  async ownedGuids() { return new Set(); }     // Plex's catalog only

  // --- watched state, progress ---

  scrobble(id) { return this.req(this.u('/PlayedItems/' + id), { method: 'POST' }); }
  unscrobble(id) { return this.req(this.u('/PlayedItems/' + id), { method: 'DELETE' }); }

  // Jellyfin has no "hide from Continue Watching": clearing the position does it.
  removeFromContinueWatching(id) {
    return this.req(this.u('/Items/' + id + '/UserData'), { method: 'POST', body: { PlaybackPositionTicks: 0 } });
  }

  // Plex-style timeline report: { ratingKey, state, time, duration }.
  timeline({ ratingKey, state, time }) {
    const p = this.playing[ratingKey] || {};
    const body = {
      ItemId: ratingKey, PositionTicks: Math.max(0, Math.floor(time || 0)) * TICKS, IsPaused: state === 'paused',
      PlaySessionId: p.session, MediaSourceId: p.source, PlayMethod: p.method || 'DirectPlay', CanSeek: true,
    };
    let path = '/Sessions/Playing/Progress';
    if (state === 'stopped') { path = '/Sessions/Playing/Stopped'; delete this.playing[ratingKey]; }
    else if (!p.started) { path = '/Sessions/Playing'; this.playing[ratingKey] = Object.assign(p, { started: true }); }
    return this.req(path, { method: 'POST', body, timeout: 8000 }).catch(() => {});
  }

  selectStreams() { return Promise.resolve(); }   // Jellyfin keeps no per-file choice

  // --- converting what the TV can't play ---

  // Ask Jellyfin how to convert, and return { url, decision } where decision
  // looks like the Plex transcode decision the player shows.
  async prepareTranscode(item, { session, offsetMs = 0, mediaSourceId, maxBitrate, audioStreamID, subtitleStreamID } = {}) {
    const profile = {
      MaxStreamingBitrate: maxBitrate ? maxBitrate * 1000 : 140000000,
      MaxStaticBitrate: 200000000,
      DirectPlayProfiles: [],
      TranscodingProfiles: [{
        Container: 'ts', Type: 'Video', Protocol: 'hls', Context: 'Streaming',
        VideoCodec: 'hevc,h264', AudioCodec: 'eac3,ac3,aac', MaxAudioChannels: '6', BreakOnNonKeyFrames: true,
      }],
      ContainerProfiles: [], CodecProfiles: [],
      SubtitleProfiles: ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt'].map(Format => ({ Format, Method: 'External' })),
    };
    const r = await this.req('/Items/' + item.ratingKey + '/PlaybackInfo', { method: 'POST', timeout: 30000, body: {
      UserId: this.userId, StartTimeTicks: Math.floor(offsetMs) * TICKS, MediaSourceId: mediaSourceId,
      AudioStreamIndex: audioStreamID, SubtitleStreamIndex: subtitleStreamID != null ? subtitleStreamID : -1,
      MaxStreamingBitrate: profile.MaxStreamingBitrate, EnableDirectPlay: false, EnableDirectStream: false,
      EnableTranscoding: true, AllowVideoStreamCopy: !maxBitrate, AllowAudioStreamCopy: true, DeviceProfile: profile,
    } });
    const src = (r.MediaSources || []).find(s => s.Id === mediaSourceId) || (r.MediaSources || [])[0];
    if (!src || !src.TranscodingUrl) throw new Error('Jellyfin couldn\'t convert this file');
    this.playing[item.ratingKey] = { session: r.PlaySessionId, source: src.Id, method: 'Transcode' };
    this.activeSession = r.PlaySessionId;
    const reasons = (src.TranscodeReasons || []).join(' ');
    const q = new URLSearchParams(src.TranscodingUrl.split('?')[1] || '');
    const videoCopied = !maxBitrate && subtitleStreamID == null && !/Video|Resolution|Bitrate|Framerate|RefFrames|Level|Profile|Anamorphic|Interlaced|BitDepth|Subtitle/i.test(reasons);
    const audioCopied = !/Audio/i.test(reasons);
    const decision = { Metadata: [{ Media: [{ videoResolution: '', bitrate: maxBitrate || 0, Part: [{ Stream: [
      { streamType: 1, decision: videoCopied ? 'copy' : 'transcode', codec: (q.get('VideoCodec') || 'h264').split(',')[0] },
      { streamType: 2, decision: audioCopied ? 'copy' : 'transcode', codec: (q.get('AudioCodec') || 'aac').split(',')[0] },
    ].concat(subtitleStreamID != null ? [{ streamType: 3, decision: 'burn' }] : []) }] }] }] };
    let url = this.uri + src.TranscodingUrl;
    if (!/[?&]api_key=/i.test(url)) url += (url.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + encodeURIComponent(this.token);
    return { url, decision };
  }

  stopTranscode() {
    const s = this.activeSession;
    this.activeSession = null;
    if (!s) return Promise.resolve();
    return this.req('/Videos/ActiveEncodings', { method: 'DELETE', params: { deviceId: clientId, playSessionId: s }, timeout: 5000 }).catch(() => {});
  }

  // --- library maintenance ---

  deleteItem(id) { return this.req('/Items/' + id, { method: 'DELETE', timeout: 30000 }); }
  scanSection() { return this.req('/Library/Refresh', { method: 'POST' }).catch(() => {}); }
  refresh(id) {
    return this.req('/Items/' + id + '/Refresh', { method: 'POST', params: {
      metadataRefreshMode: 'Default', imageRefreshMode: 'Default', replaceAllMetadata: false, replaceAllImages: false,
    } }).catch(() => {});
  }
}
