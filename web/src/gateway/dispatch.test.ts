import { api } from "@/api/client";
import type { Channel, PublicUser, ReadyPayload } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { useReadStates } from "@/stores/readStates";
import { useTyping } from "@/stores/typing";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useAuth } from "@/stores/auth";
import type { DecryptedMessage } from "@/lib/decrypt";
import { applyEvent } from "./dispatch";

const chan = (id: string): Channel => ({ id, type: "text", server_id: "s1", name: id, position: 0, parent_id: null, recipient_ids: [], last_message_id: null }) as unknown as Channel;
const person = (id: string): PublicUser => ({ id, username: id, display_name: id }) as unknown as PublicUser;

function ready(channels: Channel[], users: PublicUser[]): ReadyPayload {
  return {
    session_id: "sess",
    user: { ...person("me"), flags: 0 } as unknown as ReadyPayload["user"],
    users,
    channels,
    relationships: [],
    read_states: [],
    presences: [],
    key_grants: [],
    settings: null,
    servers: [],
    emojis: [],
    sticker_packs: [],
    voice_states: [],
  };
}

describe("ready after a reconnect", () => {
  beforeEach(() => {
    // nothing here needs the network: reconcile and the gap sync find nothing
    api.request = <T>(): Promise<T> => Promise.resolve([] as T);
  });

  it("never leaves a channel missing from the store while it rebuilds", async () => {
    useChannels.getState().upsert([chan("call"), chan("gone")]);
    let missing = false;
    const unsub = useChannels.subscribe((st) => {
      if (!st.byId["call"]) missing = true;
    });
    await applyEvent({ t: "ready", d: ready([chan("call")], []) });
    unsub();
    expect(missing).toBe(false);
    expect(Object.keys(useChannels.getState().byId)).toEqual(["call"]);
  });

  it("keeps the people the open conversation shows", async () => {
    useUsers.getState().upsert([person("author"), person("mentioned"), person("stranger")]);
    const msg = { id: "10", channel_id: "c1", author_id: "author", mentions: ["mentioned"] } as unknown as DecryptedMessage;
    useMessages.setState({ channels: { c1: { ids: ["10"], byId: { "10": msg }, hasOlder: false, hasNewer: false, loading: false, loaded: true, failed: 0, pending: [] } } });
    useUI.setState({ activeChannelId: "c1" });
    await applyEvent({ t: "ready", d: ready([chan("c1")], [person("friend")]) });
    const byId = useUsers.getState().byId;
    expect(byId["author"]).toBeDefined();
    expect(byId["mentioned"]).toBeDefined();
    expect(byId["friend"]).toBeDefined();
    expect(byId["stranger"]).toBeUndefined();
    useUI.setState({ activeChannelId: null });
  });
});

describe("typing", () => {
  it("times the indicator from when it arrived, not the server's clock", async () => {
    useTyping.getState().clear();
    await applyEvent({ t: "typing", d: { channel_id: "c1", user_id: "u2", ts: Date.now() - 60_000 } } as Parameters<typeof applyEvent>[0]);
    expect(useTyping.getState().byChannel["c1"]?.["u2"]).toBeGreaterThan(Date.now());
  });
});

describe("message_delete_bulk", () => {
  it("takes the deleted messages out of the unread count, as a single delete does", async () => {
    useReadStates.setState({ byChannel: { c1: { lastReadId: "10", mentions: 0, unread: 3 } } });
    await applyEvent({ t: "message_delete_bulk", d: { channel_id: "c1", ids: ["11", "12", "5"] } } as Parameters<typeof applyEvent>[0]);
    expect(useReadStates.getState().byChannel["c1"]?.unread).toBe(1);
  });
});

describe("mentions in messages this device never loaded", () => {
  const ev = (x: unknown) => x as Parameters<typeof applyEvent>[0];
  const mentions = () => useReadStates.getState().byChannel["c2"]?.mentions;
  beforeEach(() => {
    useAuth.setState({ me: { ...person("me"), flags: 0 } } as never);
    useChannels.getState().upsert([chan("c2")]);
  });

  it("takes back a deleted mention its event says was one", async () => {
    useReadStates.setState({ byChannel: { c2: { lastReadId: "10", mentions: 2, unread: 0 } } });
    await applyEvent(ev({ t: "message_delete", d: { id: "11", channel_id: "c2", author_id: "u2", mentions: ["me"], mention_roles: [], mention_everyone: false } }));
    expect(mentions()).toBe(1);
    await applyEvent(ev({ t: "message_delete_bulk", d: { channel_id: "c2", ids: ["12", "13"], mentions: [{ id: "13", author_id: "u2", mentions: [], mention_roles: [], mention_everyone: true }] } }));
    expect(mentions()).toBe(0);
  });

  it("moves the count with an edit that adds or takes back a mention", async () => {
    useReadStates.setState({ byChannel: { c2: { lastReadId: "10", mentions: 0, unread: 0 } } });
    const msg = { id: "20", channel_id: "c2", author_id: "u2", type: "default", ciphertext: null, mentions: ["me"], mention_roles: [], mention_everyone: false, reactions: [], attachments: [] };
    await applyEvent(ev({ t: "message_update", d: { ...msg, was: { mentions: [], mention_roles: [], mention_everyone: false } } }));
    expect(mentions()).toBe(1);
    await applyEvent(ev({ t: "message_update", d: { ...msg, mentions: [], was: { mentions: ["me"], mention_roles: [], mention_everyone: false } } }));
    expect(mentions()).toBe(0);
    // an edit of a message already read changes nothing
    await applyEvent(ev({ t: "message_update", d: { ...msg, id: "9", was: { mentions: [], mention_roles: [], mention_everyone: false } } }));
    expect(mentions()).toBe(0);
  });
});
