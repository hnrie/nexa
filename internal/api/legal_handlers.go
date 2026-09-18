package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// A law-enforcement response, for an operator who has been served valid legal
// process about one account.
//
// Every platform of any size publishes a guide telling officers what it holds
// and what it does not; a one-person instance needs the same thing, and needs
// it more, because the person answering the letter is also the person who has
// to be sure the answer is complete and true. So this is a read of the tables
// and nothing else: no new column, no new log, no retention that would not
// exist if this file were deleted.
//
// The document below is written in English on purpose and is not translated.
// It goes to an officer, usually in the United States, and it may be attached
// to a filing. A certificate of records that changes wording with the operator's
// interface language is worth less than one that does not.

// legalLabelWidth is where the value column starts, so the whole document lines
// up when it is pasted into a filing that is not proportionally spaced.
const legalLabelWidth = 26

func (s *Server) legalRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/admin/legal-report", s.admin(s.handleLegalReport))
}

// handleLegalReport compiles the document for one account. It is guarded and
// rate-limited exactly as the other admin routes are, through s.admin.
func (s *Server) handleLegalReport(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	who := strings.TrimPrefix(strings.TrimSpace(r.URL.Query().Get("user")), "@")
	if who == "" {
		WriteError(w, E(http.StatusBadRequest, "no_account", "Name the account the request is about: a username or an account id."))
		return
	}
	u, err := s.accountFor(r.Context(), who)
	if err != nil {
		WriteError(w, err)
		return
	}
	rec, err := s.Store.AccountRecord(r.Context(), u.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	// Compiling a report is the operator's own act, not something that happens
	// to the account, so it is recorded where the server records what it does:
	// its log. It is deliberately not written to audit_log, which is a
	// per-community log that the moderators of that community read — putting it
	// there would tell them an account of theirs is under legal process, which
	// is not the operator's to disclose and is often the subject of an order
	// forbidding exactly that.
	s.Log.Warn("law enforcement report compiled",
		"subject", rec.User.ID.String(), "subject_username", rec.User.Username,
		"by", me.ID.String(), "by_username", me.Username, "taken_at", rec.TakenAt)
	WriteJSON(w, http.StatusOK, map[string]any{
		"user_id":      rec.User.ID,
		"username":     rec.User.Username,
		"generated_at": rec.TakenAt,
		"filename":     "nexa-law-enforcement-response-" + rec.User.Username + "-" + time.UnixMilli(rec.TakenAt).UTC().Format("20060102-150405") + ".txt",
		"document":     s.renderLegalReport(rec, me),
	})
}

// accountFor resolves what the officer wrote down. A snowflake is what a
// preservation letter usually carries, so an id that resolves wins; a username
// is made of the same characters, so "12345" could be either and the id is
// tried first only because it is the one that cannot be re-used by somebody
// else later.
func (s *Server) accountFor(ctx context.Context, who string) (*store.User, error) {
	if id, err := ids.Parse(who); err == nil {
		if u, err := s.Store.UserByID(ctx, id); err == nil {
			return u, nil
		}
	}
	u, err := s.Store.UserByUsername(ctx, strings.ToLower(who))
	if err != nil {
		return nil, E(http.StatusNotFound, "no_such_account", "No account on this instance has that username or id.")
	}
	return u, nil
}

// legalDoc is a plain-text document being written a line at a time.
type legalDoc struct {
	b       strings.Builder
	section int
}

func (d *legalDoc) line(s string) { d.b.WriteString(s); d.b.WriteByte('\n') }
func (d *legalDoc) blank()        { d.b.WriteByte('\n') }

// para writes a paragraph already wrapped by hand, so the document reads the
// same in a terminal, an email and a filing.
func (d *legalDoc) para(lines ...string) {
	for _, l := range lines {
		d.line(l)
	}
	d.blank()
}

// head opens a numbered section and names the tables it was read from, so every
// figure below it can be traced back to a row without asking the operator.
func (d *legalDoc) head(title, tables string) {
	d.section++
	d.line(strconv.Itoa(d.section) + ". " + title)
	d.line("   Source: " + tables)
	d.blank()
}

// field writes one label-and-value row.
func (d *legalDoc) field(label, value string) {
	d.line("  " + label + strings.Repeat(" ", max(1, legalLabelWidth-len(label))) + value)
}

func (d *legalDoc) item(s string)  { d.line("  - " + s) }
func (d *legalDoc) note(s string)  { d.line("  " + s) }
func (d *legalDoc) empty(s string) { d.line("  " + s); d.blank() }

// cont continues the item above it, lined up under its text rather than under
// its bullet, so a two-line entry still reads as one entry.
func (d *legalDoc) cont(s string) { d.line("      " + s) }

// more closes a list that was cut short, saying how much was left out. A report
// that silently truncates is worse than one that does not list at all.
func (d *legalDoc) more(shown, total int) {
	if total > shown {
		d.note("(" + strconv.Itoa(total-shown) + " further rows exist and were not listed; the count above is complete.)")
	}
	d.blank()
}

// capped says so when a list came back exactly at the store's limit, where the
// true total is not known from the list itself.
func (d *legalDoc) capped(shown int) {
	if shown >= store.LegalListCap {
		d.note("(the list above stops at " + strconv.Itoa(store.LegalListCap) + " rows; there may be more.)")
	}
	d.blank()
}

// legalTime renders a stored timestamp as an absolute UTC time with the raw
// value beside it: the first is for the reader, the second is what is in the
// column, and a document that gives both cannot be accused of rounding.
func legalTime(ms int64) string {
	if ms == 0 {
		return "not recorded"
	}
	return time.UnixMilli(ms).UTC().Format("2006-01-02 15:04:05") + " UTC (" + strconv.FormatInt(ms, 10) + ")"
}

func legalTimeOpt(ms *int64) string {
	if ms == nil {
		return "not set"
	}
	return legalTime(*ms)
}

func legalIDOpt(id *ids.ID) string {
	if id == nil {
		return "none"
	}
	return id.String()
}

// legalText keeps an empty column visibly empty rather than leaving a gap that
// could be read as an omission.
func legalText(s string) string {
	if strings.TrimSpace(s) == "" {
		return "(empty)"
	}
	return s
}

func legalYesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}

