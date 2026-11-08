// Private, profile-scoped AI recommendation quality report.
// Counts tiles returned and user actions, not inferred emotions or completions.
import { h, setTransform, toggleClass } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import * as watchlist from '../plex/watchlist.js';

const ROW = 110;
const VISIBLE = 6;
const LABELS = {
  recommended: 'Personalized picks',
  'hidden-gems': 'Hidden gems',
  trending: 'Trending (comparison)',
  popular: 'Popular (comparison)',
  'ai-search': 'Natural-language discovery',
};

export function AIReportScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'AI recommendation quality';
  const clip = h('div', 'settings-list settings-clip', el);
  const track = h('div', 'settings-track', clip);
  h('div', 'settings-foot', el).textContent =
    'Last 30 days · Served means titles delivered, not cards actually seen';
  let entries = [];
  let index = 0;
  let alive = true;

  function render() {
    entries.forEach((e, i) => toggleClass(e.el, 'focus', i === index));
    const first = Math.max(0, Math.min(index - (VISIBLE - 2), entries.length - VISIBLE));
    setTransform(track, 'translateY(' + (-first * ROW) + 'px)');
  }

  function populate(data) {
    if (!alive) return;
    track.innerHTML = '';
    entries = data.map(row => {
      const el = h('div', 'setting', track);
      h('span', 'setting-label', el).textContent = row.title;
      h('span', 'setting-value', el).textContent = row.value;
      return { el };
    });
    index = 0;
    render();
  }

  async function load() {
    try {
      const report = await watchlist.aiStats();
      const summary = report.by_source || {};
      const entries = Object.keys(LABELS).map(source => {
        const counts = summary[source] || {};
        const rate = counts.open_per_100_served;
        return {
          title: LABELS[source],
          value: (counts.served || 0) + ' served · ' + (counts.open || 0) + ' opened · ' +
            (counts.request || 0) + ' requested' +
            (rate === null || rate === undefined ? '' : ' · ' + rate + ' opens/100 served'),
        };
      });
      const votes = report.feedback || {};
      entries.push({ title: 'Your direct feedback', value:
        (votes.more || 0) + ' more · ' + (votes.less || 0) + ' less · ' + (votes.hide || 0) + ' hidden' });
      populate(entries);
    } catch (e) {
      populate([{ title: 'AI report unavailable',
        value: 'Check HTTPS, the watchlist-sync password, and the verified Plex/Jellyfin profile.' }]);
    }
  }

  load();
  return {
    el, name: 'ai-report',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(entries.length - 1, index + 1); render(); return true; }
      return action === 'left' || action === 'right' || action === 'enter';
    },
    destroy() { alive = false; },
  };
}
