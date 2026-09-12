import { useMemo } from "react";
import { emojiUrl } from "@/api/users";
import type { RenderCtx } from "@/markdown/ast";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";

/** Render context for markdown: names for mentions, emoji urls, click handlers. */
export function useRenderCtx(): RenderCtx {
  const users = useUsers((u) => u.byId);
  const channels = useChannels((c) => c.byId);
  const openModal = useUI((u) => u.openModal);
  return useMemo<RenderCtx>(
    () => ({
      users,
      channels,
      emojiUrl,
      onUserClick: (id) => openModal("profile", { userId: id }),
    }),
    [users, channels, openModal],
  );
}
