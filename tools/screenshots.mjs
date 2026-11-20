// Home, library and a title page, against tools/mock-jellyfin.mjs.
//
//   node tools/screenshots.mjs            compare with tools/screens-baseline
//   node tools/screenshots.mjs --update   write those pictures instead
//
// Playwright is not a dependency of this repo. Install it somewhere else and
// point PLAYWRIGHT_MODULE at its index.js (the CI workflow does this on Ubuntu).
// Baselines from Windows will not match: the poster font and the WebGL backdrop differ.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, compareRgba, encodePng } from './pngdiff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'tools', 'screens-baseline');
const DIFF = path.join(ROOT, 'tools', 'screens-diff');
const SHOTS = ['1-home', '2-home-next-row', '3-library', '4-library-last-column', '5-detail', '6-detail-options'];
const TOL = 24;
const MAX_FRACTION = 0.005;
const HELP = [
  'Playwright is not installed in this repo. From an empty directory:',
  '  npm init -y && npm install --no-save playwright@1.49.1 && npx playwright install chromium',
  '  PLAYWRIGHT_MODULE=/that/dir/node_modules/playwright/index.js node tools/screenshots.mjs',
].join('\n');

function startMock() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'mock-jellyfin.mjs'), path.join(ROOT, 'app')], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('mock Jellyfin did not start'));
    }, 10000);
    child.stdout.on('data', d => {
      buf += d;
      const m = /MOCK (http:\/\/127\.0\.0\.1:\d+)/.exec(buf);
      if (!m || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, base: m[1] });
    });
    child.on('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('mock Jellyfin exited ' + code));
    });
  });
}

function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_MODULE;
  if (!spec) throw new Error(HELP);
  try {
    return createRequire(import.meta.url)(spec);
  } catch (e) {
    throw new Error(HELP + '\n\n' + (e && e.message));
  }
}

async function press(page, key) {
  await page.keyboard.press(key);
  // input.js applies a key on the next frame, and a second press before that replaces it.
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function saveFailure(page, err) {
  mkdirSync(DIFF, { recursive: true });
  try {
    await page.screenshot({ path: path.join(DIFF, 'failure.png'), animations: 'disabled', caret: 'hide' });
  } catch (e) { /* page may already be gone */ }
  let text = '';
  try { text = await page.evaluate(() => (document.body && document.body.innerText || '').slice(0, 2000)); }
  catch (e) { /* same */ }
  writeFileSync(path.join(DIFF, 'failure.txt'), String(err && err.stack || err) + '\n\n' + text);
}

async function shoot(page) {
  const png = opts => page.screenshot(Object.assign({ type: 'png', animations: 'disabled', caret: 'hide', scale: 'css' }, opts));
  await page.waitForFunction(() => !document.getElementById('splash'));
  await page.evaluate(() => (document.fonts && document.fonts.ready) || null);
  await page.waitForFunction(() => {
    const home = document.querySelector('.screen.home:not(.hidden)');
    if (!home) return false;
    const imgs = [...home.querySelectorAll('.tile-img')].filter(i => i.getAttribute('src'));
    const hero = home.querySelector('.hero-img.on');
    const brand = [...home.querySelectorAll('.brand img')];
    return home.querySelectorAll('.row').length >= 3
      && imgs.length >= 3 && imgs.every(i => i.complete && i.naturalWidth > 0)
      && hero && hero.complete && hero.naturalWidth > 0
      && brand.length >= 2 && brand.every(i => i.complete && i.naturalWidth > 0);
  });
  const shots = new Map();
  shots.set('1-home', await png());
  await press(page, 'ArrowDown');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('.screen.home:not(.hidden) .row');
    return rows[1] && rows[1].classList.contains('active');
  });
  shots.set('2-home-next-row', await png());
  await press(page, 'ArrowUp');
  await press(page, 'ArrowUp');
  await press(page, 'ArrowRight');
  await press(page, 'Enter');
  await page.waitForFunction(() => {
    const lib = document.querySelector('.screen.library:not(.hidden)');
    if (!lib) return false;
    const imgs = [...lib.querySelectorAll('.tile-img')].filter(i => i.getAttribute('src'));
    return imgs.length >= 7 && imgs.every(i => i.complete && i.naturalWidth > 0);
  });
  shots.set('3-library', await png());
  for (let i = 0; i < 6; i++) await press(page, 'ArrowRight');
  await page.waitForFunction(() => {
    const ring = document.querySelector('.screen.library:not(.hidden) .ring');
    const m = ring && /translate\(([-\d.]+)px/.exec(ring.style.transform || '');
    return m && Number(m[1]) > 1400;
  });
  shots.set('4-library-last-column', await png());
  await press(page, 'Escape');
  await page.waitForFunction(() => {
    const lib = document.querySelector('.screen.library');
    const home = document.querySelector('.screen.home');
    if (!home || home.classList.contains('hidden')) return false;
    if (lib && !lib.classList.contains('hidden')) return false;
    const imgs = [...home.querySelectorAll('.tile-img')].filter(i => i.getAttribute('src'));
    return home.querySelectorAll('.row').length >= 3 && imgs.length >= 3 && imgs.every(i => i.complete && i.naturalWidth > 0);
  });
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  await page.waitForFunction(() => {
    const d = document.querySelector('.screen.detail:not(.hidden)');
    if (!d || !d.querySelector('.detail-options .opt')) return false;
    const hero = d.querySelector('.hero-img.on');
    return hero && hero.complete && hero.naturalWidth > 0;
  });
  shots.set('5-detail', await png());
  await press(page, 'ArrowDown');
  await page.waitForFunction(() => !!document.querySelector('.screen.detail:not(.hidden) .detail-options .opt.focus'));
  shots.set('6-detail-options', await png());
  return shots;
}

