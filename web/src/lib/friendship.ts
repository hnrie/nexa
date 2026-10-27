import { personText, personList } from "@/lib/personText";
/**
 * What can be done about someone: ask to be friends, answer or take back a
 * request, stop being friends, block and unblock.
 *
 * Every place that offers one (a profile, the friends list, a member's menu)
 * goes through here, so each shows its result on this device the moment the
 * server answers rather than when the gateway's echo arrives, says the same
 * thing when it fails, and shows the same "on its way" state. That state
 * matters: a friend request can wait on a captcha check, and a button that
 * did nothing visible for a few seconds read as a request that never went.
 */
import { create } from "zustand";
import { ApiError } from "@/api/client";
import { relationships as relApi } from "@/api/relationships";
import type { Channel, PublicUser, Relationship } from "@/api/types";
import { guarded } from "@/lib/captcha";
import { describeError } from "@/lib/errors";
import { isSystemAccount } from "@/lib/moderation";
import { sealRequestNote } from "@/lib/requestNote";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { sealingKeyOf } from "@/stores/keys";
import { useRelationships } from "@/stores/relationships";
import { useSettings, type Settings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { button, type MenuButton } from "@/lib/contextMenus/registry";
import { displayName, useUsers } from "@/stores/users";

import { formatList, t } from "@/i18n";

/** The people a request is on its way about, so their buttons wait rather than take a second press. */
export const useRelationshipBusy = create<{ busy: Record<string, true> }>()(() => ({ busy: {} }));

/** Whether a request about this person is on its way. */
export function useBusyWith(userId: string): boolean {
  return useRelationshipBusy((b) => !!b.busy[userId]);
}

async function busyWith<T>(userId: string, job: () => Promise<T>): Promise<T | undefined> {
  if (useRelationshipBusy.getState().busy[userId]) return undefined;
  useRelationshipBusy.setState((s) => ({ busy: { ...s.busy, [userId]: true } }));
  try {
    return await job();
  } finally {
    useRelationshipBusy.setState((s) => {
      const busy = { ...s.busy };
      delete busy[userId];
      return { busy };
    });
  }
}

/** Puts the answer on this device at once; the gateway's own copy lands on top of it later. */
function setRel(user: PublicUser, type: Relationship["type"]): void {
  const had = useRelationships.getState().byUser[user.id];
  useRelationships.getState().set({
    user,
    type,
    nickname: type === "friend" ? (had?.nickname ?? "") : "",
    created_at: had?.type === type ? had.created_at : Date.now(),
  });
  useUsers.getState().upsert(user);
}

const toast = (text: string, kind: "error" | "success" | "info" = "error") => useUI.getState().toast(text, kind);

/** What went wrong with a friend request, in words (the Add friend form says the same). */
export function requestError(err: unknown): string {
  const words: Record<string, string> = {
    user_not_found: t("friends.hmDidnTWorkDoubleCheck"),
    self: t("friends.youCanTAddYourselfBut"),
    blocked: t("friends.youCanTSendARequest"),
    already_friends: t("friends.youReAlreadyFriendsWithThat"),
    already_sent: t("friends.youAlreadySentARequestTo"),
  };
  return err instanceof ApiError && words[err.code] ? words[err.code]! : describeError(err, t("friends.thatFriendRequestCouldNotBe"));
}

/**
 * Asks to be friends. Resolves to what it became: "outgoing", "friend" when
 * they had already asked, or null when it failed (and said why).
 */
export async function sendFriendRequest(user: PublicUser): Promise<"outgoing" | "friend" | null> {
  const done = await busyWith(user.id, async () => {
    try {
      const res = await guarded("friend_request", (captcha) => relApi.request(user.username, captcha));
      const type = res.type === "friend" ? "friend" : "outgoing";
      setRel(res.user, type);
      return type;
    } catch (err) {
      // This device was behind: another tab or device already sent it, or
      // they are friends already. That is the state to show, not an error.
      if (err instanceof ApiError && err.code === "already_sent") {
        setRel(user, "outgoing");
        return "outgoing";
      }
      if (err instanceof ApiError && err.code === "already_friends") {
        setRel(user, "friend");
        return "friend";
      }
      toast(requestError(err));
      return null;
    }
  });
  return done ?? null;
}

/**
 * Puts a note on the request this account just sent them, sealed on this
 * device to their identity key (the key a conversation with them would be
 * sealed to, pin check and all). The request itself has gone either way, so a
 * note that cannot be sealed or sent only says so; resolves to whether it went.
 */
export async function addRequestNote(user: PublicUser, note: string): Promise<boolean> {
  try {
    const key = await sealingKeyOf(user.id);
    // their key is not the one this device pinned: the question is on screen
    // (judgeKey), and nothing is sealed to the new key until it is answered
    if (!key) throw new Error("their identity key changed");
    await relApi.setNote(user.id, await sealRequestNote(key, note));
    return true;
  } catch (err) {
    console.warn("friends: could not add the note to a request", err);
    toast(t("friends.noteNotAdded"));
    return false;
  }
}

/** Says yes to someone's request. Resolves to the conversation the server opens with it, if any. */
export async function acceptFriendRequest(user: PublicUser): Promise<Channel | null | undefined> {
  return busyWith(user.id, async () => {
    try {
      const res = await relApi.accept(user.id);
      setRel(res.user, "friend");
      if (res.channel) useChannels.getState().upsert(res.channel);
      return res.channel ?? null;
    } catch (err) {
      // they took it back, or another device answered it first
      if (err instanceof ApiError && err.code === "no_request" && useRelationships.getState().byUser[user.id]?.type === "incoming") useRelationships.getState().remove(user.id);
      toast(describeError(err, t("profile.profileCard.couldNotAccept")));
      return undefined;
    }
  });
}

/** Ignores someone's request, or takes back one of your own. */
export async function dropFriendRequest(userId: string): Promise<boolean> {
  const was = useRelationships.getState().byUser[userId]?.type;
  const done = await busyWith(userId, async () => {
    try {
      await relApi.remove(userId);
    } catch (err) {
      // already gone is what was wanted
      if (!(err instanceof ApiError && err.status === 404)) {
        toast(describeError(err, t("friends.couldNotUpdate")));
        return false;
      }
    }
    useRelationships.getState().remove(userId);
    toast(was === "outgoing" ? t("friends.requestCancelled") : t("friends.requestIgnored"), "success");
    return true;
  });
  return done ?? false;
}

/** Asks first, as removing a friend is not quick to take back. */
export function confirmRemoveFriend(user: PublicUser): void {
  const name = displayName(user);
  useUI.getState().openModal("confirm", {
    title: t("profile.profileCard.removeFriend"),
    body: personText("friends.removeNameFromYourFriends", user.id, name),
    confirmLabel: t("profile.profileCard.removeFriend"),
    danger: true,
    // the dialog says what went wrong and stays open if this throws
    onConfirm: async () => {
      await relApi.remove(user.id);
      useRelationships.getState().remove(user.id);
      toast(t("friends.friendRemoved"), "success");
    },
  });
}

/** Opens the one block dialog, with its choices about their messages. */
export function openBlockDialog(userId: string): void {
  useUI.getState().openModal("block", { userId });
}

/** Blocks someone (the dialog's confirm), keeping the choices it offered as the account's. */
export async function blockUser(user: PublicUser, choices: Settings["blocking"]): Promise<void> {
  await relApi.block(user.id);
  setRel(user, "blocked");
  const now = useSettings.getState().settings.blocking;
  if (now.hideMessages !== choices.hideMessages || now.hideReplies !== choices.hideReplies) useSettings.getState().patch({ blocking: { ...choices } });
}

export async function unblockUser(userId: string): Promise<boolean> {
  const done = await busyWith(userId, async () => {
    try {
      await relApi.unblock(userId);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        toast(describeError(err, t("friends.couldNotUpdate")));
        return false;
      }
    }
    useRelationships.getState().remove(userId);
    toast(t("friends.unblocked"), "success");
    return true;
  });
  return done ?? false;
}

