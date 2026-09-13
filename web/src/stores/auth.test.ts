// @vitest-environment jsdom
import { api } from "@/api/client";
import type { RequestOptions } from "@/api/client";
import { b64, randomBytes } from "@/crypto/bytes";
import { generateIdentity } from "@/crypto/keys";
import { keystore } from "@/crypto/keystore";
import { hasLock } from "@/lib/appLock";
import { logoutHooks, useAuth } from "./auth";
import { useSettings } from "./settings";

interface Captured {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

describe("auth store", () => {
  const calls: Captured[] = [];
  let stored: Record<string, unknown> | null = null;
  const me = {
    id: "1",
    username: "mara",
    display_name: "Mara",
    avatar_id: null,
    banner_id: null,
    about_me: "",
    pronouns: "",
    accent_color: null,
    status_text: "",
    status_emoji: "",
    status_expires_at: null,
    public_key: "",
    flags: 0,
    created_at: 0,
    presence_pref: "online",
    dm_privacy: "everyone",
    has_recovery: true,
  };

  beforeEach(async () => {
    calls.length = 0;
    stored = null;
    localStorage.clear();
    await keystore.clear("1");
    api.request = <T>(method: string, path: string, body?: unknown, _opts?: RequestOptions): Promise<T> => {
      const b = body as Record<string, unknown> | undefined;
      calls.push({ method, path, body: b });
      if (path === "/auth/register") {
        stored = b ?? null;
        return Promise.resolve({ user: { ...me, public_key: b?.["public_key"] }, token: "tok-1" } as T);
      }
      if (path === "/auth/kdf") return Promise.resolve({ salt: stored?.["kdf_salt"], params: stored?.["kdf_params"] } as T);
      if (path === "/auth/login") {
        if (b?.["auth_key"] !== stored?.["auth_key"]) return Promise.reject(new Error("bad key"));
        return Promise.resolve({ user: me, token: "tok-2", enc_private_key: stored?.["enc_private_key"], public_key: stored?.["public_key"], kdf_salt: stored?.["kdf_salt"], kdf_params: stored?.["kdf_params"] } as T);
      }
      if (path === "/users/@me") return Promise.resolve(me as T);
      if (path === "/auth/logout") return Promise.resolve(undefined as T);
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    };
  });

  it("registers with derived keys and the wrapped identity, then logs in again", async () => {
    const { recoveryKey } = await useAuth.getState().register("mara", "Mara", "correct horse battery");
    expect(recoveryKey).toMatch(/^[0-9A-F]{8}(-[0-9A-F]{8}){7}$/);
    const reg = calls.find((c) => c.path === "/auth/register")!.body!;
    expect(b64.dec(reg["auth_key"] as string)).toHaveLength(32);
    expect(b64.dec(reg["public_key"] as string)).toHaveLength(32);
    expect(b64.dec(reg["kdf_salt"] as string)).toHaveLength(16);
    expect(reg["kdf_params"]).toEqual({ m: 65536, t: 3, p: 1, v: 1 });
    expect(typeof reg["enc_private_key_recovery"]).toBe("string");
    const s = useAuth.getState();
    expect(s.status).toBe("ready");
    expect(s.token).toBe("tok-1");
    expect(localStorage.getItem("ec.token")).toBe("tok-1");
    const identity = s.identity!;
    expect(await keystore.loadIdentity("1")).not.toBeNull();

    await useAuth.getState().logout();
    expect(useAuth.getState().status).toBe("anonymous");
    expect(localStorage.getItem("ec.token")).toBeNull();
    expect(await keystore.loadIdentity("1")).toBeNull();

    await expect(useAuth.getState().login("mara", "wrong password")).rejects.toThrow();
    await useAuth.getState().login("mara", "correct horse battery");
    const again = useAuth.getState();
    expect(again.status).toBe("ready");
    expect(b64.enc(again.identity!.privateKey)).toBe(b64.enc(identity.privateKey));
    expect(again.token).toBe("tok-2");
  }, 60_000);

  it("bootstraps into locked when the identity is not in the keystore", async () => {
    localStorage.setItem("ec.token", "tok-x");
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe("locked");
    expect(useAuth.getState().me?.username).toBe("mara");
  });

  describe("passcode", () => {
    // The real cost only slows the test down; the code path is the same.
    const fast = { kdf: { m: 1024, t: 1, p: 1, v: 1 } } as never;
    let settingsSaves = 0;
    let failSettings = false;

    beforeEach(async () => {
      settingsSaves = 0;
      failSettings = false;
      const base = api.request;
      api.request = <T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T> => {
        if (path === "/users/@me/settings" && method === "PUT") {
          settingsSaves++;
          return failSettings ? Promise.reject(new Error("offline")) : Promise.resolve({ version: settingsSaves } as T);
        }
        return base(method, path, body, opts);
      };
      const identity = generateIdentity();
      await keystore.saveIdentity("1", identity);
      await keystore.saveRoot("1", "conv-a", 0, randomBytes(32));
      useSettings.getState().reset();
      useSettings.getState().setKey(randomBytes(32));
      useAuth.setState({ status: "ready", me: me as never, token: "tok", identity });
    });

    it("keeps no readable keys on the device once it is saved", async () => {
      await useAuth.getState().setPasscode("2468", fast);
      expect(settingsSaves).toBeGreaterThan(0);
      expect(hasLock("1")).toBe(true);
      expect(useSettings.getState().settings.appLock).not.toBeNull();
      expect(await keystore.loadIdentity("1")).toBeNull();
      expect(await keystore.loadRoots("1")).toEqual([]);
    });

    it("puts everything back and says so when the account never gets the policy", async () => {
      failSettings = true;
      await expect(useAuth.getState().setPasscode("2468", fast)).rejects.toThrow(/Could not save/);
      expect(hasLock("1")).toBe(false);
      expect(useSettings.getState().settings.appLock).toBeNull();
      expect(await keystore.loadIdentity("1")).not.toBeNull();
    });

    it("keeps the passcode when removing it cannot be saved", async () => {
      await useAuth.getState().setPasscode("2468", fast);
      failSettings = true;
      await expect(useAuth.getState().removePasscode()).rejects.toThrow(/Could not save/);
      expect(hasLock("1")).toBe(true);
      expect(useSettings.getState().settings.appLock).not.toBeNull();
      expect(await keystore.loadIdentity("1")).toBeNull();
    });
  });

  it("runs the sign-out hooks before the token is dropped", async () => {
    useAuth.setState({ status: "ready", me: me as never, token: "tok" });
    const seen: string[] = [];
    logoutHooks.push(() => {
      seen.push(calls.some((c) => c.path === "/auth/logout") ? "after" : "before");
      return Promise.resolve();
    });
    try {
      await useAuth.getState().logout();
    } finally {
      logoutHooks.length = 0;
    }
    expect(seen).toEqual(["before"]);
    expect(useAuth.getState().status).toBe("anonymous");
  });
});
