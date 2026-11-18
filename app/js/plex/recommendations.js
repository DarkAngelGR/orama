import { session } from '../session.js';
import * as store from '../util/store.js';
import { applyRanking, profileKey, rankLibraryCandidates, readTaste, tasteResetRevision, tasteTitle, topTasteGenres } from '../util/taste.js';
import { baseUrl, recommend } from './watchlist.js';

export function activeTasteKey() {
  return profileKey(session.user, session.server);
}

export function aiTasteEnabled(key) {
  return !!key && store.get('tasteAi:' + key, false);
}

export function setAiTaste(key, enabled) {
  if (key) store.set('tasteAi:' + key, enabled || undefined);
}

let rankingCache;

export function prepareRecommendations(seed = null, hubs = null) {
  const server = session.server;
  const key = activeTasteKey();
  const reset = tasteResetRevision();
  const current = () => !!key && server === session.server && key === activeTasteKey() && reset === tasteResetRevision();
  const profile = readTaste(key);
  const genres = topTasteGenres(profile);
  const searchGenres = [...new Set((seed ? tasteTitle(seed).genres : []).concat(genres))].slice(0, 3);
  const companion = aiTasteEnabled(key) ? baseUrl() : '';

  let ranked;
  let pendingAI;
  const searches = current() ? searchGenres.map(async genre => {
    try {
      const items = await server.smartSearch({ genres: [[genre]], watched: false, limit: 30 });
      return items.map(it => it.Genre && it.Genre.length ? it : { ...it, Genre: [{ tag: genre }] });
    } catch (e) {
      return [];
    }
  }) : [];
  const resumeHubs = hubs || (searches.length && server.hubs ? server.hubs().catch(() => []) : []);
  const available = Promise.all([Promise.all(searches), resumeHubs]).then(([pools, home]) => {
    if (!current()) return [];
    const inProgress = new Set();
    for (const hub of home) {
      if (!/continue|ondeck/i.test(hub.hubIdentifier || '')) continue;
      for (const item of (hub.Metadata || [])) {
        const id = item.type === 'episode' ? item.grandparentRatingKey : item.ratingKey;
        if (id) inProgress.add(String(id));
      }
    }
    const candidates = [].concat(...pools).filter(item => !inProgress.has(String(item.ratingKey)));
    const local = rankLibraryCandidates(profile, seed, candidates).slice(0, 24);
    if (companion && local.length > 1 && aiTasteEnabled(key) && companion === baseUrl()) {
      const input = {
        taste: { genres: genres.slice(0, 8) },
        seed: seed ? tasteTitle(seed) : null,
        candidates: local.map(pick => tasteTitle(pick.item)),
      };
      const signature = JSON.stringify([key, reset, companion, profile, input]);
      if (!rankingCache || rankingCache.signature !== signature || Date.now() - rankingCache.at >= 120000) {
        const promise = recommend(input).then(data => data.picks).catch(() => null);
        rankingCache = { signature, at: Date.now(), promise };
      }
      pendingAI = rankingCache.promise.then(picks => {
        if (current()) ranked = applyRanking(local, picks);
      });
    }
    return local;
  });
  return {
    async picks({ waitForAI = false } = {}) {
      const local = await available;
      if (waitForAI && pendingAI) await pendingAI;
      return current() ? (aiTasteEnabled(key) && ranked || local) : [];
    },
  };
}
