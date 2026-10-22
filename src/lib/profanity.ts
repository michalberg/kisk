// Simple filter for word cloud entries. Matching runs on text without diacritics.
// Deliberately short: it catches the obvious, the controller can hide the rest by hand.

const STEMS = [
  'kurv', 'kurev', 'prdel', 'prdel', 'hovn', 'sracka', 'srac', 'zasran', 'posran', 'mrdk', 'mrdat', 'zmrd',
  'jebat', 'jeban', 'jebe', 'jebl', 'vyjeb', 'pojeb', 'zajeb', 'kokot', 'curak', 'pica', 'pice', 'picu',
  'picovin', 'picus', 'piča', 'debil', 'idiot', 'kreten', 'buzerant', 'buzna', 'cikan', 'negr', 'kunda',
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'nigger', 'whore', 'slut',
];

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STRIPPED = [...new Set(STEMS.map(strip))];

export function isProfane(word: string): boolean {
  const w = strip(word);
  // short stems must start a word so that e.g. "epica" or "picture" pass
  return STRIPPED.some(stem =>
    stem.length <= 4 ? new RegExp(`(^|[^a-z])${stem}`).test(w) : w.includes(stem),
  );
}
