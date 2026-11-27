// One origin for screenshots: Orama's app/ plus a fake Jellyfin library.
// node tools/mock-jellyfin.mjs [app-dir] [port]
// Prints "MOCK http://127.0.0.1:PORT" and serves until killed.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app'));
const PORT = Number(process.argv[3] || 0);
const U = 'u1';
const TICK = 10000;
const MIN = 60000 * TICK;
const DAY = 86400000;
const EPOCH = Date.UTC(2024, 2, 1);

const PAL = [['#3b2f7a', '#120d24'], ['#8a3b2f', '#1f0e0b'], ['#2f6a7a', '#0c1a1f'], ['#5c7a2f', '#121a0b'], ['#7a2f63', '#1c0b18'], ['#7a6a2f', '#1f1a0b'], ['#2f4a7a', '#0b111f'], ['#7a4a2f', '#1f130b']];
const MOVIES = ['Night Harbor', 'The Long Field', 'Paper Moons', 'Glass Orchard', 'Northbound', 'The Quiet Engine', 'Saltwater Kings', 'Ember Street', 'A Map of Rain', 'Hollow Bay', 'The Ninth Bell', 'Copper Sky', 'Low Tide', 'Winter Static', 'The Lantern House', 'Iron Meridian', 'Small Hours', 'Red Canyon Line', 'Second Light', 'The Archivist', 'Velvet Frontier', 'Distant Shore', 'Blue Hour', 'Stone Garden', 'Last Ferry', 'Silver Thread', 'The Cartographer', 'Midnight Relay'];
const SHOWS = ['Station Eleven North', 'The Orchard Years', 'Signal & Noise', 'Harbor Lights', 'Field Notes', 'The Long Way Home', 'Parallel Rooms', 'Coastline'];
const GENRES = [['Thriller', 'Mystery'], ['Drama'], ['Sci-Fi', 'Adventure'], ['Comedy', 'Drama'], ['Crime'], ['Romance', 'Drama']];
const SUMMARY = 'A harbour pilot finds a ship that isn\'t on any manifest, and a crew that insists it\'s still 1987. The closer she gets to the truth, the less the town wants it found.';

const movie = (name, i) => ({
  Id: 'm' + i, Name: name, Type: 'Movie', ProductionYear: 2014 + (i % 11), Overview: SUMMARY,
  RunTimeTicks: (88 + (i * 7) % 60) * MIN, OfficialRating: ['PG-13', 'R', '12', '16'][i % 4],
  CommunityRating: 6.4 + (i % 9) * 0.3, CriticRating: 60 + (i * 5) % 40, Genres: GENRES[i % GENRES.length],
  ImageTags: { Primary: 'p' }, BackdropImageTags: ['b'],
  DateCreated: new Date(EPOCH - i * DAY).toISOString(),
  PremiereDate: (2014 + (i % 11)) + '-03-14T00:00:00Z',
  UserData: i < 5 ? { PlaybackPositionTicks: (20 + i * 9) * MIN, Played: false } : { Played: i % 3 === 0 },
  People: [{ Name: 'M. Lindqvist', Type: 'Director' }, { Name: 'Ana Ferreira', Type: 'Actor', Role: 'Ines', Id: 'pa' }, { Name: 'Jonah Reyes', Type: 'Actor', Role: 'Cole', Id: 'pb' }],
  Studios: [{ Name: 'Northlight Pictures' }],
});
const show = (name, i) => ({
  Id: 's' + i, Name: name, Type: 'Series', ProductionYear: 2018 + (i % 6), Overview: SUMMARY, OfficialRating: 'TV-14',
  CommunityRating: 7.2 + (i % 5) * 0.3, Genres: GENRES[(i + 2) % GENRES.length], ImageTags: { Primary: 'p' }, BackdropImageTags: ['b'],
  ChildCount: 3, RecursiveItemCount: 24, UserData: { UnplayedItemCount: 10 },
  DateCreated: new Date(EPOCH - i * DAY / 2).toISOString(),
});
const episode = (s, n) => ({
  Id: 'e' + s.Id + '_' + n, Name: ['Pilot', 'The Crossing', 'Low Water', 'Undertow'][n % 4], Type: 'Episode', SeriesId: s.Id, SeriesName: s.Name,
  SeasonId: s.Id + 'x1', SeasonName: 'Season 1', IndexNumber: n, ParentIndexNumber: 1, Overview: SUMMARY, RunTimeTicks: 48 * MIN,
  ImageTags: { Primary: 'p' }, SeriesPrimaryImageTag: 'p', ParentBackdropItemId: s.Id, ParentBackdropImageTags: ['b'],
  UserData: { PlaybackPositionTicks: n === 2 ? 14 * MIN : 0 },
});
const movies = MOVIES.map(movie);
const shows = SHOWS.map(show);
const all = new Map([...movies, ...shows].map(x => [x.Id, x]));
const sources = id => [{
  Id: 'src' + id, Container: 'mkv', Bitrate: 18000000, Size: 9e9, Path: '/media/x.mkv', DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: -1,
  MediaStreams: [
    { Type: 'Video', Index: 0, Codec: 'hevc', Width: 3840, Height: 2160, DisplayTitle: '4K HEVC', VideoRangeType: 'HDR10' },
    { Type: 'Audio', Index: 1, Codec: 'eac3', Channels: 6, Language: 'eng', DisplayTitle: 'English EAC3 5.1' },
    { Type: 'Audio', Index: 2, Codec: 'aac', Channels: 2, Language: 'ell', DisplayTitle: 'Greek AAC Stereo' },
    { Type: 'Subtitle', Index: 3, Codec: 'subrip', Language: 'eng', DisplayTitle: 'English', IsTextSubtitleStream: true },
    { Type: 'Subtitle', Index: 4, Codec: 'subrip', Language: 'ell', DisplayTitle: 'Greek', IsTextSubtitleStream: true },
  ],
}];

