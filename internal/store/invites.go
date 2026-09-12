package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"

	"evilion.xyz/chat/internal/ids"
)

const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

func newInviteCode() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = inviteAlphabet[int(b[i])%len(inviteAlphabet)]
	}
	return string(b)
}

const inviteCols = `code, server_id, channel_id, inviter_id, max_uses, uses, expires_at, created_at`

func scanInvite(r rowScanner) (*Invite, error) {
	var in Invite
	var srv, ch, exp sql.NullInt64
	if err := r.Scan(&in.Code, &srv, &ch, &in.InviterID, &in.MaxUses, &in.Uses, &exp, &in.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	in.ServerID, in.ChannelID, in.ExpiresAt = idPtr(srv), idPtr(ch), int64Ptr(exp)
	return &in, nil
}

// CreateInvite makes a new invite; maxAge is seconds (0 = never), maxUses 0 = unlimited.
func (s *Store) CreateInvite(ctx context.Context, serverID *ids.ID, channelID *ids.ID, inviter ids.ID, maxAge int64, maxUses int) (*Invite, error) {
	in := &Invite{Code: newInviteCode(), ServerID: serverID, ChannelID: channelID, InviterID: inviter, MaxUses: maxUses, CreatedAt: nowMs()}
	if maxAge > 0 {
		exp := in.CreatedAt + maxAge*1000
		in.ExpiresAt = &exp
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO invites (`+inviteCols+`) VALUES (?,?,?,?,?,?,?,?)`, in.Code, nullID(serverID), nullID(channelID), int64(inviter), in.MaxUses, 0, nullInt64(in.ExpiresAt), in.CreatedAt)
	if err != nil {
		return nil, err
	}
	return in, nil
}

// InviteByCode loads a live invite; expired or exhausted ones are ErrNotFound.
func (s *Store) InviteByCode(ctx context.Context, code string) (*Invite, error) {
	in, err := scanInvite(s.db.R.QueryRowContext(ctx, `SELECT `+inviteCols+` FROM invites WHERE code = ?`, code))
	if err != nil {
		return nil, err
	}
	if (in.ExpiresAt != nil && *in.ExpiresAt < nowMs()) || (in.MaxUses > 0 && in.Uses >= in.MaxUses) {
		return nil, ErrNotFound
	}
	return in, nil
}

// UseInvite records a use, refusing when the invite is exhausted.
func (s *Store) UseInvite(ctx context.Context, code string) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE invites SET uses = uses + 1 WHERE code = ? AND (max_uses = 0 OR uses < max_uses) AND (expires_at IS NULL OR expires_at > ?)`, code, nowMs())
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// InvitesForServer lists live invites.
func (s *Store) InvitesForServer(ctx context.Context, serverID ids.ID) ([]*Invite, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+inviteCols+` FROM invites WHERE server_id = ? AND (expires_at IS NULL OR expires_at > ?) AND (max_uses = 0 OR uses < max_uses) ORDER BY created_at DESC`, int64(serverID), nowMs())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Invite{}
	for rows.Next() {
		in, err := scanInvite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, in)
	}
	return out, rows.Err()
}

// DeleteInvite revokes an invite.
func (s *Store) DeleteInvite(ctx context.Context, code string) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM invites WHERE code = ?`, code)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Ban records a ban (and the caller removes the member).
func (s *Store) Ban(ctx context.Context, b *Ban) error {
	if b.CreatedAt == 0 {
		b.CreatedAt = nowMs()
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO bans (server_id, user_id, reason, banned_by, created_at) VALUES (?,?,?,?,?) ON CONFLICT(server_id, user_id) DO UPDATE SET reason = excluded.reason, banned_by = excluded.banned_by, created_at = excluded.created_at`,
		int64(b.ServerID), int64(b.UserID), b.Reason, int64(b.BannedBy), b.CreatedAt)
	return err
}

// Unban lifts a ban.
func (s *Store) Unban(ctx context.Context, serverID, uid ids.ID) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM bans WHERE server_id = ? AND user_id = ?`, int64(serverID), int64(uid))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// IsBanned reports whether uid is banned from a server.
func (s *Store) IsBanned(ctx context.Context, serverID, uid ids.ID) (bool, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM bans WHERE server_id = ? AND user_id = ?`, int64(serverID), int64(uid)).Scan(&n)
	return n > 0, err
}

// Bans lists a server's bans.
func (s *Store) Bans(ctx context.Context, serverID ids.ID) ([]*Ban, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT server_id, user_id, reason, banned_by, created_at FROM bans WHERE server_id = ? ORDER BY created_at DESC`, int64(serverID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Ban{}
	for rows.Next() {
		var b Ban
		if err := rows.Scan(&b.ServerID, &b.UserID, &b.Reason, &b.BannedBy, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &b)
	}
	return out, rows.Err()
}

// Audit appends an audit log entry.
func (s *Store) Audit(ctx context.Context, e *AuditEntry) error {
	if e.ID.IsZero() {
		e.ID = ids.New()
	}
	if e.CreatedAt == 0 {
		e.CreatedAt = nowMs()
	}
	if len(e.Changes) == 0 {
		e.Changes = json.RawMessage("{}")
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO audit_log (id, server_id, actor_id, action, target_type, target_id, changes, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
		int64(e.ID), int64(e.ServerID), int64(e.ActorID), e.Action, e.TargetType, nullID(e.TargetID), string(e.Changes), e.Reason, e.CreatedAt)
	return err
}

// AuditEntries pages a server's audit log, newest first.
func (s *Store) AuditEntries(ctx context.Context, serverID, before ids.ID, limit int) ([]*AuditEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if before.IsZero() {
		before = ids.ID(1<<62 - 1)
	}
	rows, err := s.db.R.QueryContext(ctx, `SELECT id, server_id, actor_id, action, target_type, target_id, changes, reason, created_at FROM audit_log WHERE server_id = ? AND id < ? ORDER BY id DESC LIMIT ?`, int64(serverID), int64(before), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var target sql.NullInt64
		var changes string
		if err := rows.Scan(&e.ID, &e.ServerID, &e.ActorID, &e.Action, &e.TargetType, &target, &changes, &e.Reason, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.TargetID = idPtr(target)
		e.Changes = json.RawMessage(changes)
		out = append(out, &e)
	}
	return out, rows.Err()
}

// InvitesForChannel lists the live invites of one group DM.
func (s *Store) InvitesForChannel(ctx context.Context, channelID ids.ID) ([]*Invite, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+inviteCols+` FROM invites WHERE channel_id = ? AND server_id IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (max_uses = 0 OR uses < max_uses) ORDER BY created_at DESC`, int64(channelID), nowMs())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Invite{}
	for rows.Next() {
		in, err := scanInvite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, in)
	}
	return out, rows.Err()
}
