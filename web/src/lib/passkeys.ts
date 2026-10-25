/**
 * Passkeys: signing in and opening the account's keys in one step.
 *
 * Every passkey Nexa keeps can give a PRF output: 32 bytes that only that
 * passkey makes, for the fixed input below. A key made from it wraps the
 * identity key, and the server keeps that wrapped copy with the passkey's
 * public key (internal/api/passkey_handlers.go). Signing in, the passkey both
 * proves who it is and gives the PRF output again, which unwraps the key here.
 * A passkey without PRF could sign in but never read a message, so it is not
 * added at all. Android does the same with the same input and key
 * (fish.nexa.data.Passkeys).
 */
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { api } from "@/api/client";
import type { MeUser } from "@/api/types";
import { b64, utf8 } from "@/crypto/bytes";
import { publicKeyOf, unwrapPrivateKey, wrapPrivateKey, type Identity } from "@/crypto/keys";
import { authKeyFor } from "@/lib/passwordProof";
import { ReadableError } from "@/lib/readableError";
import { t } from "@/i18n";

/** What the passkey's PRF is asked for, the same for every passkey. */
export const PRF_INPUT = utf8.enc("nexa passkey prf v1");
/** A copy WebAuthn's types take (their buffers cannot be shared ones). */
const buf = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);
const WRAP_INFO = utf8.enc("nexa passkey identity v1");

export interface PasskeyInfo {
  id: string;
  name: string;
  rp_id: string;
  created_at: number;
  last_used_at: number;
}

/** The key a passkey's PRF output makes, which wraps the identity key. */
export function wrapKeyFromPrf(prf: Uint8Array): Uint8Array {
  return hkdf(sha256, prf, new Uint8Array(0), WRAP_INFO, 32);
}

/** Whether this browser can use passkeys at all. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
}

/** True when the person closed the passkey prompt: nothing to say about it. */
export function passkeyCancelled(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");
}

