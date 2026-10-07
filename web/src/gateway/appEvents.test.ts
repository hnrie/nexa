import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { Channel, Member, PublicUser, ReadyPayload, Relationship, ServerView } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { useTyping } from "@/stores/typing";
import { useUsers } from "@/stores/users";
import type { AppEvent } from "./appEvents";
import { applyEvent, dispatchHooks, resetAll } from "./dispatch";

const person = (id: string): PublicUser => ({ id, username: id, display_name: id }) as unknown as PublicUser;
const member = (server_id: string, user_id: string, nickname = ""): Member => ({ server_id, user_id, nickname, avatar_id: null, joined_at: 0, timeout_until: null, flags: 0, role_ids: [] });
const chan = (id: string, extra: Partial<Channel> = {}): Channel => ({ id, type: "text", server_id: "s1", name: id, position: 0, parent_id: null, recipient_ids: [], last_message_id: null, ...extra }) as unknown as Channel;
const view = (id: string): ServerView =>
  ({
    id,
    name: "Server " + id,
    icon_id: null,
    banner_id: null,
    owner_id: "me",
    description: "",
    system_channel_id: null,
    default_notifications: 0,
    flags: 0,
    created_at: 0,
    channels: [],
    roles: [{ id, server_id: id, name: "@everyone", color: 0, hoist: false, mentionable: false, position: 0, permissions: "0", icon_id: null, created_at: 0 }],
    members: [member(id, "me"), member(id, "bob")],
    member_count: 2,
    me: member(id, "me"),
    my_permissions: "0",
  }) as ServerView;
const rel = (id: string, type: Relationship["type"]): Relationship => ({ user: person(id), type, nickname: "", created_at: 0 });

function ready(over: Partial<ReadyPayload> = {}): ReadyPayload {
  return {
    session_id: "sess",
    user: { ...person("me"), flags: 0 } as unknown as ReadyPayload["user"],
    users: [],
    channels: [],
    relationships: [],
    read_states: [],
    presences: [],
    key_grants: [],
    settings: null,
    servers: [],
    emojis: [],
    sticker_packs: [],
    voice_states: [],
    ...over,
  };
}

let seen: AppEvent[] = [];
const record = (e: AppEvent) => void seen.push(e);
const types = () => seen.map((e) => e.type);

beforeEach(() => {
  api.request = <T>(): Promise<T> => Promise.resolve([] as T);
  resetAll();
  useChannels.setState({ byId: {} });
  useAuth.setState({ me: null });
  seen = [];
  dispatchHooks.onEvent.push(record);
});

afterEach(() => {
  dispatchHooks.onEvent.splice(dispatchHooks.onEvent.indexOf(record), 1);
  vi.useRealTimers();
});