function tooDifferent(result) {
  return result.size || (result.total > 0 && result.bad / result.total > MAX_FRACTION);
}

async function main() {
  const update = process.argv.includes('--update');
  let mock = null;
  let browser = null;
  let page = null;
  try {
    mock = await startMock();
    const pw = loadPlaywright();
    const chromium = pw.chromium || (pw.default && pw.default.chromium);
    if (!chromium) throw new Error(HELP);
    browser = await chromium.launch({
      args: ['--font-render-hinting=none', '--disable-font-subpixel-positioning', '--disable-lcd-text', '--force-color-profile=srgb'],
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    const base = mock.base;
    await page.route('**/*', route => {
      if (route.request().url().startsWith(base)) return route.continue();
      return route.abort();
    });
    await page.goto(base + '/seed', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/index\.html$/);
    const shots = await shoot(page);
    if (update) {
      mkdirSync(BASELINE, { recursive: true });
      for (const name of SHOTS) writeFileSync(path.join(BASELINE, name + '.png'), shots.get(name));
      console.log('Wrote ' + SHOTS.length + ' baselines to tools/screens-baseline');
      return;
    }
    const present = existsSync(BASELINE) ? readdirSync(BASELINE).filter(n => n.endsWith('.png')) : [];
    if (!present.length) {
      console.error('No baselines in tools/screens-baseline. Run the CI workflow with "update baselines", or on Linux: node tools/screenshots.mjs --update');
      process.exitCode = 1;
      return;
    }
    let failed = 0;
    for (const name of SHOTS) {
      const file = path.join(BASELINE, name + '.png');
      if (!existsSync(file)) {
        failed++;
        console.error(name + ': missing baseline');
        continue;
      }
      const result = compareRgba(decodePng(readFileSync(file)), decodePng(shots.get(name)), TOL);
      if (!tooDifferent(result)) {
        console.log(name + ' ok');
        continue;
      }
      failed++;
      mkdirSync(DIFF, { recursive: true });
      writeFileSync(path.join(DIFF, name + '.actual.png'), shots.get(name));
      if (result.diff) writeFileSync(path.join(DIFF, name + '.diff.png'), encodePng(result.width, result.height, result.diff));
      const why = result.size
        ? 'size differs from ' + result.width + 'x' + result.height
        : result.bad + '/' + result.total + ' pixels differ';
      console.error(name + ': ' + why);
    }
    if (failed) {
      console.error(failed + ' screenshot(s) differ. Diffs are in tools/screens-diff');
      process.exitCode = 1;
    }
  } catch (e) {
    if (page) await saveFailure(page, e);
    console.error(e && e.stack || e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (mock) mock.child.kill();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
