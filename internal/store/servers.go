package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
)

const serverCols = `id, name, icon_id, banner_id, owner_id, description, system_channel_id, default_notifications, flags, created_at`

func scanServer(r rowScanner) (*Server, error) {
	var s Server
	var icon, banner, sys sql.NullInt64
	if err := r.Scan(&s.ID, &s.Name, &icon, &banner, &s.OwnerID, &s.Description, &sys, &s.DefaultNotifications, &s.Flags, &s.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	s.IconID, s.BannerID, s.SystemChannelID = idPtr(icon), idPtr(banner), idPtr(sys)
	return &s, nil
}

// CreateServer creates a server with its @everyone role (id = server id),
// default categories and channels, and the owner as first member.
func (s *Store) CreateServer(ctx context.Context, owner ids.ID, name string) (*Server, error) {
	now := nowMs()
	srv := &Server{ID: ids.New(), Name: name, OwnerID: owner, CreatedAt: now}
	textCat := &Channel{ServerID: &srv.ID, Type: "category", Name: "Text Channels", Position: 0}
	voiceCat := &Channel{ServerID: &srv.ID, Type: "category", Name: "Voice Channels", Position: 1}
	general := &Channel{ServerID: &srv.ID, Type: "text", Name: "general", Position: 0}
	voice := &Channel{ServerID: &srv.ID, Type: "voice", Name: "General", Position: 0}
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO servers (`+serverCols+`, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, int64(srv.ID), srv.Name, nil, nil, int64(owner), "", nil, 0, 0, now, now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO roles (id, server_id, name, color, hoist, mentionable, position, permissions, created_at) VALUES (?,?,?,?,?,?,?,?,?)`, int64(srv.ID), int64(srv.ID), "@everyone", 0, 0, 0, 0, int64(perms.DefaultEveryone), now); err != nil {
			return err
		}
		for _, c := range []*Channel{textCat, voiceCat} {
			if err := s.insertChannel(ctx, tx, c); err != nil {
				return err
			}
		}
		general.ParentID = &textCat.ID
		voice.ParentID = &voiceCat.ID
		for _, c := range []*Channel{general, voice} {
			if err := s.insertChannel(ctx, tx, c); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE servers SET system_channel_id = ? WHERE id = ?`, int64(general.ID), int64(srv.ID)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO server_members (server_id, user_id, nickname, joined_at, flags) VALUES (?,?,?,?,0)`, int64(srv.ID), int64(owner), "", now)
		return err
	})
	if err != nil {
		return nil, err
	}
	srv.SystemChannelID = &general.ID
	return srv, nil
}

// ServerByID loads a server.
func (s *Store) ServerByID(ctx context.Context, id ids.ID) (*Server, error) {
	return scanServer(s.db.R.QueryRowContext(ctx, `SELECT `+serverCols+` FROM servers WHERE id = ?`, int64(id)))
}

// ServersForUser lists the servers a user belongs to, oldest membership first.
func (s *Store) ServersForUser(ctx context.Context, uid ids.ID) ([]*Server, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+prefixed("s", serverCols)+` FROM servers s JOIN server_members m ON m.server_id = s.id WHERE m.user_id = ? ORDER BY m.joined_at, s.id`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Server{}
	for rows.Next() {
		srv, err := scanServer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, srv)
	}
	return out, rows.Err()
}

func prefixed(alias, cols string) string {
	parts := strings.Split(cols, ", ")
	for i, p := range parts {
		parts[i] = alias + "." + p
	}
	return strings.Join(parts, ", ")
}

// UpdateServer applies p.
func (s *Store) UpdateServer(ctx context.Context, id ids.ID, p ServerPatch) error {
	var sets []string
	var args []any
	set := func(col string, v any) { sets = append(sets, col+" = ?"); args = append(args, v) }
	if p.Name != nil {
		set("name", *p.Name)
	}
	if p.Description != nil {
		set("description", *p.Description)
	}
	if p.IconID != nil {
		set("icon_id", nullID(*p.IconID))
	}
	if p.BannerID != nil {
		set("banner_id", nullID(*p.BannerID))
	}
	if p.SystemChannelID != nil {
		set("system_channel_id", nullID(*p.SystemChannelID))
	}
	if p.DefaultNotifications != nil {
		set("default_notifications", *p.DefaultNotifications)
	}
	if p.OwnerID != nil {
		set("owner_id", int64(*p.OwnerID))
	}
	if len(sets) == 0 {
		return nil
	}
	set("updated_at", nowMs())
	args = append(args, int64(id))
	res, err := s.db.W.ExecContext(ctx, `UPDATE servers SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteServer removes a server and its key material.
func (s *Store) DeleteServer(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = max(0, ref_count - 1) WHERE id IN (SELECT blob_id FROM attachments WHERE channel_id IN (SELECT id FROM channels WHERE server_id = ?))`, int64(id)); err != nil {
			return err
		}
		// the icon, banner, emoji and server sticker packs go with the server
		// (by cascade), so their images must be let go of here
		if err := releaseBlobRefs(ctx, tx, `SELECT icon_id FROM servers WHERE id = ?1
			UNION ALL SELECT banner_id FROM servers WHERE id = ?1
			UNION ALL SELECT blob_id FROM emojis WHERE server_id = ?1
			UNION ALL SELECT st.blob_id FROM stickers st JOIN sticker_packs p ON p.id = st.pack_id WHERE p.server_id = ?1`, int64(id)); err != nil {
			return err
		}
		for _, q := range []string{
			`DELETE FROM key_grants WHERE conv_id = ? OR conv_id IN (SELECT id FROM channels WHERE server_id = ?)`,
			`DELETE FROM key_epochs WHERE conv_id = ? OR conv_id IN (SELECT id FROM channels WHERE server_id = ?)`,
			`DELETE FROM key_flags WHERE conv_id = ? OR conv_id IN (SELECT id FROM channels WHERE server_id = ?)`,
		} {
			if _, err := tx.ExecContext(ctx, q, int64(id), int64(id)); err != nil {
				return err
			}
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM servers WHERE id = ?`, int64(id))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// releaseBlobRefs takes one reference off every blob id the query returns,
// counting repeats, so an image used twice loses both of its references.
func releaseBlobRefs(ctx context.Context, tx *sql.Tx, query string, args ...any) error {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	counts := map[int64]int{}
	for rows.Next() {
		var id sql.NullInt64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		if id.Valid {
			counts[id.Int64]++
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for id, n := range counts {
		if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = max(0, ref_count - ?) WHERE id = ?`, n, id); err != nil {
			return err
		}
	}
	return nil
}

// --- members -------------------------------------------------------------

const memberCols = `server_id, user_id, nickname, avatar_id, joined_at, timeout_until, flags`

func scanMember(r rowScanner) (*Member, error) {
	var m Member
	var avatar, timeout sql.NullInt64
	if err := r.Scan(&m.ServerID, &m.UserID, &m.Nickname, &avatar, &m.JoinedAt, &timeout, &m.Flags); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	m.AvatarID = idPtr(avatar)
	m.TimeoutUntil = int64Ptr(timeout)
	m.RoleIDs = []ids.ID{}
	return &m, nil
}

// ErrBanned is returned when a banned user tries to join a server.
var ErrBanned = errors.New("banned")

// AddMember joins a user to a server; ErrAlreadyExists when already a member,
// ErrBanned when banned.
func (s *Store) AddMember(ctx context.Context, serverID, uid ids.ID) (*Member, error) {
	var m *Member
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		m, err = addMember(ctx, tx, serverID, uid)
		return err
	})
	return m, err
}

// JoinByInvite is AddMember spending one use of an invite in the same
// transaction, so people joining at once cannot overrun its limit. It is
// ErrNotFound when the invite is used up or expired; a join that fails
// spends nothing.
func (s *Store) JoinByInvite(ctx context.Context, serverID, uid ids.ID, code string) (*Member, error) {
	var m *Member
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if m, err = addMember(ctx, tx, serverID, uid); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `UPDATE invites SET uses = uses + 1 WHERE code = ? AND (max_uses = 0 OR uses < max_uses) AND (expires_at IS NULL OR expires_at > ?)`, code, nowMs())
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return m, nil
}

// addMember inserts the membership unless the user is banned, checking the ban
// in the same statement so a ban written a moment earlier always holds.
func addMember(ctx context.Context, tx *sql.Tx, serverID, uid ids.ID) (*Member, error) {
	now := nowMs()
	res, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO server_members (server_id, user_id, nickname, joined_at, flags) SELECT ?1, ?2, '', ?3, 0 WHERE NOT EXISTS (SELECT 1 FROM bans WHERE server_id = ?1 AND user_id = ?2)`, int64(serverID), int64(uid), now)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		var banned int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM bans WHERE server_id = ? AND user_id = ?`, int64(serverID), int64(uid)).Scan(&banned); err != nil {
			return nil, err
		}
		if banned > 0 {
			return nil, ErrBanned
		}
		return nil, ErrAlreadyExists
	}
	return &Member{ServerID: serverID, UserID: uid, JoinedAt: now, RoleIDs: []ids.ID{}}, nil
}

// RemoveMember removes a membership (roles cascade).
func (s *Store) RemoveMember(ctx context.Context, serverID, uid ids.ID) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM server_members WHERE server_id = ? AND user_id = ?`, int64(serverID), int64(uid))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// IsMember reports membership.
func (s *Store) IsMember(ctx context.Context, serverID, uid ids.ID) (bool, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM server_members WHERE server_id = ? AND user_id = ?`, int64(serverID), int64(uid)).Scan(&n)
	return n > 0, err
}

// Member loads one membership with its role ids.
func (s *Store) Member(ctx context.Context, serverID, uid ids.ID) (*Member, error) {
	m, err := scanMember(s.db.R.QueryRowContext(ctx, `SELECT `+memberCols+` FROM server_members WHERE server_id = ? AND user_id = ?`, int64(serverID), int64(uid)))
	if err != nil {
		return nil, err
	}
	rows, err := s.db.R.QueryContext(ctx, `SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?`, int64(serverID), int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r int64
		if err := rows.Scan(&r); err != nil {
			return nil, err
		}
		m.RoleIDs = append(m.RoleIDs, ids.ID(r))
	}
	return m, rows.Err()
}

// Members lists memberships (with roles) after a user id, optionally filtered.
func (s *Store) Members(ctx context.Context, serverID ids.ID, after ids.ID, limit int, q string) ([]*Member, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	query := `SELECT ` + prefixed("m", memberCols) + ` FROM server_members m JOIN users u ON u.id = m.user_id WHERE m.server_id = ? AND m.user_id > ?`
	args := []any{int64(serverID), int64(after)}
	if q = strings.ToLower(strings.TrimSpace(q)); q != "" {
		like := escapeLike(q) + "%"
		query += ` AND (u.username LIKE ? ESCAPE '\' OR lower(u.display_name) LIKE ? ESCAPE '\' OR lower(m.nickname) LIKE ? ESCAPE '\')`
		args = append(args, like, like, like)
	}
	query += ` ORDER BY m.user_id LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.R.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	out := []*Member{}
	byUser := map[ids.ID]*Member{}
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, m)
		byUser[m.UserID] = m
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	list := make([]ids.ID, 0, len(out))
	for _, m := range out {
		list = append(list, m.UserID)
	}
	rrows, err := s.db.R.QueryContext(ctx, `SELECT user_id, role_id FROM member_roles WHERE server_id = ? AND user_id IN (`+placeholders(len(list))+`)`, append([]any{int64(serverID)}, idArgs(list)...)...)
	if err != nil {
		return nil, err
	}
	defer rrows.Close()
	for rrows.Next() {
		var u, r int64
		if err := rrows.Scan(&u, &r); err != nil {
			return nil, err
		}
		if m := byUser[ids.ID(u)]; m != nil {
			m.RoleIDs = append(m.RoleIDs, ids.ID(r))
		}
	}
	return out, rrows.Err()
}

// MemberIDs lists every member's user id.
func (s *Store) MemberIDs(ctx context.Context, serverID ids.ID) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT user_id FROM server_members WHERE server_id = ?`, int64(serverID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ids.ID{}
	for rows.Next() {
		var u int64
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out = append(out, ids.ID(u))
	}
	return out, rows.Err()
}

// MemberCount counts members.
func (s *Store) MemberCount(ctx context.Context, serverID ids.ID) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM server_members WHERE server_id = ?`, int64(serverID)).Scan(&n)
	return n, err
}

// UpdateMember applies p.
func (s *Store) UpdateMember(ctx context.Context, serverID, uid ids.ID, p MemberPatch) error {
	var sets []string
	var args []any
	set := func(col string, v any) { sets = append(sets, col+" = ?"); args = append(args, v) }
	if p.Nickname != nil {
		set("nickname", *p.Nickname)
	}
	if p.AvatarID != nil {
		set("avatar_id", nullID(*p.AvatarID))
	}
	if p.TimeoutUntil != nil {
		set("timeout_until", nullInt64(*p.TimeoutUntil))
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, int64(serverID), int64(uid))
	res, err := s.db.W.ExecContext(ctx, `UPDATE server_members SET `+strings.Join(sets, ", ")+` WHERE server_id = ? AND user_id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AddMemberRole assigns a role; idempotent.
func (s *Store) AddMemberRole(ctx context.Context, serverID, uid, roleID ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?,?,?)`, int64(serverID), int64(uid), int64(roleID))
	return err
}

// RemoveMemberRole unassigns a role; idempotent.
func (s *Store) RemoveMemberRole(ctx context.Context, serverID, uid, roleID ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?`, int64(serverID), int64(uid), int64(roleID))
	return err
}

// SetMemberRoles replaces a member's roles.
func (s *Store) SetMemberRoles(ctx context.Context, serverID, uid ids.ID, roleIDs []ids.ID) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM member_roles WHERE server_id = ? AND user_id = ?`, int64(serverID), int64(uid)); err != nil {
			return err
		}
		for _, r := range roleIDs {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?,?,?)`, int64(serverID), int64(uid), int64(r)); err != nil {
				return err
			}
		}
		return nil
	})
}

