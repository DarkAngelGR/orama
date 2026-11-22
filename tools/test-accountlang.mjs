import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readPlexLang, localFromPlex, plexProfileQuery, plexProfileUrl,
  readJellyfinLang, localFromJellyfin, to6392, jellyfinConfigWithLang,
} from '../app/js/plex/accountlang.js';

test('reads Plex languages from the profile bag or the user itself', () => {
  assert.equal(readPlexLang(null), null);
  assert.equal(readPlexLang({ id: 1, username: 'a' }), null);
  const nested = readPlexLang({
    profile: { defaultAudioLanguage: 'eng', defaultSubtitleLanguage: 'ell', autoSelectAudio: true, autoSelectSubtitle: 2 },
  });
  assert.deepEqual(nested, { audio: 'en', sub: 'el', autoAudio: true, autoSub: 2 });
  const flat = readPlexLang({ audioLanguage: 'ja', subtitleMode: 'always' });
  assert.equal(flat.audio, 'ja');
  assert.equal(flat.autoSub, 'always');
  const words = readPlexLang({ settings: { autoSelectSubtitle: '1', autoSelectAudio: 'false' } });
  assert.equal(words.autoSub, 1);
  assert.equal(words.autoAudio, false);
});

test('maps a Plex account onto the TV codes, and back onto the profile query', () => {
  assert.deepEqual(localFromPlex({ audio: 'en', sub: 'el', autoAudio: true, autoSub: 2 }), { audio: 'en', sub: 'el' });
  assert.deepEqual(localFromPlex({ audio: 'en', sub: 'el', autoAudio: false, autoSub: 1 }), { audio: 'auto', sub: 'auto' });
  assert.deepEqual(localFromPlex({ audio: '', sub: '', autoAudio: true, autoSub: 0 }), { audio: 'auto', sub: 'off' });
  assert.deepEqual(localFromPlex({ audio: 'en', sub: '', autoSub: 'always' }), { audio: 'en', sub: 'auto' });
  assert.equal(localFromPlex(null), null);

  assert.deepEqual(plexProfileQuery({ audio: 'en', sub: 'el' }), {
    defaultAudioLanguage: 'en', autoSelectAudio: 1, defaultSubtitleLanguage: 'el', autoSelectSubtitle: 2,
  });
  assert.equal(plexProfileQuery({ audio: 'auto', sub: 'off' }).autoSelectSubtitle, 0);
  assert.equal(plexProfileQuery({ audio: 'auto', sub: 'off' }).defaultSubtitleLanguage, '');
  assert.equal(plexProfileQuery({ sub: 'auto' }).autoSelectSubtitle, 1);
  const url = plexProfileUrl({ audio: 'auto', sub: 'off' });
  assert.ok(url.startsWith('https://clients.plex.tv/api/v2/user/profile?'));
  assert.match(url, /defaultAudioLanguage=/);
  assert.match(url, /defaultSubtitleLanguage=/);
  assert.match(url, /autoSelectSubtitle=0/);
});

test('reads Jellyfin configuration and posts the whole object back', () => {
  assert.equal(readJellyfinLang({ Name: 'A' }), null);
  const read = readJellyfinLang({
    Configuration: { AudioLanguagePreference: 'eng', SubtitleLanguagePreference: 'ell', SubtitleMode: 'Always', PlayDefaultAudioTrack: true },
  });
  assert.deepEqual(read, { audio: 'en', sub: 'el', mode: 'Always' });
  assert.deepEqual(localFromJellyfin(read), { audio: 'en', sub: 'el' });
  assert.deepEqual(localFromJellyfin({ audio: 'en', sub: 'el', mode: 'None' }), { audio: 'en', sub: 'off' });
  assert.deepEqual(localFromJellyfin({ audio: '', sub: 'el', mode: 'Smart' }), { audio: 'auto', sub: 'auto' });

  assert.equal(to6392('en'), 'eng');
  assert.equal(to6392('el'), 'ell');
  assert.equal(to6392('auto'), '');
  assert.equal(jellyfinConfigWithLang(null, { audio: 'en', sub: 'off' }), null);
  assert.equal(jellyfinConfigWithLang(['nope'], {}), null);
  const next = jellyfinConfigWithLang(
    { AudioLanguagePreference: 'jpn', SubtitleMode: 'Default', PlayDefaultAudioTrack: false, Nested: { keep: 1 } },
    { audio: 'en', sub: 'el' },
  );
  assert.equal(next.AudioLanguagePreference, 'eng');
  assert.equal(next.SubtitleLanguagePreference, 'ell');
  assert.equal(next.SubtitleMode, 'Always');
  assert.equal(next.PlayDefaultAudioTrack, false);
  assert.deepEqual(next.Nested, { keep: 1 });
  const off = jellyfinConfigWithLang({ AudioLanguagePreference: 'eng' }, { audio: 'auto', sub: 'off' });
  assert.equal(off.SubtitleMode, 'None');
  assert.equal(off.SubtitleLanguagePreference, '');
  const smart = jellyfinConfigWithLang({ AudioLanguagePreference: 'eng' }, { audio: 'ja', sub: 'auto' });
  assert.equal(smart.SubtitleMode, 'Smart');
  assert.equal(smart.AudioLanguagePreference, 'jpn');
});

globalThis.window = globalThis.window || {};
globalThis.localStorage = globalThis.localStorage || new Map();
if (!localStorage.getItem) {
  localStorage.getItem = key => localStorage.get(key) ?? null;
  localStorage.setItem = (key, value) => localStorage.set(key, value);
  localStorage.removeItem = key => localStorage.delete(key);
}

const { pickTracks } = await import('../app/js/player/tracks.js');
const { session } = await import('../app/js/session.js');
const store = await import('../app/js/util/store.js');

function part() {
  return {
    Stream: [
      { streamType: 2, id: 1, languageCode: 'jpn', codec: 'aac', selected: true },
      { streamType: 2, id: 2, languageCode: 'eng', codec: 'aac' },
      { streamType: 3, id: 3, languageCode: 'ell', codec: 'srt' },
      { streamType: 3, id: 4, languageCode: 'eng', codec: 'srt' },
    ],
  };
}

test('an adopted audio language does not replace Japanese on anime', () => {
  session.user = { uuid: 'viewer-1' };
  store.set('langByProfile', { 'viewer-1': { audio: 'en', sub: 'auto', explicit: false } });
  const anime = { type: 'movie', ratingKey: '9', Genre: [{ tag: 'Anime' }] };
  const picked = pickTracks(anime, part());
  assert.equal(picked.audio.id, 1);
  store.set('langByProfile', { 'viewer-1': { audio: 'en', sub: 'auto', explicit: true } });
  assert.equal(pickTracks(anime, part()).audio.id, 2);
  const drama = { type: 'movie', ratingKey: '8', Genre: [{ tag: 'Drama' }] };
  store.set('langByProfile', { 'viewer-1': { audio: 'en', sub: 'auto', explicit: false } });
  assert.equal(pickTracks(drama, part()).audio.id, 2);
  assert.equal(pickTracks(drama, part(), { langs: { audio: 'ja' } }).audio.id, 1);
});