func legalCount(n int) string { return strconv.Itoa(n) }

// legalPlural counts something in a sentence. A document that says "1 messages"
// invites the reader to wonder what else in it was generated without being read.
func legalPlural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return strconv.Itoa(n) + " " + many
}

// legalBytes gives a size in bytes and, above a kilobyte, in the unit a person
// reads. The exact byte count stays because it is what the column holds.
func legalBytes(n int64) string {
	out := strconv.FormatInt(n, 10) + " bytes"
	switch {
	case n >= 1<<30:
		return out + " (" + strconv.FormatFloat(float64(n)/(1<<30), 'f', 1, 64) + " GiB)"
	case n >= 1<<20:
		return out + " (" + strconv.FormatFloat(float64(n)/(1<<20), 'f', 1, 64) + " MiB)"
	case n >= 1<<10:
		return out + " (" + strconv.FormatFloat(float64(n)/(1<<10), 'f', 1, 64) + " KiB)"
	}
	return out
}

// legalFlags spells out the account's flag bits, which are the only status this
// instance keeps for an account.
func legalFlags(f int64) string {
	var on []string
	if f&store.FlagAdmin != 0 {
		on = append(on, "instance administrator")
	}
	if f&store.FlagDisabled != 0 {
		on = append(on, "disabled by an administrator")
	}
	if f&store.FlagDeleted != 0 {
		on = append(on, "deleted (profile columns overwritten)")
	}
	if len(on) == 0 {
		return strconv.FormatInt(f, 10) + " (ordinary account, not disabled, not deleted)"
	}
	return strconv.FormatInt(f, 10) + " (" + strings.Join(on, "; ") + ")"
}

// renderLegalReport turns the record into the document that is sent back. Every
// line of it is either a column read from the database or a statement about the
// software that the operator can stand behind.
func (s *Server) renderLegalReport(rec *store.AccountRecord, by *store.User) string {
	d := &legalDoc{}
	u := rec.User

	d.line("NEXA — LAW ENFORCEMENT RESPONSE")
	d.line("Records held for a single account, as of the snapshot below.")
	d.blank()
	d.field("Instance:", "Nexa")
	d.field("Address:", legalText(s.Cfg.PublicURL))
	d.field("Operator:", "the instance administrator, reachable through "+legalText(s.Cfg.PublicURL))
	d.field("Software:", "chatd "+legalText(s.Version))
	d.field("Snapshot taken:", legalTime(rec.TakenAt))
	d.field("Report compiled by:", "@"+by.Username+" (account id "+by.ID.String()+")")
	d.blank()
	d.field("Account requested:", "@"+u.Username)
	d.field("Account id:", u.ID.String())
	d.blank()

	d.para(
		"HOW TO READ THIS DOCUMENT",
		"",
		"This is a single-operator deployment of Nexa, an end-to-end-encrypted chat",
		"server. The document is a direct read of the records this instance already",
		"holds about the account named above, taken in one pass at the instant given",
		"above. Nothing in it was inferred, enriched or obtained from a third party:",
		"each line is a column of a row that exists in the database, and each section",
		"names the tables it came from.",
		"",
		"Message content, call media and attachment content are end-to-end encrypted.",
		"The operator holds no key to any of it and cannot produce it. Sections headed",
		"DATA NOT AVAILABLE and DATA NOT COLLECTED set out exactly what that means and",
		"what is simply never recorded, so that a further request for those categories",
		"can be answered before it is made.",
		"",
		"All times are UTC and are given with the raw value, which is the number of",
		"milliseconds since 1970-01-01T00:00:00Z as stored. Identifiers are snowflakes:",
		"the number itself encodes the millisecond it was issued, so any id in this",
		"document is also a creation time.",
	)

	legalAccount(d, rec)
	legalCredentials(d, rec)
	legalSessions(d, rec)
	legalMFA(d, rec)
	legalSettings(d, rec)
	legalRelationships(d, rec)
	legalCommunities(d, rec)
	legalConversations(d, rec)
	legalMessages(d, rec)
	legalFiles(d, rec)
	legalEngagement(d, rec)
	legalLinks(d, rec)
	legalTransfers(d, rec)
	legalModeration(d, rec)
	legalExpressions(d, rec)
	legalKeys(d, rec)
	legalCrashes(d, rec)
	legalUnavailable(d)
	legalNotCollected(d)
	s.legalProvenance(d, rec, by)
	return d.b.String()
}