// --- roles ---------------------------------------------------------------

const roleCols = `id, server_id, name, color, hoist, mentionable, position, permissions, icon_id, created_at`

func scanRole(r rowScanner) (*Role, error) {
	var ro Role
	var hoist, mention, permsRaw int64
	var icon sql.NullInt64
	if err := r.Scan(&ro.ID, &ro.ServerID, &ro.Name, &ro.Color, &hoist, &mention, &ro.Position, &permsRaw, &icon, &ro.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	ro.Hoist, ro.Mentionable = hoist == 1, mention == 1
	ro.Permissions = perms.Perm(uint64(permsRaw))
	ro.IconID = idPtr(icon)
	return &ro, nil
}

// CreateRole adds a role at the top of the hierarchy (below nothing but the owner).
func (s *Store) CreateRole(ctx context.Context, serverID ids.ID, name string, permsBits perms.Perm, color int) (*Role, error) {
	ro := &Role{ID: ids.New(), ServerID: serverID, Name: name, Color: color, Permissions: permsBits, CreatedAt: nowMs()}
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		// new roles start at the bottom of the hierarchy (just above @everyone),
		// so the creator always outranks them
		if _, err := tx.ExecContext(ctx, `UPDATE roles SET position = position + 1 WHERE server_id = ? AND position >= 1`, int64(serverID)); err != nil {
			return err
		}
		ro.Position = 1
		_, err := tx.ExecContext(ctx, `INSERT INTO roles (`+roleCols+`) VALUES (?,?,?,?,?,?,?,?,?,?)`, int64(ro.ID), int64(serverID), ro.Name, ro.Color, 0, 0, ro.Position, int64(ro.Permissions), nil, ro.CreatedAt)
		return err
	})
	if err != nil {
		return nil, err
	}
	return ro, nil
}