describe("what happens in the app", () => {
  it("tells reactions, once the message's store has them", async () => {
    await applyEvent({ t: "reaction_add", d: { channel_id: "c1", message_id: "m1", user_id: "bob", emoji: "👍" } });
    await applyEvent({ t: "reaction_remove", d: { channel_id: "c1", message_id: "m1", user_id: "bob", emoji: "👍" } });
    expect(seen).toEqual([
      { type: "reaction", channelId: "c1", messageId: "m1", userId: "bob", emoji: "👍", added: true },
      { type: "reaction", channelId: "c1", messageId: "m1", userId: "bob", emoji: "👍", added: false },
    ]);
  });

  it("tells members coming, changing and going, with the member as they were when they go", async () => {
    useServers.getState().setFromView(view("s1"));
    seen = [];
    await applyEvent({ t: "member_add", d: { server_id: "s1", member: member("s1", "cara"), user: person("cara") } });
    await applyEvent({ t: "member_update", d: member("s1", "cara", "Cee") });
    let inStoreWhenTold: Member | undefined;
    dispatchHooks.onEvent.push((e) => {
      if (e.type === "memberUpdated") inStoreWhenTold = useServers.getState().byId["s1"]?.members["cara"];
    });
    await applyEvent({ t: "member_update", d: member("s1", "cara", "Cara") });
    await applyEvent({ t: "member_remove", d: { server_id: "s1", user_id: "cara", reason: "kick" } });
    dispatchHooks.onEvent.pop();
    expect(types()).toEqual(["memberJoined", "memberUpdated", "memberUpdated", "memberLeft"]);
    expect(inStoreWhenTold?.nickname).toBe("Cara");
    expect(seen[3]).toEqual({ type: "memberLeft", serverId: "s1", userId: "cara", member: expect.objectContaining({ nickname: "Cara" }) });
  });

  it("tells channels and threads created, changed and deleted, a channel's threads with it", async () => {
    await applyEvent({ t: "channel_create", d: chan("c1") });
    await applyEvent({ t: "channel_update", d: chan("c1", { name: "renamed" }) });
    await applyEvent({ t: "thread_create", d: chan("t1", { type: "thread", parent_id: "c1" }) });
    await applyEvent({ t: "thread_update", d: chan("t1", { type: "thread", parent_id: "c1", name: "t" }) });
    await applyEvent({ t: "channel_delete", d: { id: "c1", server_id: "s1" } });
    expect(types()).toEqual(["channelCreated", "channelUpdated", "channelCreated", "channelUpdated", "channelDeleted", "channelDeleted"]);
    expect(seen.slice(4)).toEqual([
      { type: "channelDeleted", id: "c1", serverId: "s1", channel: expect.objectContaining({ name: "renamed" }) },
      { type: "channelDeleted", id: "t1", serverId: "s1", channel: expect.objectContaining({ name: "t" }) },
    ]);
    seen = [];
    await applyEvent({ t: "thread_create", d: chan("t2", { type: "thread", parent_id: "c9" }) });
    await applyEvent({ t: "thread_delete", d: { id: "t2", parent_id: "c9", server_id: "s1" } });
    expect(seen[1]).toEqual({ type: "channelDeleted", id: "t2", serverId: "s1", channel: expect.objectContaining({ id: "t2" }) });
  });

  it("tells profiles and presence", async () => {
    await applyEvent({ t: "user_update", d: person("bob") });
    await applyEvent({ t: "presence", d: { user_id: "bob", status: "idle", status_text: "", status_emoji: "", status_expires_at: null } });
    expect(seen).toEqual([
      { type: "userUpdated", user: expect.objectContaining({ id: "bob" }) },
      { type: "presenceUpdated", presence: expect.objectContaining({ user_id: "bob", status: "idle" }) },
    ]);
  });

  it("keeps going past a listener that throws", async () => {
    dispatchHooks.onEvent.unshift(() => {
      throw new Error("plugin trouble");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await applyEvent({ t: "user_update", d: person("bob") });
    dispatchHooks.onEvent.shift();
    warn.mockRestore();
    expect(types()).toEqual(["userUpdated"]);
    expect(useUsers.getState().byId["bob"]).toBeDefined();
  });
});

describe("servers joined and left", () => {
  it("tells none for the servers ready brings", async () => {
    await applyEvent({ t: "ready", d: ready({ servers: [view("s1"), view("s2")] }) });
    expect(types()).toEqual([]);
  });

  it("tells a join once, however many ways the server arrives", async () => {
    useServers.getState().setFromView(view("s1"));
    await applyEvent({ t: "server_create", d: view("s1") });
    expect(seen).toEqual([{ type: "serverJoined", server: expect.objectContaining({ server: expect.objectContaining({ id: "s1" }) }) }]);
  });

  it("tells leaving, with the server as it was, and once only when the event follows", async () => {
    useServers.getState().setFromView(view("s1"));
    seen = [];
    useServers.getState().remove("s1");
    await applyEvent({ t: "server_delete", d: { id: "s1" } });
    expect(seen).toEqual([{ type: "serverLeft", id: "s1", server: expect.objectContaining({ server: expect.objectContaining({ name: "Server s1" }) }) }]);
  });

  it("tells what changed while the connection was down, after a reconnect's ready", async () => {
    await applyEvent({ t: "ready", d: ready({ servers: [view("s1")], relationships: [rel("bob", "friend")] }) });
    useTyping.getState().add("c1", "bob");
    seen = [];
    await applyEvent({ t: "ready", d: ready({ servers: [view("s2")], relationships: [rel("bob", "friend"), rel("cara", "incoming")] }) });
    expect(seen).toEqual(
      expect.arrayContaining([
        { type: "serverLeft", id: "s1", server: expect.anything() },
        { type: "serverJoined", server: expect.anything() },
        { type: "relationshipChanged", userId: "cara", user: expect.objectContaining({ id: "cara" }), relationship: "incoming", old: "none" },
        { type: "typing", channelId: "c1", userId: "bob", started: false },
      ]),
    );
    expect(seen).toHaveLength(4);
  });

  it("tells nothing at sign-out", () => {
    useServers.getState().setFromView(view("s1"));
    useRelationships.getState().set(rel("bob", "friend"));
    seen = [];
    resetAll();
    expect(seen).toEqual([]);
  });
});

describe("relationships", () => {
  it("tells each change once, with the old kind, a request sent from here included", async () => {
    useRelationships.getState().set(rel("bob", "outgoing"));
    await applyEvent({ t: "relationship_add", d: rel("bob", "outgoing") });
    await applyEvent({ t: "relationship_add", d: rel("bob", "friend") });
    await applyEvent({ t: "relationship_remove", d: { user_id: "bob" } });
    expect(seen).toEqual([
      { type: "relationshipChanged", userId: "bob", user: expect.objectContaining({ id: "bob" }), relationship: "outgoing", old: "none" },
      { type: "relationshipChanged", userId: "bob", user: expect.objectContaining({ id: "bob" }), relationship: "friend", old: "outgoing" },
      { type: "relationshipChanged", userId: "bob", user: expect.objectContaining({ id: "bob" }), relationship: "none", old: "friend" },
    ]);
  });
});

describe("typing", () => {
  const typing = () => seen.filter((e) => e.type === "typing");

  it("starts once while someone keeps typing, and stops when they say so", async () => {
    await applyEvent({ t: "typing", d: { channel_id: "c1", user_id: "bob" } } as never);
    await applyEvent({ t: "typing", d: { channel_id: "c1", user_id: "bob" } } as never);
    await applyEvent({ t: "typing", d: { channel_id: "c1", user_id: "bob", stop: true } } as never);
    expect(typing()).toEqual([
      { type: "typing", channelId: "c1", userId: "bob", started: true },
      { type: "typing", channelId: "c1", userId: "bob", started: false },
    ]);
  });

  it("stops when their message arrives", async () => {
    useAuth.setState({ me: { ...person("me"), flags: 0 } } as never);
    useChannels.getState().upsert([chan("c1")]);
    await applyEvent({ t: "typing", d: { channel_id: "c1", user_id: "bob" } } as never);
    const msg = { id: "50", channel_id: "c1", author_id: "bob", type: "default", ciphertext: null, mentions: [], mention_roles: [], mention_everyone: false, reactions: [], attachments: [], flags: 0, created_at: 0, edited_at: null, key_conv_id: null, key_epoch: 0, reply_to_id: null };
    await applyEvent({ t: "message_create", d: msg } as never);
    expect(typing().map((e) => e.type === "typing" && e.started)).toEqual([true, false]);
  });

  it("stops when their time runs out", () => {
    useTyping.getState().add("c1", "bob", 1000);
    useTyping.getState().sweep(1000 + 10_001);
    expect(typing().map((e) => e.type === "typing" && e.started)).toEqual([true, false]);
  });

  it("never tells someone blocked typing", async () => {
    useRelationships.getState().set(rel("eve", "blocked"));
    seen = [];
    await applyEvent({ t: "typing", d: { channel_id: "c1", user_id: "eve" } } as never);
    expect(typing()).toEqual([]);
  });
});
