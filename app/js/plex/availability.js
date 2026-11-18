const PROVIDERS = ['tmdb', 'tvdb', 'imdb'];

export function mediaIds(item) {
  const kind = item.kind || item.type;
  const ids = { kind, title: item.title || '', year: item.year };
  for (const provider of PROVIDERS) {
    const match = (item.Guid || []).find(g => g && typeof g.id === 'string' && g.id.startsWith(provider + '://'));
    const id = item[provider] || (match && match.id.split('://')[1]);
    if (id) ids[provider] = String(id).toLowerCase();
  }
  return ids;
}

export function mediaKey(item) {
  const ids = mediaIds(item);
  const order = ids.kind === 'show' ? ['tvdb', 'tmdb', 'imdb'] : PROVIDERS;
  const provider = order.find(p => ids[p]);
  return provider ? ids.kind + ':' + provider + ':' + ids[provider] : '';
}

// A conflicting primary ID takes precedence over weaker identifiers or names.
export function matchMedia(target, item) {
  const want = mediaIds(target);
  const got = mediaIds(item);
  if (want.kind !== got.kind) return false;
  const order = want.kind === 'show' ? ['tvdb', 'tmdb', 'imdb'] : PROVIDERS;
  const common = order.find(p => want[p] && got[p]);
  return common ? want[common] === got[common] : null;
}

export function hasPlayableMedia(item) {
  return !!item && (item.Media || []).some(m => (m.Part || []).some(p =>
    !!p.key && p.exists !== false && p.exists !== 0 && p.accessible !== false && p.accessible !== 0));
}

export function playbackState(target, items, complete = true) {
  const matches = items.filter(item => matchMedia(target, item) === true);
  const kind = target.kind || target.type;
  const playable = matches.find(item => kind === 'show' ? item.playableEpisode === true : hasPlayableMedia(item));
  if (playable) return { status: 'ready', item: playable };
  const ambiguous = items.some(item => matchMedia(target, item) === null &&
    String(item.title || '').toLowerCase() === String(target.title || '').toLowerCase() &&
    (!item.year || !target.year || Math.abs(item.year - target.year) <= 1));
  return { status: matches.length || ambiguous || !complete ? 'unknown' : 'missing' };
}