/** Someone a menu can offer friend and block items for: not this account itself, nor the Nexa system account. */
function otherPerson(userId: string): PublicUser | null {
  const me = useAuth.getState().me;
  const user = useUsers.getState().byId[userId];
  return !me || userId === me.id || !user || isSystemAccount(user.flags) ? null : user;
}

/** The friend items for someone's menu: Add friend, or answering or taking back a request, or Remove friend. */
export function friendMenuItems(userId: string): ContextMenuItem[] {
  const user = otherPerson(userId);
  if (!user) return [];
  const rel = useRelationships.getState().byUser[userId];
  const busy = !!useRelationshipBusy.getState().busy[userId];
  if (!rel) return [{ id: "add-friend", label: t("profile.profileCard.addFriend"), disabled: busy, onSelect: () => void sendFriendRequest(user) }];
  if (rel.type === "incoming")
    return [
      { id: "accept-request", label: t("profile.profileCard.acceptFriendRequest"), disabled: busy, onSelect: () => void acceptFriendRequest(user) },
      { id: "ignore-request", label: t("people.menu.ignoreRequest"), disabled: busy, onSelect: () => void dropFriendRequest(userId) },
    ];
  if (rel.type === "outgoing") return [{ id: "cancel-request", label: t("people.menu.cancelRequest"), disabled: busy, onSelect: () => void dropFriendRequest(userId) }];
  if (rel.type === "friend") return [{ id: "remove-friend", label: t("profile.profileCard.removeFriend"), danger: true, onSelect: () => confirmRemoveFriend(user) }];
  return [];
}

