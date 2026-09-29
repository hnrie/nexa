import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { Channel, PublicUser, Relationship } from "@/api/types";
import { b64 } from "@/crypto/bytes";
import { generateIdentity } from "@/crypto/keys";
import { closePins, openPins, pinKey } from "@/lib/keyPins";
import { openRequestNote } from "@/lib/requestNote";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useKeyAlerts } from "@/stores/keyAlerts";
import { useRelationships } from "@/stores/relationships";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { FLAG_SYSTEM } from "@/lib/moderation";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  accept: vi.fn(),
  remove: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  setNote: vi.fn(),
}));
vi.mock("@/api/relationships", () => ({ relationships: api }));
// no captcha on Nexa: the request goes straight out
vi.mock("@/lib/captcha", () => ({ guarded: (_action: string, send: (c: string | null) => Promise<unknown>) => send(null) }));

import { acceptFriendRequest, addRequestNote, blockUser, dropFriendRequest, relationshipMenuItems, sendFriendRequest, unblockUser, useRelationshipBusy } from "./friendship";

const eve = { id: "eve", username: "eve", display_name: "Eve", avatar_id: null, flags: 0 } as unknown as PublicUser;
const nexa = { id: "nexa", username: "nexa", display_name: "Nexa", avatar_id: null, flags: FLAG_SYSTEM } as unknown as PublicUser;
const rel = (type: Relationship["type"]): Relationship => ({ user: eve, type, nickname: "", created_at: 5 });
const typeOf = () => useRelationships.getState().byUser["eve"]?.type;

beforeEach(() => {
  useAuth.setState({ me: { id: "me", username: "me", display_name: "Me", flags: 0 } as never });
  useUsers.setState({ byId: { eve } });
  useRelationships.getState().clear();
  useUI.setState({ toasts: [], modals: [], modal: null });
});

afterEach(() => {
  vi.clearAllMocks();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
});

describe("sending a friend request", () => {
  it("shows it as sent the moment the server answers, not when the gateway echoes it", async () => {
    let answer!: (v: unknown) => void;
    api.request.mockReturnValue(new Promise((r) => (answer = r)));
    const sent = sendFriendRequest(eve);
    // on its way: the buttons wait, and a second press sends nothing
    expect(useRelationshipBusy.getState().busy["eve"]).toBe(true);
    await sendFriendRequest(eve);
    expect(api.request).toHaveBeenCalledTimes(1);
    answer({ type: "outgoing", user: eve });
    expect(await sent).toBe("outgoing");
    expect(typeOf()).toBe("outgoing");
    expect(useRelationshipBusy.getState().busy["eve"]).toBeUndefined();
  });

  it("becomes friends straight away when they had already asked", async () => {
    api.request.mockResolvedValue({ type: "friend", user: eve });
    expect(await sendFriendRequest(eve)).toBe("friend");
    expect(typeOf()).toBe("friend");
  });

  it("catches up when another device already sent it, rather than calling it a failure", async () => {
    api.request.mockRejectedValue(new ApiError(400, "already_sent", "You already sent a request."));
    expect(await sendFriendRequest(eve)).toBe("outgoing");
    expect(typeOf()).toBe("outgoing");
    expect(useUI.getState().toasts).toEqual([]);
  });

  it("says why it failed and changes nothing", async () => {
    api.request.mockRejectedValue(new ApiError(403, "blocked", "You cannot send a request to this user."));
    expect(await sendFriendRequest(eve)).toBeNull();
    expect(typeOf()).toBeUndefined();
    expect(useUI.getState().toasts.map((t) => t.kind)).toEqual(["error"]);
  });
});

describe("answering and taking back requests", () => {
  it("accepts, and keeps the conversation the server opened", async () => {
    useRelationships.getState().set(rel("incoming"));
    const dm = { id: "d1", type: "dm", recipient_ids: ["me", "eve"] } as unknown as Channel;
    api.accept.mockResolvedValue({ type: "friend", user: eve, channel: dm });
    expect(await acceptFriendRequest(eve)).toBe(dm);
    expect(typeOf()).toBe("friend");
    expect(useChannels.getState().byId["d1"]).toBeTruthy();
  });

  it("drops a request that is no longer there when accepting it fails for that reason", async () => {
    useRelationships.getState().set(rel("incoming"));
    api.accept.mockRejectedValue(new ApiError(404, "no_request", "There is no pending request from that user."));
    expect(await acceptFriendRequest(eve)).toBeUndefined();
    expect(typeOf()).toBeUndefined();
  });

  it("ignores or cancels, and treats one already gone as done", async () => {
    useRelationships.getState().set(rel("outgoing"));
    api.remove.mockRejectedValue(new ApiError(404, "not_found", "Not found."));
    expect(await dropFriendRequest("eve")).toBe(true);
    expect(typeOf()).toBeUndefined();
    expect(useUI.getState().toasts.map((t) => t.text)).toEqual(["Request cancelled."]);
  });
});

