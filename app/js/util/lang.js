// Language codes come in several spellings (Plex: "ell" or "gre", files: "el",
// "gre", "greek"...). key() folds them to one ISO 639-1 code so tracks can be
// matched by language.
const ALIASES = {
  el: ['el', 'ell', 'gre', 'greek', 'ελληνικά'], en: ['en', 'eng', 'english'], es: ['es', 'spa', 'spanish'],
  fr: ['fr', 'fra', 'fre', 'french'], de: ['de', 'deu', 'ger', 'german'], it: ['it', 'ita', 'italian'],
  pt: ['pt', 'por', 'portuguese'], nl: ['nl', 'nld', 'dut', 'dutch'], ru: ['ru', 'rus', 'russian'],
  tr: ['tr', 'tur', 'turkish'], ar: ['ar', 'ara', 'arabic'], he: ['he', 'heb', 'hebrew'], ja: ['ja', 'jpn', 'japanese'],
  ko: ['ko', 'kor', 'korean'], zh: ['zh', 'zho', 'chi', 'chinese'], sv: ['sv', 'swe', 'swedish'], no: ['no', 'nor', 'nob', 'norwegian'],
  da: ['da', 'dan', 'danish'], fi: ['fi', 'fin', 'finnish'], pl: ['pl', 'pol', 'polish'], cs: ['cs', 'ces', 'cze', 'czech'],
  hu: ['hu', 'hun', 'hungarian'], ro: ['ro', 'ron', 'rum', 'romanian'], bg: ['bg', 'bul', 'bulgarian'], hr: ['hr', 'hrv', 'croatian'],
  sr: ['sr', 'srp', 'serbian'], uk: ['uk', 'ukr', 'ukrainian'], sq: ['sq', 'sqi', 'alb', 'albanian'],
};
const LOOKUP = {};
Object.keys(ALIASES).forEach(k => ALIASES[k].forEach(a => { LOOKUP[a] = k; }));

export function key(code) {
  const c = String(code || '').trim().toLowerCase().split(/[-_]/)[0];
  return LOOKUP[c] || c;
}

// Of a Plex stream.
export function ofStream(s) {
  return s ? key(s.languageCode || s.language || s.languageTag) : '';
}
