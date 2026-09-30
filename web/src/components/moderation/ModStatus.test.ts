import type { ModUser } from "@/api/moderation";
import type { Presence } from "@/api/types";
import { modStatus } from "./ModStatus";

const NOW = 1_800_000_000_000;
const song = { name: "Spotify", type: 2 as const, details: "Never Gonna Give You Up", state: "Rick Astley", created_at: 0 };

function user(over: Partial<ModUser> = {}): ModUser {
  return {
    id: "1", username: "bob", display_name: "Bob", avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null,
    status_text: "", status_emoji: "", status_expires_at: null, public_key: "", flags: 0, created_at: 0,
    admin_flags: 0, case_count: 0, open_cases: 0, awaiting_cases: 0, last_seen_at: null, mute: null, ban: null, blocked: "",
    ...over,
  };
}

function live(over: Partial<Presence> = {}): Presence {
  return { user_id: "1", status: "online", status_text: "", status_emoji: "", status_expires_at: null, ...over };
}

describe("a person's status in the moderation panel", () => {
  it("is what the grid loaded when this account cannot see them live", () => {
    const st = modStatus(user({ status_text: "on repeat", status_emoji: "🎧", presence: { status: "idle", activities: [song] } }), undefined, NOW);
    expect(st).toEqual({ status: "idle", custom: { text: "on repeat", emoji: "🎧" }, activities: [song] });
  });

  it("follows the live presence when there is one", () => {
    const st = modStatus(user({ presence: { status: "offline" } }), live({ status: "dnd", status_text: "busy", activities: [song] }), NOW);
    expect(st.status).toBe("dnd");
    expect(st.custom).toEqual({ text: "busy", emoji: "" });
    expect(st.activities).toEqual([song]);
  });

  it("believes a live offline over an older snapshot, and shows no activity then", () => {
    const st = modStatus(user({ presence: { status: "online", activities: [song] } }), live({ status: "offline" }), NOW);
    expect(st).toMatchObject({ status: "offline", activities: [] });
  });

  it("keeps a written status in view while they are away, for staff to see", () => {
    const st = modStatus(user({ status_text: "night shift", presence: { status: "offline" } }), undefined, NOW);
    expect(st).toEqual({ status: "offline", custom: { text: "night shift", emoji: "" }, activities: [] });
  });

  it("drops a written status that has run out", () => {
    expect(modStatus(user({ status_text: "back soon", status_expires_at: NOW - 1 }), undefined, NOW).custom).toBeNull();
    expect(modStatus(user({ status_text: "back soon", status_expires_at: NOW + 1 }), undefined, NOW).custom).toEqual({ text: "back soon", emoji: "" });
  });

  it("reads an older server's accounts, which carry no presence, as offline", () => {
    expect(modStatus(user(), undefined, NOW)).toEqual({ status: "offline", custom: null, activities: [] });
  });
});
