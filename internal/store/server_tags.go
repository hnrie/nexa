package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// ServerTag is the tag a server's members can wear next to their name
// everywhere (servers.tag_*): a few letters, a badge and a colour.
type ServerTag struct {
	Text string `json:"text"`
	// "icon:<name>" for one of the badges every server has, or "image:<id>"
	// for a picture the server's admins put up (blob kind "tag").
	Badge string `json:"badge"`
	Color *int   `json:"color"`
	// Limited keeps the tag to members with one of Roles, and to whoever
	// manages the server; otherwise anyone in the server may wear it.
	Limited bool     `json:"limited"`
	Roles   []ids.ID `json:"roles"`
	// Join says whether someone who sees the tag can join from it, through
	// the invite kept for it (Invite, which only the server side knows).
	Join   bool   `json:"join"`
	Invite string `json:"-"`
}

const serverTagCols = `tag_text, tag_badge, tag_color, tag_roles, tag_invite`

// scanServerTagged reads serverCols followed by serverTagCols.
func scanServerTagged(r rowScanner) (*Server, error) {
	var s Server
	var icon, banner, sys, tagColor sql.NullInt64
	var tagText, tagBadge, tagRoles, tagInvite string
	if err := r.Scan(&s.ID, &s.Name, &icon, &banner, &s.OwnerID, &s.Description, &sys, &s.DefaultNotifications, &s.Flags, &s.CreatedAt,
		&tagText, &tagBadge, &tagColor, &tagRoles, &tagInvite); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	s.IconID, s.BannerID, s.SystemChannelID = idPtr(icon), idPtr(banner), idPtr(sys)
	s.Tag = tagOf(tagText, tagBadge, tagColor, tagRoles, tagInvite)
	return &s, nil
}

func tagOf(text, badge string, color sql.NullInt64, roles, invite string) *ServerTag {
	if text == "" {
		return nil
	}
	t := &ServerTag{Text: text, Badge: badge, Color: intPtr(color), Roles: []ids.ID{}, Invite: invite, Join: invite != ""}
	if roles != "" {
		t.Limited = true
		var list []ids.ID
		if json.Unmarshal([]byte(roles), &list) == nil {
			t.Roles = list
		}
	}
	return t
}

// SetServerTag replaces a server's tag; nil takes it away.
func (s *Store) SetServerTag(ctx context.Context, serverID ids.ID, t *ServerTag) error {
	if t == nil {
		_, err := s.db.W.ExecContext(ctx, `UPDATE servers SET tag_text = '', tag_badge = '', tag_color = NULL, tag_roles = '', tag_invite = '', updated_at = ? WHERE id = ?`, nowMs(), int64(serverID))
		return err
	}
	roles := ""
	if t.Limited {
		list := t.Roles
		if list == nil {
			list = []ids.ID{}
		}
		b, err := json.Marshal(list)
		if err != nil {
			return err
		}
		roles = string(b)
	}
	_, err := s.db.W.ExecContext(ctx, `UPDATE servers SET tag_text = ?, tag_badge = ?, tag_color = ?, tag_roles = ?, tag_invite = ?, updated_at = ? WHERE id = ?`,
		t.Text, t.Badge, nullInt(t.Color), roles, t.Invite, nowMs(), int64(serverID))
	return err
}

// TagWearers is everyone wearing a server's tag.
func (s *Store) TagWearers(ctx context.Context, serverID ids.ID) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT id FROM users WHERE tag_server_id = ?`, int64(serverID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ids.ID
	for rows.Next() {
		var id ids.ID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// TakeOffTags takes a server's tag off the people named, or off everyone
// wearing it when only is nil, and says whose it took off.
func (s *Store) TakeOffTags(ctx context.Context, serverID ids.ID, only []ids.ID) ([]ids.ID, error) {
	var out []ids.ID
	err := s.Tx(ctx, func(tx *db.Tx) error {
		q := `SELECT id FROM users WHERE tag_server_id = ?`
		args := []any{int64(serverID)}
		if only != nil {
			if len(only) == 0 {
				return nil
			}
			q += ` AND id IN (` + placeholders(len(only)) + `)`
			args = append(args, idArgs(only)...)
		}
		rows, err := tx.QueryContext(ctx, q, args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id ids.ID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			out = append(out, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil || len(out) == 0 {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE users SET tag_server_id = NULL, tag_text = '', tag_badge = '', tag_color = NULL, updated_at = ? WHERE id IN (`+placeholders(len(out))+`)`,
			append([]any{nowMs()}, idArgs(out)...)...)
		return err
	})
	return out, err
}

// RepaintTags gives everyone wearing a server's tag its new badge and colour.
func (s *Store) RepaintTags(ctx context.Context, serverID ids.ID, badge string, color *int) ([]ids.ID, error) {
	wearers, err := s.TagWearers(ctx, serverID)
	if err != nil || len(wearers) == 0 {
		return wearers, err
	}
	_, err = s.db.W.ExecContext(ctx, `UPDATE users SET tag_badge = ?, tag_color = ?, updated_at = ? WHERE tag_server_id = ?`, badge, nullInt(color), nowMs(), int64(serverID))
	return wearers, err
}

// WearTag puts a server's tag on someone, as the server has it now; a nil
// server takes theirs off.
func (s *Store) WearTag(ctx context.Context, uid ids.ID, serverID *ids.ID, t *ServerTag) error {
	if serverID == nil || t == nil {
		_, err := s.db.W.ExecContext(ctx, `UPDATE users SET tag_server_id = NULL, tag_text = '', tag_badge = '', tag_color = NULL, updated_at = ? WHERE id = ?`, nowMs(), int64(uid))
		return err
	}
	_, err := s.db.W.ExecContext(ctx, `UPDATE users SET tag_server_id = ?, tag_text = ?, tag_badge = ?, tag_color = ?, updated_at = ? WHERE id = ?`,
		int64(*serverID), t.Text, t.Badge, nullInt(t.Color), nowMs(), int64(uid))
	return err
}

// TagImage is the picture a tag's badge names, if it names one.
func TagImage(badge string) (ids.ID, bool) {
	raw, ok := strings.CutPrefix(badge, "image:")
	if !ok {
		return 0, false
	}
	id, err := ids.Parse(raw)
	return id, err == nil
}
