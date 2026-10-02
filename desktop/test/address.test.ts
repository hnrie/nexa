/**
 * Nexa moved to nexa.fish. This app opens the new address, and the first
 * time it starts it opens the old one once, so the page there can carry its
 * sign-in over (web/src/lib/move.ts).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: true } }));

const { ORIGIN, START_URL, MOVE_URL, MOVED_FROM, isAppUrl, isMovedUrl } = await import("../src/main/config");

describe("Nexa's address", () => {
  it("is nexa.fish, and only pages there are the app", () => {
    expect(ORIGIN).toBe("https://nexa.fish");
    expect(START_URL).toBe("https://nexa.fish/channels/@me");
    expect(isAppUrl("https://nexa.fish/channels/@me")).toBe(true);
    expect(isAppUrl("https://chat.evilion.xyz/channels/@me")).toBe(false);
    expect(isAppUrl("https://nexa.fish.evil.example/")).toBe(false);
  });

  it("knows the address it moved from, to carry a sign-in over from once", () => {
    expect(MOVED_FROM).toEqual(["https://chat.evilion.xyz"]);
    expect(MOVE_URL).toBe("https://chat.evilion.xyz/channels/@me");
    expect(isMovedUrl("https://chat.evilion.xyz/channels/@me")).toBe(true);
    expect(isMovedUrl("https://nexa.fish/")).toBe(false);
    expect(isMovedUrl("https://chat.evilion.xyz.evil.example/")).toBe(false);
  });
});
