import type { PublicUser } from "@/api/types";

/** Turns `@username` tokens into `<@id>` and collects the mentioned ids. Code spans and links (youtube.com/@name) are left alone. */
export function extractMentions(text: string, users: Record<string, PublicUser>): { text: string; mentions: string[]; everyone: boolean } {
  const byName = new Map<string, string>();
  for (const u of Object.values(users)) byName.set(u.username, u.id);
  const mentions = new Set<string>();
  let everyone = false;
  const segments = text.split(/(```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<]+)/i);
  const out = segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg.replace(/(^|[^\w<])@([a-z0-9_.]{2,32}|everyone|here)\b/g, (m, pre: string, name: string) => {
        if (name === "everyone" || name === "here") {
          everyone = true;
          return m;
        }
        const id = byName.get(name);
        if (!id) return m;
        mentions.add(id);
        return `${pre}<@${id}>`;
      });
    })
    .join("");
  for (const m of out.matchAll(/<@!?(\d+)>/g)) mentions.add(m[1]!);
  return { text: out, mentions: [...mentions], everyone };
}

/** Inverse for editing: `<@id>` back to `@username` when the user is known. */
export function humanizeMentions(text: string, users: Record<string, PublicUser>): string {
  return text.replace(/<@!?(\d+)>/g, (m, id: string) => {
    const u = users[id];
    return u ? `@${u.username}` : m;
  });
}
