import { create } from "zustand";
import { auth as authApi } from "@/api/auth";
import { api, ApiError } from "@/api/client";
import { isMfaChallenge, type KdfParamsJson, type MeUser } from "@/api/types";
import { users as usersApi } from "@/api/users";
import { b64, randomBytes } from "@/crypto/bytes";
import { DEFAULT_KDF, deriveAuthKey, deriveEncKey, deriveMaster, deriveSettingsKey, newRecoveryKey, recoveryKeyToBytes, recoveryToKeys, type KdfParams } from "@/crypto/kdf";
import { generateIdentity, unwrapPrivateKey, wrapPrivateKey, type Identity } from "@/crypto/keys";
import { keystore } from "@/crypto/keystore";
import { guarded } from "@/lib/captcha";
import { adoptPolicy, clearLock, enableLock, hasLock, loadLock, policyFor, saveLock, unlockIdentity, type LockConfig } from "@/lib/appLock";
import { useSettings, type AppLockPolicy } from "@/stores/settings";
import { storage } from "@/lib/storage";

import { t } from "@/i18n";
/** "offline": a token is stored, but the server or this device's key store could not be reached. */
export type AuthStatus = "idle" | "loading" | "offline" | "anonymous" | "locked" | "pinlocked" | "ready";

/** What a password got us: either we are in, or the account wants a code. */
export type LoginOutcome = { mfa: false } | { mfa: true; backupCodesLeft: number };

/** Kept out of the store so a half-finished sign-in never lands in a snapshot. */
let pendingMfa: { username: string; encKey: Uint8Array; ticket: string } | null = null;
/**
 * The account's passcode policy, held from the moment we decide to ask for it.
 * Showing the lock screen tears the session down, which clears the settings it
 * came from, so it has to be kept here rather than read back later.
 */
let pendingPolicy: AppLockPolicy | null = null;

const TOKEN_KEY = "ec.token";

interface AuthState {
  status: AuthStatus;
  me: MeUser | null;
  token: string | null;
  identity: Identity | null;
  settingsKey: Uint8Array | null;
  error: string | null;
  /** Bumped whenever this device's lock settings change, so the lock timers re-read them. */
  lockVersion: number;
  bootstrap: () => Promise<void>;
  register: (username: string, displayName: string, password: string, extra?: { invite_code?: string; registration_key?: string }) => Promise<{ recoveryKey: string }>;
  login: (username: string, password: string) => Promise<LoginOutcome>;
  /** Finishes a sign-in that stopped for a second factor. */
  completeMfa: (proof: { code?: string; backupCode?: string }) => Promise<void>;
  cancelMfa: () => void;
  unlock: (password: string) => Promise<void>;
  /** Rebuilds the keys from this device's passcode. */
  unlockWithPasscode: (passcode: string) => Promise<void>;
  /** Forgets the keys held in memory and shows the passcode screen. */
  lockApp: () => void;
  /** Asks for the account passcode on a device that has not stored it yet. */
  requirePasscode: () => void;
  /** Wraps the identity with a passcode and drops the plaintext copy. */
  setPasscode: (passcode: string, opts?: Partial<Pick<LockConfig, "autoLockMs" | "lockOnBlur" | "blurDelayMs">>) => Promise<void>;
  /** Removes the passcode and goes back to keeping the keys on this device. */
  removePasscode: () => Promise<void>;
  /** Tells the lock timers that this device's lock settings were changed. */
  bumpLock: () => void;
  recover: (username: string, recoveryKey: string, newPassword: string) => Promise<{ recoveryKey: string }>;
  changePassword: (current: string, next: string) => Promise<void>;
  newRecoveryKey: (password: string) => Promise<string>;
  logout: () => Promise<void>;
  setMe: (me: MeUser) => void;
}

/** Pushes settings to the server now rather than on the usual debounce, trying twice; false if they never got there. */
async function saveSettingsNow(): Promise<boolean> {
  if (await useSettings.getState().flush()) return true;
  await new Promise((r) => setTimeout(r, 500));
  return useSettings.getState().flush();
}

const saveFailed = () => t("auth.couldNotSaveThatToYour");