export const b64url = {
  enc(u: Uint8Array): string {
    return b64.enc(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s: string): Uint8Array {
    const std = s.replace(/-/g, "+").replace(/_/g, "/");
    return b64.dec(std + "=".repeat((4 - (std.length % 4)) % 4));
  },
};

const bytes = (b: ArrayBuffer | ArrayBufferView): Uint8Array =>
  b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
const prfOf = (cred: PublicKeyCredential): Uint8Array | null => {
  const first = (cred.getClientExtensionResults() as PrfResults).prf?.results?.first;
  return first ? bytes(first) : null;
};

interface CreationJson {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  excludeCredentials: { type: "public-key"; id: string }[];
  authenticatorSelection: AuthenticatorSelectionCriteria;
  attestation: AttestationConveyancePreference;
  timeout: number;
}

interface RequestJson {
  challenge: string;
  rpId: string;
  userVerification: UserVerificationRequirement;
  timeout: number;
}

const noPrf = () => new ReadableError(t("passkeys.noPrf"));

/** Asks a passkey that was just made for its PRF output, for the authenticators that only give it on use. */
async function prfFromUse(rpId: string, credentialId: Uint8Array): Promise<Uint8Array> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId,
      allowCredentials: [{ type: "public-key", id: buf(credentialId) }],
      userVerification: "required",
      extensions: { prf: { eval: { first: buf(PRF_INPUT) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const prf = cred ? prfOf(cred) : null;
  if (!prf) throw noPrf();
  return prf;
}

/**
 * Adds a passkey to the signed-in account: the password first (as for every
 * change to how the account signs in), then the passkey prompt.
 */
export async function addPasskey(password: string, identity: Identity, name: string): Promise<PasskeyInfo> {
  const opts = await api.request<{ ticket: string; public_key: CreationJson }>("POST", "/auth/passkeys/options", { auth_key: await authKeyFor(password) });
  const pk = opts.public_key;
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: buf(b64url.dec(pk.challenge)),
      rp: pk.rp,
      user: { id: buf(b64url.dec(pk.user.id)), name: pk.user.name, displayName: pk.user.displayName },
      pubKeyCredParams: pk.pubKeyCredParams,
      excludeCredentials: pk.excludeCredentials.map((c) => ({ type: c.type, id: buf(b64url.dec(c.id)) })),
      authenticatorSelection: pk.authenticatorSelection,
      attestation: pk.attestation,
      timeout: pk.timeout,
      extensions: { prf: { eval: { first: buf(PRF_INPUT) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw noPrf();
  const ext = cred.getClientExtensionResults() as PrfResults;
  const rawId = bytes(cred.rawId);
  let prf = prfOf(cred);
  if (!prf) {
    if (!ext.prf?.enabled) {
      forgetOnDevice(pk.rp.id, rawId);
      throw noPrf();
    }
    prf = await prfFromUse(pk.rp.id, rawId);
  }
  const res = cred.response as AuthenticatorAttestationResponse;
  return api.request<PasskeyInfo>("POST", "/auth/passkeys", {
    ticket: opts.ticket,
    name,
    client_data_json: b64.enc(bytes(res.clientDataJSON)),
    attestation_object: b64.enc(bytes(res.attestationObject)),
    enc_private_key: b64.enc(await wrapPrivateKey(identity.privateKey, wrapKeyFromPrf(prf))),
  });
}

/** Tells the password manager a passkey Nexa will not keep can go, where the browser can. */
function forgetOnDevice(rpId: string, id: Uint8Array): void {
  const signal = (PublicKeyCredential as unknown as { signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void> }).signalUnknownCredential;
  void signal?.call(PublicKeyCredential, { rpId, credentialId: b64url.enc(id) }).catch(() => undefined);
}

/** Signs in with a passkey: the session, and the identity key the passkey opens. */
export async function signInWithPasskey(): Promise<{ me: MeUser; token: string; identity: Identity }> {
  const begin = await api.request<{ ticket: string; public_key: RequestJson }>("POST", "/auth/passkey/begin", {});
  const pk = begin.public_key;
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: buf(b64url.dec(pk.challenge)),
      rpId: pk.rpId,
      allowCredentials: [],
      userVerification: pk.userVerification,
      timeout: pk.timeout,
      extensions: { prf: { eval: { first: buf(PRF_INPUT) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw noPrf();
  const prf = prfOf(cred);
  const res = cred.response as AuthenticatorAssertionResponse;
  const out = await api.request<{ user: MeUser; token: string; public_key: string; enc_private_key: string }>("POST", "/auth/passkey/finish", {
    ticket: begin.ticket,
    credential_id: b64.enc(bytes(cred.rawId)),
    client_data_json: b64.enc(bytes(res.clientDataJSON)),
    authenticator_data: b64.enc(bytes(res.authenticatorData)),
    signature: b64.enc(bytes(res.signature)),
  });
  // a session was made: without the key it would open on a locked screen, so it goes again
  const giveUp = async (msg: string): Promise<never> => {
    await fetch(api.url("/auth/logout"), { method: "POST", headers: { Authorization: `Bearer ${out.token}` } }).catch(() => undefined);
    throw new ReadableError(msg);
  };
  if (!prf) return giveUp(t("passkeys.noPrf"));
  let privateKey: Uint8Array;
  try {
    privateKey = await unwrapPrivateKey(b64.dec(out.enc_private_key), wrapKeyFromPrf(prf));
  } catch {
    return giveUp(t("passkeys.couldNotOpenKeys"));
  }
  const publicKey = b64.dec(out.public_key);
  if (b64.enc(publicKeyOf(privateKey)) !== out.public_key) return giveUp(t("passkeys.couldNotOpenKeys"));
  return { me: out.user, token: out.token, identity: { publicKey, privateKey } };
}

export const passkeysApi = {
  list: () => api.request<PasskeyInfo[]>("GET", "/auth/passkeys"),
  rename: (id: string, name: string) => api.request<void>("PATCH", `/auth/passkeys/${id}`, { name }),
  remove: (id: string) => api.request<void>("DELETE", `/auth/passkeys/${id}`),
};
