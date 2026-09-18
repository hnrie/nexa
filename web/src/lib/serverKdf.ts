/**
 * Argon2id parameters that came from the server, checked before they are used.
 *
 * Four places ask the server how to stretch a password — signing in, unlocking
 * a session that has the token but not the keys, changing a password, and a
 * subchat's own password — and every one of them then hands the result back to
 * the server as proof of knowledge. Parameters that make the stretching free
 * therefore hand over the password itself. They all go through here so there is
 * one definition of what is acceptable, and so the refusal reads the same
 * wherever it lands.
 *
 * The floor and ceiling live in `@/crypto/kdf`, next to the derivation they
 * constrain; only the wording is here, because the crypto module deliberately
 * knows nothing about the interface.
 */

import { kdfParamsAcceptable, WeakKdfError, type KdfParams } from "@/crypto/kdf";

import { t } from "@/i18n";

/** What the API carries: the three costs, and a params version the client may not know. */
export interface ServerKdfParams {
  m: number;
  t: number;
  p: number;
  v?: number;
}

/**
 * The parameters to derive with, or a refusal. Callers should let the error
 * reach the screen that asked for the password: it is not the password that is
 * wrong, and saying so is the only way anyone finds out.
 */
export function acceptServerKdf(p: ServerKdfParams): KdfParams {
  if (!kdfParamsAcceptable(p)) {
    console.error("kdf: refusing argon2id parameters the server sent", p);
    throw new WeakKdfError(t("auth.theServerAskedToProtectYourPassword"));
  }
  return { m: p.m, t: p.t, p: p.p, v: 1 };
}
