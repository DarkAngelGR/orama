import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = {};
globalThis.localStorage = new Map();
localStorage.getItem = key => localStorage.get(key) ?? null;
localStorage.setItem = (key, value) => localStorage.set(key, value);
localStorage.removeItem = key => localStorage.delete(key);

const {
  playbackMode, audioDirectOk, resumeAt, openIsStale, nextSeekCount, seekStepMs, clampSeek,
  markerAt, isFinalCredits, skipTarget, chosenMedia, preloadedUsable, matchTextTrack,
  replacementSub, nextSubtitle, togetherNeedsSeek, isEmbeddedText, isSidecarText,
} = await import('../app/js/player/decide.js');
const { set: storeSet } = await import('../app/js/util/store.js');

const original = { id: 'original' };
const capped = { id: '1080p-8', kbps: 8000 };
const file = {
  container: 'mkv', videoCodec: 'hevc',
  Part: [{ Stream: [{ streamType: 1, codec: 'hevc' }] }],
};
const aac = { id: 1, codec: 'aac' };
const dts = { id: 2, codec: 'dca' };
const srt = { id: 10, codec: 'srt', index: 0, languageCode: 'eng' };
const ass = { id: 11, codec: 'ass', key: '/lib/sub.ass', languageCode: 'eng' };
const pgs = { id: 12, codec: 'pgs', index: 1 };

function mode(over) {
  return playbackMode(Object.assign({ quality: original, media: file, audio: aac, sub: null, forced: false, refused: false }, over));
}

test('direct play when the TV can decode the file, and transcode otherwise', () => {
  assert.equal(mode(), 'direct');
  assert.equal(mode({ audio: null, sub: null }), 'direct');
  assert.equal(mode({ audio: { codec: 'AAC' } }), 'direct');
  assert.equal(mode({ sub: srt }), 'direct');
  assert.equal(mode({ sub: ass }), 'direct');
  assert.equal(isEmbeddedText(srt), true);
  assert.equal(isSidecarText(ass), true);

  assert.equal(mode({ quality: capped }), 'hls');
  assert.equal(mode({ quality: capped, forced: true }), 'hls');
  assert.equal(mode({ media: { ...file, container: 'iso' } }), 'hls');
  assert.equal(mode({ media: { ...file, videoCodec: 'HEVC' } }), 'hls');
  assert.equal(mode({ audio: dts }), 'hls');
  assert.equal(audioDirectOk(null), true);
  assert.equal(audioDirectOk(dts), false);
  assert.equal(mode({ sub: pgs }), 'hls');
  assert.equal(mode({ sub: { codec: 'SRT', index: 0 } }), 'hls');
  assert.equal(mode({ refused: true }), 'hls');
  assert.equal(mode({ forced: true, audio: dts, sub: pgs }), 'direct');
  assert.equal(mode({ forced: true, refused: true }), 'direct');
});

test('Dolby Vision without an HDR base is converted even when direct play is forced', () => {
  const dv = {
    ...file,
    Part: [{ Stream: [{ streamType: 1, DOVIPresent: true, DOVIProfile: 5 }] }],
  };
  const hdr = {
    ...file,
    Part: [{ Stream: [{ streamType: 1, DOVIPresent: true, DOVIProfile: 8, DOVIBLCompatID: '1' }] }],
  };
  assert.equal(mode({ media: dv }), 'hls');
  assert.equal(mode({ media: dv, forced: true }), 'hls');
  assert.equal(mode({ media: hdr }), 'direct');
  storeSet('audioExtras', 'all');
  try {
    assert.equal(audioDirectOk(dts), true);
    assert.equal(mode({ audio: dts }), 'direct');
  } finally {
    storeSet('audioExtras', undefined);
  }
});

test('resume uses the server offset only when the caller did not choose one', () => {
  assert.equal(resumeAt(null, 5000), 5000);
  assert.equal(resumeAt(undefined, 5000), 5000);
  assert.equal(resumeAt(0, 5000), 0);
  assert.equal(resumeAt(1200, 5000), 1200);
  assert.equal(resumeAt(null, 0), 0);
  assert.equal(resumeAt(null, undefined), 0);
});

test('a newer open or a closed player drops the late result', () => {
  assert.equal(openIsStale(true, 3, 3), false);
  assert.equal(openIsStale(true, 2, 3), true);
  assert.equal(openIsStale(false, 3, 3), true);
  assert.equal(openIsStale(false, 1, 2), true);
});

test('seek steps grow while the key is held and stop short of the end', () => {
  assert.equal(nextSeekCount(0, 1000, 1699), 1);
  assert.equal(nextSeekCount(4, 1000, 1700), 0);
  assert.deepEqual([0, 2, 3, 7, 8, 15, 16].map(n => seekStepMs(n, false)), [10000, 10000, 30000, 30000, 60000, 60000, 180000]);
  assert.deepEqual([0, 3, 4, 11, 12].map(n => seekStepMs(n, true)), [30000, 30000, 60000, 60000, 180000]);
  assert.equal(clampSeek(0, -1, 10000, 100000), 0);
  assert.equal(clampSeek(50000, 1, 10000, 100000), 60000);
  assert.equal(clampSeek(90000, 1, 30000, 100000), 97000);
  assert.equal(clampSeek(0, 1, 10000, 2000), 0);
  assert.equal(clampSeek(1000, -1, 10000, 0), 0);
});

