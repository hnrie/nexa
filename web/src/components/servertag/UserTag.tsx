import { useAuth } from "@/stores/auth";
import { useUsers } from "@/stores/users";
import { ServerTagChip } from "./ServerTagChip";

/**
 * The server tag someone wears, if any, for beside their name wherever it is
 * drawn. The account's own comes from itself, which changes the moment a tag
 * is put on or taken off here. It opens the server it is from only with
 * `open`, which a message's author has: in a list a tap is meant for the row,
 * and one that landed on the tag would open something else.
 */
export function UserTag({ userId, size = "md", open = false }: { userId: string | null | undefined; size?: "sm" | "md" | "lg"; open?: boolean }) {
  const theirs = useUsers((u) => (userId ? u.byId[userId]?.server_tag : undefined));
  const mine = useAuth((a) => (userId && a.me?.id === userId ? a.me.server_tag : undefined));
  const tag = mine !== undefined ? mine : theirs;
  if (!tag) return null;
  return <ServerTagChip tag={tag} size={size} open={open} />;
}
