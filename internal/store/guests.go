package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/ids"
)

// GuestLink lets people without an account into one channel's call.
type GuestLink struct {
	Code      string `json:"code"`
	ChannelID ids.ID `json:"channel_id"`
	CreatorID ids.ID `json:"creator_id"`
	// Epoch is the key epoch whose call key the link carries in its fragment.
	Epoch     int   `json:"epoch"`
	CreatedAt int64 `json:"created_at"`
	ExpiresAt int64 `json:"expires_at"`
	// Guests counts who is in through the link right now (filled by listings).
	Guests int `json:"guests"`
}

// Guest is someone in a call through a guest link. It is not an account.
type Guest struct {
	ID          ids.ID
	LinkCode    string
	ChannelID   ids.ID
	DisplayName string
	// Epoch is the link's, kept so the call can hand the guest newer keys.
	Epoch     int
	SessionID ids.ID
	TokenHash string
	IP        string
	CreatedAt int64
	ExpiresAt int64
}

// User is how a guest appears to the code that serves calls: an id, a name
// and the guest flag, with none of an account's keys or settings.
func (g *Guest) User() *User {
	return &User{ID: g.ID, DisplayName: g.DisplayName, Flags: FlagGuest, PresencePref: "online", DMPrivacy: "nobody", CreatedAt: g.CreatedAt, UpdatedAt: g.CreatedAt}
}

// Session is the guest's one session, as the call code sees sessions.
func (g *Guest) Session() *Session {
	return &Session{ID: g.SessionID, UserID: g.ID, IP: g.IP, CreatedAt: g.CreatedAt, LastSeenAt: g.CreatedAt}
}

// guestCodeLen gives a link about 70 bits, far past guessing. On a server whose
// calls go through the SFU a guess would still need the key in the link's
// fragment to hear anything; peer to peer there is no such key, which is why
// those servers take no guests unless told to.
const guestCodeLen = 12

func newGuestCode() string {
	b := make([]byte, guestCodeLen)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = inviteAlphabet[int(b[i])%len(inviteAlphabet)]
	}
	return string(b)
}

const guestLinkCols = `code, channel_id, creator_id, epoch, created_at, expires_at`

func scanGuestLink(r rowScanner) (*GuestLink, error) {
	var l GuestLink
	if err := r.Scan(&l.Code, &l.ChannelID, &l.CreatorID, &l.Epoch, &l.CreatedAt, &l.ExpiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &l, nil
}

// CreateGuestLink stores a new link for a channel's call; maxAgeMs is how long it takes new guests.
func (s *Store) CreateGuestLink(ctx context.Context, channelID, creatorID ids.ID, epoch int, maxAgeMs int64) (*GuestLink, error) {
	now := nowMs()
	l := &GuestLink{Code: newGuestCode(), ChannelID: channelID, CreatorID: creatorID, Epoch: epoch, CreatedAt: now, ExpiresAt: now + maxAgeMs}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO guest_links (`+guestLinkCols+`) VALUES (?,?,?,?,?,?)`, l.Code, int64(channelID), int64(creatorID), epoch, l.CreatedAt, l.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return l, nil
}

// GuestLinkByCode loads a link, expired or not: an expired link takes no one
// new, but whoever it let in stays until their own time is up.
func (s *Store) GuestLinkByCode(ctx context.Context, code string) (*GuestLink, error) {
	return scanGuestLink(s.db.R.QueryRowContext(ctx, `SELECT `+guestLinkCols+` FROM guest_links WHERE code = ?`, code))
}

// GuestLinksForChannel lists a channel's links, newest first, each with how many guests it has in.
func (s *Store) GuestLinksForChannel(ctx context.Context, channelID ids.ID) ([]*GuestLink, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT code, channel_id, creator_id, epoch, created_at, expires_at, (SELECT count(*) FROM guests g WHERE g.link_code = l.code) FROM guest_links l WHERE channel_id = ? ORDER BY created_at DESC`, int64(channelID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*GuestLink{}
	for rows.Next() {
		var l GuestLink
		if err := rows.Scan(&l.Code, &l.ChannelID, &l.CreatorID, &l.Epoch, &l.CreatedAt, &l.ExpiresAt, &l.Guests); err != nil {
			return nil, err
		}
		out = append(out, &l)
	}
	return out, rows.Err()
}

// DeleteGuestLink revokes a link; its guests go with it.
func (s *Store) DeleteGuestLink(ctx context.Context, code string) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM guest_links WHERE code = ?`, code)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteSpentGuestLinks removes links that expired and have nobody left in, and returns how many went.
func (s *Store) DeleteSpentGuestLinks(ctx context.Context, now int64) (int64, error) {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM guest_links WHERE expires_at <= ? AND NOT EXISTS (SELECT 1 FROM guests g WHERE g.link_code = guest_links.code)`, now)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

const guestCols = `id, link_code, channel_id, display_name, epoch, session_id, token_hash, ip, created_at, expires_at`

func scanGuest(r rowScanner) (*Guest, error) {
	var g Guest
	if err := r.Scan(&g.ID, &g.LinkCode, &g.ChannelID, &g.DisplayName, &g.Epoch, &g.SessionID, &g.TokenHash, &g.IP, &g.CreatedAt, &g.ExpiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &g, nil
}

// CreateGuest lets someone in through a link (ID, SessionID and CreatedAt are filled in when zero).
func (s *Store) CreateGuest(ctx context.Context, g *Guest) error {
	if g.ID.IsZero() {
		g.ID = ids.New()
	}
	if g.SessionID.IsZero() {
		g.SessionID = ids.New()
	}
	if g.CreatedAt == 0 {
		g.CreatedAt = nowMs()
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO guests (`+guestCols+`) VALUES (?,?,?,?,?,?,?,?,?,?)`,
		int64(g.ID), g.LinkCode, int64(g.ChannelID), g.DisplayName, g.Epoch, int64(g.SessionID), g.TokenHash, g.IP, g.CreatedAt, g.ExpiresAt)
	return err
}

// GuestByTokenHash finds the guest a bearer token belongs to.
func (s *Store) GuestByTokenHash(ctx context.Context, hash string) (*Guest, error) {
	return scanGuest(s.db.R.QueryRowContext(ctx, `SELECT `+guestCols+` FROM guests WHERE token_hash = ?`, hash))
}

// GuestByID loads one guest.
func (s *Store) GuestByID(ctx context.Context, id ids.ID) (*Guest, error) {
	return scanGuest(s.db.R.QueryRowContext(ctx, `SELECT `+guestCols+` FROM guests WHERE id = ?`, int64(id)))
}

func (s *Store) guestList(ctx context.Context, where string, args ...any) ([]*Guest, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+guestCols+` FROM guests`+where+` ORDER BY created_at`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Guest{}
	for rows.Next() {
		g, err := scanGuest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// Guests lists every guest, for the sweep that lets go of the ones who are gone.
func (s *Store) Guests(ctx context.Context) ([]*Guest, error) {
	return s.guestList(ctx, "")
}

// GuestsForLink lists who came in through a link.
func (s *Store) GuestsForLink(ctx context.Context, code string) ([]*Guest, error) {
	return s.guestList(ctx, " WHERE link_code = ?", code)
}

// GuestsForChannel lists the guests of a channel's call.
func (s *Store) GuestsForChannel(ctx context.Context, channelID ids.ID) ([]*Guest, error) {
	return s.guestList(ctx, " WHERE channel_id = ?", int64(channelID))
}

// DeleteGuest ends a guest's time in the call.
func (s *Store) DeleteGuest(ctx context.Context, id ids.ID) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM guests WHERE id = ?`, int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