describe("blocking", () => {
  it("blocks and keeps the dialog's choices as the account's", async () => {
    api.block.mockResolvedValue(undefined);
    await blockUser(eve, { hideMessages: true, hideReplies: true });
    expect(typeOf()).toBe("blocked");
    expect(useSettings.getState().settings.blocking).toEqual({ hideMessages: true, hideReplies: true });
  });

  it("unblocks", async () => {
    useRelationships.getState().set(rel("blocked"));
    api.unblock.mockResolvedValue(undefined);
    expect(await unblockUser("eve")).toBe(true);
    expect(typeOf()).toBeUndefined();
  });
});

describe("relationshipMenuItems", () => {
  const ids = (id = "eve") => relationshipMenuItems(id).map((i) => i.id);
  it("offers what fits where things stand", () => {
    expect(ids()).toEqual(["add-friend", "block"]);
    useRelationships.getState().set(rel("incoming"));
    expect(ids()).toEqual(["accept-request", "ignore-request", "block"]);
    useRelationships.getState().set(rel("outgoing"));
    expect(ids()).toEqual(["cancel-request", "block"]);
    useRelationships.getState().set(rel("friend"));
    expect(ids()).toEqual(["remove-friend", "block"]);
    useRelationships.getState().set(rel("blocked"));
    expect(ids()).toEqual(["unblock"]);
  });

  it("offers nothing about yourself or the system account", () => {
    useUsers.setState({ byId: { eve, nexa, me: { id: "me", username: "me", display_name: "Me", flags: 0 } as unknown as PublicUser } });
    expect(ids("me")).toEqual([]);
    expect(ids("nexa")).toEqual([]);
  });

  it("opens the one block dialog", () => {
    relationshipMenuItems("eve").find((i) => i.id === "block")!.onSelect!();
    expect(useUI.getState().modals.map((m) => [m.kind, m.props])).toEqual([["block", { userId: "eve" }]]);
  });
});

describe("a note on a friend request", () => {
  const sam = generateIdentity();
  const samUser = { id: "sam", username: "sam", display_name: "Sam", avatar_id: null, flags: 0, public_key: b64.enc(sam.publicKey) } as unknown as PublicUser;
  beforeEach(() => {
    useUsers.setState({ byId: { sam: samUser } });
    useKeyAlerts.getState().reset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    closePins();
    vi.restoreAllMocks();
  });

  it("is sealed on this device to their key, so only they can read it", async () => {
    api.setNote.mockResolvedValue(undefined);
    expect(await addRequestNote(samUser, "Hi, it's Sam from the climbing gym")).toBe(true);
    expect(api.setNote).toHaveBeenCalledTimes(1);
    const [id, sealed] = api.setNote.mock.calls[0] as [string, string];
    expect(id).toBe("sam");
    expect(sealed).not.toContain("climbing");
    expect(await openRequestNote(sam, sealed)).toBe("Hi, it's Sam from the climbing gym");
    expect(await openRequestNote(generateIdentity(), sealed)).toBeNull();
    expect(useUI.getState().toasts).toEqual([]);
  });

  it("says the request went but the note did not, when the note cannot be added", async () => {
    api.setNote.mockRejectedValue(new ApiError(404, "no_request", "You have no pending request to that user."));
    expect(await addRequestNote(samUser, "hello")).toBe(false);
    expect(useUI.getState().toasts.map((x) => x.text)).toEqual(["Your friend request was sent, but the note could not be added."]);
  });

  it("is not sealed to a key other than the one this device pinned for them", async () => {
    openPins("me");
    // the key this device first met them with, before the server offered another
    pinKey("sam", b64.enc(generateIdentity().publicKey));
    expect(await addRequestNote(samUser, "hello")).toBe(false);
    expect(api.setNote).not.toHaveBeenCalled();
    expect(useKeyAlerts.getState().pending["sam"]?.offered).toBe(samUser.public_key);
    expect(useUI.getState().toasts.map((x) => x.kind)).toEqual(["error"]);
  });
});

