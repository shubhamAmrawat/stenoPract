import nspell from 'nspell';
import dictionary from 'dictionary-en-gb';

let speller: ReturnType<typeof nspell> | undefined;

/** True if `word` (already lower-cased) is a valid British-English word. Loaded lazily, once. */
export function isDictionaryWord(word: string): boolean {
  speller ??= nspell({ aff: Buffer.from(dictionary.aff), dic: Buffer.from(dictionary.dic) });
  if (speller.correct(word)) return true;
  // Proper nouns are stored capitalised in the dictionary (Delhi, India ...).
  return speller.correct(word.charAt(0).toUpperCase() + word.slice(1));
}
