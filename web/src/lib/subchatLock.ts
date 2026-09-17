/**
 * The password on a subchat.
 *
 * It is stretched here, the same way an account's password is, and only what
 * comes out of that is sent: the server stores a hash of it and never sees the
 * password. The lock keeps the subchat shut on the screen and stops the server
 * handing over its messages — the messages themselves are encrypted for the
 * same people either way, which is what the interface says.
 */
import { b64, randomBytes } from "@/crypto/bytes";
import { deriveAuthKey, deriveMaster, DEFAULT_KDF, type KdfParams } from "@/crypto/kdf";
import { api } from "@/api/client";
import type { Snowflake } from "@/api/types";

import { t } from "@/i18n";
export const MIN_SUBCHAT_PASSWORD = 4;

/** The fields a create or edit request carries when a password is set. */
export interface LockFields {
  password_key: string;
  password_salt: string;
  password_params: KdfParams;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_SUBCHAT_PASSWORD) return t("appLock.useAtLeastCharacters", { count: MIN_SUBCHAT_PASSWORD });
  if (pw.length > 128) return t("appLock.thatIsTooLong");
  return null;
}

/** Stretches a new password into what a create or edit request sends. */
export async function newLock(password: string): Promise<LockFields> {
  const salt = randomBytes(16);
  const master = await deriveMaster(password, salt, DEFAULT_KDF);
  return { password_key: b64.enc(deriveAuthKey(master)), password_salt: b64.enc(salt), password_params: DEFAULT_KDF };
}

export interface LockParams {
  locked: boolean;
  /** Whether this sign-in has already typed it. */
  unlocked: boolean;
  salt?: string;
  params?: KdfParams;
}

/** Whether this sign-in may open the subchat yet. */
export function lockState(channelId: Snowflake): Promise<LockParams> {
  return api.request<LockParams>("GET", `/channels/${channelId}/lock`);
}

/** Stretches a password the way this subchat's was, and sends the proof. */
export async function unlockSubchat(channelId: Snowflake, password: string): Promise<void> {
  const info = await lockState(channelId);
  if (!info.locked || !info.salt || !info.params) return;
  const master = await deriveMaster(password, b64.dec(info.salt), info.params);
  await api.request<{ unlocked: boolean }>("POST", `/channels/${channelId}/unlock`, { password_key: b64.enc(deriveAuthKey(master)) });
}
