import { api } from "./client";

/** The kinds of Discord activity a person can show, as bits of LinkedDiscord.kinds. */
export const DISCORD_KINDS = { playing: 1, listening: 2, watching: 4, streaming: 8, competing: 16 } as const;
export const DISCORD_KINDS_ALL = 31;

/** The Discord account linked for showing Discord activity here. */
export interface LinkedDiscord {
  id: string;
  username: string;
  global_name?: string;
  avatar_url?: string;
  /** In the Discord server Nexa's bot reads presence in. */
  in_guild: boolean;
  /** When it left that server (0: it has not, or it never got in). */
  left_at: number;
  /** Whether its activity shows at all. */
  show: boolean;
  kinds: number;
  /** The bot is connected to Discord and hearing it right now. */
  watching: boolean;
}

export interface DiscordState {
  /** Discord activity sync is set up on the server. */
  available: boolean;
  linked: LinkedDiscord | null;
  /** For admins: whether the bot is set up and connected, and why not. */
  bot?: { configured: boolean; connected: boolean; guild_id?: string; error?: string; redirect?: string };
}

export const connections = {
  discord(): Promise<DiscordState> {
    return api.request<DiscordState>("GET", "/connections/discord");
  },
  /** Discord's page for linking this account; the app goes there, and Discord sends it back. */
  authorizeDiscord(): Promise<{ url: string }> {
    return api.request<{ url: string }>("POST", "/connections/discord/authorize");
  },
  setDiscord(patch: { show?: boolean; kinds?: number }): Promise<DiscordState> {
    return api.request<DiscordState>("PATCH", "/connections/discord", patch);
  },
  unlinkDiscord(): Promise<void> {
    return api.request<void>("DELETE", "/connections/discord");
  },
  /** Puts the linked account back in the activity server after it left. */
  rejoinDiscord(): Promise<DiscordState> {
    return api.request<DiscordState>("POST", "/connections/discord/rejoin");
  },
};
