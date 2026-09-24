/**
 * Moderation, both sides of it.
 *
 * `nexa` is a member's own: their Nexa conversation (notices about actions
 * taken on their account, lifted mutes and bans, announcements) and their case
 * threads, where they can appeal. `moderation` is the staff's panel. None of it
 * is end-to-end encrypted — a case thread is a conversation with the instance
 * itself — and the app says so wherever one is written.
 */
import { api } from "./client";
import type { PublicUser, Snowflake } from "./types";

export type ModAction = "avatar_remove" | "field_reset" | "mute" | "ban" | "delete";
export type ResetField = "username" | "display_name" | "about_me" | "pronouns" | "status";

/** As much of an account as the moderation views draw: a name, an avatar, a way to the profile. */
export interface Person {
  id: Snowflake;
  username: string;
  display_name: string;
  avatar_id: Snowflake | null;
  flags: number;
  deleted?: boolean;
}

/** People named by a response, keyed by id; views refer to them by id. */
export type People = Record<string, Person>;

export interface PurgeCounts {
  messages: number;
  attachments: number;
  attachment_bytes: number;
  owned_servers: number;
  owned_groups: number;
  servers: number;
  groups: number;
  packs: number;
  reactions: number;
  /** One-to-one conversations, which go whole when someone deletes their own account. */
  direct_messages?: number;
}

/** Exactly what a case did; which fields are there depends on the action. */
export interface CaseDetails {
  avatar?: boolean;
  banner?: boolean;
  fields?: ResetField[];
  old?: Partial<Record<ResetField, string>>;
  new?: Partial<Record<ResetField, string>>;
  duration_ms?: number;
  permanent?: boolean;
  counts?: PurgeCounts;
  complete?: boolean;
}

/** A case as the member it is about sees it. */
export interface MemberCase {
  id: Snowflake;
  number: number;
  action: ModAction;
  reason: string;
  details: CaseDetails;
  moderator_id: Snowflake;
  created_at: number;
  expires_at: number | null;
  lifted_at: number | null;
  lifted_by: Snowflake | null;
  lift_reason: string;
  status: "open" | "closed";
  /** Its mute or ban still holds. */
  in_effect: boolean;
  /** Its mute or ban ran out, or a later case replaced it. */
  ended: boolean;
  /** Staff replies the member has not read. */
  unread: number;
  acknowledged: boolean;
  last_activity_at: number;
}

export type Awaiting = "staff" | "member" | "none";

/** A case as the staff see it. */
export interface StaffCase extends MemberCase {
  user_id: Snowflake;
  target_username: string;
  target_display_name: string;
  awaiting: Awaiting;
  closed_at: number | null;
  closed_by: Snowflake | null;
  notice_ack_at: number | null;
  last_message: CaseMessage | null;
}

export type CaseEvent = "" | "lifted" | "closed" | "reopened" | "expired" | "replaced";

/** One line of a case's thread. */
export interface CaseMessage {
  id: Snowflake;
  case_id: Snowflake;
  author_id: Snowflake;
  kind: "member" | "staff" | "system";
  event: CaseEvent;
  body: string;
  created_at: number;
}

/** A mute or ban in force. */
export interface Restriction {
  kind: "mute" | "ban";
  case_id: Snowflake;
  case_number: number;
  reason: string;
  moderator_id: Snowflake;
  expires_at: number | null;
  created_at: number;
}

export interface CaseCounts {
  needs_reply: number;
  open: number;
  in_effect: number;
  closed: number;
  all: number;
}

/** An account's standing, as it arrives with the account and on every change. */
export interface NexaState {
  /** The Nexa system account's id. */
  account_id: Snowflake;
  mute: Restriction | null;
  ban: Restriction | null;
  /** Notices not yet dismissed, oldest first. */
  pending: MemberCase[];
  unread: number;
  /** When Nexa last had something for this account (0: never). */
  latest: number;
  people: People;
  /** Staff only: what is waiting on them. */
  staff?: { counts: CaseCounts; owner_id: Snowflake };
}

export interface Announcement {
  id: Snowflake;
  title: string;
  body: string;
  author_id: Snowflake;
  created_at: number;
}

export type FeedItem =
  | { kind: "notice" | "lift"; at: number; case: MemberCase }
  | { kind: "announcement"; at: number; announcement: Announcement };

export type BlockReason = "" | "self" | "system" | "deleted" | "owner" | "staff";

/** An account in the moderation grid. */
export interface ModUser extends PublicUser {
  /** Every flag, including disabled and deleted. */
  admin_flags: number;
  case_count: number;
  open_cases: number;
  awaiting_cases: number;
  last_seen_at: number | null;
  mute: Restriction | null;
  ban: Restriction | null;
  /** Why the viewer cannot act on this account ("" when they can). */
  blocked: BlockReason;
}

export interface ModLogEntry {
  id: Snowflake;
  action: string;
  moderator_id: Snowflake;
  moderator_username: string;
  target_id: Snowflake | null;
  target_username: string;
  case_id: Snowflake | null;
  case_number: number | null;
  reason: string;
  details: Record<string, unknown>;
  created_at: number;
}

