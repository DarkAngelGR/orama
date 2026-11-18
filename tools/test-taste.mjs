import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.localStorage = new Map();
globalThis.window = {};
globalThis.document = { documentElement: {}, addEventListener() {} };
localStorage.getItem = key => localStorage.get(key) ?? null;
localStorage.setItem = (key, value) => localStorage.set(key, value);
localStorage.removeItem = key => localStorage.delete(key);

const taste = await import('../app/js/util/taste.js');

const now = Date.UTC(2026, 10, 18);
const day = 86400000;
const profile = 'plex:server:user';
const dark = { ratingKey: '1', title: 'Dark', type: 'show', Genre: [{ tag: 'Mystery' }] };
const severance = { ratingKey: '2', title: 'Severance', type: 'show', audienceRating: 9, Genre: [{ tag: 'Mystery' }] };
const arrival = { ratingKey: '3', title: 'Arrival', type: 'movie', Genre: [{ tag: 'Drama' }] };
const mystery = { ratingKey: '4', title: 'The Fall', type: 'show', Genre: [{ tag: 'Mystery' }] };
const drama = { ratingKey: '5', title: 'Past Lives', type: 'movie', Genre: [{ tag: 'Drama' }] };

test('keeps one completion per title and isolates history by viewer and server', () => {
  assert.ok(taste.recordCompletion, 'provide title-level taste recording');
  const alpha = taste.profileKey({ uuid: 'alpha' }, { id: 'server' });
  const beta = taste.profileKey({ uuid: 'beta' }, { id: 'server' });
  const secondServer = taste.profileKey({ uuid: 'alpha' }, { id: 'server-2' });
  taste.recordCompletion(alpha, dark, now);
  taste.recordCompletion(alpha, dark, now + day);
  assert.deepEqual(taste.readTaste(alpha).map(({ id, completedAt }) => [id, completedAt]), [['1', now + day]]);
  assert.deepEqual(taste.readTaste(beta), []);
  assert.deepEqual(taste.readTaste(secondServer), []);
  taste.resetTaste(alpha);
  assert.deepEqual(taste.readTaste(alpha), []);
});

test('ranks recent tastes and gives explicit preference more weight', () => {
  assert.ok(taste.rankLibraryCandidates, 'provide taste ranking');
  taste.resetTaste(profile);
  taste.recordCompletion(profile, arrival, now - 60 * day);
  taste.recordCompletion(profile, dark, now);
  const rank = seed => taste.rankLibraryCandidates(taste.readTaste(profile), seed, [drama, mystery, severance], now);
  assert.deepEqual(rank(dark).map(p => p.item.ratingKey), ['2', '4', '5']);
  assert.equal(rank(dark)[0].reason, 'Because you watched Dark');
  taste.setFeedback(profile, arrival, 'more');
  taste.setFeedback(profile, mystery, 'less');
  assert.deepEqual(rank(null).map(p => p.item.ratingKey), ['5', '2']);
});

test('excludes plays in progress, finished movies, started shows, and the seed', () => {
  assert.ok(taste.rankLibraryCandidates, 'provide library eligibility filtering');
  const candidates = [dark, { ...severance, viewedLeafCount: 1 }, { ...arrival, viewCount: 1 },
    { ...mystery, viewOffset: 45000 }, drama];
  assert.deepEqual(taste.rankLibraryCandidates([], dark, candidates, now).map(p => p.item.ratingKey), []);
  assert.deepEqual(taste.rankLibraryCandidates([], dark, [], now), []);
});

test('matches genres from Plex, Jellyfin, and Discover across spelling and grouping', () => {
  const key = 'cross-provider';
  taste.recordCompletion(key, { ...dark, Genre: [{ tag: 'Sci-Fi & Fantasy' }] }, now);
  const candidate = { ...arrival, Genre: [{ tag: 'Science Fiction' }] };
  assert.equal(taste.rankLibraryCandidates(taste.readTaste(key), null, [candidate], now)[0]?.item.title, 'Arrival');
});

test('accepts only distinct AI picks from the shortlist and fills missing picks locally', () => {
  assert.ok(taste.applyRanking, 'provide AI shortlist validation');
  const local = [dark, arrival, drama].map(item => ({ item, reason: 'Local' }));
  const remote = [{ id: '3', reason: 'A fresh pick' }, { id: 'unknown', reason: 'Invented' },
    { id: '3', reason: 'Duplicate' }];
  const picks = taste.applyRanking(local, remote);
  assert.deepEqual(picks.map(p => p.item.ratingKey), ['3', '1', '5']);
  assert.equal(picks[0].reason, 'A fresh pick');
});

test('opens the tile menu for a Jellyfin library item with a nonnumeric ID', async () => {
  const { libraryItem } = await import('../app/js/screens/home.js');
  assert.ok(libraryItem, 'provide a shared tile-menu eligibility check');
  assert.equal(libraryItem({ ratingKey: '31a4db67fd6b', jellyfin: true }), true);
  assert.equal(libraryItem({ ratingKey: '31a4db67fd6b', jellyfin: true, catalog: true }), false);
});

