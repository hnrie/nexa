import { create } from "zustand";
import { connections, type DiscordState } from "@/api/connections";
import { useSettings } from "@/stores/settings";

/** The account's linked Discord account, for Settings → Activity and the banner about leaving its server. */
interface DiscordStore {
  state: DiscordState | null;
  set: (state: DiscordState) => void;
  load: () => Promise<void>;
  clear: () => void;
}

/** How long after asking to link in the desktop app a new link is taken to be that one. */
const LINK_WAIT_MS = 10 * 60_000;
let awaitingLink = 0;
let onLinked: (() => void) | null = null;

/**
 * The desktop app sends the system's browser to Discord and waits here. When
 * the link it asked for arrives from the server, `then` runs, once.
 */
export function awaitDiscordLink(then: () => void): void {
  awaitingLink = Date.now();
  onLinked = then;
}

export const useDiscord = create<DiscordStore>()((set, get) => ({
  state: null,
  set: (state) => {
    const was = get().state;
    set({ state });
    alignShare();
    if (onLinked && state.linked && was && !was.linked) {
      const then = onLinked;
      const fresh = Date.now() - awaitingLink < LINK_WAIT_MS;
      onLinked = null;
      if (fresh) then();
    }
  },
  load: async () => {
    try {
      useDiscord.getState().set(await connections.discord());
    } catch {
      /* an older server without the route, or offline: nothing linked to show */
    }
  },
  clear: () => set({ state: null }),
}));

/**
 * "Share my activity with others" is one switch for both places activity
 * comes from. The desktop app's is kept back on this side; what Discord says
 * is shown by the server, so the server is told to match. The account's
 * settings are what decides, on every device, so a server that disagrees is
 * put right whenever either side changes.
 */
function alignShare(): void {
  const linked = useDiscord.getState().state?.linked;
  const st = useSettings.getState();
  if (!linked || !st.loaded) return;
  const want = st.settings.shareActivity !== false;
  if (linked.show === want) return;
  void connections
    .setDiscord({ show: want })
    .then((next) => useDiscord.setState({ state: next }))
    .catch(() => undefined);
}

let installed = false;

/** Keeps the server's copy of the switch in step with the settings. */
export function installDiscord(): void {
  if (installed) return;
  installed = true;
  useSettings.subscribe((s, prev) => {
    if (s.loaded !== prev.loaded || s.settings.shareActivity !== prev.settings.shareActivity) alignShare();
  });
}
