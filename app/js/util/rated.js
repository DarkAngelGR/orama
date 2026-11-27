// Audience score, else the critic score. Both are 0-10. Missing is 0.
function scoreOf(ep) {
  if (!ep) return 0;
  const audience = Number(ep.audienceRating);
  if (audience > 0) return audience;
  const critic = Number(ep.rating);
  return critic > 0 ? critic : 0;
}

// "★ 8.9", or "" when the episode has no score.
export function ratingLabel(ep) {
  const score = scoreOf(ep);
  return score ? '★ ' + score.toFixed(1) : '';
}

// Highest score first. Ties, and unrated episodes, keep season then episode
// index. Does not mutate `eps`.
export function byRating(eps) {
  const tagged = eps.map((ep, i) => ({ ep, i, score: scoreOf(ep) }));
  tagged.sort((a, b) => {
    if (a.score !== b.score) {
      if (!a.score) return 1;
      if (!b.score) return -1;
      return b.score - a.score;
    }
    const season = (Number(a.ep.parentIndex) || 0) - (Number(b.ep.parentIndex) || 0);
    if (season) return season;
    const index = (Number(a.ep.index) || 0) - (Number(b.ep.index) || 0);
    if (index) return index;
    return a.i - b.i;
  });
  return tagged.map(x => x.ep);
}
