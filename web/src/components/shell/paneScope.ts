import { createContext, useContext } from "react";

/**
 * Which pane the tree being rendered belongs to, and whether it is the one
 * with focus.
 *
 * With no provider — a single pane, or a phone — `focused` is true and `id` is
 * null, which is exactly the app as it was before panes existed. Anything that
 * only one part of the screen may do at a time asks here first.
 *
 * The composer is the reason this exists. It takes the caret a tick after it
 * mounts, which is right when there is one of it; with three tiled chats, three
 * composers each grabbed the caret from the last, and since taking the caret
 * also moved pane focus, the two chased each other until the tab locked up.
 */
export interface PaneScope {
  id: string | null;
  focused: boolean;
}

export const PaneCtx = createContext<PaneScope>({ id: null, focused: true });

export function usePaneScope(): PaneScope {
  return useContext(PaneCtx);
}
