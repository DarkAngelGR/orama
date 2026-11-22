// Query params for one library listing. One value per filter. Kids-mode
// params are applied last so a rating picked here cannot widen them.

export function plexFilterParams(filters) {
  const f = filters || {};
  const p = {};
  if (f.genre) p.genre = f.genre;
  if (f.year) p.year = f.year;
  if (f.decade) p.decade = f.decade;
  if (f.resolution) p.resolution = f.resolution;
  if (f.contentRating) p.contentRating = f.contentRating;
  return p;
}

// Jellyfin's public items API has Is4K and IsHD. MinHeight/MaxHeight are sent
// for a 1080p-vs-720p split on servers that honor them.
// shortcut: a server that ignores MinHeight treats 1080p and 720p as "HD, not 4K".
const JF_RES = {
  '4k': { Is4K: true },
  '1080': { IsHD: true, Is4K: false, MinHeight: 1000 },
  '720': { IsHD: true, Is4K: false, MinHeight: 700, MaxHeight: 900 },
  sd: { IsHD: false },
};

export function jellyfinFilterParams(filters) {
  const f = filters || {};
  const p = {};
  if (f.genre) p.Genres = f.genre;
  if (f.year) p.Years = f.year;
  else if (f.decade) {
    const y = parseInt(f.decade, 10);
    if (y) {
      const years = [];
      for (let n = 0; n < 10; n++) years.push(y + n);
      p.Years = years.join(',');
    }
  }
  const res = JF_RES[String(f.resolution || '').toLowerCase()];
  if (res) Object.assign(p, res);
  return p;
}

export function plexListingParams({ sort, type, unwatched, filters, kids, start, size } = {}) {
  const params = Object.assign({
    sort, type,
    'X-Plex-Container-Start': start,
    'X-Plex-Container-Size': size,
  }, plexFilterParams(filters));
  if (unwatched) params[type === 2 ? 'unwatchedLeaves' : 'unwatched'] = 1;
  if (kids) Object.assign(params, kids);
  return params;
}

export function plexLetterParams({ type, unwatched, filters, kids } = {}) {
  const params = Object.assign({ type }, plexFilterParams(filters));
  if (unwatched) params[type === 2 ? 'unwatchedLeaves' : 'unwatched'] = 1;
  if (kids) Object.assign(params, kids);
  return params;
}

export function jellyfinListingParams({ filters, unwatched, kids } = {}) {
  const params = jellyfinFilterParams(filters);
  if (unwatched) params.Filters = 'IsUnplayed';
  if (kids && kids.MaxOfficialRating) params.MaxOfficialRating = kids.MaxOfficialRating;
  return params;
}

export function hasActiveFilters(filters) {
  const f = filters || {};
  return !!(f.genre || f.year || f.decade || f.resolution || f.contentRating);
}

export function filterBits(filters) {
  const f = filters || {};
  return [f.genreTitle || f.genre, f.decadeTitle || f.yearTitle || f.decade || f.year,
    f.resolutionTitle || f.resolution, f.contentRatingTitle || f.contentRating].filter(Boolean);
}

export function filterButtonLabel(filters) {
  const bits = filterBits(filters);
  return bits.length ? 'Filter: ' + bits.join(' · ') : 'Filter';
}
