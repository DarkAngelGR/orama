// Hold OK on a poster or episode. The same actions everywhere; a screen passes
// the ones that need its own navigation (Open on Home may resume).

export function libraryItem(it) {
  return !!(it && it.ratingKey && !it.download && !it.catalog &&
    (it.jellyfin === true || /^\d+$/.test(String(it.ratingKey))));
}

export function isWatched(item) {
  if (!item) return false;
  if (item.type === 'show' || item.type === 'season') return item.leafCount > 0 && item.viewedLeafCount >= item.leafCount;
  return !!item.viewCount;
}

export function showTarget(item) {
  if (!item || !item.grandparentRatingKey) return null;
  return { ratingKey: item.grandparentRatingKey, type: 'show', title: item.grandparentTitle };
}

export function seasonTarget(item) {
  if (!item || !item.parentRatingKey) return null;
  return {
    ratingKey: item.parentRatingKey, type: 'season',
    parentRatingKey: item.grandparentRatingKey, title: item.parentTitle || item.grandparentTitle,
  };
}

// kids: no Remove from Continue Watching. Nothing here deletes a file.
export function menuActions(item, { continueRow = false, kids = false } = {}) {
  if (!item || !item.ratingKey) return [];
  const opts = [];
  const playable = item.type === 'movie' || item.type === 'episode';
  if (playable && (item.viewOffset || item.viewCount)) opts.push({ label: 'Play from start', value: 'restart' });
  if (item.type === 'episode' && item.grandparentRatingKey) opts.push({ label: 'Go to show', value: 'show' });
  if (item.type === 'episode' && item.parentRatingKey) opts.push({ label: 'Go to season', value: 'season' });
  const watched = isWatched(item);
  const markable = item.type === 'movie' || item.type === 'episode' || item.type === 'show' || item.type === 'season';
  if (markable && (!watched || item.viewOffset)) opts.push({ label: 'Mark as watched', value: 'watched' });
  if (markable && watched) opts.push({ label: 'Mark as unwatched', value: 'unwatched' });
  else if (item.viewOffset) opts.push({ label: 'Clear progress', value: 'clear' });
  if (!kids && (continueRow || item.viewOffset) && item.type !== 'show' && item.type !== 'season') {
    opts.push({ label: 'Remove from Continue Watching', value: 'remove' });
  }
  opts.push({ label: 'Open', value: 'open' });
  return opts;
}

export function applyMenuResult(item, value) {
  if (!item) return;
  if (value === 'watched') {
    if (item.type === 'show' || item.type === 'season') {
      if (item.leafCount) item.viewedLeafCount = item.leafCount;
    } else item.viewCount = 1;
    item.viewOffset = undefined;
  } else if (value === 'unwatched' || value === 'clear') {
    item.viewCount = 0;
    item.viewOffset = undefined;
    if (item.type === 'show' || item.type === 'season') item.viewedLeafCount = 0;
  } else if (value === 'remove') {
    item.viewOffset = undefined;
  }
}

export function menuNotice(value, wasWatched) {
  if (value === 'remove') return 'Removed from Continue Watching';
  if (value === 'watched') return 'Marked as watched';
  if (value === 'unwatched') return wasWatched ? 'Marked as unwatched' : 'Progress cleared';
  if (value === 'clear') return 'Progress cleared';
  return '';
}

// hooks: { open, play, select, server, notice, refresh, onExtra, onError }
export function openTitleMenu(picker, item, ctx, hooks) {
  const extra = (ctx && ctx.extra) || [];
  const opts = extra.concat(menuActions(item, ctx || {}));
  if (!opts.length) return;
  const was = isWatched(item);
  const h = hooks || {};
  picker.open(item.grandparentTitle || item.title || 'Title', opts, async value => {
    if (h.onExtra && h.onExtra(value)) return;
    try {
      const kind = await runMenuAction(item, value, h);
      if (kind === 'changed') {
        const text = menuNotice(value, was);
        if (text && h.notice) h.notice(text, 3000);
        if (h.refresh) h.refresh(item, value);
      }
    } catch (e) {
      if (h.onError) h.onError(e);
      if (h.notice) h.notice('The server didn\'t accept that (' + ((e && e.message) || 'error') + ')', 5000);
    }
  });
}

export async function runMenuAction(item, value, hooks) {
  const h = hooks || {};
  const open = h.open;
  if (value === 'open') {
    if (h.select) h.select(item);
    else if (open) open(item);
    return 'nav';
  }
  if (value === 'restart') {
    if (h.play) h.play(item, { offset: 0 });
    return 'nav';
  }
  if (value === 'show') {
    const t = showTarget(item);
    if (t && open) open(t);
    return 'nav';
  }
  if (value === 'season') {
    const t = seasonTarget(item);
    if (t && open) open(t);
    return 'nav';
  }
  const server = h.server;
  if (!server) throw new Error('No server');
  if (value === 'remove') await server.removeFromContinueWatching(item.ratingKey);
  else if (value === 'watched') await server.scrobble(item.ratingKey);
  else if (value === 'unwatched' || value === 'clear') await server.unscrobble(item.ratingKey);
  else return 'nav';
  applyMenuResult(item, value);
  if (server.invalidate) server.invalidate();
  return 'changed';
}
