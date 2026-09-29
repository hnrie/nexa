package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// The kinds of Discord activity a person can choose to show, as bits of
// DiscordLink.Kinds. Custom statuses are never among them: a Nexa account has
// its own.
const (
	DiscordKindPlaying   = 1 << 0
	DiscordKindListening = 1 << 1
	DiscordKindWatching  = 1 << 2
	DiscordKindStreaming = 1 << 3
	DiscordKindCompeting = 1 << 4
	DiscordKindsAll      = DiscordKindPlaying | DiscordKindListening | DiscordKindWatching | DiscordKindStreaming | DiscordKindCompeting
)

// DiscordLink is a Nexa account's link to a Discord account (discord_links).
type DiscordLink struct {
	UserID         ids.ID
	DiscordID      string
	Username       string
	GlobalName     string
	Avatar         string
	AccessSealed   []byte
	RefreshSealed  []byte
	TokenExpiresAt int64
	InGuild        bool
	LeftAt         int64
	ShowActivity   bool
	Kinds          int
	CreatedAt      int64
	UpdatedAt      int64
}

const discordLinkCols = `user_id, discord_id, username, global_name, avatar, access_sealed, refresh_sealed, token_expires_at, in_guild, left_at, show_activity, kinds, created_at, updated_at`

func scanDiscordLink(r rowScanner) (*DiscordLink, error) {
	var l DiscordLink
	var inGuild, show int64
	if err := r.Scan(&l.UserID, &l.DiscordID, &l.Username, &l.GlobalName, &l.Avatar, &l.AccessSealed, &l.RefreshSealed, &l.TokenExpiresAt, &inGuild, &l.LeftAt, &show, &l.Kinds, &l.CreatedAt, &l.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	l.InGuild, l.ShowActivity = inGuild != 0, show != 0
	return &l, nil
}

// DiscordLinkOf is the account's link, or ErrNotFound.
func (s *Store) DiscordLinkOf(ctx context.Context, uid ids.ID) (*DiscordLink, error) {
	return scanDiscordLink(s.db.R.QueryRowContext(ctx, `SELECT `+discordLinkCols+` FROM discord_links WHERE user_id = ?`, int64(uid)))
}

// DiscordLinkByDiscordID is the link of the Nexa account a Discord account is linked to, or ErrNotFound.
func (s *Store) DiscordLinkByDiscordID(ctx context.Context, discordID string) (*DiscordLink, error) {
	return scanDiscordLink(s.db.R.QueryRowContext(ctx, `SELECT `+discordLinkCols+` FROM discord_links WHERE discord_id = ?`, discordID))
}

// DiscordLinks is every link, for the bot to know whose presence it is watching.
func (s *Store) DiscordLinks(ctx context.Context) ([]*DiscordLink, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+discordLinkCols+` FROM discord_links`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*DiscordLink{}
	for rows.Next() {
		l, err := scanDiscordLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// SaveDiscordLink links an account to a Discord account, or updates the link
// it has: the Discord account's names and the tokens. Its choices of what to
// show are kept. A Discord account already linked to a different Nexa account
// is refused with ErrConflict.
func (s *Store) SaveDiscordLink(ctx context.Context, l *DiscordLink) error {
	if other, err := s.DiscordLinkByDiscordID(ctx, l.DiscordID); err == nil && other.UserID != l.UserID {
		return ErrConflict
	} else if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	now := nowMs()
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO discord_links (user_id, discord_id, username, global_name, avatar, access_sealed, refresh_sealed, token_expires_at, in_guild, left_at, show_activity, kinds, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(user_id) DO UPDATE SET discord_id = excluded.discord_id, username = excluded.username, global_name = excluded.global_name,
			avatar = excluded.avatar, access_sealed = excluded.access_sealed, refresh_sealed = excluded.refresh_sealed,
			token_expires_at = excluded.token_expires_at, in_guild = excluded.in_guild, left_at = excluded.left_at, updated_at = excluded.updated_at`,
		int64(l.UserID), l.DiscordID, l.Username, l.GlobalName, l.Avatar, l.AccessSealed, l.RefreshSealed, l.TokenExpiresAt,
		boolInt(l.InGuild), l.LeftAt, int64(1), DiscordKindsAll, now, now)
	if err != nil && db.IsUniqueViolation(err) {
		// linked to someone else between the check and the write
		return ErrConflict
	}
	return err
}

// SetDiscordTokens replaces a link's sealed tokens after a refresh.
func (s *Store) SetDiscordTokens(ctx context.Context, uid ids.ID, access, refresh []byte, expiresAt int64) error {
	_, err := s.db.W.ExecContext(ctx, `UPDATE discord_links SET access_sealed = ?, refresh_sealed = ?, token_expires_at = ?, updated_at = ? WHERE user_id = ?`,
		access, refresh, expiresAt, nowMs(), int64(uid))
	return err
}

// SetDiscordInGuild records whether the Discord account is in the activity
// server. Leaving notes when (the first time only, until it is back); coming
// back clears it. It reports whether anything changed.
func (s *Store) SetDiscordInGuild(ctx context.Context, discordID string, in bool) (bool, error) {
	now := nowMs()
	var res sql.Result
	var err error
	if in {
		res, err = s.db.W.ExecContext(ctx, `UPDATE discord_links SET in_guild = 1, left_at = 0, updated_at = ? WHERE discord_id = ? AND (in_guild = 0 OR left_at <> 0)`, now, discordID)
	} else {
		res, err = s.db.W.ExecContext(ctx, `UPDATE discord_links SET in_guild = 0, left_at = ?, updated_at = ? WHERE discord_id = ? AND in_guild = 1`, now, now, discordID)
	}
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// SetDiscordPrefs changes what a link shows: whether anything does, and which kinds.
func (s *Store) SetDiscordPrefs(ctx context.Context, uid ids.ID, show bool, kinds int) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE discord_links SET show_activity = ?, kinds = ?, updated_at = ? WHERE user_id = ?`, boolInt(show), kinds&DiscordKindsAll, nowMs(), int64(uid))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteDiscordLink unlinks an account, taking its tokens with it. It returns
// the link as it was, or ErrNotFound when there was none.
func (s *Store) DeleteDiscordLink(ctx context.Context, uid ids.ID) (*DiscordLink, error) {
	l, err := s.DiscordLinkOf(ctx, uid)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.W.ExecContext(ctx, `DELETE FROM discord_links WHERE user_id = ?`, int64(uid)); err != nil {
		return nil, err
	}
	return l, nil
}