/** Block or Unblock, for someone's menu. */
export function blockMenuItem(userId: string): ContextMenuItem | null {
  if (!otherPerson(userId)) return null;
  if (useRelationships.getState().byUser[userId]?.type === "blocked") return { id: "unblock", label: t("friends.unblock"), disabled: !!useRelationshipBusy.getState().busy[userId], onSelect: () => void unblockUser(userId) };
  return { id: "block", label: t("profile.profileCard.block"), danger: true, onSelect: () => openBlockDialog(userId) };
}

/**
 * The friend and block items for someone's menu, as two buttons: `ids` names
 * them in the menu they are in, `user` says who the menu is about.
 */
export function relationshipButtons<C>(ids: { friend: string; block: string }, user: (ctx: C) => string | null): MenuButton<C>[] {
  return [
    button(ids.friend, (ctx) => {
      const id = user(ctx);
      return id ? friendMenuItems(id) : null;
    }),
    button(ids.block, (ctx) => {
      const id = user(ctx);
      return id ? blockMenuItem(id) : null;
    }),
  ];
}

// --- several people at once (a picked part of a list) ------------------------

/** "Alice, Bob and Cara": the people a bulk action is about, as the app's language lists them. */
export function nameList(users: PublicUser[]): string {
  return formatList(users.map((u) => displayName(u)));
}

/**
 * Runs a job for each person in turn, and says once how it went: how many it
 * worked for, and what went wrong with the first that failed.
 */
async function eachPerson(users: PublicUser[], job: (u: PublicUser) => Promise<void>, done: (count: number) => string, failed: string): Promise<void> {
  let ok = 0;
  let firstError: unknown = null;
  for (const u of users) {
    try {
      await job(u);
      ok++;
    } catch (err) {
      firstError ??= err;
    }
  }
  if (ok) toast(done(ok), "success");
  if (firstError) toast(describeError(firstError, failed));
}

/** Stops being friends with several people, after asking once. */
export function confirmRemoveFriends(users: PublicUser[]): void {
  if (users.length === 1) return confirmRemoveFriend(users[0]!);
  useUI.getState().openModal("confirm", {
    title: t("pick.removeFriendsTitle", { count: users.length }),
    body: personText("pick.removeFriendsBody", null, null, { names: personList(users) }),
    confirmLabel: t("pick.removeFriends", { count: users.length }),
    danger: true,
    onConfirm: () =>
      eachPerson(
        users,
        async (u) => {
          await relApi.remove(u.id);
          useRelationships.getState().remove(u.id);
        },
        (count) => t("pick.friendsRemoved", { count }),
        t("friends.couldNotUpdate"),
      ),
  });
}

/** Blocks several people, after asking once, with the account's choices about their messages. */
export function confirmBlockPeople(users: PublicUser[]): void {
  if (users.length === 1) return openBlockDialog(users[0]!.id);
  useUI.getState().openModal("confirm", {
    title: t("pick.blockTitle", { count: users.length }),
    body: personText("pick.blockBody", null, null, { names: personList(users) }),
    confirmLabel: t("pick.block", { count: users.length }),
    danger: true,
    onConfirm: () =>
      eachPerson(
        users,
        async (u) => {
          await relApi.block(u.id);
          setRel(u, "blocked");
        },
        (count) => t("pick.blocked", { count }),
        t("friends.couldNotUpdate"),
      ),
  });
}

/** Unblocks several people. */
export function unblockPeople(users: PublicUser[]): Promise<void> {
  return eachPerson(
    users,
    async (u) => {
      try {
        await relApi.unblock(u.id);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
      useRelationships.getState().remove(u.id);
    },
    (count) => t("pick.unblocked", { count }),
    t("friends.couldNotUpdate"),
  );
}

/** Says yes to several requests. */
export function acceptRequests(users: PublicUser[]): Promise<void> {
  return eachPerson(
    users,
    async (u) => {
      const res = await relApi.accept(u.id);
      setRel(res.user, "friend");
      if (res.channel) useChannels.getState().upsert(res.channel);
    },
    (count) => t("pick.accepted", { count }),
    t("profile.profileCard.couldNotAccept"),
  );
}

/** Ignores several requests, or takes back several of your own. */
export function dropRequests(users: PublicUser[]): Promise<void> {
  return eachPerson(
    users,
    async (u) => {
      try {
        await relApi.remove(u.id);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
      useRelationships.getState().remove(u.id);
    },
    (count) => t("pick.requestsDropped", { count }),
    t("friends.couldNotUpdate"),
  );
}
