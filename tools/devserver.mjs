// Dev companion for builds made with --dev:
//  - receives logs and perf samples from the TV (POST /log) and appends them to build/tv.log
//  - queues commands for the app, which long-polls GET /cmd
//      tools/tvsend.sh keys=down,down,right,enter
//      tools/tveval.sh 'document.title'          (result comes back in the log)
//
// Queued commands run as JavaScript inside the app on the TV, where the Plex
// tokens live, so every endpoint needs the shared secret in build/dev-secret
// (sent as X-Dev-Secret). deploy.sh --dev bakes the same secret into the
// build. /send also only accepts POSTs from this computer that don't come
// from a web page, so neither the LAN nor a site open in your browser can
// queue code.
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logFile = path.join(root, 'build', 'tv.log');
const secretFile = path.join(root, 'build', 'dev-secret');
mkdirSync(path.dirname(logFile), { recursive: true });
const port = Number(process.env.PORT || 8790);
const MAX_BODY = 1 << 20;

// Shared with deploy.sh --dev; whichever runs first creates it.
if (!existsSync(secretFile) || !readFileSync(secretFile, 'utf8').trim()) {
  writeFileSync(secretFile, randomBytes(16).toString('hex') + '\n', { mode: 0o600 });
}
const secret = Buffer.from(readFileSync(secretFile, 'utf8').trim());

function authorized(req) {
  const given = Buffer.from(String(req.headers['x-dev-secret'] || ''));
  return given.length === secret.length && timingSafeEqual(given, secret);
}

function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

// Log lines are printed to your terminal: drop escape/control characters.
function clean(s) {
  return String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

function readBody(req, res, done) {
  let body = '';
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BODY) { res.statusCode = 413; res.end(); req.destroy(); return; }
    body += c;
  });
  req.on('end', () => { if (size <= MAX_BODY) done(body); });
}

function deny(res, code, msg) {
  res.statusCode = code;
  res.end(msg + '\n');
}

const queue = [];
let waiting = null;

function deliver() {
  if (!waiting || !queue.length) return;
  const res = waiting;
  waiting = null;
  clearTimeout(res.timer);
  res.end(JSON.stringify(queue.splice(0)));
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  // The TV app is a cross-origin client (file:// or the widget origin). The
  // secret, not the origin, is what protects /cmd and /log.
  if (url.pathname === '/cmd' || url.pathname === '/log') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dev-Secret');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (!authorized(req)) { deny(res, 403, 'bad or missing X-Dev-Secret'); return; }
  }

  if (req.method === 'GET' && url.pathname === '/cmd') {
    if (waiting) { clearTimeout(waiting.timer); waiting.end('[]'); }
    waiting = res;
    res.timer = setTimeout(() => { if (waiting === res) { waiting = null; res.end('[]'); } }, 20000);
    deliver();
    return;
  }

  if (url.pathname === '/send') {
    // Only from this computer, never from a web page (browsers always send
    // Origin on cross-site POSTs), and only with the secret.
    if (req.method !== 'POST') { deny(res, 405, 'POST only'); return; }
    if (!isLoopback(req) || req.headers.origin) { deny(res, 403, 'local command-line clients only'); return; }
    if (!authorized(req)) { deny(res, 403, 'bad or missing X-Dev-Secret'); return; }
    readBody(req, res, body => {
      const p = new URLSearchParams(body);
      const connected = !!waiting;
      const keys = p.get('keys');
      const gap = Number(p.get('gap') || 150);
      if (keys) queue.push({ keys: keys.split(','), gap });
      const code = p.get('eval');
      if (code) queue.push({ eval: code });
      deliver();
      res.end(connected ? 'sent\n' : 'queued (app not connected yet)\n');
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/log') {
    readBody(req, res, body => {
      try {
        for (const entry of JSON.parse(body)) {
          const t = new Date(entry.t).toISOString().slice(11, 23);
          const line = `${t} ${clean(entry.level).padEnd(5)} ${clean(entry.msg)}`;
          console.log(line);
          appendFileSync(logFile, line + '\n');
        }
      } catch (e) {
        console.error('bad payload', e.message);
      }
      res.end('ok');
    });
    return;
  }

  deny(res, 404, 'not found');
}).listen(port, '0.0.0.0', () => console.log(`devserver on :${port}, logging to ${path.relative(root, logFile)}`));
