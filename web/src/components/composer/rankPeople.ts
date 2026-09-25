/**
 * The order @ suggestions come in. A name that is exactly what was typed
 * comes first, then names that start with it, then names with a word that
 * starts with it, then names that merely contain it; inside each, the people
 * who spoke here most recently lead, then the rest by name. The list used to
 * be the first eight members in the order the server listed them, so "@al"
 * could offer "michal" and leave "alice" off the end.
 */
export interface Person {
  id: string;
  username: string;
  display_name: string;
}

export function rankPeople<T extends Person>(query: string, people: T[], nickname: (id: string) => string, recent: ReadonlyMap<string, number>): T[] {
  const q = query.toLocaleLowerCase();
  const scored: { p: T; tier: number; recent: number; name: string }[] = [];
  for (const p of people) {
    const nick = nickname(p.id);
    const names = [p.username, p.display_name, nick].filter(Boolean).map((n) => n.toLocaleLowerCase());
    let tier: number;
    if (!q) tier = 3;
    else if (names.some((n) => n === q)) tier = 0;
    else if (names.some((n) => n.startsWith(q))) tier = 1;
    else if (names.some((n) => n.split(/[\s._-]+/u).some((w) => w.startsWith(q)))) tier = 2;
    else if (names.some((n) => n.includes(q))) tier = 3;
    else continue;
    scored.push({ p, tier, recent: recent.get(p.id) ?? Number.POSITIVE_INFINITY, name: (nick || p.display_name || p.username).toLocaleLowerCase() });
  }
  scored.sort((a, b) => a.tier - b.tier || a.recent - b.recent || a.name.localeCompare(b.name));
  return scored.map((x) => x.p);
}

/** Who spoke last, most recent first, as a rank per person: the newest messages of a conversation, newest first. */
export function recentSpeakers(authorsNewestFirst: Iterable<string>, skip?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of authorsNewestFirst) {
    if (id === skip || out.has(id)) continue;
    out.set(id, out.size);
  }
  return out;
}
