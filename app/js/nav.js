// Where selecting things goes. Kept in one place so screens don't import each other.
import * as router from './router.js';
import { DetailScreen } from './screens/detail.js';
import { LibraryScreen } from './screens/library.js';
import { PlayerScreen } from './screens/player.js';
import { SearchScreen } from './screens/search.js';
import { SettingsScreen } from './screens/settings.js';
import { CatalogScreen } from './screens/catalog.js';
import { PersonScreen } from './screens/person.js';

export function openItem(item) {
  if (item.type === 'clip') { playItem(item); return; }
  router.push(DetailScreen(item));
}

export function playItem(item, opts) {
  if (item.type === 'show' || item.type === 'season') {
    // Play on a show means "the next episode"; the detail screen resolves it.
    router.push(DetailScreen(item, { autoplay: true }));
    return;
  }
  router.push(PlayerScreen(item, opts || {}));
}

export function openLibrary(section) {
  router.push(LibraryScreen(section));
}

export function openSearch() {
  router.push(SearchScreen());
}

export function openSettings() {
  router.push(SettingsScreen());
}

// A title from Plex's catalog that isn't on your server.
export function openPerson(person) {
  router.push(PersonScreen(person));
}

// A title's catalog page (details, Add to Watchlist), found by title and year.
export async function openCatalogLookup({ title, year, kind }) {
  const { search } = await import('./plex/discover.js');
  const found = await search(title, { limit: 10 });
  const type = kind === 'show' ? 'show' : 'movie';
  const m = found.find(x => x.type === type && (!year || Math.abs((x.year || 0) - year) <= 1)) || found.find(x => x.type === type);
  if (m) openCatalog(m);
  return !!m;
}

export function openCatalog(item) {
  router.push(CatalogScreen(item));
}