// RoleByID loads a role.
func (s *Store) RoleByID(ctx context.Context, id ids.ID) (*Role, error) {
	return scanRole(s.db.R.QueryRowContext(ctx, `SELECT `+roleCols+` FROM roles WHERE id = ?`, int64(id)))
}

// Roles lists a server's roles, lowest position first (@everyone at 0).
func (s *Store) Roles(ctx context.Context, serverID ids.ID) ([]*Role, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+roleCols+` FROM roles WHERE server_id = ? ORDER BY position, id`, int64(serverID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Role{}
	for rows.Next() {
		ro, err := scanRole(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ro)
	}
	return out, rows.Err()
}

// UpdateRole applies p.
func (s *Store) UpdateRole(ctx context.Context, id ids.ID, p RolePatch) error {
	var sets []string
	var args []any
	set := func(col string, v any) { sets = append(sets, col+" = ?"); args = append(args, v) }
	if p.Name != nil {
		set("name", *p.Name)
	}
	if p.Color != nil {
		set("color", *p.Color)
	}
	if p.Hoist != nil {
		set("hoist", boolInt(*p.Hoist))
	}
	if p.Mentionable != nil {
		set("mentionable", boolInt(*p.Mentionable))
	}
	if p.Permissions != nil {
		set("permissions", int64(*p.Permissions))
	}
	if p.IconID != nil {
		set("icon_id", nullID(*p.IconID))
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, int64(id))
	res, err := s.db.W.ExecContext(ctx, `UPDATE roles SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteRole removes a role, its assignments and its overwrites. @everyone cannot be deleted.
func (s *Store) DeleteRole(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		var serverID int64
		if err := tx.QueryRowContext(ctx, `SELECT server_id FROM roles WHERE id = ?`, int64(id)).Scan(&serverID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if serverID == int64(id) {
			return ErrConflict
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM channel_overwrites WHERE target_type = 'role' AND target_id = ?`, int64(id)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM roles WHERE id = ?`, int64(id))
		return err
	})
}

// SetRolePositions rewrites positions (@everyone stays at 0).
func (s *Store) SetRolePositions(ctx context.Context, serverID ids.ID, positions map[ids.ID]int) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		for id, pos := range positions {
			if id == serverID {
				continue
			}
			if pos < 1 {
				pos = 1
			}
			if _, err := tx.ExecContext(ctx, `UPDATE roles SET position = ? WHERE id = ? AND server_id = ?`, pos, int64(id), int64(serverID)); err != nil {
				return err
			}
		}
		return nil
	})
}

// --- server channels ------------------------------------------------------

// CreateServerChannel adds a channel at the end of its parent.
func (s *Store) CreateServerChannel(ctx context.Context, serverID ids.ID, typ, name string, parent *ids.ID) (*Channel, error) {
	c := &Channel{ServerID: &serverID, Type: typ, Name: name, ParentID: parent}
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		var max sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT max(position) FROM channels WHERE server_id = ? AND type = ? AND coalesce(parent_id, 0) = coalesce(?, 0)`, int64(serverID), map[bool]string{true: "category", false: "x"}[typ == "category"], nullID(parent)).Scan(&max); err != nil {
			return err
		}
		if typ != "category" {
			if err := tx.QueryRowContext(ctx, `SELECT max(position) FROM channels WHERE server_id = ? AND type != 'category' AND coalesce(parent_id, 0) = coalesce(?, 0)`, int64(serverID), nullID(parent)).Scan(&max); err != nil {
				return err
			}
		}
		if max.Valid {
			c.Position = int(max.Int64) + 1
		}
		return s.insertChannel(ctx, tx, c)
	})
	if err != nil {
		return nil, err
	}
	return s.ChannelByID(ctx, c.ID)
}