func legalAccount(d *legalDoc, rec *store.AccountRecord) {
	u := rec.User
	d.head("ACCOUNT", "users")
	d.field("Username:", u.Username)
	d.field("Display name:", legalText(u.DisplayName))
	d.field("Account id:", u.ID.String())
	d.field("Created:", legalTime(u.CreatedAt))
	d.field("Profile last changed:", legalTime(u.UpdatedAt))
	d.field("Status flags:", legalFlags(u.Flags))
	d.field("About me:", legalText(u.AboutMe))
	d.field("Pronouns:", legalText(u.Pronouns))
	d.field("Custom status:", legalText(u.StatusEmoji+" "+u.StatusText))
	d.field("Status expires:", legalTimeOpt(u.StatusExpiresAt))
	d.field("Presence preference:", legalText(u.PresencePref))
	d.field("Who may DM them:", legalText(u.DMPrivacy))
	d.field("Avatar file id:", legalIDOpt(u.AvatarID))
	d.field("Banner file id:", legalIDOpt(u.BannerID))
	d.blank()
	d.note("Every field above was typed by the account holder except the id, the times")
	d.note("and the flags. None of it is verified by this instance: there is no identity")
	d.note("check at registration, so a display name or an \"about me\" is a claim and")
	d.note("nothing more.")
	d.blank()
}

func legalCredentials(d *legalDoc, rec *store.AccountRecord) {
	d.head("CREDENTIALS HELD (VALUES NOT PRODUCED)", "users")
	d.para(
		"  The account row carries the credential columns below. Their values are not",
		"  reproduced here and cannot usefully be produced: none of them is a password,",
		"  and none of them can be turned into one. They are listed so that the request",
		"  can be closed on this point.",
	)
	d.item("auth_hash — an argon2id verifier of a key the browser derives from the")
	d.cont("password. The password itself never reaches this server in any form.")
	d.item("kdf_salt, kdf_params — the parameters the browser stretches the password")
	d.cont("with.")
	d.item("public_key — the account's public key, which is public by design.")
	d.item("enc_private_key — the account's private key, encrypted with a key derived")
	d.cont("from the password. The operator cannot open it.")
	d.item("enc_private_key_recovery, recovery_auth_hash — the same private key under")
	d.cont("the account's recovery key, and a verifier for that key. The recovery key")
	d.cont("itself was shown once, in the browser, and was never stored here.")
	d.blank()
	d.field("Recovery key set up:", legalYesNo(rec.User.RecoveryAuthHash != ""))
	d.blank()
}

func legalSessions(d *legalDoc, rec *store.AccountRecord) {
	d.head("LOGIN SESSIONS AND IP ADDRESSES", "sessions, channel_unlocks")
	d.para(
		"  One row per signed-in device that has not been signed out or expired. This",
		"  is the only place this instance writes an IP address for an account.",
		"",
		"  The address is the one the session was opened from, recorded once when the",
		"  session was created and never updated afterwards. It is therefore a record of",
		"  where a login happened, not of where the account has been since. The earliest",
		"  row for an account is normally its registration, because registering signs the",
		"  new account in; it is not separately labelled as such.",
		"",
		"  Sessions are deleted when the holder signs out, when an administrator disables",
		"  the account, and when they go idle past the instance's session lifetime. A",
		"  deleted session leaves nothing behind, so this list is what exists now and not",
		"  a history of every login ever made.",
	)
	d.field("Sessions held now:", legalCount(len(rec.Sessions)))
	d.blank()
	if len(rec.Sessions) == 0 {
		d.empty("No session rows exist for this account.")
	}
	for i, se := range rec.Sessions {
		d.line("  Session " + strconv.Itoa(i+1) + " of " + strconv.Itoa(len(rec.Sessions)))
		d.field("  Session id:", se.ID.String())
		d.field("  IP at sign-in:", legalText(se.IP))
		d.field("  User agent:", legalText(se.UserAgent))
		d.field("  Signed in:", legalTime(se.CreatedAt))
		d.field("  Last activity:", legalTime(se.LastSeenAt))
		d.blank()
	}
	d.field("Subchats unlocked:", legalCount(rec.Unlocks))
	d.blank()
	d.note("A subchat can carry a password. Where one does, the server records which of")
	d.note("these sessions has typed it, as a row per session. Neither the password nor a")
	d.note("hash of it is kept against a session, and the messages in such a subchat are")
	d.note("encrypted exactly as any others: the password shuts the door on the screen, it")
	d.note("is not what encrypts anything.")
	d.blank()
}

func legalMFA(d *legalDoc, rec *store.AccountRecord) {
	d.head("TWO-FACTOR AUTHENTICATION", "user_mfa, mfa_backup_codes")
	if rec.MFA == nil {
		d.empty("No second factor has ever been set up for this account; no row exists.")
		return
	}
	d.field("Enabled:", legalYesNo(rec.MFA.Enabled))
	d.field("Set up:", legalTime(rec.MFA.CreatedAt))
	d.field("Backup codes issued:", legalCount(rec.MFA.BackupCodesTotal))
	d.field("Backup codes spent:", legalCount(rec.MFA.BackupCodesUsed))
	d.blank()
	d.note("The authenticator seed is stored sealed with a key that exists only on this")
	d.note("server, and the backup codes are stored as keyed hashes. Neither is produced:")
	d.note("they are credentials for getting into the account, not records of its use.")
	d.blank()
}

