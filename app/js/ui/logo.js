// A title's clear logo in place of its name, on home and on the detail page.
// Listings don't always carry the logo entry a full metadata fetch has, so a
// Plex item without one asks the server for its own (or its show's) logo by
// id. That guess keeps the text title until the logo has loaded, and one that
// fails is remembered so it isn't asked for again.
const known = new Map(); // url -> true (loads) | false (missing)

export function listedLogo(item) {
  const img = ((item && item.Image) || []).find(i => i && i.type === 'clearLogo');
  return img ? img.url : '';
}

// The show's id for an episode or season: its logo is the show's.
export function logoOwner(item) {
  if (!item) return '';
  if (item.type === 'episode') return item.grandparentRatingKey || '';
  if (item.type === 'season') return item.parentRatingKey || '';
  if (item.type === 'movie' || item.type === 'show') return item.ratingKey || '';
  return '';
}

export function guessedLogo(item) {
  if (!item || item.jellyfin) return '';
  const id = logoOwner(item);
  return id ? '/library/metadata/' + id + '/clearLogo' : '';
}

// Shows `img` or `title` for `item`. `url(path)` turns a server path into an
// image URL at the size the screen wants.
export function showLogo(img, title, item, url) {
  const listed = listedLogo(item);
  const src = url(listed || guessedLogo(item));
  img.dataset.want = src || '';
  const swap = on => {
    img.style.display = on ? '' : 'none';
    title.style.display = on ? 'none' : '';
  };
  img.onerror = () => {
    known.set(src, false);
    if (img.dataset.want === src) swap(false);
  };
  if (!src || known.get(src) === false) { swap(false); return; }
  if (listed || known.get(src) === true) { img.src = src; swap(true); return; }
  swap(false);
  const probe = new Image();
  probe.onload = () => {
    known.set(src, true);
    if (img.dataset.want !== src) return;
    img.src = src;
    swap(true);
  };
  probe.onerror = () => known.set(src, false);
  probe.src = src;
}
