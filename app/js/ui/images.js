// Image loading tuned for a slow TV CPU:
//  - a few downloads at a time, newest request first (what's on screen now
//    matters more than what scrolled past),
//  - requests for nodes that were recycled before loading are dropped,
//  - decode() runs off the main thread before the image is attached, so
//    attaching never stalls a frame.
const MAX_ACTIVE = 6;
const LOADED_MAX = 800;

const queue = [];
let active = 0;
const loaded = new Map(); // url -> true, in insertion order for LRU trimming
const warming = new Set(); // prefetches queued or downloading

function remember(url) {
  loaded.delete(url);
  loaded.set(url, true);
  if (loaded.size > LOADED_MAX) loaded.delete(loaded.keys().next().value);
}

function attach(img, url, instant) {
  img.src = url;
  if (instant) {
    img.classList.add('in', 'now');
  } else {
    img.classList.remove('now');
    img.classList.add('in');
  }
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.pop();
    if (job.img._want !== job.url) { warming.delete(job.url); continue; }
    active++;
    const loader = new Image();
    loader.src = job.url;
    const done = ok => {
      active--;
      if (job.sink) warming.delete(job.url);
      if (ok) {
        remember(job.url);
        if (job.img._want === job.url) attach(job.img, job.url, false);
      }
      pump();
    };
    if (loader.decode) loader.decode().then(() => done(true), () => done(false));
    else { loader.onload = () => done(true); loader.onerror = () => done(false); }
  }
}

// Point an <img> at a URL. Empty url clears it.
export function load(img, url) {
  if (img._want === url) return;
  img._want = url;
  if (!url) {
    img.classList.remove('in');
    img.removeAttribute('src');
    return;
  }
  if (loaded.has(url)) {
    attach(img, url, true);
    return;
  }
  img.classList.remove('in');
  queue.push({ img, url });
  trim();
  pump();
}

// Oldest first out: those are prefetches (queued at the front) and posters that scrolled past.
function trim() {
  if (queue.length <= 200) return;
  queue.splice(0, queue.length - 200).forEach(j => { if (j.sink) warming.delete(j.url); });
}

// Warm the cache without a target element (e.g. the next page of a grid).
export function prefetch(url) {
  if (!url || loaded.has(url) || warming.has(url)) return;
  warming.add(url);
  const sink = { _want: url, classList: { add() {}, remove() {} } };
  queue.unshift({ img: sink, url, sink: true });
  trim();
  pump();
}
