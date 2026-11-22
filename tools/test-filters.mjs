import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  plexFilterParams, jellyfinFilterParams, plexListingParams, plexLetterParams, jellyfinListingParams,
  hasActiveFilters, filterBits, filterButtonLabel,
} from '../app/js/plex/filters.js';

test('plex listing params keep one value per filter and let kids rating win', () => {
  assert.deepEqual(plexFilterParams({ genre: '42', genreTitle: 'Drama', year: '1999', resolution: '4k', contentRating: 'R' }), {
    genre: '42', year: '1999', resolution: '4k', contentRating: 'R',
  });
  const params = plexListingParams({
    sort: 'titleSort', type: 1, unwatched: true, start: 0, size: 140,
    filters: { genre: '42', contentRating: 'R' },
    kids: { contentRating: 'G,PG' },
  });
  assert.equal(params.genre, '42');
  assert.equal(params.contentRating, 'G,PG');
  assert.equal(params.unwatched, 1);
  assert.equal(params.sort, 'titleSort');
  const shows = plexLetterParams({ type: 2, unwatched: true, filters: { decade: '1980' }, kids: { contentRating: 'G' } });
  assert.equal(shows.unwatchedLeaves, 1);
  assert.equal(shows.decade, '1980');
  assert.equal(shows.contentRating, 'G');
  assert.equal(shows.unwatched, undefined);
});

test('jellyfin filters use Genres, Years and height flags', () => {
  assert.deepEqual(jellyfinFilterParams({ genre: 'Drama', year: '2010' }), { Genres: 'Drama', Years: '2010' });
  const decade = jellyfinFilterParams({ decade: '1990' });
  assert.equal(decade.Years, '1990,1991,1992,1993,1994,1995,1996,1997,1998,1999');
  assert.deepEqual(jellyfinFilterParams({ resolution: '4k' }), { Is4K: true });
  assert.deepEqual(jellyfinFilterParams({ resolution: '1080' }), { IsHD: true, Is4K: false, MinHeight: 1000 });
  assert.deepEqual(jellyfinFilterParams({ resolution: '720' }), { IsHD: true, Is4K: false, MinHeight: 700, MaxHeight: 900 });
  assert.deepEqual(jellyfinFilterParams({ resolution: 'sd' }), { IsHD: false });
  const listed = jellyfinListingParams({
    filters: { genre: 'Drama', resolution: 'sd' }, unwatched: true, kids: { MaxOfficialRating: 'TV-PG' },
  });
  assert.equal(listed.Genres, 'Drama');
  assert.equal(listed.IsHD, false);
  assert.equal(listed.Filters, 'IsUnplayed');
  assert.equal(listed.MaxOfficialRating, 'TV-PG');
});

test('active filters show on the button and an empty set does not', () => {
  assert.equal(hasActiveFilters({}), false);
  assert.equal(hasActiveFilters({ genreTitle: 'Drama' }), false);
  assert.equal(hasActiveFilters({ genre: '42' }), true);
  assert.deepEqual(filterBits({ genre: '42', genreTitle: 'Drama', decade: '1990', decadeTitle: '1990s', resolutionTitle: '4K' }), ['Drama', '1990s', '4K']);
  assert.equal(filterButtonLabel({}), 'Filter');
  assert.equal(filterButtonLabel({ year: '1999', yearTitle: '1999' }), 'Filter: 1999');
});
