package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// --- OAuth2 ---------------------------------------------------------------------------

// OAuthCode is an authorization code handed to an application's redirect.
type OAuthCode struct {
	CodeHash        string
	ApplicationID   ids.ID
	UserID          ids.ID
	Scopes          []string
	RedirectURI     string
	GuildID         *ids.ID
	Permissions     int64
	Challenge       string
	ChallengeMethod string
	// WebhookID is the webhook made for webhook.incoming, if asked for
	WebhookID *ids.ID
	ExpiresAt int64
	CreatedAt int64
}

// CreateOAuthCode stores a code.
func (s *Store) CreateOAuthCode(ctx context.Context, c *OAuthCode) error {
	c.CreatedAt = nowMs()
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO oauth_codes (code_hash, application_id, user_id, scopes, redirect_uri, guild_id, permissions, challenge, challenge_method, webhook_id, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		c.CodeHash, int64(c.ApplicationID), int64(c.UserID), stringsJSON(c.Scopes), c.RedirectURI, nullID(c.GuildID), c.Permissions, c.Challenge, c.ChallengeMethod, nullID(c.WebhookID), c.ExpiresAt, c.CreatedAt)
	return err
}

// TakeOAuthCode returns a code and removes it, so it is used at most once.
func (s *Store) TakeOAuthCode(ctx context.Context, hash string) (*OAuthCode, error) {
	var c OAuthCode
	err := s.Tx(ctx, func(tx *db.Tx) error {
		var scopes string
		var guild, webhook sql.NullInt64
		err := tx.QueryRowContext(ctx, `SELECT code_hash, application_id, user_id, scopes, redirect_uri, guild_id, permissions, challenge, challenge_method, webhook_id, expires_at, created_at FROM oauth_codes WHERE code_hash = ?`, hash).
			Scan(&c.CodeHash, &c.ApplicationID, &c.UserID, &scopes, &c.RedirectURI, &guild, &c.Permissions, &c.Challenge, &c.ChallengeMethod, &webhook, &c.ExpiresAt, &c.CreatedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		c.Scopes, c.GuildID, c.WebhookID = jsonStrings(scopes), idPtr(guild), idPtr(webhook)
		_, err = tx.ExecContext(ctx, `DELETE FROM oauth_codes WHERE code_hash = ?`, hash)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// OAuthToken is an access token an application holds for an account, with
// the refresh token that renews it. The refresh token outlives the access
// token, so an application can renew one that has run out; the row goes when
// the refresh token does.
type OAuthToken struct {
	ID               ids.ID
	ApplicationID    ids.ID
	UserID           ids.ID
	Scopes           []string
	AccessHash       string
	RefreshHash      string
	ExpiresAt        int64
	RefreshExpiresAt int64
	CreatedAt        int64
}

const oauthTokenCols = `id, application_id, user_id, scopes, access_hash, refresh_hash, expires_at, refresh_expires_at, created_at`

func scanOAuthToken(r rowScanner) (*OAuthToken, error) {
	var t OAuthToken
	var scopes string
	if err := r.Scan(&t.ID, &t.ApplicationID, &t.UserID, &scopes, &t.AccessHash, &t.RefreshHash, &t.ExpiresAt, &t.RefreshExpiresAt, &t.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	t.Scopes = jsonStrings(scopes)
	return &t, nil
}

// CreateOAuthToken stores a token.
func (s *Store) CreateOAuthToken(ctx context.Context, t *OAuthToken) error {
	if t.ID.IsZero() {
		t.ID = ids.New()
	}
	t.CreatedAt = nowMs()
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO oauth_tokens (`+oauthTokenCols+`) VALUES (?,?,?,?,?,?,?,?,?)`,
		int64(t.ID), int64(t.ApplicationID), int64(t.UserID), stringsJSON(t.Scopes), t.AccessHash, t.RefreshHash, t.ExpiresAt, t.RefreshExpiresAt, t.CreatedAt)
	return err
}

// OAuthTokenByAccess finds a token by its access token's hash.
func (s *Store) OAuthTokenByAccess(ctx context.Context, hash string) (*OAuthToken, error) {
	return scanOAuthToken(s.db.R.QueryRowContext(ctx, `SELECT `+oauthTokenCols+` FROM oauth_tokens WHERE access_hash = ?`, hash))
}

// OAuthTokenByRefresh finds a token by its refresh token's hash.
func (s *Store) OAuthTokenByRefresh(ctx context.Context, hash string) (*OAuthToken, error) {
	return scanOAuthToken(s.db.R.QueryRowContext(ctx, `SELECT `+oauthTokenCols+` FROM oauth_tokens WHERE refresh_hash = ?`, hash))
}

// DeleteOAuthToken removes one token.
func (s *Store) DeleteOAuthToken(ctx context.Context, id ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM oauth_tokens WHERE id = ?`, int64(id))
	return err
}

// DeleteOAuthTokensFor removes every token an application holds for an account.
func (s *Store) DeleteOAuthTokensFor(ctx context.Context, app, user ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM oauth_tokens WHERE application_id = ? AND user_id = ?`, int64(app), int64(user))
	return err
}

// OAuthGrants lists, for an account, each application holding a token for it
// with the scopes of its newest one.
func (s *Store) OAuthGrants(ctx context.Context, user ids.ID) ([]*OAuthToken, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+oauthTokenCols+` FROM oauth_tokens WHERE user_id = ? ORDER BY application_id, id DESC`, int64(user))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*OAuthToken{}
	seen := map[ids.ID]bool{}
	for rows.Next() {
		t, err := scanOAuthToken(rows)
		if err != nil {
			return nil, err
		}
		if seen[t.ApplicationID] {
			continue
		}
		seen[t.ApplicationID] = true
		out = append(out, t)
	}
	return out, rows.Err()
}

// --- interactions ---------------------------------------------------------------------

// Interaction is someone using what an application made: a command, a
// component, a form. Data is the interaction as the application was sent it.
type Interaction struct {
	ID                ids.ID
	ApplicationID     ids.ID
	Type              int
	TokenHash         string
	UserID            ids.ID
	GuildID           *ids.ID
	ChannelID         *ids.ID
	MessageID         *ids.ID
	ResponseType      int
	ResponseMessageID *ids.ID
	Ephemeral         bool
	Data              json.RawMessage
	// Modal is the form the application's answer opened, empty for none
	Modal     json.RawMessage
	CreatedAt int64
	ExpiresAt int64
}

const interactionCols = `id, application_id, type, token_hash, user_id, guild_id, channel_id, message_id, response_type, response_message_id, ephemeral, data, modal, created_at, expires_at`

func scanInteraction(r rowScanner) (*Interaction, error) {
	var it Interaction
	var guild, channel, message, response sql.NullInt64
	var ephemeral int64
	var data, modal string
	if err := r.Scan(&it.ID, &it.ApplicationID, &it.Type, &it.TokenHash, &it.UserID, &guild, &channel, &message, &it.ResponseType, &response, &ephemeral, &data, &modal, &it.CreatedAt, &it.ExpiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	it.GuildID, it.ChannelID, it.MessageID, it.ResponseMessageID = idPtr(guild), idPtr(channel), idPtr(message), idPtr(response)
	it.Ephemeral = ephemeral == 1
	it.Data = json.RawMessage(data)
	if modal != "" {
		it.Modal = json.RawMessage(modal)
	}
	return &it, nil
}

// CreateInteraction stores an interaction.
func (s *Store) CreateInteraction(ctx context.Context, it *Interaction) error {
	if it.CreatedAt == 0 {
		it.CreatedAt = nowMs()
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO interactions (`+interactionCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		int64(it.ID), int64(it.ApplicationID), it.Type, it.TokenHash, int64(it.UserID), nullID(it.GuildID), nullID(it.ChannelID), nullID(it.MessageID),
		it.ResponseType, nullID(it.ResponseMessageID), boolInt(it.Ephemeral), string(it.Data), string(it.Modal), it.CreatedAt, it.ExpiresAt)
	return err
}

// DeleteInteraction forgets an interaction its application never answered
// in time, whose token then stops working. False when it was answered after
// all, just now.
func (s *Store) DeleteInteraction(ctx context.Context, id ids.ID) (bool, error) {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM interactions WHERE id = ? AND response_type = 0`, int64(id))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ReleaseInteraction takes back an answer whose message could not be made,
// so the application can answer again.
func (s *Store) ReleaseInteraction(ctx context.Context, id ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `UPDATE interactions SET response_type = 0, response_message_id = NULL, ephemeral = 0, modal = '' WHERE id = ?`, int64(id))
	return err
}

// InteractionByID loads one interaction.
func (s *Store) InteractionByID(ctx context.Context, id ids.ID) (*Interaction, error) {
	return scanInteraction(s.db.R.QueryRowContext(ctx, `SELECT `+interactionCols+` FROM interactions WHERE id = ?`, int64(id)))
}

// InteractionByToken finds an interaction of an application by its token's hash.
func (s *Store) InteractionByToken(ctx context.Context, app ids.ID, hash string) (*Interaction, error) {
	return scanInteraction(s.db.R.QueryRowContext(ctx, `SELECT `+interactionCols+` FROM interactions WHERE application_id = ? AND token_hash = ?`, int64(app), hash))
}

// AnswerInteraction records an interaction's first answer, only if it has
// none yet: false when another answer got there first. modal is the form the
// answer opens, if it opens one.
func (s *Store) AnswerInteraction(ctx context.Context, id ids.ID, responseType int, messageID *ids.ID, ephemeral bool, modal json.RawMessage) (bool, error) {
	res, err := s.db.W.ExecContext(ctx, `UPDATE interactions SET response_type = ?, response_message_id = ?, ephemeral = ?, modal = ? WHERE id = ? AND response_type = 0`,
		responseType, nullID(messageID), boolInt(ephemeral), string(modal), int64(id))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// SetInteractionMessage records the message an interaction's answer made,
// for one that was deferred and is answered now.
func (s *Store) SetInteractionMessage(ctx context.Context, id, messageID ids.ID, ephemeral bool) error {
	_, err := s.db.W.ExecContext(ctx, `UPDATE interactions SET response_message_id = ?, ephemeral = ? WHERE id = ?`, int64(messageID), boolInt(ephemeral), int64(id))
	return err
}

// SweepInteractions removes interactions and ephemeral messages past their
// time, and OAuth codes and tokens past theirs (a token's being its refresh
// token's).
func (s *Store) SweepInteractions(ctx context.Context, now int64) error {
	for _, q := range []string{`DELETE FROM interactions WHERE expires_at < ?`,
		`DELETE FROM ephemeral_files WHERE ephemeral_id IN (SELECT id FROM ephemeral_messages WHERE expires_at < ?)`,
		`DELETE FROM ephemeral_messages WHERE expires_at < ?`, `DELETE FROM oauth_codes WHERE expires_at < ?`, `DELETE FROM oauth_tokens WHERE refresh_expires_at < ?`} {
		if _, err := s.db.W.ExecContext(ctx, q, now); err != nil {
			return err
		}
	}
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM interaction_files WHERE created_at < ?`, now-24*3600*1000)
	return err
}

// --- ephemeral messages ------------------------------------------------------------------

// EphemeralMessage is an application's answer only one person sees.
type EphemeralMessage struct {
	ID            ids.ID
	ChannelID     ids.ID
	UserID        ids.ID
	ApplicationID ids.ID
	InteractionID *ids.ID
	Plain         json.RawMessage
	Flags         int64
	CreatedAt     int64
	EditedAt      *int64
	ExpiresAt     int64
	// Files, on one being stored, are the files it carries
	Files []EphemeralFile
}

// EphemeralFile is a file an ephemeral message carries: ID is the
// attachment's id as the message names it.
type EphemeralFile struct {
	ID          ids.ID
	EphemeralID ids.ID
	BlobID      ids.ID
	UserID      ids.ID
}

const ephemeralCols = `id, channel_id, user_id, application_id, interaction_id, plain, flags, created_at, edited_at, expires_at`

func scanEphemeral(r rowScanner) (*EphemeralMessage, error) {
	var e EphemeralMessage
	var interaction, edited sql.NullInt64
	var plain string
	if err := r.Scan(&e.ID, &e.ChannelID, &e.UserID, &e.ApplicationID, &interaction, &plain, &e.Flags, &e.CreatedAt, &edited, &e.ExpiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	e.InteractionID, e.EditedAt = idPtr(interaction), int64Ptr(edited)
	e.Plain = json.RawMessage(plain)
	return &e, nil
}

// InsertEphemeral stores an ephemeral message.
func (s *Store) InsertEphemeral(ctx context.Context, e *EphemeralMessage) error {
	if e.ID.IsZero() {
		e.ID = ids.New()
	}
	if e.CreatedAt == 0 {
		e.CreatedAt = e.ID.Time().UnixMilli()
	}
	return s.Tx(ctx, func(tx *db.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO ephemeral_messages (`+ephemeralCols+`) VALUES (?,?,?,?,?,?,?,?,?,?)`,
			int64(e.ID), int64(e.ChannelID), int64(e.UserID), int64(e.ApplicationID), nullID(e.InteractionID), string(e.Plain), e.Flags, e.CreatedAt, nullInt64(e.EditedAt), e.ExpiresAt); err != nil {
			return err
		}
		return insertEphemeralFiles(ctx, tx, e.ID, e.UserID, e.Files)
	})
}

func insertEphemeralFiles(ctx context.Context, tx *db.Tx, ephemeral, user ids.ID, files []EphemeralFile) error {
	for _, f := range files {
		if _, err := tx.ExecContext(ctx, `INSERT INTO ephemeral_files (id, ephemeral_id, blob_id, user_id) VALUES (?,?,?,?)`, int64(f.ID), int64(ephemeral), int64(f.BlobID), int64(user)); err != nil {
			return err
		}
	}
	return nil
}

// EphemeralFileByID loads a file of an ephemeral message.
func (s *Store) EphemeralFileByID(ctx context.Context, id ids.ID) (*EphemeralFile, error) {
	var f EphemeralFile
	err := s.db.R.QueryRowContext(ctx, `SELECT id, ephemeral_id, blob_id, user_id FROM ephemeral_files WHERE id = ?`, int64(id)).Scan(&f.ID, &f.EphemeralID, &f.BlobID, &f.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &f, err
}

// EphemeralFileReadable reports whether a file belongs to an ephemeral
// message meant for uid.
func (s *Store) EphemeralFileReadable(ctx context.Context, blob, uid ids.ID) (bool, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM ephemeral_files WHERE blob_id = ? AND user_id = ?`, int64(blob), int64(uid)).Scan(&n)
	return n > 0, err
}

// EphemeralByID loads one ephemeral message.
func (s *Store) EphemeralByID(ctx context.Context, id ids.ID) (*EphemeralMessage, error) {
	return scanEphemeral(s.db.R.QueryRowContext(ctx, `SELECT `+ephemeralCols+` FROM ephemeral_messages WHERE id = ?`, int64(id)))
}

// UpdateEphemeral replaces an ephemeral message's content and flags, keeps
// the files listed in keep (all of them when keep is nil) and adds add.
func (s *Store) UpdateEphemeral(ctx context.Context, e *EphemeralMessage, keep []ids.ID, add []EphemeralFile) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE ephemeral_messages SET plain = ?, flags = ?, edited_at = ? WHERE id = ?`, string(e.Plain), e.Flags, nullInt64(e.EditedAt), int64(e.ID))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if keep != nil {
			args := []any{int64(e.ID)}
			q := `DELETE FROM ephemeral_files WHERE ephemeral_id = ?`
			if len(keep) > 0 {
				q += ` AND id NOT IN (` + placeholders(len(keep)) + `)`
				args = append(args, idArgs(keep)...)
			}
			if _, err := tx.ExecContext(ctx, q, args...); err != nil {
				return err
			}
		}
		return insertEphemeralFiles(ctx, tx, e.ID, e.UserID, add)
	})
}

// DeleteEphemeral removes an ephemeral message and its files' rows.
func (s *Store) DeleteEphemeral(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM ephemeral_files WHERE ephemeral_id = ?`, int64(id)); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM ephemeral_messages WHERE id = ?`, int64(id))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// --- files sent with interactions --------------------------------------------------------

// InteractionFile is a file someone sent an application with an interaction.
type InteractionFile struct {
	BlobID    ids.ID
	UserID    ids.ID
	Filename  string
	CreatedAt int64
}

// PutInteractionFile records the name a file sent with an interaction came with.
func (s *Store) PutInteractionFile(ctx context.Context, f *InteractionFile) error {
	if f.CreatedAt == 0 {
		f.CreatedAt = nowMs()
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO interaction_files (blob_id, user_id, filename, created_at) VALUES (?,?,?,?)`, int64(f.BlobID), int64(f.UserID), f.Filename, f.CreatedAt)
	return err
}

// InteractionFileByBlob loads a file sent with an interaction.
func (s *Store) InteractionFileByBlob(ctx context.Context, blob ids.ID) (*InteractionFile, error) {
	var f InteractionFile
	err := s.db.R.QueryRowContext(ctx, `SELECT blob_id, user_id, filename, created_at FROM interaction_files WHERE blob_id = ?`, int64(blob)).Scan(&f.BlobID, &f.UserID, &f.Filename, &f.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &f, err
}

// --- copies for bots ---------------------------------------------------------------------

// MaxBotCopies is how many bots one message may carry copies for.
const MaxBotCopies = 10

// PutBotCopies replaces the copies a message carries for bots.
func (s *Store) PutBotCopies(ctx context.Context, msgID ids.ID, copies map[ids.ID][]byte) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM bot_copies WHERE message_id = ?`, int64(msgID)); err != nil {
			return err
		}
		for bot, sealed := range copies {
			if _, err := tx.ExecContext(ctx, `INSERT INTO bot_copies (message_id, bot_id, sealed) VALUES (?,?,?)`, int64(msgID), int64(bot), sealed); err != nil {
				return err
			}
		}
		return nil
	})
}

// BotCopies returns the sealed copies a bot has of the listed messages.
func (s *Store) BotCopies(ctx context.Context, bot ids.ID, msgs []ids.ID) (map[ids.ID][]byte, error) {
	out := map[ids.ID][]byte{}
	err := chunked(msgs, func(part []ids.ID) error {
		args := append([]any{int64(bot)}, idArgs(part)...)
		rows, err := s.db.R.QueryContext(ctx, `SELECT message_id, sealed FROM bot_copies WHERE bot_id = ? AND message_id IN (`+placeholders(len(part))+`)`, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id ids.ID
			var sealed []byte
			if err := rows.Scan(&id, &sealed); err != nil {
				return err
			}
			out[id] = sealed
		}
		return rows.Err()
	})
	return out, err
}