/**
 * Run on sign-out before the state is cleared. The gateway session registers
 * here rather than being imported, since it already depends on this store.
 */
export const logoutHooks: (() => Promise<void>)[] = [];

async function deriveAll(password: string, salt: Uint8Array, params: KdfParams) {
  const master = await deriveMaster(password, salt, params);
  return { authKey: deriveAuthKey(master), encKey: deriveEncKey(master) };
}

function toParams(p: KdfParamsJson): KdfParams {
  return { m: p.m, t: p.t, p: p.p, v: 1 };
}

async function finishLogin(set: (s: Partial<AuthState>) => void, me: MeUser, token: string, identity: Identity): Promise<void> {
  storage.set(TOKEN_KEY, token);
  api.setToken(token);
  // With a passcode set, the only copy of the key on this device is the wrapped
  // one, so the plaintext must never go back into the key store.
  if (!hasLock(me.id)) await keystore.saveIdentity(me.id, identity);
  set({ status: "ready", me, token, identity, settingsKey: deriveSettingsKey(identity.privateKey), error: null });
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: "idle",
  me: null,
  token: storage.get(TOKEN_KEY),
  identity: null,
  settingsKey: null,
  error: null,
  lockVersion: 0,

  bootstrap: async () => {
    const token = storage.get(TOKEN_KEY);
    if (!token) {
      set({ status: "anonymous", token: null });
      return;
    }
    api.setToken(token);
    // A retry from the offline screen stays on it until there is an answer, so
    // the screen does not flash a spinner on every attempt.
    set(get().status === "offline" ? { token } : { status: "loading", token });
    try {
      const me = await usersApi.me();
      if (hasLock(me.id)) {
        set({ status: "pinlocked", me, identity: null, settingsKey: null });
        return;
      }
      const identity = await keystore.loadIdentity(me.id);
      if (!identity) {
        set({ status: "locked", me });
        return;
      }
      set({ status: "ready", me, identity, settingsKey: deriveSettingsKey(identity.privateKey), error: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        storage.remove(TOKEN_KEY);
        api.setToken(null);
        set({ status: "anonymous", token: null, me: null });
        return;
      }
      // Only the server turning the request down means logged out. A dropped
      // connection, a server restarting behind Cloudflare or a key store hiccup
      // keeps the session and waits on a screen that retries.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        set({ status: "anonymous", error: err.message });
        return;
      }
      set({ status: "offline", error: err instanceof ApiError || err instanceof TypeError ? t("offline.couldNotReachTheServer") : t("auth.couldNotOpenTheKeysSaved") });
    }
  },

  register: async (username, displayName, password, extra) => {
    const salt = randomBytes(16);
    const params = DEFAULT_KDF;
    const { authKey, encKey } = await deriveAll(password, salt, params);
    const identity = generateIdentity();
    const recovery = newRecoveryKey();
    const rk = recoveryToKeys(recovery.bytes);
    const body = {
      username,
      display_name: displayName,
      auth_key: b64.enc(authKey),
      kdf_salt: b64.enc(salt),
      kdf_params: params,
      public_key: b64.enc(identity.publicKey),
      enc_private_key: b64.enc(await wrapPrivateKey(identity.privateKey, encKey)),
      enc_private_key_recovery: b64.enc(await wrapPrivateKey(identity.privateKey, rk.encKey)),
      recovery_auth_key: b64.enc(rk.authKey),
      ...(extra ?? {}),
    };
    const res = await guarded("register", (captcha) => authApi.register(body, captcha));
    await finishLogin(set, res.user, res.token, identity);
    return { recoveryKey: recovery.display };
  },

  login: async (username, password) => {
    const kdf = await authApi.kdf(username);
    const { authKey, encKey } = await deriveAll(password, b64.dec(kdf.salt), toParams(kdf.params));
    const res = await guarded("login", (captcha) => authApi.login(username, b64.enc(authKey), captcha));
    if (isMfaChallenge(res)) {
      pendingMfa = { username, encKey, ticket: res.ticket };
      return { mfa: true, backupCodesLeft: res.backup_codes_left };
    }
    pendingMfa = null;
    const privateKey = await unwrapPrivateKey(b64.dec(res.enc_private_key), encKey);
    await finishLogin(set, res.user, res.token, { publicKey: b64.dec(res.public_key), privateKey });
    return { mfa: false };
  },

  completeMfa: async ({ code, backupCode }) => {
    const pending = pendingMfa;
    if (!pending) throw new Error(t("auth.startAgainFromYourPassword"));
    const body = backupCode ? { backup_code: backupCode } : { code: (code ?? "").replace(/\s/g, "") };
    const res = await authApi.loginMfa(pending.ticket, body);
    const privateKey = await unwrapPrivateKey(b64.dec(res.enc_private_key), pending.encKey);
    pendingMfa = null;
    await finishLogin(set, res.user, res.token, { publicKey: b64.dec(res.public_key), privateKey });
  },

  cancelMfa: () => {
    pendingMfa = null;
  },

  unlock: async (password) => {
    const me = get().me;
    const token = get().token;
    if (!me || !token) throw new Error("not logged in");
    const bundle = await usersApi.myKeys();
    const { encKey } = await deriveAll(password, b64.dec(bundle.kdf_salt), toParams(bundle.kdf_params));
    const privateKey = await unwrapPrivateKey(b64.dec(bundle.enc_private_key), encKey);
    await finishLogin(set, me, token, { publicKey: b64.dec(bundle.public_key), privateKey });
  },

  unlockWithPasscode: async (passcode) => {
    const { me, token, identity: current } = get();
    if (!me || !token) throw new Error("not logged in");
    if (!hasLock(me.id)) {
      // This device has not seen the account's passcode yet: check it against
      // the policy, then wrap this device's copy of the key with it.
      const policy = pendingPolicy ?? useSettings.getState().settings.appLock;
      if (!policy || !current) throw new Error(t("appLock.thisDeviceHasNoPasscode"));
      await adoptPolicy(me.id, current, passcode, policy);
      pendingPolicy = null;
      await keystore.forgetIdentity(me.id);
      await keystore.forgetRoots(me.id);
      set({ status: "ready", error: null });
      return;
    }
    const identity = await unlockIdentity(me.id, passcode);
    set({ status: "ready", me, identity, settingsKey: deriveSettingsKey(identity.privateKey), error: null });
  },

  /** Asks for the account passcode on a device that has not stored it yet. */
  requirePasscode: () => {
    const { me, status } = get();
    if (!me || status !== "ready" || hasLock(me.id)) return;
    const policy = useSettings.getState().settings.appLock;
    if (!policy) return;
    pendingPolicy = policy;
    set({ status: "pinlocked" });
  },

  lockApp: () => {
    const { me, status } = get();
    if (!me || status !== "ready" || !hasLock(me.id)) return;
    set({ status: "pinlocked", identity: null, settingsKey: null });
  },

  setPasscode: async (passcode, opts) => {
    const { me, identity } = get();
    if (!me || !identity) throw new Error(t("auth.unlockYourKeysFirst"));
    const previousLock = loadLock(me.id);
    const previousPolicy = useSettings.getState().settings.appLock;
    const cfg = await enableLock(me.id, identity, passcode, opts);
    // The wrapped copy is now the only one on this device; drop the readable
    // one, and the conversation keys, which would read messages without it.
    await keystore.forgetIdentity(me.id);
    await keystore.forgetRoots(me.id);
    get().bumpLock();
    // The policy travels with the account, so every other device asks too. It
    // is saved right away: a reload before the debounce would come back to
    // settings that say there is no passcode, and drop the one just made.
    useSettings.getState().patch({ appLock: await policyFor(cfg, passcode) });
    if (await saveSettingsNow()) return;
    // Unsaved, the next ready would find no passcode and quietly undo this
    // one, so put things back and say so instead.
    if (previousLock) {
      saveLock(me.id, previousLock);
    } else {
      clearLock(me.id);
      await keystore.saveIdentity(me.id, identity);
    }
    useSettings.getState().patch({ appLock: previousPolicy });
    get().bumpLock();
    throw new Error(saveFailed());
  },

  removePasscode: async () => {
    const { me, identity } = get();
    if (!me) return;
    const previousLock = loadLock(me.id);
    const previousPolicy = useSettings.getState().settings.appLock;
    clearLock(me.id);
    get().bumpLock();
    if (identity) await keystore.saveIdentity(me.id, identity);
    useSettings.getState().patch({ appLock: null });
    if (await saveSettingsNow()) return;
    // Unsaved, the next ready would ask for the removed passcode again.
    if (previousLock) {
      saveLock(me.id, previousLock);
      await keystore.forgetIdentity(me.id);
    }
    useSettings.getState().patch({ appLock: previousPolicy });
    get().bumpLock();
    throw new Error(saveFailed());
  },

  bumpLock: () => set((s) => ({ lockVersion: s.lockVersion + 1 })),

  recover: async (username, recoveryKey, newPassword) => {
    const rkBytes = recoveryKeyToBytes(recoveryKey);
    const rk = recoveryToKeys(rkBytes);
    const begin = await guarded("recover", (captcha) => authApi.recoverBegin(username, b64.enc(rk.authKey), captcha));
    const privateKey = await unwrapPrivateKey(b64.dec(begin.enc_private_key_recovery), rk.encKey);
    const salt = randomBytes(16);
    const { authKey, encKey } = await deriveAll(newPassword, salt, DEFAULT_KDF);
    const fresh = newRecoveryKey();
    const frk = recoveryToKeys(fresh.bytes);
    const res = await authApi.recoverFinish({
      username,
      recovery_auth_key: b64.enc(rk.authKey),
      new_auth_key: b64.enc(authKey),
      new_kdf_salt: b64.enc(salt),
      new_kdf_params: DEFAULT_KDF,
      new_enc_private_key: b64.enc(await wrapPrivateKey(privateKey, encKey)),
      new_recovery_auth_key: b64.enc(frk.authKey),
      new_enc_private_key_recovery: b64.enc(await wrapPrivateKey(privateKey, frk.encKey)),
      ticket: begin.ticket,
    });
    await finishLogin(set, res.user, res.token, { publicKey: b64.dec(begin.public_key), privateKey });
    return { recoveryKey: fresh.display };
  },

  changePassword: async (current, next) => {
    const { identity } = get();
    if (!identity) throw new Error("locked");
    const bundle = await usersApi.myKeys();
    const cur = await deriveAll(current, b64.dec(bundle.kdf_salt), toParams(bundle.kdf_params));
    const salt = randomBytes(16);
    const nxt = await deriveAll(next, salt, DEFAULT_KDF);
    await authApi.changePassword({
      auth_key: b64.enc(cur.authKey),
      new_auth_key: b64.enc(nxt.authKey),
      new_kdf_salt: b64.enc(salt),
      new_kdf_params: DEFAULT_KDF,
      new_enc_private_key: b64.enc(await wrapPrivateKey(identity.privateKey, nxt.encKey)),
    });
  },

  newRecoveryKey: async (password) => {
    const { identity } = get();
    if (!identity) throw new Error("locked");
    const bundle = await usersApi.myKeys();
    const cur = await deriveAll(password, b64.dec(bundle.kdf_salt), toParams(bundle.kdf_params));
    const fresh = newRecoveryKey();
    const frk = recoveryToKeys(fresh.bytes);
    await authApi.replaceRecovery({
      auth_key: b64.enc(cur.authKey),
      recovery_auth_key: b64.enc(frk.authKey),
      enc_private_key_recovery: b64.enc(await wrapPrivateKey(identity.privateKey, frk.encKey)),
    });
    set((s) => (s.me ? { me: { ...s.me, has_recovery: true } } : s));
    return fresh.display;
  },

  logout: async () => {
    const me = get().me;
    // First, while the token still works, so a call is left properly.
    for (const hook of logoutHooks) {
      try {
        await hook();
      } catch {
        /* signing out goes ahead regardless */
      }
    }
    try {
      await authApi.logout();
    } catch {
      /* the token may already be invalid */
    }
    storage.remove(TOKEN_KEY);
    api.setToken(null);
    pendingMfa = null;
    pendingPolicy = null;
    if (me) {
      clearLock(me.id);
      await keystore.clear(me.id);
    }
    set({ status: "anonymous", me: null, token: null, identity: null, settingsKey: null, error: null });
  },

  setMe: (me) => set({ me }),
}));
