import { servers as serversApi } from "@/api/servers";
import { keystore } from "@/crypto/keystore";
import { t } from "@/i18n";
import { hasLock } from "@/lib/appLock";
import { guarded } from "@/lib/captcha";
import { parseInviteFragment } from "@/lib/inviteLink";
import { ring } from "@/lib/keyring";
import { useChannels } from "@/stores/channels";
import { useKeys } from "@/stores/keys";
import { useServers } from "@/stores/servers";
import { useUsers } from "@/stores/users";

/**
 * Accepts an invite, puts what it joined into the stores, and returns where
 * to go: the group, or the server's first text channel.
 *
 * `fragment` is the invite link's `#k=…` when it has one: the server's key,
 * which unlocks the history at once. It is kept on this device and granted to
 * this account, so its other devices and later sign-ins have it too.
 */
export async function acceptInvite(code: string, fragment: string): Promise<string> {
  const res = await guarded("join", (captcha) => serversApi.join(code, captcha));
  // What came back decides, rather than what the preview said and a cast
  // through `unknown`: a field that is absent or renamed used to navigate
  // to /channels/@me/undefined and bounce home with no explanation.
  if ("channel" in res) {
    if (res.users) useUsers.getState().upsert(res.users);
    useChannels.getState().upsert(res.channel);
    return `/channels/@me/${res.channel.id}`;
  }
  if (!("server" in res)) throw new Error(t("invite.couldNotAcceptTheInvite"));
  useUsers.getState().upsert(res.users);
  useChannels.getState().upsert(res.server.channels);
  useServers.getState().setFromView(res.server);
  const key = parseInviteFragment(fragment);
  const userId = useKeys.getState().userId;
  if (key && userId && !ring.get(res.server.id, key.epoch)) {
    ring.set(res.server.id, key.epoch, key.root);
    // behind a passcode the key stays off the disk; the self-grant brings it back
    if (!hasLock(userId)) await keystore.saveRoot(userId, res.server.id, key.epoch, key.root);
    // a self-grant records the key server-side so other devices and later logins have it
    await useKeys.getState().grantTo(res.server.id, key.epoch, [userId]);
  }
  const first = res.server.channels.find((c) => c.type === "text");
  return first ? `/channels/${res.server.id}/${first.id}` : `/channels/${res.server.id}`;
}
