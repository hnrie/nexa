package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// Servers in the moderation panel. The staff see what a server shows everyone
// (its icon, banner, name and description), who owns it and how many are in
// it, and can take back what breaks the rules. They never see anything said
// inside it: channel names and messages stay with its members.

// ModServer is a server as the staff's panel shows it.
type ModServer struct {
	Server
	MemberCount  int `json:"member_count"`
	ChannelCount int `json:"channel_count"`
}

// ModServerFilter picks which servers the panel lists, and in what order.
type ModServerFilter struct {
	// Query matches a server's name or description, or its owner's username.
	Query string
	// Sort is "newest" (the default), "oldest", "members" or "name".
	Sort   string
	Offset int
	Limit  int
}

const modServerCountCols = `(SELECT count(*) FROM server_members m WHERE m.server_id = s.id),
	(SELECT count(*) FROM channels c WHERE c.server_id = s.id AND c.type <> 'category')`

// modServerCols is what the panel reads of a server: everything a member
// sees, its tag included, and how many members and channels it has.
var modServerCols = prefixed("s", serverCols) + `, ` + prefixed("s", serverTagCols) + `, ` + prefixed("s", serverCommunityCols) + `, ` + modServerCountCols

func scanModServer(r rowScanner) (*ModServer, error) {
	var m ModServer
	var icon, banner, system, tagColor sql.NullInt64
	var tagText, tagBadge, tagRoles, tagInvite string
	var c communityScan
	dest := []any{&m.ID, &m.Name, &icon, &banner, &m.OwnerID, &m.Description, &system, &m.DefaultNotifications, &m.Flags, &m.CreatedAt,
		&tagText, &tagBadge, &tagColor, &tagRoles, &tagInvite}
	dest = append(dest, c.dest()...)
	dest = append(dest, &m.MemberCount, &m.ChannelCount)
	if err := r.Scan(dest...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	m.IconID, m.BannerID, m.SystemChannelID = idPtr(icon), idPtr(banner), idPtr(system)
	m.Tag = tagOf(tagText, tagBadge, tagColor, tagRoles, tagInvite)
	c.apply(&m.Server)
	return &m, nil
}

// ModServers lists servers for the panel.
func (s *Store) ModServers(ctx context.Context, f ModServerFilter) ([]*ModServer, error) {
	if f.Limit <= 0 || f.Limit > 120 {
		f.Limit = 60
	}
	q := `SELECT ` + modServerCols + ` FROM servers s`
	var args []any
	if term := strings.TrimSpace(strings.ToLower(f.Query)); term != "" {
		like := "%" + escapeLike(term) + "%"
		q += ` JOIN users u ON u.id = s.owner_id WHERE (` + s.db.Dialect.Lower("s.name") + ` LIKE ? ESCAPE '\' OR ` + s.db.Dialect.Lower("s.description") + ` LIKE ? ESCAPE '\' OR u.username LIKE ? ESCAPE '\'`
		args = append(args, like, like, like)
		if id, err := ids.Parse(term); err == nil {
			q += ` OR s.id = ?`
			args = append(args, int64(id))
		}
		q += `)`
	}
	switch f.Sort {
	case "oldest":
		q += ` ORDER BY s.id`
	case "members":
		q += ` ORDER BY (SELECT count(*) FROM server_members m WHERE m.server_id = s.id) DESC, s.id DESC`
	case "name":
		q += ` ORDER BY ` + s.db.Dialect.Lower("s.name") + `, s.id`
	default:
		q += ` ORDER BY s.id DESC`
	}
	q += ` LIMIT ? OFFSET ?`
	args = append(args, f.Limit, max(0, f.Offset))
	rows, err := s.db.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*ModServer{}
	for rows.Next() {
		m, err := scanModServer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ModServerByID loads one server for the panel.
func (s *Store) ModServerByID(ctx context.Context, id ids.ID) (*ModServer, error) {
	return scanModServer(s.db.R.QueryRowContext(ctx, `SELECT `+modServerCols+` FROM servers s WHERE s.id = ?`, int64(id)))
}

// CountServers is how many servers there are.
func (s *Store) CountServers(ctx context.Context) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM servers`).Scan(&n)
	return n, err
}

// ModMembership is a server an account owns or has a profile of its own in
// (a nickname or a picture): the parts of their profile people see there.
type ModMembership struct {
	ServerID    ids.ID  `json:"server_id"`
	Name        string  `json:"name"`
	IconID      *ids.ID `json:"icon_id"`
	Owner       bool    `json:"owner"`
	Nickname    string  `json:"nickname"`
	AvatarID    *ids.ID `json:"avatar_id"`
	MemberCount int     `json:"member_count"`
	JoinedAt    int64   `json:"joined_at"`
}

// ModMemberships lists the servers an account owns or has a server profile in,
// the ones it owns first.
func (s *Store) ModMemberships(ctx context.Context, uid ids.ID) ([]ModMembership, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT s.id, s.name, s.icon_id, s.owner_id, m.nickname, m.avatar_id, m.joined_at,
		(SELECT count(*) FROM server_members x WHERE x.server_id = s.id)
		FROM server_members m JOIN servers s ON s.id = m.server_id
		WHERE m.user_id = ? AND (s.owner_id = ? OR m.nickname <> '' OR m.avatar_id IS NOT NULL)
		ORDER BY CASE WHEN s.owner_id = ? THEN 0 ELSE 1 END, m.joined_at, s.id LIMIT 200`, int64(uid), int64(uid), int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ModMembership{}
	for rows.Next() {
		var m ModMembership
		var icon, avatar sql.NullInt64
		var owner int64
		if err := rows.Scan(&m.ServerID, &m.Name, &icon, &owner, &m.Nickname, &avatar, &m.JoinedAt, &m.MemberCount); err != nil {
			return nil, err
		}
		m.IconID, m.AvatarID, m.Owner = idPtr(icon), idPtr(avatar), ids.ID(owner) == uid
		out = append(out, m)
	}
	return out, rows.Err()
}

// ModServerReset is what a server_reset takes back. Name, when set, is what
// the server is called in its place.
type ModServerReset struct {
	Icon        bool
	Banner      bool
	Name        *string
	Description bool
	// Tag takes the server's tag away. Taking it off the people wearing it,
	// and letting its badge and invite go, is the caller's to do after.
	Tag bool
	// Discovery takes the server off Discovery until the staff put it back.
	Discovery bool
}

// ModResetServer takes back parts of what a server shows everyone and opens
// the case for it (its owner's), in one transaction.
func (s *Store) ModResetServer(ctx context.Context, c *ModCase, serverID ids.ID, f ModServerReset, log *ModLogEntry) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		// the same locks a server's own image changes take, so the two cannot cross
		for _, col := range []string{"icon_id", "banner_id"} {
			if err := tx.Serialise(ctx, "image:servers."+col, int64(serverID)); err != nil {
				return err
			}
		}
		var icon, banner sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT icon_id, banner_id FROM servers WHERE id = ?`, int64(serverID)).Scan(&icon, &banner); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		var sets []string
		var args []any
		var release []int64
		if f.Icon && icon.Valid {
			sets = append(sets, "icon_id = NULL")
			release = append(release, icon.Int64)
		}
		if f.Banner && banner.Valid {
			sets = append(sets, "banner_id = NULL")
			release = append(release, banner.Int64)
		}
		if f.Name != nil {
			sets = append(sets, "name = ?")
			args = append(args, *f.Name)
		}
		if f.Description {
			sets = append(sets, "description = ''")
		}
		if f.Tag {
			sets = append(sets, "tag_text = ''", "tag_badge = ''", "tag_color = NULL", "tag_roles = ''", "tag_invite = ''")
		}
		if f.Discovery {
			sets = append(sets, "discovery_hidden = 1")
		}
		if len(sets) == 0 {
			return errors.New("server reset: nothing to reset")
		}
		sets = append(sets, "updated_at = ?")
		args = append(args, nowMs(), int64(serverID))
		if _, err := tx.ExecContext(ctx, `UPDATE servers SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
			return err
		}
		for _, id := range release {
			if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - 1")+` WHERE id = ?`, id); err != nil {
				return err
			}
		}
		return openCaseTx(ctx, tx, c, log)
	})
}
