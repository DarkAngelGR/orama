// Thin wrapper over the Tizen / Samsung web APIs, with webOS and desktop-browser
// fallbacks so the UI can also be developed in Chrome.
import { warn } from '../util/log.js';

export const isTizen = typeof window.tizen !== 'undefined';

// LG TVs expose PalmSystem in a packaged app, window.webOS when that library
// is present, and "Web0S" (a zero) in the user agent.
export function isWebOS() {
  try {
    if (window.webOS || window.PalmSystem) return true;
  } catch (e) {}
  return /web0s/i.test(userAgent());
}

function userAgent() {
  try {
    if (window.navigator && window.navigator.userAgent) return String(window.navigator.userAgent);
  } catch (e) {}
  try { return String(navigator.userAgent || ''); } catch (e) { return ''; }
}

// keyCode → action. Desktop keys mirror the remote for development in a browser.
// 461 is Back on an LG remote. 33/34 are Channel Up/Down there and Page Up/Down
// on a keyboard; both mean the same page jump Samsung's channel keys already do.
const KEYMAP = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  10009: 'back', 461: 'back', 8: 'back', 27: 'back',
  10252: 'playpause', 32: 'playpause', 415: 'play', 19: 'pause', 413: 'stop',
  417: 'ff', 412: 'rw', 10232: 'prev', 10233: 'next', 427: 'pageup', 428: 'pagedown', 33: 'pageup', 34: 'pagedown',
  403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 457: 'info', 10073: 'info',
};

export function actionFor(e) {
  return KEYMAP[e.keyCode] || null;
}

export function registerKeys() {
  // webOS delivers media keys on its own; it has no registerKey.
  if (!isTizen) return;
  const keys = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward',
    'MediaRewind', 'MediaTrackPrevious', 'MediaTrackNext', 'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow',
    'ColorF3Blue', 'Info'];
  for (const k of keys) {
    try { tizen.tvinputdevice.registerKey(k); } catch (e) { warn('registerKey failed', k); }
  }
}

export function exitApp() {
  if (isWebOS()) {
    try {
      if (window.webOS && typeof window.webOS.platformBack === 'function') {
        window.webOS.platformBack();
        return;
      }
    } catch (e) {}
    try { window.close(); } catch (e) {}
    return;
  }
  try { tizen.application.getCurrentApplication().exit(); } catch (e) { window.close(); }
}

// Latest webOS.deviceInfo payload. The call is async; PalmSystem.deviceInfo is
// the synchronous copy used on the same turn, and it wins when both exist.
let webosAsync = null;

function readPalmDevice() {
  try {
    const raw = window.PalmSystem && window.PalmSystem.deviceInfo;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) { return null; }
}

function webosInfo() {
  try {
    if (window.webOS && typeof window.webOS.deviceInfo === 'function') {
      window.webOS.deviceInfo(info => {
        if (info && typeof info === 'object') webosAsync = info;
      });
    }
  } catch (e) {}
  return Object.assign({}, webosAsync || {}, readPalmDevice() || {});
}

function modelFromUA() {
  const ua = userAgent();
  const named = ua.match(/\b(OLED\w+|NANO\w+|QNED\w+|LM-\w+)\b/i);
  return named ? named[1] : '';
}

export function deviceInfo() {
  if (isWebOS()) {
    const info = webosInfo();
    const model = info.modelNameAscii || info.modelName || modelFromUA() || 'LG TV';
    const version = info.version || info.sdkVersion || '';
    // PMS has a built-in "webOS" profile (the official app) that may reject
    // transcode requests the way "Tizen" does; "LG" gets the generic profile
    // plus our own X-Plex-Client-Profile-Extra.
    return {
      model: String(model),
      name: 'LG ' + model,
      platform: 'LG',
      platformVersion: version ? String(version) : '5.0',
    };
  }
  let model = 'Browser';
  let name = 'Orama';
  try { model = webapis.productinfo.getRealModel() || webapis.productinfo.getModel(); } catch (e) {}
  try { name = 'Samsung ' + (webapis.productinfo.getModel() || 'TV'); } catch (e) {}
  // PMS has a built-in "Tizen" profile (the official app) that rejects our
  // transcode requests with 400; "Samsung" gets the generic profile plus our
  // own X-Plex-Client-Profile-Extra.
  return { model, name, platform: isTizen ? 'Samsung' : 'Web' };
}

function flagOn(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

export function supports4K() {
  if (isWebOS()) {
    const info = webosInfo();
    // uhd comes from webOS.deviceInfo / PalmSystem. The app runs at 1920×1080,
    // so screen.width is the page size and often not the panel; only trust a
    // size that is actually UHD. Otherwise false.
    if (flagOn(info.uhd) || flagOn(info.uhd8K)) return true;
    const w = Number(info.screenWidth || 0);
    const h = Number(info.screenHeight || 0);
    if (w >= 3840 || h >= 2160) return true;
    try {
      if (typeof screen !== 'undefined' && (Number(screen.width) >= 3840 || Number(screen.height) >= 2160)) return true;
    } catch (e) {}
    return false;
  }
  try { return webapis.productinfo.isUdPanelSupported(); } catch (e) { return false; }
}

// Keep the screen saver from kicking in during playback.
// webOS does this itself while a <video> element is playing.
export function setScreenSaver(on) {
  if (isWebOS()) return;
  try {
    webapis.appcommon.setScreenSaver(on ? webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON
      : webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
  } catch (e) {}
}