// ServerChannels lists a server's channels ordered by parent then position.
func (s *Store) ServerChannels(ctx context.Context, serverID ids.ID) ([]*Channel, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+channelCols+` FROM channels WHERE server_id = ? ORDER BY coalesce(parent_id, 0), position, id`, int64(serverID))
	if err != nil {
		return nil, err
	}
	out := []*Channel{}
	for rows.Next() {
		c, err := scanChannel(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		c.Recipients = []ids.ID{}
		c.KeyConvID = serverID
		out = append(out, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// channels with their own epochs encrypt under their own conversation
	own, err := s.db.R.QueryContext(ctx, `SELECT DISTINCT conv_id FROM key_epochs WHERE conv_id IN (SELECT id FROM channels WHERE server_id = ?)`, int64(serverID))
	if err != nil {
		return nil, err
	}
	defer own.Close()
	ownSet := map[ids.ID]bool{}
	for own.Next() {
		var id int64
		if err := own.Scan(&id); err != nil {
			return nil, err
		}
		ownSet[ids.ID(id)] = true
	}
	for _, c := range out {
		if ownSet[c.ID] {
			c.KeyConvID = c.ID
		}
	}
	if err := own.Err(); err != nil {
		return nil, err
	}
	ows, err := s.OverwritesForServer(ctx, serverID)
	if err != nil {
		return nil, err
	}
	for _, c := range out {
		c.Overwrites = ows[c.ID]
		if c.Overwrites == nil {
			c.Overwrites = []Overwrite{}
		}
	}
	return out, nil
}

// SetChannelPositions applies a bulk reorder.
func (s *Store) SetChannelPositions(ctx context.Context, serverID ids.ID, list []ChannelPosition) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		for _, p := range list {
			if p.ParentSet {
				if _, err := tx.ExecContext(ctx, `UPDATE channels SET position = ?, parent_id = ?, updated_at = ? WHERE id = ? AND server_id = ?`, p.Position, nullID(p.ParentID), nowMs(), int64(p.ID), int64(serverID)); err != nil {
					return err
				}
			} else if _, err := tx.ExecContext(ctx, `UPDATE channels SET position = ?, updated_at = ? WHERE id = ? AND server_id = ?`, p.Position, nowMs(), int64(p.ID), int64(serverID)); err != nil {
				return err
			}
		}
		return nil
	})
}

