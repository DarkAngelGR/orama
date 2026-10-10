// Send remote-control keys to a Samsung TV over its LAN websocket API.
// Usage: node tools/remote.mjs KEY_DOWN KEY_DOWN:10 KEY_ENTER ...
//   KEY:N repeats N times; "wait:ms" pauses. Token is cached in .env as TV_REMOTE_TOKEN.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // TV uses a self-signed cert
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split('\n')
  .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const name = Buffer.from('samsucks-dev').toString('base64');
const token = env.TV_REMOTE_TOKEN ? `&token=${env.TV_REMOTE_TOKEN}` : '';
const url = `wss://${env.TV_IP}:8002/api/v2/channels/samsung.remote.control?name=${name}${token}`;
const gap = Number(process.env.GAP || 120);

const steps = process.argv.slice(2).flatMap(a => {
  if (a.startsWith('wait:')) return [{ wait: Number(a.slice(5)) }];
  const [key, n] = a.split(':');
  return Array.from({ length: Number(n || 1) }, () => ({ key }));
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ws = new WebSocket(url);
ws.onmessage = async ev => {
  const msg = JSON.parse(ev.data);
  if (msg.event !== 'ms.channel.connect') return;
  const t = msg.data && msg.data.token;
  if (t && t !== env.TV_REMOTE_TOKEN) {
    const text = readFileSync(envPath, 'utf8').replace(/^TV_REMOTE_TOKEN=.*\n?/m, '');
    writeFileSync(envPath, text.replace(/\n?$/, '\n') + `TV_REMOTE_TOKEN=${t}\n`);
  }
  for (const s of steps) {
    if (s.wait) { await sleep(s.wait); continue; }
    ws.send(JSON.stringify({ method: 'ms.remote.control', params: {
      Cmd: 'Click', DataOfCmd: s.key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } }));
    await sleep(gap);
  }
  await sleep(200);
  ws.close();
};
ws.onerror = e => { console.error('remote error:', e.message || e); process.exit(1); };
ws.onclose = () => process.exit(0);
setTimeout(() => { console.error('timed out (accept the prompt on the TV?)'); process.exit(1); }, 30000);
