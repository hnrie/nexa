import { api } from "@/api/client";
import type { RequestOptions } from "@/api/client";
import type { KeyGrant, Message } from "@/api/types";
import { b64 } from "@/crypto/bytes";
import { channelKey } from "@/crypto/conv";
import { generateIdentity } from "@/crypto/keys";
import { keystore } from "@/crypto/keystore";
import { encryptMessage } from "@/crypto/message";
import { decryptForStore } from "@/lib/decrypt";
import { ring } from "@/lib/keyring";
import { applyEvent } from "@/gateway/dispatch";
import { useAuth } from "./auth";
import { useKeys } from "./keys";
import { useMessages } from "./messages";
import { useUsers } from "./users";

const alice = generateIdentity();
const bob = generateIdentity();

function user(id: string, pub: Uint8Array) {
  return {
    id,
    username: id,
    display_name: id,
    avatar_id: null,
    banner_id: null,
    about_me: "",
    pronouns: "",
    accent_color: null,
    status_text: "",
    status_emoji: "",
    status_expires_at: null,
    public_key: b64.enc(pub),
    flags: 0,
    created_at: 0,
  };
}

describe("key manager", () => {
  const putGrants: { conv_id: string; epoch: number; user_id: string; wrapped_key: string }[] = [];
  beforeEach(async () => {
    putGrants.length = 0;
    await keystore.clear("A");
    await keystore.clear("B");
    useKeys.getState().reset();
    useMessages.getState().clearAll();
    useUsers.getState().upsert([user("A", alice.publicKey), user("B", bob.publicKey)]);
    api.request = <T>(method: string, path: string, body?: unknown, _opts?: RequestOptions): Promise<T> => {
      if (method === "POST" && path === "/keys/epochs") return Promise.resolve({ conv_id: "conv1", epoch: 0, user_ids: ["A", "B"] } as T);
      if (method === "POST" && path === "/keys/grants") {
        putGrants.push(...(body as typeof putGrants));
        return Promise.resolve({ inserted: (body as unknown[]).length } as T);
      }
      if (method === "GET" && path === "/keys/needs") return Promise.resolve([] as T);
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    };
  });

  it("creates an epoch, grants everyone, and the recipient can unwrap it", async () => {
    await useKeys.getState().init("A", alice);
    const got = await useKeys.getState().ensureConvKey("conv1");
    expect(got?.epoch).toBe(0);
    expect(putGrants.map((g) => g.user_id).sort()).toEqual(["A", "B"]);
    const forBob = putGrants.find((g) => g.user_id === "B")!;
    const rootA = ring.get("conv1", 0)!;

    // Bob's session ingests the grant and derives the same channel key.
    useKeys.getState().reset();
    await useKeys.getState().init("B", bob);
    const grant: KeyGrant = { conv_id: "conv1", epoch: 0, user_id: "B", wrapped_key: forBob.wrapped_key, wrapped_by: "A", created_at: 1 };
    const changed = await useKeys.getState().ingestGrants([grant]);
    expect(changed).toEqual(["conv1"]);
    expect(b64.enc(ring.get("conv1", 0)!)).toBe(b64.enc(rootA));
    expect(b64.enc(channelKey(ring.get("conv1", 0)!, "chan9"))).toBe(b64.enc(channelKey(rootA, "chan9")));
  });

  it("re-decrypts waiting messages when a grant arrives", async () => {
    // Alice encrypts a message with a root Bob does not have yet.
    await useKeys.getState().init("A", alice);
    await useKeys.getState().ensureConvKey("conv1");
    const root = ring.get("conv1", 0)!;
    const env = await encryptMessage(channelKey(root, "chan9"), { conv: "conv1", epoch: 0, channelId: "chan9", authorId: "A" }, { t: "secret" });
    const forBob = putGrants.find((g) => g.user_id === "B")!;

    useKeys.getState().reset();
    await useKeys.getState().init("B", bob);
    useAuth.setState({ me: { ...user("B", bob.publicKey), presence_pref: "online", dm_privacy: "everyone", has_recovery: false } });
    const m: Message = {
      id: "5",
      channel_id: "chan9",
      author_id: "A",
      type: "default",
      ciphertext: env,
      key_conv_id: "conv1",
      key_epoch: 0,
      reply_to_id: null,
      mentions: [],
      mention_roles: [],
      mention_everyone: false,
      attachments: [],
      reactions: [],
      flags: 0,
      edited_at: null,
      created_at: 1,
    };
    const first = await decryptForStore(m);
    expect(first.decryptError).toBe("no_key");
    await applyEvent({ t: "message_create", d: m });
    expect(useMessages.getState().channels["chan9"]?.byId["5"]?.decryptError).toBe("no_key");
    expect(useKeys.getState().waiting["conv1"]).toBe(true);
    await applyEvent({ t: "key_grant", d: { conv_id: "conv1", epoch: 0, user_id: "B", wrapped_key: forBob.wrapped_key, wrapped_by: "A", created_at: 1 } });
    const after = useMessages.getState().channels["chan9"]?.byId["5"];
    expect(after?.decryptError).toBeUndefined();
    expect(after?.payload).toEqual({ t: "secret" });
    expect(useKeys.getState().waiting["conv1"]).toBeUndefined();
  });
});
