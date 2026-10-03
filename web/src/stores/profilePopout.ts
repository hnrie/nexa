import { create } from "zustand";

/**
 * Someone's profile popout, open beside what was pressed: a name or a picture
 * in a message, a row of the member list, a mention. It says the little that
 * matters at a glance; the whole profile is a press away on it.
 */
export interface OpenProfilePopout {
  userId: string;
  anchor: HTMLElement;
  /** The server it was opened in, whose roles it shows. */
  serverId?: string | undefined;
}

export const useProfilePopout = create<{ open: OpenProfilePopout | null }>()(() => ({ open: null }));

/** Opens someone's popout beside `anchor`, or closes it when it is open from there already. */
export function openProfilePopout(userId: string, anchor: HTMLElement, serverId?: string): void {
  const cur = useProfilePopout.getState().open;
  if (cur && cur.anchor === anchor && cur.userId === userId) {
    useProfilePopout.setState({ open: null });
    return;
  }
  useProfilePopout.setState({ open: { userId, anchor, serverId } });
}

export function closeProfilePopout(): void {
  useProfilePopout.setState({ open: null });
}
