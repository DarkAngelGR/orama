// Review scores as Plex sends them (verified by github.com/GLinnik21/plx-native,
// docs/pms-api.md, "Review scores"):
//  - /library/metadata/{id} carries `Rating[]`: { image, value, type }, e.g.
//    imdb://image.rating 7.4, rottentomatoes://image.rating.ripe 9.1 (critic),
//    rottentomatoes://image.rating.upright 8.5 (audience), themoviedb://image.rating 7.8.
//  - Listings carry only the flat pair rating/ratingImage + audienceRating/
//    audienceRatingImage, from the library's "Ratings source" setting.
//  - `image` names the provider; `type` doesn't (IMDb and TMDB are both
//    "audience"). Every value is 0-10, percentages included (91% -> 9.1).
//  - A missing score is an omitted field, never 0.
// Names are written out as text; no provider logos are used.

const PROVIDERS = [
  { key: 'imdb', test: img => /^imdb:\/\//.test(img), label: v => 'IMDb ' + v.toFixed(1) },
  // Critics' tomato only; the audience popcorn would crowd the line.
  { key: 'rt', test: img => /^rottentomatoes:\/\/image\.rating\.(ripe|rotten)/.test(img), label: v => 'Rotten Tomatoes ' + Math.round(v * 10) + '%' },
  { key: 'tmdb', test: img => /^themoviedb:\/\//.test(img), label: v => 'TMDB ' + Math.round(v * 10) + '%' },
];

function rows(item) {
  if (Array.isArray(item.Rating) && item.Rating.length) {
    return item.Rating.map(r => ({ image: r.image || '', value: Number(r.value) }));
  }
  const out = [];
  if (item.ratingImage && item.rating) out.push({ image: item.ratingImage, value: Number(item.rating) });
  if (item.audienceRatingImage && item.audienceRating) out.push({ image: item.audienceRatingImage, value: Number(item.audienceRating) });
  return out;
}

// [{ key, value, label }] in the order IMDb, Rotten Tomatoes, TMDB.
export function scores(item) {
  if (!item) return [];
  const found = rows(item).filter(r => r.value > 0);
  const out = [];
  for (const p of PROVIDERS) {
    const r = found.find(x => p.test(x.image));
    if (r) out.push({ key: p.key, value: r.value, label: p.label(r.value) });
  }
  return out;
}

export function imdb(item) {
  const s = scores(item).find(x => x.key === 'imdb');
  return s ? s.value : 0;
}

// One 0-10 number for ranking: IMDb when known, else the library's own score.
export function ratingOf(item) {
  return imdb(item) || Number(item.audienceRating) || Number(item.rating) || 0;
}

// "IMDb 7.4  ·  Rotten Tomatoes 91%  ·  TMDB 78%", or "★ 7.4" when the
// source isn't named (older servers, unknown providers).
export function scoresText(item) {
  const s = scores(item);
  if (s.length) return s.map(x => x.label).join('  ·  ');
  return item.audienceRating ? '★ ' + Number(item.audienceRating).toFixed(1) : '';
}