func legalSettings(d *legalDoc, rec *store.AccountRecord) {
	d.head("CLIENT SETTINGS", "user_settings")
	if rec.Settings == nil {
		d.empty("No settings row exists for this account.")
		return
	}
	d.field("Stored size:", legalBytes(rec.Settings.Bytes))
	d.field("Version:", strconv.FormatInt(rec.Settings.Version, 10))
	d.field("Last written:", legalTime(rec.Settings.UpdatedAt))
	d.blank()
	d.note("This row is a single opaque blob that the account's own client encrypted")
	d.note("before sending. Its contents — themes, notification choices, muted")
	d.note("conversations, the order of a sidebar — cannot be read by the operator. Only")
	d.note("its size, its version counter and when it was last written are legible.")
	d.blank()
}

func legalRelationships(d *legalDoc, rec *store.AccountRecord) {
	d.head("FRIENDS, REQUESTS AND BLOCKS", "relationships")
	d.para(
		"  Each row is one direction of a link between two accounts: friend, outgoing",
		"  request, incoming request, or blocked. Rows are removed when the link is,",
		"  so this is the state now and not a history.",
	)
	d.field("Rows they created:", legalCount(len(rec.Outgoing)))
	d.field("Rows naming them:", legalCount(len(rec.Incoming)))
	d.blank()
	if len(rec.Outgoing) > 0 {
		d.note("From this account:")
		for _, r := range rec.Outgoing {
			note := ""
			if r.Nickname != "" {
				note = ", private nickname they set: " + r.Nickname
			}
			d.item("account " + r.OtherID.String() + " — " + r.Type + ", since " + legalTime(r.CreatedAt) + note)
		}
		d.blank()
	}
	if len(rec.Incoming) > 0 {
		d.note("From other accounts, about this one:")
		for _, r := range rec.Incoming {
			note := ""
			if r.Nickname != "" {
				note = ", private nickname that account set for them: " + r.Nickname
			}
			d.item("account " + r.OtherID.String() + " — " + r.Type + ", since " + legalTime(r.CreatedAt) + note)
		}
		d.blank()
	}
	if len(rec.Outgoing) == 0 && len(rec.Incoming) == 0 {
		d.empty("No relationship rows exist in either direction.")
	}
}

func legalCommunities(d *legalDoc, rec *store.AccountRecord) {
	d.head("COMMUNITIES (SERVERS)", "server_members, member_roles, roles, servers")
	d.field("Memberships:", legalCount(len(rec.Memberships)))
	d.field("Communities owned:", legalCount(len(rec.Owned)))
	d.blank()
	for _, m := range rec.Memberships {
		d.line("  " + m.ServerName + " (id " + m.ServerID.String() + ")")
		d.field("  Joined:", legalTime(m.JoinedAt))
		d.field("  Nickname there:", legalText(m.Nickname))
		d.field("  Per-community avatar:", legalIDOpt(m.AvatarID))
		d.field("  Timed out until:", legalTimeOpt(m.TimeoutUntil))
		d.field("  Roles:", legalText(strings.Join(m.Roles, ", ")))
		d.blank()
	}
	if len(rec.Memberships) == 0 {
		d.empty("This account is not a member of any community.")
	}
	if len(rec.Owned) > 0 {
		d.note("Communities this account owns:")
		for _, sv := range rec.Owned {
			d.item(sv.Name + " (id " + sv.ID.String() + "), created " + legalTime(sv.CreatedAt))
		}
		d.blank()
	}
	d.note("A community's name, its description and its channel names are typed by the")
	d.note("people who run it and are stored as typed. Nothing said inside a channel is.")
	d.blank()
}

func legalConversations(d *legalDoc, rec *store.AccountRecord) {
	d.head("CONVERSATIONS", "dm_participants, channels, channel_overwrites")
	d.para(
		"  Direct messages, group messages and subchats this account is a participant",
		"  of. A two-person direct message has no name; a group or a subchat carries the",
		"  name its members typed, which is stored in the clear.",
	)
	d.field("Conversations:", legalCount(len(rec.Conversations)))
	d.field("Channels they own:", legalCount(len(rec.OwnedChannels)))
	d.field("Permission overrides:", legalCount(rec.Overwrites))
	d.blank()
	shown := 0
	for _, c := range rec.Conversations {
		if shown == legalListCapDoc {
			break
		}
		shown++
		name := c.Name
		if name == "" {
			name = "(no name — two-person direct message)"
		}
		d.item(c.Type + " " + c.ChannelID.String() + " — " + name + ", joined " + legalTime(c.AddedAt) +
			", added by " + legalIDOpt(c.AddedBy) + ", hidden from their sidebar: " + legalYesNo(c.Hidden))
	}
	if len(rec.Conversations) == 0 {
		d.empty("This account is not in any direct message, group or subchat.")
	} else {
		d.more(shown, len(rec.Conversations))
	}
	if len(rec.OwnedChannels) > 0 {
		d.note("Channels this account owns (a group it created, or a subchat it opened):")
		for _, c := range rec.OwnedChannels {
			d.item(c.Type + " " + c.ID.String() + " — " + legalText(c.Name) + ", created " + legalTime(c.CreatedAt))
		}
		d.blank()
	}
	d.note("The membership list of a conversation is legible; what is said in it is not.")
	d.blank()
}

