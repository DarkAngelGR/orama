// Missing or wrong-shaped API fields. Arrays count as objects, matching the checks these replaced.
export const asList = v => Array.isArray(v) ? v : [];
export const asObj = v => v && typeof v === 'object' ? v : null;

// First-character buckets from a library. A missing size must not poison the
// offsets after it (NaN), or channel-up/down jumps to a blank cell.
export function letterStarts(directory) {
  let start = 0;
  return asList(directory).map(d => {
    const row = d && typeof d === 'object' ? d : {};
    const letter = { title: row.title == null ? '' : String(row.title), start };
    start += Number(row.size) || 0;
    return letter;
  });
}

// null: the reply belongs to an older sort or filter, so leave the current index alone.
export function lettersIfCurrent(gen, current, directory) {
  if (gen !== current) return null;
  return letterStarts(directory);
}
