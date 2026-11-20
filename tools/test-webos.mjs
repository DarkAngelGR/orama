import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = { navigator: { userAgent: 'Mozilla/5.0' } };
globalThis.localStorage = new Map();
localStorage.getItem = key => localStorage.get(key) ?? null;
localStorage.setItem = (key, value) => localStorage.set(key, value);
localStorage.removeItem = key => localStorage.delete(key);
globalThis.document = { createElement() { return {}; } };
globalThis.screen = { width: 1920, height: 1080 };

const { actionFor, isWebOS, isTizen, deviceInfo, supports4K } = await import('../app/js/platform/tizen.js');
const { playbackMode } = await import('../app/js/player/decide.js');
const {
  SAMSUNG_PROFILE_EXTRA, plexProfileExtra, jellyfinTranscodeCodecs, lgVideoCodecs, webosDirect,
} = await import('../app/js/player/caps.js');

function asBrowser() {
  window.webOS = undefined;
  window.PalmSystem = undefined;
  window.navigator = { userAgent: 'Mozilla/5.0' };
  delete globalThis.MediaSource;
  document.createElement = () => ({});
}

function asWebOS(extra) {
  window.PalmSystem = undefined;
  window.webOS = extra || {};
  window.navigator = { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0.3440.106' };
}

const original = { id: 'original' };
const file = {
  container: 'mkv', videoCodec: 'hevc',
  Part: [{ Stream: [{ streamType: 1, codec: 'hevc' }] }],
};

function mode(over) {
  return playbackMode(Object.assign({
    quality: original, media: file, audio: { codec: 'aac' }, sub: null, forced: false, refused: false,
  }, over));
}

test('LG remote keys map onto the same actions as the Samsung remote', () => {
  assert.equal(actionFor({ keyCode: 461 }), 'back');
  assert.equal(actionFor({ keyCode: 10009 }), 'back');
  assert.equal(actionFor({ keyCode: 415 }), 'play');
  assert.equal(actionFor({ keyCode: 19 }), 'pause');
  assert.equal(actionFor({ keyCode: 413 }), 'stop');
  assert.equal(actionFor({ keyCode: 417 }), 'ff');
  assert.equal(actionFor({ keyCode: 412 }), 'rw');
  assert.equal(actionFor({ keyCode: 403 }), 'red');
  assert.equal(actionFor({ keyCode: 404 }), 'green');
  assert.equal(actionFor({ keyCode: 405 }), 'yellow');
  assert.equal(actionFor({ keyCode: 406 }), 'blue');
  // Channel up/down on LG (33/34). Page up/down on a keyboard. Same actions.
  assert.equal(actionFor({ keyCode: 33 }), 'pageup');
  assert.equal(actionFor({ keyCode: 34 }), 'pagedown');
  assert.equal(actionFor({ keyCode: 457 }), 'info');
  assert.equal(actionFor({ keyCode: 999 }), null);
});

test('webOS is detected from webOS, PalmSystem or the Web0S user agent, and reported as LG', () => {
  asBrowser();
  assert.equal(isWebOS(), false);
  assert.equal(isTizen, false);
  assert.equal(deviceInfo().platform, 'Web');

  asWebOS();
  assert.equal(isWebOS(), true);
  assert.equal(deviceInfo().platform, 'LG');
  assert.notEqual(deviceInfo().platform, 'webOS');
  assert.equal(supports4K(), false);

  window.webOS = undefined;
  window.PalmSystem = undefined;
  window.navigator = { userAgent: 'Mozilla/5.0 (Web0S) Chrome/68.0' };
  assert.equal(isWebOS(), true);

  window.navigator = { userAgent: 'Mozilla/5.0' };
  window.PalmSystem = {};
  assert.equal(isWebOS(), true);

  asWebOS({
    deviceInfo(cb) {
      cb({ modelNameAscii: 'OLED55C1', version: '5.4.0', uhd: true, screenWidth: 1920, screenHeight: 1080 });
    },
  });
  const info = deviceInfo();
  assert.equal(info.platform, 'LG');
  assert.equal(info.model, 'OLED55C1');
  assert.equal(info.name, 'LG OLED55C1');
  assert.equal(info.platformVersion, '5.4.0');
  assert.equal(supports4K(), true);

  // PalmSystem is synchronous and wins over an older callback. No uhd flag and
  // a 1080p size means not 4K.
  window.PalmSystem = { deviceInfo: JSON.stringify({ modelName: 'HE_DTV', screenWidth: 1920, screenHeight: 1080 }) };
  window.webOS = { deviceInfo(cb) { cb({}); } };
  assert.equal(deviceInfo().model, 'HE_DTV');
  assert.equal(supports4K(), false);

  screen.width = 3840;
  screen.height = 2160;
  assert.equal(supports4K(), true);
  screen.width = 1920;
  screen.height = 1080;
  asBrowser();
});

test('Samsung codec lists stay byte-identical and webOS uses its own', () => {
  asBrowser();
  const samsungExtra = [
    'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264,hevc&audioCodec=aac,ac3,eac3)',
    'add-direct-play-profile(type=videoProfile&container=mp4,mkv&videoCodec=h264,hevc&audioCodec=aac,ac3,eac3)',
  ].join('+');
  assert.equal(SAMSUNG_PROFILE_EXTRA, samsungExtra);
  assert.equal(plexProfileExtra(), samsungExtra);
  assert.deepEqual(jellyfinTranscodeCodecs(), { VideoCodec: 'hevc,h264', AudioCodec: 'eac3,ac3,aac' });
  assert.equal(mode(), 'direct');
  assert.equal(mode({ audio: { codec: 'mp2' } }), 'direct');
  assert.equal(mode({ media: { container: 'avi', videoCodec: 'mpeg2video', Part: [{ Stream: [] }] } }), 'direct');
  assert.equal(mode({ audio: { codec: 'dca' } }), 'hls');

  asWebOS();
  delete globalThis.MediaSource;
  document.createElement = () => ({});
  const assumed = lgVideoCodecs();
  assert.equal(assumed.h264, 1);
  assert.equal(assumed.hevc, 1);
  assert.equal(assumed.vp9, 1);
  assert.equal(assumed.av1, 1);
  assert.equal(assumed.mpeg2video, undefined);
  const direct = webosDirect();
  assert.equal(direct.audio.aac, 1);
  assert.equal(direct.audio.flac, 1);
  assert.equal(direct.audio.dts, undefined);
  assert.equal(direct.audio.truehd, undefined);
  assert.equal(direct.container.mkv, 1);
  assert.equal(direct.container.avi, undefined);
  assert.equal(mode(), 'direct');
  assert.equal(mode({ audio: { codec: 'flac' } }), 'direct');
  assert.equal(mode({ audio: { codec: 'mp2' } }), 'hls');
  assert.equal(mode({ audio: { codec: 'dca' } }), 'hls');
  assert.equal(mode({ audio: { codec: 'truehd' } }), 'hls');
  assert.equal(mode({ media: { container: 'avi', videoCodec: 'hevc', Part: [{ Stream: [] }] } }), 'hls');
  assert.equal(mode({ media: { container: 'mkv', videoCodec: 'vp9', Part: [{ Stream: [] }] } }), 'direct');

  document.createElement = () => ({
    canPlayType(type) {
      if (/av01/.test(type)) return '';
      if (/vp9|vp09/.test(type)) return 'probably';
      if (/hvc1|hev1/.test(type)) return 'maybe';
      return '';
    },
  });
  globalThis.MediaSource = { isTypeSupported() { return false; } };
  const probed = lgVideoCodecs();
  assert.equal(probed.h264, 1);
  assert.equal(probed.hevc, 1);
  assert.equal(probed.vp9, 1);
  assert.equal(probed.av1, undefined);
  const extra = plexProfileExtra();
  assert.ok(extra.indexOf('videoCodec=h264,hevc,vp9&') >= 0);
  assert.equal(extra.indexOf('av1'), -1);
  assert.ok(extra.indexOf('audioCodec=aac,mp3,ac3,eac3,opus,flac') >= 0);
  assert.equal(extra.indexOf('dts'), -1);
  assert.equal(extra.indexOf('truehd'), -1);
  assert.equal(jellyfinTranscodeCodecs().VideoCodec, 'h264,hevc,vp9');
  assert.equal(jellyfinTranscodeCodecs().AudioCodec, 'aac,mp3,ac3,eac3,opus,flac');
  assert.equal(mode({ media: { container: 'mkv', videoCodec: 'av1', Part: [{ Stream: [] }] } }), 'hls');
  assert.equal(mode({ media: { container: 'webm', videoCodec: 'vp9', Part: [{ Stream: [] }] } }), 'direct');

  asBrowser();
  assert.equal(plexProfileExtra(), samsungExtra);
});