test('discards pending recommendations when the viewer changes', async () => {
  const { session } = await import('../app/js/session.js');
  const { prepareRecommendations } = await import('../app/js/plex/recommendations.js');
  let serve;
  session.server = { id: 'lib', smartSearch: () => new Promise(resolve => { serve = resolve; }) };
  session.user = { uuid: 'alex' };
  const pending = prepareRecommendations(dark);
  session.user = { uuid: 'sam' };
  serve([severance]);
  assert.deepEqual(await pending.picks(), []);
});

test('keeps local picks usable while an opted-in model is pending or unavailable', async () => {
  const { session } = await import('../app/js/session.js');
  const { activeTasteKey, prepareRecommendations, setAiTaste } = await import('../app/js/plex/recommendations.js');
  const { setManualUrl } = await import('../app/js/plex/watchlist.js');
  const originalFetch = globalThis.fetch;
  session.server = { id: 'fallback-library', smartSearch: async () => [mystery, severance] };
  session.user = { uuid: 'opted-in' };
  setManualUrl('http://localhost:8789');
  let rejectModel;
  const requests = [];
  globalThis.fetch = (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Promise((resolve, reject) => { rejectModel = reject; });
  };
  try {
    assert.equal((await prepareRecommendations(dark).picks({ waitForAI: true }))[0].item.title, 'Severance');
    assert.equal(requests.length, 0);
    setAiTaste(activeTasteKey(), true);
    const pending = prepareRecommendations(dark);
    const local = await pending.picks();
    assert.equal(local[0].item.title, 'Severance');
    assert.equal(requests[0].url, 'http://localhost:8789/api/tv/recommend');
    assert.deepEqual(requests[0].body.candidates.map(x => x.id), ['2', '4']);
    rejectModel(new Error('provider offline'));
    assert.deepEqual(await pending.picks({ waitForAI: true }), local);
  } finally {
    globalThis.fetch = originalFetch;
    setManualUrl('');
  }
});

test('refreshes local candidates and excludes the parent of a resumed episode', async () => {
  const { session } = await import('../app/js/session.js');
  const { prepareRecommendations } = await import('../app/js/plex/recommendations.js');
  let candidates = [mystery, severance];
  session.server = { id: 'progress-library', smartSearch: async () => candidates };
  session.user = { uuid: 'progress' };
  const hubs = [{ hubIdentifier: 'home.continue', Metadata: [{ type: 'episode', grandparentRatingKey: '2' }] }];
  assert.deepEqual((await prepareRecommendations(dark, hubs).picks()).map(p => p.item.ratingKey), ['4']);
  candidates = [{ ...mystery, viewedLeafCount: 1 }, severance];
  assert.deepEqual(await prepareRecommendations(dark, hubs).picks(), []);
});

test('invalidates ranking before transmission and after the provider replies when taste is reset', async () => {
  const { session } = await import('../app/js/session.js');
  const { activeTasteKey, prepareRecommendations, setAiTaste } = await import('../app/js/plex/recommendations.js');
  const { setManualUrl } = await import('../app/js/plex/watchlist.js');
  const originalFetch = globalThis.fetch;
  session.user = { uuid: 'reset-user' };
  setManualUrl('http://localhost:8789');
  try {
    let serve;
    let send;
    let sends = 0;
    session.server = { id: 'reset-library', smartSearch: () => new Promise(resolve => { serve = resolve; }) };
    const key = activeTasteKey();
    setAiTaste(key, true);
    globalThis.fetch = () => {
      sends++;
      return new Promise(resolve => { send = resolve; });
    };
    const pendingSearch = prepareRecommendations(dark);
    taste.resetTaste(key);
    serve([mystery, severance]);
    assert.deepEqual(await pendingSearch.picks(), []);
    assert.equal(sends, 0);

    session.server.smartSearch = async () => [mystery, severance];
    const pendingModel = prepareRecommendations(dark);
    assert.equal((await pendingModel.picks()).length, 2);
    assert.equal(sends, 1);
    taste.resetTaste(key);
    send(new Response(JSON.stringify({ picks: [{ id: '4', reason: 'A model suggestion' }] })));
    assert.deepEqual(await pendingModel.picks({ waitForAI: true }), []);
  } finally {
    globalThis.fetch = originalFetch;
    setManualUrl('');
  }
});

test('ranks past a missing candidate and a hub list that is not a list', async () => {
  const { session } = await import('../app/js/session.js');
  const { prepareRecommendations } = await import('../app/js/plex/recommendations.js');
  session.server = { id: 'broken-hubs', smartSearch: async () => [null, mystery], hubs: async () => null };
  session.user = { uuid: 'broken-hubs' };
  const picks = await prepareRecommendations(dark).picks();
  assert.deepEqual(picks.map(p => p.item.ratingKey), ['4']);
  assert.deepEqual(taste.rankLibraryCandidates([], dark, [null, mystery], now).map(p => p.item.title), ['The Fall']);
});
