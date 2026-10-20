import { create } from "zustand";
import { apps as appsApi, type AppCommand, type ChannelCommands, type CommandApp } from "@/api/apps";

/**
 * What apps offer in each channel: their slash commands and the entries of
 * people's and messages' menus, as GET /channels/{id}/commands answers. Kept
 * for a few minutes per channel and loaded when a channel opens. When the
 * server says an app's commands changed (gateway application_commands_update)
 * or an app was added or taken away, every kept list goes stale: it stays in
 * use until it is read again, and the channel asked for last is read again at
 * once, so its menus and its message box never go without one.
 */

/** How long a channel's list is trusted before it is asked for again. */
const FRESH_MS = 5 * 60 * 1000;

interface Entry {
  at: number;
  data: ChannelCommands | null;
}

/** A command to start in a channel's message box: one clicked where someone else used it. */
export interface StartCommand {
  channelId: string;
  applicationId: string;
  /** The command's name, with its subcommands ("config set"). */
  name: string;
}

interface AppCommandsState {
  byChannel: Record<string, Entry>;
  /** A command waiting for the message box of its channel to pick it up. */
  start: StartCommand | null;
  startCommand: (s: StartCommand | null) => void;
  /** Loads a channel's list unless a fresh one is kept; resolves to it (null when it could not load). */
  load: (channelId: string, force?: boolean) => Promise<ChannelCommands | null>;
  /** Marks every kept list stale, so each is loaded again when it is next needed, and reloads the channel asked for last. */
  forget: () => void;
}

const inFlight = new Map<string, Promise<ChannelCommands | null>>();
/** The channel whose list was asked for last: the one open now. */
let lastChannel: string | null = null;

export const useAppCommands = create<AppCommandsState>((set, get) => ({
  byChannel: {},
  start: null,
  startCommand: (start) => set({ start }),
  load: (channelId, force = false) => {
    lastChannel = channelId;
    const kept = get().byChannel[channelId];
    if (!force && kept?.data && Date.now() - kept.at < FRESH_MS) return Promise.resolve(kept.data);
    const going = inFlight.get(channelId);
    if (going) return going;
    const p = appsApi
      .inChannel(channelId)
      .then((data) => {
        set((st) => ({ byChannel: { ...st.byChannel, [channelId]: { at: Date.now(), data } } }));
        return data;
      })
      .catch(() => kept?.data ?? null)
      .finally(() => inFlight.delete(channelId));
    inFlight.set(channelId, p);
    return p;
  },
  forget: () => {
    inFlight.clear();
    set((st) => ({ byChannel: Object.fromEntries(Object.entries(st.byChannel).map(([id, e]) => [id, { ...e, at: 0 }])) }));
    if (lastChannel) void get().load(lastChannel, true);
  },
}));

/** A channel's kept list, as it is now, stale or not (null until it has first loaded). */
export function channelCommands(channelId: string): ChannelCommands | null {
  return useAppCommands.getState().byChannel[channelId]?.data ?? null;
}

/** Command types. */
export const CMD_SLASH = 1;
export const CMD_USER = 2;
export const CMD_MESSAGE = 3;

/** The commands of one type a channel offers, each with its app, apps in the order the server listed them. */
export function commandsOfType(list: ChannelCommands | null, type: number): { app: CommandApp; command: AppCommand }[] {
  if (!list) return [];
  const apps = new Map(list.applications.map((a) => [a.id, a]));
  const out: { app: CommandApp; command: AppCommand }[] = [];
  for (const command of list.commands) {
    if (command.type !== type) continue;
    const app = apps.get(command.application_id);
    if (app) out.push({ app, command });
  }
  const order = new Map(list.applications.map((a, i) => [a.id, i]));
  return out.sort((a, b) => (order.get(a.app.id)! - order.get(b.app.id)!) || a.command.name.localeCompare(b.command.name));
}
