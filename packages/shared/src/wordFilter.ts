// A small bad-word filter for text strangers will see in the public lobby list (room names, and
// host names shown there). Catches common profanity and slurs, including l33t spellings, spaced
// or dotted letters and repeated letters. It's a first line, not a guarantee: players can still
// report, hosts can remove, and admins can ban.

/** Matched anywhere inside the text (after normalising). Long enough not to hit innocent words. */
const ANYWHERE = [
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'fagot', 'retard', 'whore', 'slut', 'dick', 'cock', 'pussy', 'penis', 'vagina',
  'porn', 'rape', 'rapist', 'nazi', 'hitler', 'kike', 'spic', 'chink', 'tranny', 'wank', 'twat', 'bollock', 'asshole', 'bastard', 'motherf',
  'jizz', 'cum', 'dildo', 'boob', 'tits', 'nude', 'sex', 'kys', 'killyourself',
];
/** Only as whole words (they're inside innocent words: class, Scunthorpe, cockatoo is caught above). */
const WHOLE = ['ass', 'fag', 'hoe', 'hore', 'tit', 'gay', 'homo', 'anal', 'cumming', 'jew'];
/** Inside-word matches that are fine (checked before the list). */
const ALLOWED = ['cocktail', 'cockatoo', 'peacock', 'hitchcock', 'scunthorpe', 'cumberland', 'cucumber', 'dickens', 'sussex', 'essex', 'middlesex', 'shitake', 'shiitake', 'document', 'circumstance', 'spice', 'spicy', 'grape', 'drape', 'therapist', 'skyscraper'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g', '(': 'c' };

/** Lowercase, accents off, l33t to letters. Keeps spaces between words. */
function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0-9!|@$+(]/g, (c) => LEET[c] ?? c);
}

const squash = (s: string) => s.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');

/** True if `text` contains a listed word (spaced, dotted, l33t and doubled letters included). */
export function hasBadWords(text: string): boolean {
  const norm = normalise(text);
  let joined = squash(norm);
  for (const ok of ALLOWED) joined = joined.split(squash(ok)).join('_');
  if (ANYWHERE.some((w) => joined.includes(squash(w)))) return true;
  const words = norm.split(/[^a-z]+/).filter(Boolean).map(squash);
  return words.some((w) => WHOLE.map(squash).includes(w));
}

/**
 * The same text with filtered words masked by asterisks (same length, so the line still reads
 * naturally): "you f***ing c***" -> "you ******* ****". Spaced-out words ("f u c k") are masked
 * as a whole. Used for chat in public rooms.
 */
export function maskBadWords(text: string): string {
  const parts = text.split(/(\s+)/);
  // Trailing punctuation stays ("f u c k," -> "* * * *,").
  const star = (s: string) => {
    const m = s.match(/^(.*?)([,.?;:]*)$/s)!;
    return '*'.repeat(m[1].length) + m[2];
  };
  /** One letter, maybe with punctuation around it ("k," in "f u c k,"). */
  const single = (s: string) => s.replace(/[,.?;:'"()]/g, '').length === 1;
  // Runs of single characters ("f u c k", "s h i t") are checked together.
  for (let i = 0; i < parts.length; i += 2) {
    if (!single(parts[i])) continue;
    let j = i;
    while (j + 2 < parts.length && single(parts[j + 2])) j += 2;
    if (j > i) {
      const run = parts.slice(i, j + 1).filter((_, k) => k % 2 === 0).join('');
      if (hasBadWords(run)) for (let k = i; k <= j; k += 2) parts[k] = star(parts[k]);
      i = j;
    }
  }
  for (let i = 0; i < parts.length; i += 2) if (parts[i] && hasBadWords(parts[i])) parts[i] = star(parts[i]);
  return parts.join('');
}
