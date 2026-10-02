import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordState, LinkedDiscord } from "@/api/connections";

vi.mock("@/api/connections", () => ({ connections: { setDiscord: vi.fn(() => new Promise(() => undefined)) } }));

import { awaitDiscordLink, useDiscord } from "./discord";

const account: LinkedDiscord = { id: "1", username: "alice_d", in_guild: true, left_at: 0, show: true, kinds: 31, watching: true };
const unlinked: DiscordState = { available: true, linked: null };
const linked: DiscordState = { available: true, linked: account };

describe("a link the desktop app is waiting for", () => {
  beforeEach(() => {
    useDiscord.setState({ state: null });
    vi.useRealTimers();
  });

  it("says so once, when the link arrives from the server", () => {
    const then = vi.fn();
    useDiscord.getState().set(unlinked);
    awaitDiscordLink(then);
    useDiscord.getState().set(linked);
    expect(then).toHaveBeenCalledTimes(1);
    // the same account's later changes are not a new link
    useDiscord.getState().set({ ...linked, linked: { ...account, in_guild: false } });
    useDiscord.getState().set(unlinked);
    useDiscord.getState().set(linked);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a link nobody here asked for", () => {
    const then = vi.fn();
    useDiscord.getState().set(unlinked);
    useDiscord.getState().set(linked);
    expect(then).not.toHaveBeenCalled();
  });

  it("is not mistaken for the settings loading an account that was linked all along", () => {
    const then = vi.fn();
    awaitDiscordLink(then);
    // the first state this window hears of: already linked
    useDiscord.getState().set(linked);
    expect(then).not.toHaveBeenCalled();
  });

  it("gives up after the ten minutes Discord's page is good for", () => {
    vi.useFakeTimers();
    const then = vi.fn();
    useDiscord.getState().set(unlinked);
    awaitDiscordLink(then);
    vi.advanceTimersByTime(11 * 60_000);
    useDiscord.getState().set(linked);
    expect(then).not.toHaveBeenCalled();
  });
});
