// Plex's seek preview pictures come as one BIF file: a 64-byte header, an
// index of (time, offset) pairs, then the JPEGs back to back.
const MAGIC = 0x89424946; // "\x89BIF"

// null when it isn't a BIF file we understand.
export function parseBif(buf) {
  if (!buf || buf.byteLength < 72) return null;
  const v = new DataView(buf);
  if (v.getUint32(0) !== MAGIC) return null;
  const count = v.getUint32(12, true);
  const interval = v.getUint32(16, true) || 1000;
  // count entries plus a closing one whose offset is where the last picture ends.
  if (!count || 64 + (count + 1) * 8 > buf.byteLength) return null;
  const times = new Uint32Array(count);
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i <= count; i++) {
    if (i < count) times[i] = v.getUint32(64 + i * 8, true);
    offsets[i] = v.getUint32(64 + i * 8 + 4, true);
  }
  return { buf, count, interval, times, offsets };
}

// Index of the last picture at or before `ms`.
export function bifIndex(bif, ms) {
  const t = ms / bif.interval;
  let lo = 0;
  let hi = bif.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bif.times[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function bifPicture(bif, i) {
  const start = bif.offsets[i];
  const end = bif.offsets[i + 1];
  if (!(end > start) || end > bif.buf.byteLength) return null;
  return new Blob([new Uint8Array(bif.buf, start, end - start)], { type: 'image/jpeg' });
}
