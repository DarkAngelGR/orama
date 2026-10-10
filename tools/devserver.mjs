// Dev companion for builds made with --dev:
//  - receives logs and perf samples from the TV (POST /log) and appends them to build/tv.log
//  - queues commands for the app, which long-polls GET /cmd
//      curl 'localhost:8790/send?keys=down,down,right,enter'
//      curl 'localhost:8790/send?eval=document.title'      (result comes back in the log)
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logFile = path.join(root, 'build', 'tv.log');
mkdirSync(path.dirname(logFile), { recursive: true });
const port = Number(process.env.PORT || 8790);

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/cmd') {
    if (waiting) { clearTimeout(waiting.timer); waiting.end('[]'); }
    waiting = res;
    res.timer = setTimeout(() => { if (waiting === res) { waiting = null; res.end('[]'); } }, 20000);
    deliver();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/send') {
    const connected = !!waiting;
    const keys = url.searchParams.get('keys');
    const gap = Number(url.searchParams.get('gap') || 150);
    if (keys) queue.push({ keys: keys.split(','), gap });
    const code = url.searchParams.get('eval');
    if (code) queue.push({ eval: code });
    deliver();
    res.end(connected ? 'sent\n' : 'queued (app not connected yet)\n');
    return;
  }

  if (req.method !== 'POST') { res.end('ok'); return; }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    try {
      for (const entry of JSON.parse(body)) {
        const t = new Date(entry.t).toISOString().slice(11, 23);
        const line = `${t} ${entry.level.padEnd(5)} ${entry.msg}`;
        console.log(line);
        appendFileSync(logFile, line + '\n');
      }
    } catch (e) {
      console.error('bad payload', e.message);
    }
    res.end('ok');
  });
}).listen(port, '0.0.0.0', () => console.log(`devserver on :${port}, logging to ${path.relative(root, logFile)}`));
