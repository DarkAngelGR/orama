// Sidecar (external) text subtitles, rendered by us over a direct-played video,
// so an .srt next to the file never forces the server to transcode.

function ms(h, m, s, frac) {
  return ((+h * 60 + +m) * 60 + +s) * 1000 + Math.round(+('0.' + (frac || '0')) * 1000);
}

// Anime subtitles translate on-screen signs too: lines in styles named like
// these, or pinned to the top (\an7-9), are drawn at the top of the screen.
const SIGN_STYLE = /sign|song|^op\b|^ed\b|title|screen|note|typeset/i;
// The TV hands over Matroska ASS lines whole:
// "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text".
const MKV_ASS = /^\d+,-?\d+,([^,]*),[^,]*,-?\d+,-?\d+,-?\d+,[^,]*,/;
export const NO_CUE = { text: '', top: '' };

// One subtitle line → { text, top }: plain text, and whether it's a sign.
export function cleanCue(raw, style) {
  let s = String(raw || '');
  const m = s.match(MKV_ASS);
  if (m) { style = m[1]; s = s.slice(m[0].length); }
  const top = /\\an[789]/.test(s) || (!!style && SIGN_STYLE.test(style));
  s = s
    .replace(/\{[^}]*\\p[1-9][^}]*\}[^{]*/g, '')   // drawing mode: vector shapes, not words
    .replace(/\{[^}]*\}/g, '')                      // other ASS override tags
    .replace(/<[^>]+>/g, '')                        // <i>, <font> ...
    .replace(/\\N/g, '\n')
    .replace(/\\[nh]/g, ' ');                       // soft break, hard space
  const lines = s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return { text: lines.join('\n'), top };
}

function parseSrtOrVtt(text) {
  const cues = [];
  const re = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/g;
  let m;
  const add = (start, end, raw) => {
    const c = cleanCue(raw);
    if (c.text) cues.push({ start, end, text: c.text, top: c.top });
  };
  while ((m = re.exec(text))) add(ms(m[1], m[2], m[3], m[4]), ms(m[5], m[6], m[7], m[8]), m[9]);
  // WebVTT allows mm:ss.ttt without hours.
  if (!cues.length) {
    const short = /(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/g;
    while ((m = short.exec(text))) add(ms(0, m[1], m[2], m[3]), ms(0, m[4], m[5], m[6]), m[7]);
  }
  return cues;
}

function parseAss(text) {
  const cues = [];
  const lines = text.split(/\r?\n/);
  let textIndex = 9;
  let styleIndex = 3;
  for (const line of lines) {
    if (/^Format:/i.test(line) && /Text/i.test(line)) {
      const fields = line.slice(7).split(',').map(f => f.trim().toLowerCase());
      textIndex = fields.indexOf('text');
      styleIndex = fields.indexOf('style');
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const parts = line.slice(9).split(',');
    const t = s => s.trim().match(/(\d+):(\d{2}):(\d{2})\.(\d{1,3})/);
    const a = t(parts[1]);
    const b = t(parts[2]);
    if (!a || !b) continue;
    const c = cleanCue(parts.slice(textIndex).join(','), (parts[styleIndex] || '').trim());
    if (c.text) cues.push({ start: ms(a[1], a[2], a[3], a[4]), end: ms(b[1], b[2], b[3], b[4]), text: c.text, top: c.top });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export function parseSubtitles(text, codec) {
  text = text.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  if (codec === 'ass' || codec === 'ssa' || /^\[Script Info\]/m.test(text)) return parseAss(text);
  return parseSrtOrVtt(text);
}

// Finds the active cue for a playback position; cheap for monotonic playback,
// binary search after jumps.
export class CueTrack {
  constructor(cues) {
    this.cues = cues;
    this.i = 0;
  }

  // { text, top }: dialogue for the bottom, signs for the top.
  at(t) {
    const cues = this.cues;
    if (!cues.length) return NO_CUE;
    let i = this.i;
    if (i >= cues.length || cues[i].start > t || (i + 1 < cues.length && cues[i + 1].start <= t && t - cues[i].start > 30000)) {
      let lo = 0;
      let hi = cues.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cues[mid].start <= t) lo = mid; else hi = mid - 1;
      }
      i = lo;
    }
    while (i + 1 < cues.length && cues[i + 1].start <= t) i++;
    this.i = i;
    const c = cues[i];
    if (!(c.start <= t && t < c.end)) return NO_CUE;
    // Overlapping cues (common in ASS) are shown together, each line once.
    const bottom = [];
    const top = [];
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      const x = cues[j];
      if (x.start > t || x.end <= t) continue;
      const list = x.top ? top : bottom;
      if (list.indexOf(x.text) < 0) list.push(x.text);
    }
    return { text: bottom.join('\n'), top: top.join('\n') };
  }
}
