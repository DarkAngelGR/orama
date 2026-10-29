// Smart search: "80s horror", "unwatched comedies under 2 hours", "Keanu
// Reeves movies", "best sci-fi shows", "films directed by Nolan". No AI: the
// words are matched against the library's own genres, decades, lengths,
// watched state and people. parse() returns null when the text isn't a
// filter (most title searches), so ordinary searching is unchanged.

const FILLER = new Set(('a an the some any all me i my for to of in on from that which what with by and or ' +
  'watch watching good great something stuff titles title please show me find give').split(' '));

// Everyday words for genres. Values are matched against the server's own
// genre names (so "Science Fiction" on Plex, "Sci-Fi & Fantasy" on Jellyfin TV):
// the first one the server has wins; "a+b" means both.
const ALIASES = {
  scary: ['horror'], horrors: ['horror'], funny: ['comedy'], comedies: ['comedy'], comic: ['comedy'],
  scifi: ['science fiction', 'sci-fi'], 'sci-fi': ['science fiction', 'sci-fi'], 'sci fi': ['science fiction', 'sci-fi'],
  animated: ['animation'], cartoon: ['animation'], cartoons: ['animation'], romantic: ['romance'],
  romcom: ['romance+comedy'], romcoms: ['romance+comedy'], 'rom com': ['romance+comedy'], 'rom-com': ['romance+comedy'],
  kids: ['family', 'kids'], thrillers: ['thriller'], documentaries: ['documentary'], docs: ['documentary'],
  westerns: ['western'], musicals: ['musical', 'music'], dramas: ['drama'], mysteries: ['mystery'],
  'true crime': ['crime+documentary'], superhero: ['action'], fantasy: ['fantasy', 'sci-fi & fantasy'],
};

const norm = s => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

