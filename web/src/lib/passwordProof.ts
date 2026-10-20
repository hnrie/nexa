import { users as usersApi } from "@/api/users";
import { b64 } from "@/crypto/bytes";
import { deriveAuthKey, deriveMaster } from "@/crypto/kdf";
import { acceptServerKdf } from "@/lib/serverKdf";

/**
 * Turns the account's password into the proof the server asks for before
 * something that cannot be taken back (a new second factor, a bot's new
 * token). The password itself never leaves the device.
 */
export async function authKeyFor(password: string): Promise<string> {
  const bundle = await usersApi.myKeys();
  // The stretch parameters are the server's answer, and the proof below goes
  // straight back to it, so they are checked against the floor first.
  const master = await deriveMaster(password, b64.dec(bundle.kdf_salt), acceptServerKdf(bundle.kdf_params));
  return b64.enc(deriveAuthKey(master));
}