test('intro and credits markers, including the one that ends the episode', () => {
  const intro = { type: 'intro', startTimeOffset: 1000, endTimeOffset: 20000 };
  const credits = { type: 'credits', startTimeOffset: 500000, endTimeOffset: 590000 };
  const markers = [intro, credits];
  assert.equal(markerAt(markers, 1000), intro);
  assert.equal(markerAt(markers, 18999), intro);
  assert.equal(markerAt(markers, 19000), null);
  assert.equal(markerAt(markers, 999), null);
  assert.equal(markerAt([], 1000), null);
  assert.equal(isFinalCredits(credits, 600000), true);
  assert.equal(isFinalCredits({ type: 'credits', final: true, endTimeOffset: 1000 }, 600000), true);
  assert.equal(isFinalCredits({ type: 'credits', endTimeOffset: 100000 }, 600000), false);
  assert.equal(isFinalCredits(intro, 600000), false);
  assert.equal(skipTarget(credits, 600000), 590000);
  assert.equal(skipTarget({ endTimeOffset: 599000 }, 600000), 597000);
  assert.equal(skipTarget({ endTimeOffset: 1000 }, 600000), 1000);
});

test('version, resume-from-cache, and subtitle track choice', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  assert.deepEqual(chosenMedia([a, b], 1, 0), { media: b, index: 1 });
  assert.deepEqual(chosenMedia([a, b], null, 1), { media: b, index: 1 });
  assert.deepEqual(chosenMedia([a, b], 9, 0), { media: a, index: 0 });
  assert.deepEqual(chosenMedia([], 0, 0), { media: null, index: 0 });
  assert.deepEqual(chosenMedia(null, null, 0), { media: null, index: 0 });

  const loaded = { ratingKey: '1', _at: 1000, Media: [{ Part: [{}] }] };
  assert.equal(preloadedUsable(loaded, '1', 1000 + 119999), true);
  assert.equal(preloadedUsable(loaded, '1', 1000 + 120000), false);
  assert.equal(preloadedUsable(loaded, '2', 1000), false);
  assert.equal(preloadedUsable({ ratingKey: '1', _at: 1000, Media: [{}] }, '1', 1000), false);
  assert.equal(preloadedUsable(null, '1', 1000), false);

  const en = { id: 1, codec: 'srt', index: 0, languageCode: 'eng' };
  const en2 = { id: 2, codec: 'srt', index: 1, languageCode: 'en' };
  const el = { id: 3, codec: 'srt', index: 2, key: '/el.srt', languageCode: 'ell' };
  assert.equal(matchTextTrack(
    [{ index: 7, lang: 'eng' }, { index: 8, lang: 'en' }, { index: 9, lang: 'ell' }],
    [en, en2, el], en2,
  ).index, 8);
  assert.equal(matchTextTrack([{ index: 4 }, { index: 5 }], [en, el], el).index, 5);
  assert.equal(matchTextTrack([{ index: 4 }], [en, el], el).index, null);
  const image = { id: 9, codec: 'pgs', index: 0 };
  assert.equal(matchTextTrack([], [image, en], en, [3, 4]).index, 3);
  assert.equal(matchTextTrack([], [image], image, [3]).index, null);
  assert.equal(matchTextTrack([], [], en, []).index, null);

  const ext = { id: 4, codec: 'srt', key: '/a.srt', languageCode: 'eng', forced: false };
  assert.equal(replacementSub([en, ext], { languageCode: 'en', forced: false }), ext);
  assert.equal(replacementSub([en], { languageCode: 'en', forced: true }), en);
  assert.equal(replacementSub([el], { languageCode: 'ja' }), null);

  assert.equal(nextSubtitle([en, el], en, null), null);
  assert.equal(nextSubtitle([en, el], null, el), el);
  assert.equal(nextSubtitle([en], null, el), en);
  assert.equal(nextSubtitle([{ id: 1 }, { id: 2, selected: true }], null, null).id, 2);
  assert.equal(nextSubtitle([], null, null), null);
});

test('Watch Together jumps only when the friend is far enough', () => {
  assert.equal(togetherNeedsSeek(10000, { positionMs: 10000, seek: true }), false);
  assert.equal(togetherNeedsSeek(0, { positionMs: 1500, seek: true }), false);
  assert.equal(togetherNeedsSeek(0, { positionMs: 1501, seek: true }), true);
  assert.equal(togetherNeedsSeek(0, { positionMs: 2000, paused: true }), false);
  assert.equal(togetherNeedsSeek(0, { positionMs: 2001, paused: true }), true);
  assert.equal(togetherNeedsSeek(4000, { positionMs: 0 }), true);
  assert.equal(togetherNeedsSeek(3900, { positionMs: 0 }), false);
  assert.equal(togetherNeedsSeek(0, { positionMs: 1750 }), true);
  assert.equal(togetherNeedsSeek(0, { positionMs: 1749 }), false);
});
