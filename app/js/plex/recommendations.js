import { session } from '../session.js';
import * as store from '../util/store.js';
import { applyRanking, profileKey, rankLibraryCandidates, readTaste, tasteResetRevision, tasteTitle, topTasteGenres } from '../util/taste.js';
import { baseUrl, discover, info, recommend } from './watchlist.js';
import { acquire, tracked } from './requests.js';
import { matchMedia } from './availability.js';

export function activeTasteKey() {
  return profileKey(session.user, session.server);
}

export function aiTasteEnabled(key) {
  return !!key && store.get('tasteAi:' + key, false);
}

export function setAiTaste(key, enabled) {
  if (key) store.set('tasteAi:' + key, enabled || undefined);
}

const rankingCache = new Map();
let discovery;

function modelRanking(key, reset, companion, profile, seed, local) {
  const input = {
    taste: { genres: topTasteGenres(profile).slice(0, 8) },
    seed: seed ? tasteTitle(seed) : null,
    candidates: local.map(pick => tasteTitle(pick.item)),
  };
  const signature = JSON.stringify([key, reset, companion, profile, input]);
  const hit = rankingCache.get(signature);
  if (hit && Date.now() - hit.at < 120000) return hit.promise;
  const promise = recommend(input).then(data => data.picks).catch(() => null);
  if (rankingCache.size >= 8) rankingCache.delete(rankingCache.keys().next().value);
  rankingCache.set(signature, { at: Date.now(), promise });
  return promise;
}

export function discoverySections() {
  const address = baseUrl();
  if (!address) return Promise.resolve([]);
  if (!discovery || discovery.address !== address || Date.now() - discovery.at >= 120000) {
    const entry = { address, at: Date.now() };
    entry.promise = discover().catch(e => {
      if (discovery === entry) discovery = null;
      throw e;
    });
    discovery = entry;
  }
  return discovery.promise;
}

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
      return (Array.isArray(items) ? items : []).filter(it => it && it.ratingKey).map(it =>
        it.Genre && it.Genre.length ? it : { ...it, Genre: [{ tag: genre }] });
    } catch (e) {
      return [];
    }
  }) : [];
  const resumeHubs = hubs || (searches.length && server.hubs ? server.hubs().catch(() => []) : []);
  const available = Promise.all([Promise.all(searches), resumeHubs]).then(([pools, home]) => {
    if (!current()) return [];
    const inProgress = new Set();
    for (const hub of (Array.isArray(home) ? home : [])) {
      if (!hub || !/continue|ondeck/i.test(hub.hubIdentifier || '')) continue;
      for (const item of (Array.isArray(hub.Metadata) ? hub.Metadata : [])) {
        if (!item) continue;
        const id = item.type === 'episode' ? item.grandparentRatingKey : item.ratingKey;
        if (id) inProgress.add(String(id));
      }
    }
    const candidates = [].concat(...pools).filter(item => item && !inProgress.has(String(item.ratingKey)));
    const local = rankLibraryCandidates(profile, seed, candidates).slice(0, 24);
    if (companion && local.length > 1 && aiTasteEnabled(key) && companion === baseUrl()) {
      pendingAI = modelRanking(key, reset, companion, profile, seed, local).then(picks => {
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

export async function requestablePicks(sections, { seed = null, moviesOnly = false } = {}) {
  const key = activeTasteKey();
  const server = session.server;
  const companion = baseUrl();
  const reset = tasteResetRevision();
  const current = () => !!key && key === activeTasteKey() && server === session.server &&
    companion === baseUrl() && reset === tasteResetRevision();
  const profile = readTaste(key);
  if (!current() || !companion || (!profile.length && !seed)) return [];
  const candidates = [].concat(...(Array.isArray(sections) ? sections : []).map(section =>
    section && Array.isArray(section.items) ? section.items : [])).filter(item =>
    item && item.arrStatus === 'none' && (!moviesOnly || item.type === 'movie') && !tracked(item) &&
    (!seed || matchMedia(seed, item) !== true));
  let ranked = rankLibraryCandidates(profile, seed, candidates).slice(0, 12);
  if (aiTasteEnabled(key) && ranked.length > 1) {
    const picks = await modelRanking(key, reset, companion, profile, seed, ranked);
    if (aiTasteEnabled(key)) ranked = applyRanking(ranked, picks);
  }
  if (!current()) return [];
  const checked = await Promise.all(ranked.slice(0, 9).map(async pick => ({
    ...pick, availability: await server.findPlayable(pick.item, { fresh: moviesOnly }),
  })));
  return current() ? checked.filter(pick => pick.availability.status === 'missing') : [];
}

export function autoFetchEnabled(key) {
  return !!key && store.get('tasteAutoFetch:' + key, false);
}

export function setAutoFetch(key, enabled) {
  if (key) store.set('tasteAutoFetch:' + key, enabled || undefined);
}

export async function fetchAfterCompletion(seed, triggerId, key) {
  const server = session.server;
  const companion = baseUrl();
  const reset = tasteResetRevision();
  const active = () => autoFetchEnabled(key) && key === activeTasteKey() && server === session.server &&
    companion === baseUrl() && reset === tasteResetRevision();
  if (!companion || !active()) return;
  const configuration = await info();
  if (!configuration.auto_fetch || !active()) return;
  const sections = await discoverySections();
  if (!active()) return;
  const picks = await requestablePicks(sections, { seed, moviesOnly: true });
  if (picks.length && active()) {
    await acquire(picks[0].item, { triggerId, allowed: active });
  }
}
