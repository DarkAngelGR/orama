// Chapters from a Plex metadata item (Chapter) or a Jellyfin item (Chapters).
// Times are milliseconds, matching the rest of the player.

export function chaptersFrom(item) {
  const raw = item && (item.Chapter || item.Chapters);
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    let start = c.startTimeOffset;
    if (start == null && c.StartPositionTicks != null) start = Math.round(Number(c.StartPositionTicks) / 10000);
    start = Number(start);
    if (!isFinite(start) || start < 0) return;
    let end = c.endTimeOffset;
    if (end == null && c.EndPositionTicks != null) end = Math.round(Number(c.EndPositionTicks) / 10000);
    const row = { title: String(c.tag || c.Name || c.title || ('Chapter ' + (i + 1))), start };
    if (end != null && isFinite(Number(end))) row.end = Number(end);
    out.push(row);
  });
  out.sort((a, b) => a.start - b.start);
  return out;
}

// Skip a chapter that starts at 0: a tick there sits under the bar's cap.
export function chapterMarks(chapters, duration) {
  if (!duration) return [];
  const marks = [];
  (chapters || []).forEach(c => {
    if (c.start < 1000) return;
    const at = Math.max(0, Math.min(1, c.start / duration));
    marks.push({ title: c.title, start: c.start, at });
  });
  return marks;
}

// Index of the chapter playing at `ms`, or -1 before the first one.
export function chapterIndex(chapters, ms) {
  let at = -1;
  const t = Number(ms) || 0;
  const list = chapters || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].start <= t + 800) at = i;
  }
  return at;
}