// SetOverwrite upserts a channel overwrite.
func (s *Store) SetOverwrite(ctx context.Context, ow Overwrite) error {
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO channel_overwrites (channel_id, target_id, target_type, allow, deny) VALUES (?,?,?,?,?) ON CONFLICT(channel_id, target_id) DO UPDATE SET target_type = excluded.target_type, allow = excluded.allow, deny = excluded.deny`,
		int64(ow.ChannelID), int64(ow.TargetID), ow.TargetType, int64(ow.Allow), int64(ow.Deny))
	return err
}

// DeleteOverwrite removes an overwrite.
func (s *Store) DeleteOverwrite(ctx context.Context, channelID, targetID ids.ID) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM channel_overwrites WHERE channel_id = ? AND target_id = ?`, int64(channelID), int64(targetID))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Overwrites lists a channel's overwrites.
func (s *Store) Overwrites(ctx context.Context, channelID ids.ID) ([]Overwrite, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT channel_id, target_id, target_type, allow, deny FROM channel_overwrites WHERE channel_id = ?`, int64(channelID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Overwrite{}
	for rows.Next() {
		var ow Overwrite
		var a, d int64
		if err := rows.Scan(&ow.ChannelID, &ow.TargetID, &ow.TargetType, &a, &d); err != nil {
			return nil, err
		}
		ow.Allow, ow.Deny = perms.Perm(uint64(a)), perms.Perm(uint64(d))
		out = append(out, ow)
	}
	return out, rows.Err()
}

// OverwritesForServer returns every overwrite of a server keyed by channel.
func (s *Store) OverwritesForServer(ctx context.Context, serverID ids.ID) (map[ids.ID][]Overwrite, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT o.channel_id, o.target_id, o.target_type, o.allow, o.deny FROM channel_overwrites o JOIN channels c ON c.id = o.channel_id WHERE c.server_id = ?`, int64(serverID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[ids.ID][]Overwrite{}
	for rows.Next() {
		var ow Overwrite
		var a, d int64
		if err := rows.Scan(&ow.ChannelID, &ow.TargetID, &ow.TargetType, &a, &d); err != nil {
			return nil, err
		}
		ow.Allow, ow.Deny = perms.Perm(uint64(a)), perms.Perm(uint64(d))
		out[ow.ChannelID] = append(out[ow.ChannelID], ow)
	}
	return out, rows.Err()
}
