// Which settings row belongs to which category. Pure data: the screen renders
// it, and the test imports it without a DOM. Empty categories are left out
// (kids mode only has Account). An unknown label stays on screen under Other.

const GROUPS = [
  ['account', 'Account', ['Kids mode', 'Server', 'Profile', 'User', "Who's watching at start", 'Sign out']],
  ['playback', 'Playback', ['Default quality', 'Audio formats', 'Force direct play', 'Audio language', 'OK on Continue Watching']],
  ['subtitles', 'Subtitles', ['Subtitle language', 'Subtitle size', 'Subtitle colour', 'Subtitle background']],
  ['home', 'Home & recommendations', ['Discover rows on Home', 'Theme music', 'AI recommendations', 'Auto-fetch movies', 'Reset taste profile']],
  ['appearance', 'Appearance', ['Animations', 'Seasonal theme']],
  ['downloads', 'Downloads & updates', ['Updates', 'Downloads (watchlist-sync)']],
  ['advanced', 'Advanced', ['Performance overlay', 'Demo: original slow renderer']],
];

export function groupSettings(items) {
  const byLabel = new Map();
  for (const item of items) {
    const list = byLabel.get(item.label);
    if (list) list.push(item);
    else byLabel.set(item.label, [item]);
  }
  const used = new Set();
  const groups = [];
  for (const [id, title, labels] of GROUPS) {
    const rows = [];
    for (const label of labels) {
      const found = byLabel.get(label);
      if (!found) continue;
      for (const item of found) rows.push(item);
      used.add(label);
    }
    if (rows.length) groups.push({ id, title, items: rows });
  }
  const rest = items.filter(item => !used.has(item.label));
  if (rest.length) groups.push({ id: 'other', title: 'Other', items: rest });
  return groups;
}
