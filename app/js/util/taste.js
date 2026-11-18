import * as store from './store.js';

const DAY = 86400000;
let resetRevision = 0;

export function profileKey(user, server) {
  if (!user || !user.uuid || !server || !server.id) return '';
  return JSON.stringify([server.kind || 'plex', server.id, user.uuid]);
}

export function readTaste(key) {
  return key ? store.get('taste:' + key, []) : [];
}

export function resetTaste(key) {
  if (!key) return;
  store.set('taste:' + key, undefined);
  resetRevision++;
}

export function tasteResetRevision() {
  return resetRevision;
}

export function tasteTitle(item) {
  return {
    id: String(item.ratingKey), title: item.title, kind: item.type, year: Number(item.year) || null,
    genres: Array.from(new Set((item.Genre || []).map(g => g.tag).filter(Boolean))),
  };
}

function updateTitle(key, item, patch) {
  if (!key || !item || !item.ratingKey || !item.title) return;
  const title = tasteTitle(item);
  const history = readTaste(key);
  const previous = history.find(x => x.id === title.id);
  if (previous && !title.genres.length) title.genres = previous.genres;
  const next = Object.assign({}, previous, title, patch);
  store.set('taste:' + key, [next].concat(history.filter(x => x.id !== title.id)).slice(0, 100));
}

export function recordCompletion(key, item, completedAt = Date.now()) {
  updateTitle(key, item, { completedAt });
}

export function setFeedback(key, item, feedback) {
  updateTitle(key, item, { feedback });
}

function genreKeys(genres) {
  const keys = new Map();
  for (const name of genres) {
    for (const part of name.toLowerCase().split(/\s+&\s+/)) {
      const key = /^(science fiction|sci[ -]?fi)$/.test(part) ? 'science fiction' : part;
      keys.set(key, name);
    }
  }
  return keys;
}

function genreScores(profile, now) {
  const scores = new Map();
  for (const title of profile) {
    const age = Math.max(0, now - title.completedAt);
    const completion = title.completedAt ? 1 / (1 + age / (30 * DAY)) : 0;
    const weight = title.feedback === 'more' ? 3 + completion : title.feedback === 'less' ? -0.5 : completion;
    for (const [key, name] of genreKeys(title.genres)) {
      const current = scores.get(key);
      scores.set(key, { name, score: (current ? current.score : 0) + weight });
    }
  }
  return scores;
}

export function topTasteGenres(profile, now = Date.now()) {
  return [...new Set([...genreScores(profile, now).values()].filter(g => g.score > 0)
    .sort((a, b) => b.score - a.score).map(g => g.name))];
}

export function rankLibraryCandidates(profile, seed, candidates, now = Date.now()) {
  const scores = genreScores(profile, now);
  const seedGenres = genreKeys(seed ? tasteTitle(seed).genres : []);
  const excluded = new Set(profile.filter(x => x.completedAt || x.feedback === 'less').map(x => x.id));
  if (seed) excluded.add(String(seed.ratingKey));
  const ranked = [];
  for (const item of candidates) {
    const id = String(item.ratingKey);
    if (!item.ratingKey || excluded.has(id) || item.viewCount > 0 || item.viewOffset > 0 || item.viewedLeafCount > 0) continue;
    if (item.type !== 'movie' && item.type !== 'show') continue;
    excluded.add(id);
    let score = 0;
    let best = null;
    let related = false;
    for (const genre of genreKeys(tasteTitle(item).genres).keys()) {
      const preference = scores.get(genre);
      if (preference) {
        score += preference.score;
        if (preference.score > 0 && (!best || preference.score > best.score)) best = preference;
      }
      if (seedGenres.has(genre)) { score += 2; related = true; }
    }
    if (score <= 0) continue;
    const reason = related ? 'Because you watched ' + seed.title : 'Matches your taste for ' + best.name;
    ranked.push({ item, reason, score });
  }
  return ranked.sort((a, b) => b.score - a.score || (b.item.audienceRating || 0) - (a.item.audienceRating || 0));
}

export function applyRanking(local, remote) {
  if (!Array.isArray(remote)) return local;
  const remaining = new Map(local.map(p => [String(p.item.ratingKey), p]));
  const ranked = [];
  for (const choice of remote.slice(0, 3)) {
    if (!choice || typeof choice.id !== 'string' || typeof choice.reason !== 'string' || !choice.reason.trim()) continue;
    const pick = remaining.get(choice.id);
    if (!pick) continue;
    ranked.push({ item: pick.item, reason: choice.reason.trim().slice(0, 120) });
    remaining.delete(choice.id);
  }
  return ranked.concat([...remaining.values()]);
}