func legalMessages(d *legalDoc, rec *store.AccountRecord) {
	d.head("MESSAGE METADATA", "messages")
	d.para(
		"  Message content is not held in readable form and is not part of this section.",
		"  What follows is the envelope the server needs in order to deliver and order",
		"  messages: who wrote one, in which channel, when, and whether it was edited or",
		"  carried a file.",
	)
	d.field("Messages sent:", legalCount(rec.Messages.Count))
	d.field("First message:", legalTime(rec.Messages.First))
	d.field("Most recent message:", legalTime(rec.Messages.Last))
	d.field("Since edited:", legalCount(rec.Messages.Edited))
	d.field("With a file attached:", strconv.FormatInt(rec.Messages.WithAttachment, 10))
	d.field("Mentions of them:", legalCount(rec.Messages.Mentioned))
	d.blank()
	d.note("The mention count is of messages by anybody, this account included, that name")
	d.note("this account. A mention travels outside the ciphertext because the server has")
	d.note("to know who to notify without being able to read what it is notifying them")
	d.note("about; it is one of the few things about a message that is legible here.")
	d.blank()
	d.note("A deleted message is deleted: the row goes, and no copy, tombstone or archive")
	d.note("of it is kept. The counts above are of messages that exist now.")
	d.blank()
	if len(rec.PerChannel) > 0 {
		d.note("By channel, most active first:")
		for _, c := range rec.PerChannel {
			where := c.Type + " " + c.ChannelID.String()
			if c.Name != "" {
				where += " (" + c.Name + ")"
			}
			if c.ServerID != nil {
				where += ", in community " + c.ServerID.String()
			}
			d.item(where + " — " + legalPlural(c.Count, "message", "messages") + ", " + legalTime(c.First) + " to " + legalTime(c.Last))
		}
		d.blank()
	}
}

func legalFiles(d *legalDoc, rec *store.AccountRecord) {
	d.head("FILES SENT AND STORED", "attachments, blobs")
	d.para(
		"  A file sent in a conversation is encrypted in the sender's client before it",
		"  is uploaded. The server stores the ciphertext and knows its length and the",
		"  message it belongs to. It does not store the file's name, its type or its",
		"  dimensions: there is no column for any of them, because all three travel",
		"  inside the encrypted envelope with the message.",
		"",
		"  The SHA-256 recorded against an encrypted file is of the stored ciphertext,",
		"  not of the file. It cannot be compared against a hash set of known files, by",
		"  the operator or by anyone else.",
	)
	d.field("Attachments sent:", legalCount(rec.Attachments.Count))
	d.field("Stored bytes:", legalBytes(rec.Attachments.Bytes))
	d.field("First attachment:", legalTime(rec.Attachments.First))
	d.field("Most recent:", legalTime(rec.Attachments.Last))
	d.blank()
	if len(rec.BlobKinds) > 0 {
		d.note("Stored files uploaded by this account, by purpose:")
		for _, k := range rec.BlobKinds {
			state := "stored as uploaded"
			if k.Encrypted {
				state = "encrypted, not readable by the operator"
			}
			d.item(k.Kind + " — " + legalPlural(k.Count, "file", "files") + ", " + legalBytes(k.Bytes) + ", " + state)
		}
		d.blank()
	} else {
		d.empty("This account has uploaded no files.")
	}
	if len(rec.PlainBlobs) > 0 {
		d.note("Files that are not encrypted, and so could be produced on request:")
		for _, b := range rec.PlainBlobs {
			dims := ""
			if b.Width != nil && b.Height != nil {
				dims = ", " + strconv.Itoa(*b.Width) + "x" + strconv.Itoa(*b.Height)
			}
			d.item(b.Kind + " " + b.ID.String() + " — " + b.Mime + ", " + legalBytes(b.Size) + dims +
				", animated: " + legalYesNo(b.Animated) + ", uploaded " + legalTime(b.CreatedAt))
			d.cont("sha256 " + b.SHA256)
		}
		d.capped(len(rec.PlainBlobs))
		d.note("These are profile pictures, banners, community icons, custom emoji and")
		d.note("stickers. They are the only files on this instance that are stored as they")
		d.note("were uploaded, and their SHA-256 is of the file itself.")
		d.blank()
	}
}

func legalEngagement(d *legalDoc, rec *store.AccountRecord) {
	d.head("REACTIONS, PINS, READ POSITIONS AND POLL VOTES", "reactions, pins, read_states, poll_votes")
	d.field("Reactions left:", legalCount(rec.Reactions.Count))
	d.field("First reaction:", legalTime(rec.Reactions.First))
	d.field("Most recent:", legalTime(rec.Reactions.Last))
	d.field("Messages they pinned:", legalCount(rec.Pins))
	d.field("Read positions kept:", legalCount(rec.ReadStates.Channels))
	d.field("Last marked as read:", legalTime(rec.ReadStates.LastAck))
	d.field("Poll votes cast:", legalCount(rec.PollVotes))
	d.blank()
	if len(rec.Emoji) > 0 {
		d.note("A reaction is stored as the emoji it is, in the clear. Which emoji this")
		d.note("account used, and how often:")
		for _, e := range rec.Emoji {
			d.item(e.Emoji + " — " + legalCount(e.Count))
		}
		d.blank()
	}
	d.note("A poll vote records the account, the message and which option was chosen. The")
	d.note("wording of the question and of the options is inside the encrypted message and")
	d.note("is not readable, so a vote is an index and not an answer.")
	d.blank()
}

