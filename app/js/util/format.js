import { scoresText } from './ratings.js';

export function duration(ms) {
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return min + 'm';
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
}

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => (n < 10 ? '0' : '') + n;
  return (hh ? hh + ':' + pad(mm) : mm) + ':' + pad(ss);
}

export function episodeLabel(item) {
  if (item.type !== 'episode') return '';
  return 'S' + (item.parentIndex || 0) + ' · E' + (item.index || 0);
}

// Under an episode still: "34m left", "Watched · 52m", or just "55m".
export function episodeStatus(item) {
  if (!item) return '';
  const mins = item.duration ? Math.round(item.duration / 60000) + 'm' : '';
  if (item.viewOffset && item.duration > item.viewOffset) return duration(Math.max(60000, item.duration - item.viewOffset)) + ' left';
  if (item.viewCount) return mins ? 'Watched · ' + mins : 'Watched';
  return mins;
}

// "Film · Thriller" on a movie, "Series · 2 seasons" on a show.
export function detailEyebrow(item) {
  if (!item) return '';
  const kind = { movie: 'Film', show: 'Series', episode: 'Episode', season: 'Season' }[item.type] || '';
  const bits = [];
  if (kind) bits.push(kind);
  if (item.type === 'show' && item.childCount) bits.push(item.childCount + (item.childCount === 1 ? ' season' : ' seasons'));
  if (item.type !== 'show') (item.Genre || []).slice(0, 3).forEach(g => { if (g && g.tag) bits.push(g.tag); });
  return bits.join(' · ');
}

// What the white Play button says. Shows name the episode.
export function playLabel(item, showLike) {
  if (!item) return '';
  if (showLike) return (item.viewOffset ? 'Resume ' : 'Play ') + episodeLabel(item);
  if (item.viewOffset) return 'Resume ' + clock(item.viewOffset);
  return 'Play';
}

// "1h 8m left · ends at 22:55" for a partly watched movie. `now` is injectable.
export function leftLine(item, now) {
  if (!item || !item.viewOffset || !(item.duration > item.viewOffset)) return '';
  const left = item.duration - item.viewOffset;
  const d = new Date((now == null ? Date.now() : now) + left);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return duration(Math.max(60000, left)) + ' left · ends at ' + hh + ':' + mm;
}

// The line under a title: "2019 · PG-13 · 2h 4m" style.
// 4K / HDR / 5.1 from a listing that already carries Media. Empty when it doesn't.
export function techChips(item) {
  const media = item && item.Media && item.Media[0];
  if (!media) return [];
  const chips = [];
  const r = String(media.videoResolution || '').toLowerCase();
  if (r === '4k') chips.push('4K');
  else if (r === '1080' || r === '720') chips.push(r + 'p');
  const streams = (media.Part && media.Part[0] && media.Part[0].Stream) || [];
  const v = streams.find(s => s && s.streamType === 1) || {};
  const blob = (v.displayTitle || '') + ' ' + (v.title || '') + ' ' + (v.colorTrc || '');
  if (v.DOVIPresent || /dolby vision|dovi/i.test(blob)) chips.push('Dolby Vision');
  else if (/hdr10\+/i.test(blob)) chips.push('HDR10+');
  else if (/hdr10/i.test(blob)) chips.push('HDR10');
  else if (/smpte2084|arib-std-b67|\bhdr\b|\bhlg\b/i.test(blob)) chips.push('HDR');
  const a = streams.find(s => s && s.streamType === 2);
  if (a && a.channels === 8) chips.push('7.1');
  else if (a && a.channels === 6) chips.push('5.1');
  return chips;
}

// Pieces of the line under a title. `chip` is the outlined kind (rating, 4K).
export function metaParts(item) {
  const parts = [];
  const add = (text, chip) => { if (text) parts.push({ text: String(text), chip: !!chip }); };
  if (!item) return parts;
  if (item.type === 'episode') {
    add(episodeLabel(item));
    if (item.originallyAvailableAt) add(item.originallyAvailableAt.slice(0, 4));
  } else if (item.year) add(item.year);
  if (item.contentRating) add(item.contentRating, true);
  if (item.type === 'show' && item.childCount) add(item.childCount + (item.childCount === 1 ? ' season' : ' seasons'));
  else if (item.duration) add(duration(item.duration));
  techChips(item).forEach(c => add(c, true));
  const score = scoresText(item);
  if (score) add(score);
  return parts;
}

export function metaLine(item) {
  return metaParts(item).map(p => p.text).join('  ·  ');
}

// Gold eyebrow on Home. Continue Watching adds how much is left.
export function heroEyebrow(rowTitle, item) {
  const hub = rowTitle || '';
  if (/continue|on\s*deck/i.test(hub)) {
    if (item && item.viewOffset && item.duration > item.viewOffset) {
      return 'Continue watching · ' + duration(Math.max(60000, item.duration - item.viewOffset)) + ' left';
    }
    return 'Continue watching';
  }
  return hub;
}

export function progress(item) {
  if (!item.viewOffset || !item.duration) return 0;
  return Math.min(1, item.viewOffset / item.duration);
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
