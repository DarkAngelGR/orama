// "Lucky Draw": learn the user's taste from what they've watched, then draw an
// unwatched title that fits. Scoring is plain arithmetic over a few hundred
// items, so it costs a few milliseconds even on a TV CPU.

const WATCHED_PER_SECTION = 150;   // most recent watches per library
const POOL_PER_SECTION = 400;      // unwatched candidates per library
const CACHE_MS = 10 * 60 * 1000;
const SHORTLIST = 30;              // the draw happens among the best matches
const TEMPERATURE = 0.35;          // lower = safer picks, higher = more surprise
const WILDCARD = 0.12;             // chance of a well-rated pick outside the usual taste
const WILDCARD_RATING = 7.5;
const DAY = 24 * 60 * 60;

const tags = (item, field, n) => (item[field] || []).slice(0, n).map(t => t.tag).filter(Boolean);
const decade = item => (item.year ? Math.floor(item.year / 10) * 10 : 0);

function isWatched(item) {
  if (item.type === 'show') return (item.viewedLeafCount || 0) > 0;
  return (item.viewCount || 0) > 0 || !!item.lastViewedAt;
}

// --- Loading ---------------------------------------------------------------

async function list(server, section, params) {
  const type = section.type === 'show' ? 2 : 1;
  const mc = await server.get('/library/sections/' + section.key + '/all', Object.assign({
    type, excludeFields: 'summary,tagline', 'X-Plex-Container-Start': 0,
  }, params), { maxAge: CACHE_MS });
  return mc.Metadata || [];
}

// Unwatched titles in a random order where the server supports it, so big
// libraries aren't sampled alphabetically; older servers fall back to newest.
async function unwatched(server, section) {
  const params = { unwatched: 1, 'X-Plex-Container-Size': POOL_PER_SECTION };
  try {
    return await list(server, section, Object.assign({ sort: 'random' }, params));
  } catch (e) {
    return list(server, section, Object.assign({ sort: 'addedAt:desc' }, params));
  }
}

export async function loadPool(server) {
  const sections = await server.sections();
  const per = await Promise.all(sections.map(async s => {
    const [recent, fresh] = await Promise.all([
      list(server, s, { sort: 'lastViewedAt:desc', 'X-Plex-Container-Size': WATCHED_PER_SECTION }),
      unwatched(server, s),
    ]);
    return {
      watched: recent.filter(isWatched),
      // Shows already started live in Continue Watching; keep only fresh ones.
      candidates: fresh.filter(m => !isWatched(m)),
    };
  }));
  return {
    watched: per.flatMap(p => p.watched),
    candidates: per.flatMap(p => p.candidates),
  };
}

// --- Taste profile -----------------------------------------------------------

function bump(map, key, w) {
  if (key) map.set(key, (map.get(key) || 0) + w);
}

// Each watched title votes for its genres, director, lead actors and decade.
// Recent watches and high personal ratings count more; low ratings count less.
export function buildProfile(watched, now = Date.now() / 1000) {
  const p = { genres: new Map(), directors: new Map(), actors: new Map(), decades: new Map(), total: 0, count: watched.length };
  for (const item of watched) {
    let w = 1;
    const age = item.lastViewedAt ? (now - item.lastViewedAt) / DAY : 365;
    if (age < 30) w += 1;
    else if (age < 120) w += 0.5;
    if (item.userRating >= 8) w += 1;
    else if (item.userRating && item.userRating <= 4) w -= 0.75;
    if (w <= 0) continue;
    p.total += w;
    for (const g of tags(item, 'Genre', 4)) bump(p.genres, g, w);
    for (const d of tags(item, 'Director', 2)) bump(p.directors, d, w);
    for (const a of tags(item, 'Role', 3)) bump(p.actors, a, w);
    bump(p.decades, decade(item), w);
  }
  return p;
}

function share(map, key, total) {
  return total ? (map.get(key) || 0) / total : 0;
}

// --- Scoring and the draw ------------------------------------------------------

// How well an unwatched title fits, plus what made it fit (for "why this").
export function score(item, p) {
  const genres = tags(item, 'Genre', 4)
    .map(g => ({ g, s: share(p.genres, g, p.total) }))
    .sort((a, b) => b.s - a.s);
  // The two strongest genre matches carry it; a title isn't punished for
  // also being tagged with a genre the user rarely watches.
  const genreFit = genres.slice(0, 2).reduce((sum, x) => sum + x.s, 0);
  const director = tags(item, 'Director', 2).find(d => p.directors.has(d));
  const actor = tags(item, 'Role', 3).find(a => p.actors.has(a));
  const era = share(p.decades, decade(item), p.total);
  const rating = item.audienceRating || item.rating || 0;
  const quality = rating ? Math.max(0, rating - 5) / 5 : 0.3; // 5→0, 10→1
  const value = (p.total ? 3 * genreFit : 0) + (director ? 1.5 : 0) + (actor ? 0.8 : 0) + 0.6 * era + 1.2 * quality;
  return {
    item, value,
    why: {
      genres: genres.filter(x => x.s >= 0.12).slice(0, 2).map(x => x.g),
      director, actor,
      rating: rating >= 7.5 ? rating : 0,
    },
  };
}

// Weighted random pick among the best matches: usually a strong fit, now and
// then a surprise. `avoid` holds ratingKeys drawn recently.
export function draw(candidates, p, { kind = 'any', avoid = [], random = Math.random } = {}) {
  const skip = new Set(avoid);
  let pool = candidates.filter(c => (kind === 'any' || c.type === kind) && !skip.has(c.ratingKey));
  if (!pool.length) pool = candidates.filter(c => kind === 'any' || c.type === kind);
  if (!pool.length) return null;
  const all = pool.map(c => score(c, p)).sort((a, b) => b.value - a.value);
  const ranked = all.slice(0, SHORTLIST);
  // Now and then, a wildcard: well rated, but outside the shortlist.
  if (p.count && random() < WILDCARD) {
    const wild = all.slice(SHORTLIST).filter(r => (r.item.audienceRating || r.item.rating || 0) >= WILDCARD_RATING);
    if (wild.length) return Object.assign(wild[Math.floor(random() * wild.length)], { wildcard: true });
  }
  const top = ranked[0].value;
  const weights = ranked.map(r => Math.exp((r.value - top) / TEMPERATURE));
  let x = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ranked.length; i++) {
    x -= weights[i];
    if (x <= 0) return ranked[i];
  }
  return ranked[ranked.length - 1];
}

// Short reasons for the pick, most specific first.
export function reasons(pick, p) {
  const out = [];
  if (pick.wildcard) out.push('Wildcard: outside your usual, but well rated');
  else if (!p.count) out.push('Highly rated and new to you');
  if (pick.why.genres.length) out.push('You watch a lot of ' + pick.why.genres.join(' & '));
  if (pick.why.director) out.push('From ' + pick.why.director + ', a director you watch');
  if (pick.why.actor) out.push('With ' + pick.why.actor);
  if (pick.why.rating) out.push('★ ' + Number(pick.why.rating).toFixed(1) + ' audience rating');
  if (!out.length) out.push('Something different from your usual');
  return out.slice(0, 3);
}