func legalLinks(d *legalDoc, rec *store.AccountRecord) {
	d.head("INVITE AND GUEST-CALL LINKS", "invites, guest_links")
	d.field("Invites they created:", legalCount(len(rec.Invites)))
	d.field("Guest call links:", legalCount(len(rec.GuestLinks)))
	d.blank()
	for _, in := range rec.Invites {
		target := "community " + legalIDOpt(in.ServerID)
		if in.ServerID == nil {
			target = "group conversation " + legalIDOpt(in.ChannelID)
		}
		d.item("code " + in.Code + " — " + target + ", used " + legalCount(in.Uses) + " of " +
			legalCount(in.MaxUses) + " (0 = unlimited), created " + legalTime(in.CreatedAt) + ", expires " + legalTimeOpt(in.ExpiresAt))
	}
	if len(rec.Invites) > 0 {
		d.blank()
		d.note("An invite counts how many times it was used. It does not record who used it:")
		d.note("there is no column for that, and no row is written when somebody joins by a")
		d.note("link. Where a join was recorded at all, it is in that community's own audit")
		d.note("log as a membership change, without the code.")
		d.blank()
	}
	for _, g := range rec.GuestLinks {
		d.item("code " + g.Code + " — call in channel " + g.ChannelID.String() + ", created " +
			legalTime(g.CreatedAt) + ", expires " + legalTime(g.ExpiresAt))
	}
	if len(rec.GuestLinks) > 0 {
		d.blank()
		d.note("A guest link lets somebody without an account into one call. People who")
		d.note("joined through one are separate rows in a separate table, keyed to the link")
		d.note("rather than to this account, and each is a different person; they are not")
		d.note("this account's records and are not listed here. The key that decrypts such a")
		d.note("call travels in the part of the link after the # and never reaches the")
		d.note("server, so the server has never held it.")
		d.blank()
	}
	if len(rec.Invites) == 0 && len(rec.GuestLinks) == 0 {
		d.empty("This account has created no invite or guest-call links that still exist.")
	}
}

func legalTransfers(d *legalDoc, rec *store.AccountRecord) {
	d.head("TRANSFERS NOT YET FINISHED", "uploads")
	if len(rec.Uploads) == 0 {
		d.empty("No upload rows exist for this account.")
		return
	}
	for _, up := range rec.Uploads {
		d.item("upload " + up.ID.String() + " — declared " + legalBytes(up.Size) + ", received " +
			legalBytes(up.Received) + ", became file " + legalIDOpt(up.BlobID) + ", started " + legalTime(up.CreatedAt) +
			", last written " + legalTime(up.UpdatedAt))
	}
	d.blank()
	d.note("A large file arrives in pieces; this row tracks how much has landed. It says")
	d.note("nothing about the file beyond its length, and the bytes it collected are the")
	d.note("same ciphertext as any other attachment.")
	d.blank()
}

func legalModeration(d *legalDoc, rec *store.AccountRecord) {
	d.head("MODERATION RECORD", "bans, audit_log")
	d.field("Bans against them:", legalCount(len(rec.BansAgainst)))
	d.field("Bans they issued:", legalCount(rec.BansIssued))
	d.field("Audit entries by them:", legalCount(rec.AuditAsActor))
	d.field("Audit entries on them:", legalCount(len(rec.AuditOnThem)))
	d.blank()
	for _, b := range rec.BansAgainst {
		d.item("banned from " + b.ServerName + " (id " + b.ServerID.String() + ") by account " +
			b.BannedBy.String() + " on " + legalTime(b.CreatedAt) + ", reason: " + legalText(b.Reason))
	}
	if len(rec.BansAgainst) > 0 {
		d.blank()
	}
	for _, a := range rec.AuditOnThem {
		d.item(a.Action + " in community " + a.ServerID.String() + " by account " + a.ActorID.String() +
			" on " + legalTime(a.CreatedAt) + ", reason: " + legalText(a.Reason))
	}
	if len(rec.AuditOnThem) > 0 {
		d.capped(len(rec.AuditOnThem))
	}
	d.note("The audit log is per community and is written by the people who moderate that")
	d.note("community, for their own use. It is not an instance-wide record of the")
	d.note("account, and there is no instance-wide moderation log on this deployment.")
	d.note("There is no warning or strike system, so no warnings exist to report.")
	d.blank()
}

