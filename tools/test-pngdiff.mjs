import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { crc32, encodePng, decodePng, compareRgba } from './pngdiff.mjs';

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

test('png round trip keeps pixels, and a small channel change is inside tolerance', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const rgba = Buffer.from([10, 20, 30, 255, 0, 0, 0, 255, 255, 255, 255, 128, 1, 2, 3, 255]);
  const back = decodePng(encodePng(2, 2, rgba));
  assert.equal(back.width, 2);
  assert.equal(back.height, 2);
  assert.deepEqual([...back.data], [...rgba]);

  const nudged = Buffer.from(rgba);
  nudged[0] = 20;
  assert.equal(compareRgba({ width: 2, height: 2, data: rgba }, { width: 2, height: 2, data: nudged }, 24).bad, 0);
  nudged[0] = 40;
  const hard = compareRgba({ width: 2, height: 2, data: rgba }, { width: 2, height: 2, data: nudged }, 24);
  assert.equal(hard.bad, 1);
  assert.equal(hard.diff[0], 255);
  assert.equal(compareRgba({ width: 2, height: 2, data: rgba }, { width: 1, height: 2, data: rgba }, 24).size, true);
});

test('png sub filter reconstructs rgb pixels', () => {
  // 2×1 RGB, filter Sub. Stored bytes are the delta from the left pixel.
  const raw = Buffer.from([1, 10, 20, 30, 5, 5, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  assert.deepEqual([...decodePng(png).data], [10, 20, 30, 255, 15, 25, 40, 255]);
});
