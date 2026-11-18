import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact, consider, reportBody } from '../app/js/util/report.js';

function bucket() {
  return { seen: new Map(), sent: [] };
}

test('redacts credentials and keeps a plain address', () => {
  const s = redact('fail http://flex:s3cret@192.168.1.5:32400/a?X-Plex-Token=abc123&x=1 Authorization: Bearer tok Basic QWxhZGRpbjpvcGVu');
  assert.equal(s.includes('s3cret'), false);
  assert.equal(s.includes('abc123'), false);
  assert.equal(s.includes('QWxh'), false);
  assert.equal(/\btok\b/.test(s), false);
  assert.match(s, /http:\/\/192\.168\.1\.5:32400\/a\?X-Plex-Token=redacted&x=1/);
  assert.equal(redact('X-Plex-Token: supersecret').includes('supersecret'), false);
  assert.equal(redact('token missing'), 'token missing');
  assert.equal(consider(bucket(), '   ', 0), null);
});

test('drops duplicates for 60s and stops after 10 new reports a minute', () => {
  const again = bucket();
  assert.equal(consider(again, 'same', 1000), 'same');
  assert.equal(consider(again, 'same', 1000 + 59999), null);
  assert.equal(consider(again, 'same', 1000 + 60000), 'same');
  const spaced = bucket();
  assert.equal(consider(spaced, 'same  thing', 0), 'same thing');
  assert.equal(consider(spaced, 'same thing', 1), null);

  const limited = bucket();
  assert.equal(consider(limited, 'a', 0), 'a');
  for (let i = 0; i < 20; i++) assert.equal(consider(limited, 'a', 1), null);
  for (let i = 1; i < 10; i++) assert.equal(consider(limited, 'b' + i, 1), 'b' + i);
  assert.equal(consider(limited, 'overflow', 1), null);
  assert.equal(consider(limited, 'overflow', 60000), 'overflow');

  const long = 'x'.repeat(600);
  assert.equal(consider(bucket(), long, 0).length, 500);

  const body = reportBody({
    level: 'nope', where: 'w'.repeat(90), message: 'm'.repeat(600), version: 'v'.repeat(30), device: 'd'.repeat(50),
  });
  assert.equal(body.level, 'error');
  assert.equal(body.where.length, 80);
  assert.equal(body.message.length, 500);
  assert.equal(body.version.length, 20);
  assert.equal(body.device.length, 40);
  assert.equal(reportBody({ level: 'warn', where: '', message: 'ok', version: '0.28.0', device: 'TV' }).level, 'warn');
  assert.equal(reportBody({ level: 'error', message: '' }), null);
});
