import type { PublicUser } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";

/** An app's picture: its own icon, else its bot's avatar, else the letters of its name. */
export function AppIcon({ app, size = 40, square = false }: { app: { id: string; name: string; icon_id: string | null; bot?: Pick<PublicUser, "avatar_id"> | null }; size?: number; square?: boolean }) {
  if (app.icon_id) return <Avatar id={app.id} avatarId={app.icon_id} name={app.name} size={size} kind="icon" square={square} />;
  return <Avatar id={app.id} avatarId={app.bot?.avatar_id ?? null} name={app.name} size={size} square={square} />;
}
