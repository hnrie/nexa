import type { PublicUser } from "@/api/types";

/**
 * Mentioning people in a note. A mention is written as it is in a message,
 * `<@id>`, and only the people who have the note are offered: anyone else
 * could not open it to see they were mentioned. Android ranks them the same
 * way (fish.nexa.notes.NoteMentions).
 */

/** How many people the list offers at once. */
export const MENTION_MAX = 8;

/**
 * The people whose name or username fits what was typed after the @, best
 * first: a name or username that starts with it, then one with a word that
 * starts with it, then one that has it anywhere; alphabetical within each.
 * Nothing typed yet offers everyone.
 */
export function mentionMatches(people: readonly PublicUser[], query: string, max = MENTION_MAX): PublicUser[] {
  const q = query.toLocaleLowerCase();
  const scored: { u: PublicUser; rank: number; name: string }[] = [];
  for (const u of people) {
    const name = (u.display_name || u.username).toLocaleLowerCase();
    const user = u.username.toLocaleLowerCase();
    let rank: number;
    if (!q || name.startsWith(q) || user.startsWith(q)) rank = 0;
    else if (name.split(/[\s._-]+/).some((w) => w.startsWith(q)) || user.split(/[._]+/).some((w) => w.startsWith(q))) rank = 1;
    else if (name.includes(q) || user.includes(q)) rank = 2;
    else continue;
    scored.push({ u, rank, name });
  }
  scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.u.id.localeCompare(b.u.id));
  return scored.slice(0, max).map((x) => x.u);
}

/** The people a note's text mentions, each once, in the order they first appear. */
export function mentionedIds(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/<@!?(\d{1,20})>/g)) out.add(m[1]!);
  return [...out];
}