func legalExpressions(d *legalDoc, rec *store.AccountRecord) {
	d.head("CUSTOM EMOJI, STICKERS AND PACKS", "emojis, sticker_packs, stickers, sticker_installs")
	d.field("Custom emoji uploaded:", legalCount(len(rec.Emojis)))
	d.field("Packs they own:", legalCount(len(rec.Packs)))
	d.field("Stickers they made:", legalCount(rec.Stickers))
	d.field("Packs they installed:", legalCount(len(rec.Installs)))
	d.blank()
	for _, e := range rec.Emojis {
		d.item(":" + e.Name + ": (id " + e.ID.String() + ") in community " + e.ServerID.String() + ", added " + legalTime(e.CreatedAt))
	}
	if len(rec.Emojis) > 0 {
		d.blank()
	}
	for _, p := range rec.Packs {
		d.item(p.Kind + " pack \"" + p.Name + "\" (id " + p.ID.String() + "), public: " + legalYesNo(p.Public) + ", created " + legalTime(p.CreatedAt))
	}
	if len(rec.Packs) > 0 {
		d.blank()
	}
	for _, in := range rec.Installs {
		d.item("installed pack \"" + in.Name + "\" (id " + in.PackID.String() + ") on " + legalTime(in.InstalledAt))
	}
	if len(rec.Installs) > 0 {
		d.blank()
	}
	d.note("The images behind these are not encrypted and could be produced on request;")
	d.note("they are listed by file id in the files section above.")
	d.blank()
}

func legalKeys(d *legalDoc, rec *store.AccountRecord) {
	d.head("ENCRYPTION KEY RECORDS", "key_epochs, key_grants")
	d.field("Key generations begun:", legalCount(rec.KeyEpochs))
	d.field("Keys sealed to them:", legalCount(rec.KeyGrants))
	d.blank()
	d.note("Each conversation has a key that is generated on a member's device and then")
	d.note("sealed separately to each member's public key. The server stores and hands out")
	d.note("those sealed copies, which is what a key grant row is. It cannot open one: a")
	d.note("grant can only be opened by the private key of the member it was sealed to,")
	d.note("which is itself stored only in a form that member's password unwraps. The")
	d.note("count above is of sealed copies held, not of keys the operator can read.")
	d.blank()
}

func legalCrashes(d *legalDoc, rec *store.AccountRecord) {
	d.head("CRASH REPORTS", "client_errors")
	if len(rec.Crashes) == 0 {
		d.empty("No crash reports from this account are held.")
		return
	}
	for _, c := range rec.Crashes {
		d.item(c.Kind + " on " + legalTime(c.CreatedAt) + " at path " + legalText(c.Path) + ", build " + legalText(c.Version))
		d.cont(c.Message)
		d.cont(legalText(c.UserAgent))
	}
	d.capped(len(rec.Crashes))
	d.note("When the app breaks in somebody's browser it reports the error, where in the")
	d.note("code it happened and which build it was. No conversation, message or file is")
	d.note("ever part of such a report, and the log is cleared by the operator at will.")
	d.blank()
}

func legalUnavailable(d *legalDoc) {
	d.head("DATA NOT AVAILABLE", "stated limitation of the service")
	d.para(
		"  The categories below cannot be produced in response to this request or to any",
		"  further process, because the operator does not hold them and has no means of",
		"  obtaining them. This is a property of how the software works, not a policy",
		"  choice, and it cannot be waived by the operator.",
	)
	d.para(
		"  MESSAGE CONTENT.",
		"  Every message is encrypted on the sender's device before it is sent. The key",
		"  is a conversation key generated on a member's device and sealed to each",
		"  member's public key; the server stores only the sealed ciphertext, in the",
		"  messages table. The operator holds no conversation key, no member's private",
		"  key, and no escrow, master or recovery key of any kind. A member's private key",
		"  exists on this server only in a form unwrapped by that member's password, and",
		"  the password never reaches the server — the browser sends a verifier derived",
		"  from it. There is no setting, no administrative action and no software change",
		"  available to the operator that would decrypt message content already sent.",
	)
	d.para(
		"  ATTACHMENT CONTENT.",
		"  Files are encrypted on the sender's device with a key carried inside the",
		"  encrypted message, and uploaded as ciphertext. The operator can produce the",
		"  stored ciphertext and its length; it cannot produce the file, its name, its",
		"  type, its dimensions or a hash of its plaintext, and none of those is stored.",
	)
	d.para(
		"  CALL AUDIO AND VIDEO.",
		"  Calls are not recorded. Media is not written to disk at any point. Where a",
		"  call passes through a selective forwarding unit rather than directly between",
		"  participants, the frames are encrypted end to end before they reach it, with a",
		"  key derived from the conversation key the server cannot read. There is no",
		"  recording facility in this software and no interception capability to enable.",
	)
	d.para(
		"  REAL-TIME INTERCEPTION.",
		"  There is no mechanism in this software by which the operator could be made to",
		"  deliver future message or call content in readable form. Content is encrypted",
		"  before it arrives; an order to hand over what arrives would deliver the same",
		"  ciphertext this document already describes.",
	)
	d.para(
		"  DELETED CONTENT.",
		"  A deleted message, conversation, file or account is removed from the database.",
		"  No tombstone, archive or recycle bin is kept for any of them. Deleting an",
		"  account overwrites its profile columns in place and deletes its sessions,",
		"  relationships, settings, key grants and second-factor rows; what that account",
		"  wrote stays, still encrypted, attributed to a deleted user.",
	)
}