function take(state, re) {
  const m = re.exec(state.text);
  if (!m) return null;
  state.text = (state.text.slice(0, m.index) + ' ' + state.text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return m;
}

function minutesOf(n, unit) {
  return /^h/.test(unit) ? Math.round(parseFloat(n) * 60) : Math.round(parseFloat(n));
}

function fmtMinutes(m) {
  const h = Math.floor(m / 60);
  return h ? h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + 'm';
}

// genres: the server's genre names. Returns { type, genres, yearFrom, yearTo,
// watched, minMinutes, maxMinutes, sort, person, personRole, label } or null.
export function parse(input, genres = []) {
  const state = { text: ' ' + norm(input) + ' ' };
  if (state.text.trim().length < 3) return null;
  const f = { genres: [], parts: [] };
  let m;
  take(state, /\b(show me|give me|find me|i want|recommend( me)?)\b/);

  if (take(state, /\b(movies?|films?)\b/)) f.type = 'movie';
  else if (take(state, /\b(tv shows?|tv series|shows?|series)\b/)) f.type = 'show';

  if (take(state, /\b(unwatched|not (yet )?watched|haven'?t (seen|watched)|never seen|unseen|new to me)\b/)) f.watched = false;
  else if (take(state, /\b(already watched|watched( before)?|seen( before)?|rewatch)\b/)) f.watched = true;

  if ((m = take(state, /\b(?:the )?(19|20)?(\d)0'?s\b/))) {
    const d = Number(m[2]);
    const from = m[1] ? Number(m[1] + m[2] + '0') : (d <= 2 ? 2000 + d * 10 : 1900 + d * 10);
    f.yearFrom = from; f.yearTo = from + 9;
    f.parts.push(from + 's');
  } else if ((m = take(state, /\b(before|until|older than|pre)[ -]((19|20)\d\d)\b/))) {
    f.yearTo = Number(m[2]) - 1; f.parts.push('before ' + m[2]);
  } else if ((m = take(state, /\b(after|since|newer than|post)[ -]((19|20)\d\d)\b/))) {
    f.yearFrom = Number(m[1] === 'since' ? m[2] : Number(m[2]) + 1); f.parts.push((m[1] === 'since' ? 'since ' : 'after ') + m[2]);
  } else if ((m = take(state, /\b(?:from |in )?((19|20)\d\d)\b/))) {
    f.yearFrom = f.yearTo = Number(m[1]); f.parts.push(m[1]);
  }

  if ((m = take(state, /\b(under|less than|shorter than|below|max|at most)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/))) {
    f.maxMinutes = minutesOf(m[2], m[3]); f.parts.push('under ' + fmtMinutes(f.maxMinutes));
  } else if ((m = take(state, /\b(over|more than|longer than|at least)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/))) {
    f.minMinutes = minutesOf(m[2], m[3]); f.parts.push('over ' + fmtMinutes(f.minMinutes));
  } else if (take(state, /\b(short|quick)\b/)) {
    f.maxMinutes = 95; f.parts.push('short');
  } else if (take(state, /\b(long|epic)\b/)) {
    f.minMinutes = 150; f.parts.push('long');
  }

  if (take(state, /\b(best|top rated|top|highest rated|highly rated|acclaimed)\b/)) f.sort = 'rating';
  else if (take(state, /\b(newest|latest|recent|new)\b/)) f.sort = 'newest';
  else if (take(state, /\b(oldest|classic|classics|old)\b/)) f.sort = 'oldest';

  // Genres, as groups: each group is one wish ("sci-fi") and lists every server
  // genre that answers to it ("Science Fiction", "Sci-Fi & Fantasy"); a title
  // must match every group ("romcom" = Romance group + Comedy group).
  const known = genres.map(g => ({ name: g, key: norm(g), halves: norm(g).split(/ & | and /) }));
  const namesFor = phrase => known.filter(k => k.key === phrase || k.halves.includes(phrase)).map(k => k.name);
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const addGroup = names => {
    if (!names.length) return false;
    const key = names.slice().sort().join('|');
    if (!f.genres.some(g => g.slice().sort().join('|') === key)) f.genres.push(names);
    return true;
  };
  // The server's own names and their halves, longest first ("science fiction" before "fiction").
  const phrases = Array.from(new Set([].concat(...known.map(k => [k.key].concat(k.halves.length > 1 ? k.halves : [])))))
    .filter(p => p.length > 2).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    if (!take(state, new RegExp('\\b' + esc(phrase) + '(s|es)?\\b'))) continue;
    const alias = (ALIASES[phrase] || []).filter(o => o.indexOf('+') < 0);   // "sci-fi" is also "Science Fiction"
    addGroup([].concat(namesFor(phrase), ...alias.map(namesFor)).filter((n, i, all) => all.indexOf(n) === i));
  }
  // Everyday words.
  Object.keys(ALIASES).sort((a, b) => b.length - a.length).forEach(word => {
    const re = new RegExp('\\b' + word.replace(/[-]/g, '[- ]?') + '\\b');
    if (!re.test(state.text)) return;
    const plain = ALIASES[word].filter(o => o.indexOf('+') < 0);
    const both = ALIASES[word].find(o => o.indexOf('+') >= 0);
    let hit = false;
    if (both && both.split('+').every(a => namesFor(a).length)) hit = both.split('+').map(a => addGroup(namesFor(a))).some(Boolean);
    else if (plain.length) hit = addGroup([].concat(...plain.map(namesFor)).filter((n, i, a) => a.indexOf(n) === i));
    if (hit) take(state, re);
  });

  // People: "with X", "starring X", "by X" / "directed by X"; or what's left.
  if ((m = take(state, /\b(directed by|by|from director)\s+(.+)$/))) { f.person = m[2].trim(); f.personRole = 'director'; }
  else if ((m = take(state, /\b(with|starring|featuring)\s+(.+)$/))) { f.person = m[2].trim(); f.personRole = 'actor'; }

  const rest = state.text.split(' ').filter(w => w && !FILLER.has(w)).join(' ');
  if (rest) {
    if (f.person) return null;            // words we don't understand: not a filter
    f.person = rest;                      // maybe a name: "keanu reeves movies"
    f.personGuess = true;
  }
  const any = f.type || f.watched !== undefined || f.yearFrom || f.yearTo || f.minMinutes || f.maxMinutes || f.sort || f.genres.length || f.person;
  // A bare word is a title search, not a filter ("alien" is a movie, not a person).
  if (!any || (f.personGuess && !(f.type || f.genres.length || f.yearFrom || f.yearTo || f.watched !== undefined || f.sort))) return null;
  return f;
}

// "Horror · 1980s · unwatched · with Keanu Reeves", once the person is known.
export function label(f, personName) {
  const bits = [];
  // Each wish by its plainest name ("Science Fiction" over "Sci-Fi & Fantasy").
  if (f.genres.length) bits.push(f.genres.map(g => g.find(n => !/ & /.test(n)) || g[0]).join(' + '));
  bits.push(...f.parts);
  if (f.watched === false) bits.push('unwatched');
  if (f.watched === true) bits.push('watched');
  if (personName) bits.push((f.personRole === 'director' ? 'directed by ' : 'with ') + personName);
  const what = f.type === 'show' ? 'Shows' : f.type === 'movie' ? 'Movies' : 'Movies and shows';
  const sort = f.sort === 'rating' ? 'Best ' + what.toLowerCase() : f.sort === 'newest' ? 'Newest ' + what.toLowerCase() : f.sort === 'oldest' ? 'Oldest ' + what.toLowerCase() : what;
  return sort + (bits.length ? ': ' + bits.join(' · ') : '');
}

// Checks done on the TV (the servers can't filter these the same way).
export function matches(f, it) {
  const y = it.year || 0;
  if (f.yearFrom && y && y < f.yearFrom) return false;
  if (f.yearTo && y && y > f.yearTo) return false;
  const mins = it.duration ? it.duration / 60000 : 0;
  if (it.type === 'movie' && mins) {
    if (f.maxMinutes && mins > f.maxMinutes) return false;
    if (f.minMinutes && mins < f.minMinutes) return false;
  }
  if (f.watched === true && !(it.type === 'show' ? it.viewedLeafCount > 0 : it.viewCount)) return false;
  if (f.watched === false && (it.type === 'show' ? it.leafCount && it.viewedLeafCount >= it.leafCount : it.viewCount)) return false;
  if (f.genres.length && it.Genre && it.Genre.length) {
    const have = it.Genre.map(g => norm(g.tag));
    if (!f.genres.every(group => group.some(g => have.includes(norm(g))))) return false;
  }
  return true;
}
