/**
 * The words a plural could have been made from, for the checker to try when
 * the dictionaries do not know the plural itself. Their word lists give many
 * nouns no plural at all ("detection", "integration", "verification"), so
 * "detections" read as a misspelling although it is a word anyone would write.
 *
 * Only stems of four letters or more count: a short one turns slips such as
 * "thes" or "ands" into words, and every short noun's plural is in the lists
 * already.
 */
export function pluralStems(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (stem: string) => {
    if (stem.length >= 4 && !out.includes(stem)) out.push(stem);
  };
  // "categories" from "category", "boxes" from "box", "detections" from "detection"
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (/(?:s|x|z|ch|sh)es$/.test(w)) add(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("'s") && !w.endsWith("’s")) add(w.slice(0, -1));
  return out;
}