function svg(id, kind) {
  const it = all.get(id) || all.get(String(id).replace(/^e(s\d+)_.*/, '$1')) || { Name: '' };
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = PAL[h % PAL.length];
  const [w, ht] = kind === 'Backdrop' ? [1920, 1080] : kind === 'Thumb' ? [1280, 720] : [600, 900];
  const fs = kind === 'Backdrop' ? 0 : 54;
  const words = String(it.Name).split(' ');
  const lines = [];
  let cur = '';
  for (const wd of words) {
    if ((cur + ' ' + wd).trim().length > 12) { if (cur) lines.push(cur); cur = wd; }
    else cur = (cur + ' ' + wd).trim();
  }
  if (cur) lines.push(cur);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const text = fs ? lines.map((l, i) => `<text x="44" y="${ht - 60 - (lines.length - 1 - i) * 64}" font-family="'Liberation Serif',serif" font-size="${fs}" font-weight="700" fill="#fff" fill-opacity=".92">${esc(l)}</text>`).join('') : '';
  const orb = kind === 'Backdrop'
    ? `<circle cx="1400" cy="380" r="520" fill="${a}" fill-opacity=".9"/><circle cx="1650" cy="760" r="300" fill="${PAL[(h + 3) % PAL.length][0]}" fill-opacity=".55"/>`
    : `<circle cx="${w * 0.7}" cy="${ht * 0.3}" r="${w * 0.55}" fill="${a}" fill-opacity=".85"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}"><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b}" stop-opacity="0"/><stop offset="1" stop-color="${b}"/></linearGradient><rect width="100%" height="100%" fill="${b}"/>${orb}<rect width="100%" height="100%" fill="url(#g)"/>${text}</svg>`;
}

const TYPES = { css: 'text/css', js: 'text/javascript', html: 'text/html', png: 'image/png', woff2: 'font/woff2', svg: 'image/svg+xml', json: 'application/json' };

function json(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function fileFor(urlPath) {
  const rel = decodeURIComponent(urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, ''));
  const f = path.resolve(APP, rel);
  const inside = path.relative(APP, f);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  if (!existsSync(f) || !statSync(f).isFile()) return null;
  return f;
}

createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); }
  catch (e) { res.writeHead(400); res.end(); return; }
  const p = url.pathname;
  const q = url.searchParams;
  let m;
  if (p === '/seed') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(`<!DOCTYPE html><meta charset="utf-8"><script>
localStorage.clear();
const S=(k,v)=>localStorage.setItem('ss.'+k,JSON.stringify(v));
S('token','demo');
S('user',{title:'Alex',uuid:'${U}'});
S('server',{kind:'jellyfin',uri:location.origin,token:'demo',name:'Living room',id:'demo',userId:'${U}',admin:true});
S('animations',false);
S('upMode','off');
location.href='/index.html';
</script>`);
    return;
  }
  if (p.includes('webapis.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end('/* tv stub */');
    return;
  }
  if ((m = /^\/Items\/([^/]+)\/Images\/(\w+)/.exec(p))) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    res.end(svg(m[1], m[2]));
    return;
  }
  if (p === '/System/Info' || p === '/System/Info/Public') return json(res, { ServerName: 'Living room', Id: 'demo', Version: '10.10.0' });
  if (p === '/SyncPlay/List') return json(res, []);
  if (p === `/Users/${U}/Views`) return json(res, { Items: [{ Id: 'lib-m', Name: 'Movies', CollectionType: 'movies' }, { Id: 'lib-s', Name: 'Shows', CollectionType: 'tvshows' }] });
  if (p === `/Users/${U}/Items/Resume`) return json(res, { Items: [movies[0], episode(shows[0], 2), movies[1], movies[2], episode(shows[3], 5), movies[3], movies[4]] });
  if (p === '/Shows/NextUp') return json(res, { Items: shows.slice(0, 6).map((s, i) => episode(s, i + 1)) });
  if (p === `/Users/${U}/Items/Latest`) return json(res, q.get('ParentId') === 'lib-s' ? shows : movies.slice(6, 20));
  if (p === `/Users/${U}/Items`) {
    const pid = q.get('ParentId') || '';
    // Detail → Top rated: every episode of the show, with a few scores.
    if (q.get('IncludeItemTypes') === 'Episode' && q.get('Recursive') === 'true' && /^s\d+$/.test(pid)) {
      const s = all.get(pid);
      if (!s) return json(res, { Items: [], TotalRecordCount: 0 });
      const items = [];
      for (let season = 1; season <= 3; season++) {
        for (let n = 1; n <= 8; n++) {
          const ep = episode(s, n);
          ep.Id = 'e' + pid + 's' + season + 'e' + n;
          ep.ParentIndexNumber = season;
          ep.IndexNumber = n;
          ep.SeasonId = pid + 'x' + season;
          ep.SeasonName = 'Season ' + season;
          if (n === 5) ep.CriticRating = 62 + season * 10;
          else if (n !== 8) ep.CommunityRating = Math.round((6 + ((season + n) % 4) * 0.8) * 10) / 10;
          items.push(ep);
        }
      }
      return json(res, { Items: items, TotalRecordCount: items.length });
    }
    if (/^s\d+$/.test(pid)) return json(res, { Items: [1, 2, 3].map(n => ({ Id: pid + 'x' + n, Name: 'Season ' + n, Type: 'Season', IndexNumber: n, SeriesId: pid, RecursiveItemCount: 8, ImageTags: { Primary: 'p' }, UserData: { UnplayedItemCount: 8 } })) });
    if (/x\d+$/.test(pid)) {
      const s = all.get(pid.split('x')[0]);
      return json(res, { Items: [1, 2, 3, 4, 5, 6, 7, 8].map(n => episode(s, n)) });
    }
    const list = pid === 'lib-s' ? shows : movies;
    const start = Number(q.get('StartIndex') || 0);
    const lim = Number(q.get('Limit') || 100);
    return json(res, { Items: list.slice(start, start + lim), TotalRecordCount: list.length });
  }
  if ((m = new RegExp('^/Users/' + U + '/Items/([^/]+)$').exec(p))) {
    const it = all.get(m[1]);
    if (!it) { res.writeHead(404); res.end(); return; }
    return json(res, Object.assign({}, it, it.Type === 'Movie' ? { MediaSources: sources(it.Id), Taglines: ['Some ships never left port.'] } : {}));
  }
  if (p.startsWith('/MediaSegments') || /ThemeSongs|Similar|SpecialFeatures|LocalTrailers/.test(p)) return json(res, { Items: [] });
  if (p.startsWith('/Sessions') || p.startsWith('/Users/' + U + '/PlayingItems')) { res.writeHead(204); res.end(); return; }

  const f = fileFor(p);
  if (f) {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).slice(1)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(f));
    return;
  }
  if (/^\/(Users|Shows|Items|Videos|Audio|Genres|Persons)/.test(p)) return json(res, { Items: [] });
  res.writeHead(404);
  res.end();
}).listen(PORT, '127.0.0.1', function () {
  process.stdout.write('MOCK http://127.0.0.1:' + this.address().port + '\n');
});
