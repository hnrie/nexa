import { api, captchaOptions } from "./client";
import type { NoteKeyRow, NoteLinkRow, NoteLinkView, NoteInviteRow, NoteRole, NoteRow, NoteSharing, NoteVersionRow, PublicUser, Snowflake } from "./types";

/**
 * Notes. Everything sent and returned here is sealed on the device
 * (crypto/notes.ts): the server keeps who may read and write a note and
 * which save came first, and nothing it could read.
 */
export const notes = {
  list(): Promise<{ notes: NoteRow[]; invites: NoteInviteRow[] }> {
    return api.request("GET", "/notes");
  },
  create(head: string, body: string, keySealed: string): Promise<NoteRow> {
    return api.request("POST", "/notes", { head, body, key_sealed: keySealed });
  },
  get(id: Snowflake): Promise<NoteRow> {
    return api.request("GET", `/notes/${id}`);
  },
  /** Saves over the version `base`. Refused with `note_stale` when the note has moved on since. */
  save(id: Snowflake, head: string, body: string, base: number, files: string[], opts?: { keep?: boolean; keepalive?: boolean }): Promise<{ version: number; updated_at: number }> {
    // keep: the state being replaced is set aside as a version, whatever the clock says
    return api.request("PUT", `/notes/${id}`, { head, body, base_version: base, files, ...(opts?.keep ? { keep: true } : {}) }, opts?.keepalive ? { keepalive: true } : undefined);
  },
  /** The note's earlier states, newest first, and its earlier keys. */
  versions(id: Snowflake): Promise<{ versions: NoteVersionRow[]; keys: NoteKeyRow[] }> {
    return api.request("GET", `/notes/${id}/versions`);
  },
  version(id: Snowflake, versionId: Snowflake): Promise<NoteVersionRow> {
    return api.request("GET", `/notes/${id}/versions/${versionId}`);
  },
  /** Says this account has the note open, or has closed it; `hello` asks the others there to say so too. */
  presence(id: Snowflake, here: boolean, hello = false, opts?: { keepalive?: boolean }): Promise<void> {
    return api.request<void>("POST", `/notes/${id}/presence`, { here, hello }, opts?.keepalive ? { keepalive: true } : undefined);
  },
  remove(id: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/notes/${id}`);
  },
  sharing(id: Snowflake): Promise<NoteSharing> {
    return api.request("GET", `/notes/${id}/sharing`);
  },
  setRole(id: Snowflake, userId: Snowflake, role: NoteRole): Promise<void> {
    return api.request<void>("PATCH", `/notes/${id}/members/${userId}`, { role });
  },
  /** Takes someone out of a note; "@me" leaves it. */
  removeMember(id: Snowflake, userId: Snowflake | "@me"): Promise<void> {
    return api.request<void>("DELETE", `/notes/${id}/members/${userId}`);
  },
  invite(id: Snowflake, userId: Snowflake, role: NoteRole, keySealed: string, captcha?: string | null): Promise<{ id: Snowflake; role: NoteRole; created_at: number; user: PublicUser }> {
    return api.request("POST", `/notes/${id}/invites`, { user_id: userId, role, key_sealed: keySealed }, captchaOptions(captcha));
  },
  cancelInvite(id: Snowflake, inviteId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/notes/${id}/invites/${inviteId}`);
  },
  acceptInvite(inviteId: Snowflake): Promise<NoteRow> {
    return api.request("POST", `/note-invites/${inviteId}/accept`);
  },
  declineInvite(inviteId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/note-invites/${inviteId}`);
  },
  createLink(id: Snowflake, link: { token_hash: string; role: NoteRole; key_wrapped: string; link_sealed: string }): Promise<NoteLinkRow> {
    return api.request("POST", `/notes/${id}/links`, link);
  },
  removeLink(id: Snowflake, linkId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/notes/${id}/links/${linkId}`);
  },
  /** What a share link leads to. Only the link's token is sent: the key after its # never leaves the device. */
  link(token: string): Promise<NoteLinkView> {
    return api.request("GET", `/note-links/${encodeURIComponent(token)}`);
  },
  joinLink(token: string, keySealed: string): Promise<NoteRow> {
    return api.request("POST", `/note-links/${encodeURIComponent(token)}/join`, { key_sealed: keySealed });
  },
  rekey(
    id: Snowflake,
    body: {
      head: string;
      body: string;
      base_version: number;
      /** The key being replaced, sealed with the new one. */
      prev_key: string;
      members: { user_id: Snowflake; key_sealed: string }[];
      invites: { id: Snowflake; key_sealed: string }[];
      links: { id: Snowflake; key_wrapped: string; link_sealed: string }[];
    },
  ): Promise<{ version: number; updated_at: number }> {
    return api.request("POST", `/notes/${id}/rekey`, body);
  },
};