func legalNotCollected(d *legalDoc) {
	d.head("DATA NOT COLLECTED", "absent columns, verified against the schema")
	d.para(
		"  A law-enforcement request commonly asks for the categories below. None of",
		"  them is withheld: no column exists for any of them anywhere in this",
		"  instance's schema, so there is nothing to search, preserve or produce. They",
		"  are listed rather than omitted so that the point does not have to be raised",
		"  a second time.",
	)
	d.item("Email address. Registration asks for a username, a display name and a")
	d.cont("password. No email address is collected, at registration or afterwards,")
	d.cont("and no column for one exists. There is no email verification, no password")
	d.cont("reset by email, and this instance sends no email at all.")
	d.item("Telephone number, and any SMS or call verification.")
	d.item("Legal name, date of birth, age, government identifier, or any identity")
	d.cont("document. Nothing about an account is verified by anybody.")
	d.item("Payment, billing or subscription records. This instance charges nothing,")
	d.cont("has no payment processor and holds no financial data.")
	d.item("A registration-IP or last-known-IP field. Addresses are written in exactly")
	d.cont("one place, the session row, which is above. The address on a session is")
	d.cont("written when the session is created and is never updated, so there is no")
	d.cont("record of the account's current or most recent address as such.")
	d.item("An IP or access history. The server's own request log records the method,")
	d.cont("the path, the status, the size and the duration of each request and does")
	d.cont("not record the address it came from. Any reverse proxy or network")
	d.cont("provider in front of this instance keeps its own logs under its own")
	d.cont("retention; those are not this instance's records and are not read here.")
	d.item("Presence, online-time, last-seen or typing history. Who is online is held")
	d.cont("in memory for as long as a connection lasts and is never written down.")
	d.cont("The session's last-activity time above is the nearest thing that exists.")
	d.item("Call records. Who was in a call, with whom, and for how long is held in")
	d.cont("memory for the life of the call and is not written to any table. The only")
	d.cont("figure kept is one instance-wide monthly byte total for capacity")
	d.cont("planning, which is not attributed to any account.")
	d.item("Device identifiers, advertising identifiers, or push-notification tokens.")
	d.cont("Notifications are delivered over the connection the app already holds")
	d.cont("open; no push service is used and no device token is stored.")
	d.item("Location data of any kind. No column exists, nothing derives a location")
	d.cont("from an address, and the server tells every browser that the geolocation")
	d.cont("permission is denied outright.")
	d.item("Contacts, address book or social-graph imports. Nothing is imported from a")
	d.cont("device; the relationship rows above were each created by hand.")
	d.item("Search queries, link clicks, analytics, telemetry or behavioural profiles.")
	d.cont("Search runs in the account's own client against messages it has already")
	d.cont("decrypted, and the query is never sent to the server.")
	d.item("Message content backups, drafts or undelivered copies. A message exists")
	d.cont("once, encrypted, in the messages table.")
	d.blank()
}

func (s *Server) legalProvenance(d *legalDoc, rec *store.AccountRecord, by *store.User) {
	d.head("PROVENANCE", "this report")
	d.field("Snapshot taken at:", legalTime(rec.TakenAt))
	d.field("Subject account:", "@"+rec.User.Username+" (id "+rec.User.ID.String()+")")
	d.field("Compiled by:", "@"+by.Username+" (id "+by.ID.String()+")")
	d.field("Software:", "chatd "+legalText(s.Version))
	d.field("Instance address:", legalText(s.Cfg.PublicURL))
	d.blank()
	d.note("Tables read for this report:")
	for _, l := range legalTablesRead {
		d.cont(l)
	}
	d.blank()
	d.note("Tables not read, and why:")
	d.item("guests — rows describe people who joined a call through a link without an")
	d.cont("account. They are keyed to the link, not to an account, and each is a")
	d.cont("different person; where this account made such links, the links are above.")
	d.item("key_flags, polls, realtime_usage, instance_settings, schema bookkeeping —")
	d.cont("keyed to a conversation, a message, a month or the instance, never to an")
	d.cont("account.")
	d.blank()
	d.para(
		"  Every figure in this document is a count or a column value read from the",
		"  tables named above, in one pass, at the instant given. Nothing was inferred,",
		"  recomputed or obtained from anywhere else, and no value was derived from data",
		"  the operator cannot read. Where a list was long it was capped, and the cap is",
		"  stated at the point it applies; the counts above each list are complete.",
		"",
		"  This report reads the live database. The operator may hold periodic backups",
		"  of that database for disaster recovery; this document does not read them, and",
		"  a backup would hold the same encrypted content, under the same limitations.",
		"",
		"  Compiling this report made no change to any record. The fact that it was",
		"  compiled, by whom and about which account, was written to this server's",
		"  operational log at the time given above.",
	)
	d.line("END OF REPORT")
}

// legalTablesRead is the provenance list: every table this report reads. It is
// written out rather than generated so that it can be checked against the
// queries by eye, which is what a reader of the report would have to do, and
// broken into lines so it stays readable in a filing.
var legalTablesRead = []string{
	"attachments, audit_log, bans, blobs, channel_overwrites, channel_unlocks,",
	"channels, client_errors, dm_participants, emojis, guest_links, invites,",
	"key_epochs, key_grants, member_roles, messages, mfa_backup_codes, pins,",
	"poll_votes, reactions, read_states, relationships, roles, server_members,",
	"servers, sessions, sticker_installs, sticker_packs, stickers, uploads,",
	"user_mfa, user_settings, users.",
}

// legalListCapDoc is how many conversations the document itself lists before it
// says how many more there were. The store reads more than this; a page of
// conversation ids is already past what a reader gets anything from.
const legalListCapDoc = 100
