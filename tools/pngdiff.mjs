// Enough of a PNG codec to compare screenshots. 8-bit RGB or RGBA only.
import zlib from 'node:zlib';

export function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function decodePng(buf) {
  const u = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (u.length < 8 || u.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a png');
  let o = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  const idat = [];
  while (o + 8 <= u.length) {
    const len = u.readUInt32BE(o);
    const type = u.toString('ascii', o + 4, o + 8);
    const data = u.subarray(o + 8, o + 8 + len);
    o += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      if (data[12]) throw new Error('interlaced png');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (depth !== 8 || (color !== 2 && color !== 6)) throw new Error('unsupported png');
  const bpp = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const bytes = Buffer.alloc(height * stride);
  let i = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[i++];
    const row = y * stride;
    const prev = y ? row - stride : -1;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? bytes[row + x - bpp] : 0;
      const up = prev >= 0 ? bytes[prev + x] : 0;
      const ul = prev >= 0 && x >= bpp ? bytes[prev + x - bpp] : 0;
      const v = raw[i++];
      let n = v;
      if (filter === 1) n = (v + left) & 255;
      else if (filter === 2) n = (v + up) & 255;
      else if (filter === 3) n = (v + ((left + up) >> 1)) & 255;
      else if (filter === 4) n = (v + paeth(left, up, ul)) & 255;
      else if (filter !== 0) throw new Error('bad png filter');
      bytes[row + x] = n;
    }
  }
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const s = p * bpp;
    const d = p * 4;
    out[d] = bytes[s];
    out[d + 1] = bytes[s + 1];
    out[d + 2] = bytes[s + 2];
    out[d + 3] = bpp === 4 ? bytes[s + 3] : 255;
  }
  return { width, height, data: out };
}

// Pixels whose channels differ by more than tol. diff is an RGBA image of the misses.
export function compareRgba(a, b, tol = 24) {
  if (a.width !== b.width || a.height !== b.height) {
    return { width: a.width, height: a.height, bad: a.width * a.height, total: a.width * a.height, size: true, diff: null };
  }
  const total = a.width * a.height;
  const diff = Buffer.alloc(total * 4);
  let bad = 0;
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const dr = Math.abs(a.data[p] - b.data[p]);
    const dg = Math.abs(a.data[p + 1] - b.data[p + 1]);
    const db = Math.abs(a.data[p + 2] - b.data[p + 2]);
    const miss = dr > tol || dg > tol || db > tol;
    if (miss) bad++;
    diff[p] = miss ? 255 : a.data[p];
    diff[p + 1] = miss ? 0 : a.data[p + 1];
    diff[p + 2] = miss ? 0 : a.data[p + 2];
    diff[p + 3] = 255;
  }
  return { width: a.width, height: a.height, bad, total, size: false, diff };
}