export type GridShow = "all" | "muted" | "banned" | "staff" | "cases" | "disabled";
export type GridSort = "newest" | "oldest" | "name";
export type CaseView = "needs_reply" | "open" | "in_effect" | "closed" | "all";

export interface ActionRequest {
  action: ModAction;
  reason: string;
  images?: { avatar: boolean; banner: boolean };
  fields?: ResetField[];
  duration_ms?: number;
  permanent?: boolean;
  confirm?: string;
}

interface Thread<C> {
  case: C;
  messages: CaseMessage[];
  people: People;
}

export const nexa = {
  state(): Promise<{ state: NexaState; account: PublicUser | null }> {
    return api.request("GET", "/nexa");
  },
  feed(before?: number): Promise<{ items: FeedItem[]; has_more: boolean; people: People }> {
    return api.request("GET", "/nexa/feed", undefined, { query: { before } });
  },
  seen(at?: number): Promise<void> {
    return api.request("POST", "/nexa/seen", at ? { at } : {});
  },
  thread(caseId: Snowflake): Promise<Thread<MemberCase>> {
    return api.request("GET", `/nexa/cases/${caseId}`);
  },
  reply(caseId: Snowflake, body: string): Promise<{ message: CaseMessage; messages: CaseMessage[]; case: MemberCase }> {
    return api.request("POST", `/nexa/cases/${caseId}/messages`, { body });
  },
  read(caseId: Snowflake, messageId: Snowflake): Promise<void> {
    return api.request("POST", `/nexa/cases/${caseId}/read`, { message_id: messageId });
  },
  ack(caseId: Snowflake): Promise<void> {
    return api.request("POST", `/nexa/cases/${caseId}/ack`);
  },
};

export const moderation = {
  summary(): Promise<{ counts: CaseCounts; owner_id: Snowflake; nexa_id: Snowflake; staff_ids: Snowflake[]; people: People }> {
    return api.request("GET", "/moderation/summary");
  },
  users(p: { q?: string; show?: GridShow; sort?: GridSort; cursor?: string; limit?: number }): Promise<{ users: ModUser[]; next_cursor: string }> {
    return api.request("GET", "/moderation/users", undefined, { query: { q: p.q || undefined, show: p.show, sort: p.sort, cursor: p.cursor || undefined, limit: p.limit } });
  },
  user(id: Snowflake): Promise<{ user: ModUser; cases: StaffCase[]; people: People }> {
    return api.request("GET", `/moderation/users/${id}`);
  },
  purgePreview(id: Snowflake): Promise<PurgeCounts> {
    return api.request("GET", `/moderation/users/${id}/purge-preview`);
  },
  act(id: Snowflake, body: ActionRequest): Promise<{ case: StaffCase; people: People }> {
    return api.request("POST", `/moderation/users/${id}/actions`, body);
  },
  cases(p: { view: CaseView; before_at?: number; before_id?: Snowflake; limit?: number }): Promise<{ cases: StaffCase[]; counts: CaseCounts; people: People }> {
    return api.request("GET", "/moderation/cases", undefined, { query: { view: p.view, before_at: p.before_at, before_id: p.before_id, limit: p.limit } });
  },
  thread(caseId: Snowflake): Promise<Thread<StaffCase>> {
    return api.request("GET", `/moderation/cases/${caseId}`);
  },
  reply(caseId: Snowflake, body: string): Promise<{ message: CaseMessage; messages: CaseMessage[]; case: StaffCase }> {
    return api.request("POST", `/moderation/cases/${caseId}/messages`, { body });
  },
  lift(caseId: Snowflake, reason: string): Promise<{ case: StaffCase }> {
    return api.request("POST", `/moderation/cases/${caseId}/lift`, { reason });
  },
  setClosed(caseId: Snowflake, closed: boolean): Promise<{ case: StaffCase }> {
    return api.request("POST", `/moderation/cases/${caseId}/${closed ? "close" : "reopen"}`);
  },
  log(p: { action?: string[]; q?: string; target?: Snowflake; before?: Snowflake; limit?: number }): Promise<{ entries: ModLogEntry[]; people: People }> {
    return api.request("GET", "/moderation/log", undefined, {
      query: { action: p.action?.length ? p.action.join(",") : undefined, q: p.q || undefined, target: p.target, before: p.before, limit: p.limit },
    });
  },
  announcements(before?: number): Promise<{ announcements: Announcement[]; people: People; recipients: number }> {
    return api.request("GET", "/moderation/announcements", undefined, { query: { before } });
  },
  announce(title: string, body: string): Promise<{ announcement: Announcement; people: People }> {
    return api.request("POST", "/moderation/announcements", { title, body });
  },
  retract(id: Snowflake): Promise<void> {
    return api.request("DELETE", `/moderation/announcements/${id}`);
  },
  /** Grants or takes away admin access, or disables or restores sign-in, with an optional reason for the log. */
  access(id: Snowflake, body: { admin?: boolean; disabled?: boolean; reason?: string }): Promise<{ flags: number }> {
    return api.request("PATCH", `/admin/users/${id}`, body);
  },
};
