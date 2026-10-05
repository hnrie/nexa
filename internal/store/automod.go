package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"evilion.xyz/chat/internal/ids"
)

// AutoMod's rules and its log (migration 0032). What a rule looks for and
// does is checked and given meaning in api/automod.go; here it is only kept.

// AutomodRule is one rule of a server.
type AutomodRule struct {
	ID             ids.ID          `json:"id"`
	ServerID       ids.ID          `json:"server_id"`
	Name           string          `json:"name"`
	Kind           string          `json:"kind"`
	Enabled        bool            `json:"enabled"`
	Config         json.RawMessage `json:"config"`
	Actions        json.RawMessage `json:"actions"`
	ExemptRoles    []ids.ID        `json:"exempt_roles"`
	ExemptChannels []ids.ID        `json:"exempt_channels"`
	CreatorID      ids.ID          `json:"creator_id"`
	CreatedAt      int64           `json:"created_at"`
	UpdatedAt      int64           `json:"updated_at"`
}

// AutomodEvent is one time a rule acted.
type AutomodEvent struct {
	ID        ids.ID  `json:"id"`
	ServerID  ids.ID  `json:"server_id"`
	RuleID    *ids.ID `json:"rule_id"`
	RuleName  string  `json:"rule_name"`
	RuleKind  string  `json:"rule_kind"`
	UserID    ids.ID  `json:"user_id"`
	ChannelID *ids.ID `json:"channel_id"`
	// MessageID is the message it was about, when that was sent.
	MessageID *ids.ID         `json:"message_id"`
	Actions   json.RawMessage `json:"actions"`
	// Content is what was caught, sealed with the server's key (an envelope),
	// or null for a rule the server applied itself.
	Content    json.RawMessage `json:"content"`
	ReporterID *ids.ID         `json:"reporter_id"`
	CreatedAt  int64           `json:"created_at"`
}

const automodRuleCols = `id, server_id, name, kind, enabled, config, actions, exempt_roles, exempt_channels, creator_id, created_at, updated_at`

func scanAutomodRule(r rowScanner) (*AutomodRule, error) {
	var a AutomodRule
	var enabled int64
	var config, actions, roles, chans string
	if err := r.Scan(&a.ID, &a.ServerID, &a.Name, &a.Kind, &enabled, &config, &actions, &roles, &chans, &a.CreatorID, &a.CreatedAt, &a.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	a.Enabled = enabled == 1
	a.Config, a.Actions = json.RawMessage(orJSON(config, "{}")), json.RawMessage(orJSON(actions, "[]"))
	a.ExemptRoles, a.ExemptChannels = parseIDsJSONOrEmpty(roles), parseIDsJSONOrEmpty(chans)
	return &a, nil
}

func orJSON(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

// MaxAutomodRules is how many rules one server keeps.
const MaxAutomodRules = 50

// AutomodRules lists a server's rules, oldest first.
func (s *Store) AutomodRules(ctx context.Context, serverID ids.ID) ([]*AutomodRule, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+automodRuleCols+` FROM automod_rules WHERE server_id = ? ORDER BY id`, int64(serverID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AutomodRule{}
	for rows.Next() {
		a, err := scanAutomodRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// AutomodRule loads one rule.
func (s *Store) AutomodRule(ctx context.Context, id ids.ID) (*AutomodRule, error) {
	return scanAutomodRule(s.db.R.QueryRowContext(ctx, `SELECT `+automodRuleCols+` FROM automod_rules WHERE id = ?`, int64(id)))
}

// SaveAutomodRule writes a rule, new (no id yet) or changed.
func (s *Store) SaveAutomodRule(ctx context.Context, a *AutomodRule) error {
	now := nowMs()
	a.UpdatedAt = now
	if a.ExemptRoles == nil {
		a.ExemptRoles = []ids.ID{}
	}
	if a.ExemptChannels == nil {
		a.ExemptChannels = []ids.ID{}
	}
	if a.ID.IsZero() {
		var n int
		if err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM automod_rules WHERE server_id = ?`, int64(a.ServerID)).Scan(&n); err != nil {
			return err
		}
		if n >= MaxAutomodRules {
			return ErrLimit
		}
		a.ID, a.CreatedAt = ids.New(), now
		_, err := s.db.W.ExecContext(ctx, `INSERT INTO automod_rules (`+automodRuleCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
			int64(a.ID), int64(a.ServerID), a.Name, a.Kind, boolInt(a.Enabled), string(a.Config), string(a.Actions), idsJSON(a.ExemptRoles), idsJSON(a.ExemptChannels), int64(a.CreatorID), a.CreatedAt, a.UpdatedAt)
		return err
	}
	res, err := s.db.W.ExecContext(ctx, `UPDATE automod_rules SET name = ?, kind = ?, enabled = ?, config = ?, actions = ?, exempt_roles = ?, exempt_channels = ?, updated_at = ? WHERE id = ? AND server_id = ?`,
		a.Name, a.Kind, boolInt(a.Enabled), string(a.Config), string(a.Actions), idsJSON(a.ExemptRoles), idsJSON(a.ExemptChannels), a.UpdatedAt, int64(a.ID), int64(a.ServerID))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteAutomodRule removes a rule; its log entries stay, under its name.
func (s *Store) DeleteAutomodRule(ctx context.Context, serverID, id ids.ID) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM automod_rules WHERE id = ? AND server_id = ?`, int64(id), int64(serverID))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetAutomodAt records when the rules members' apps apply last changed (0: there are none).
func (s *Store) SetAutomodAt(ctx context.Context, serverID ids.ID, at int64) error {
	_, err := s.db.W.ExecContext(ctx, `UPDATE servers SET automod_at = ? WHERE id = ?`, at, int64(serverID))
	return err
}

// AddAutomodEvent writes one entry of the AutoMod log.
func (s *Store) AddAutomodEvent(ctx context.Context, e *AutomodEvent) error {
	if e.ID.IsZero() {
		e.ID = ids.New()
	}
	if e.CreatedAt == 0 {
		e.CreatedAt = nowMs()
	}
	if len(e.Actions) == 0 {
		e.Actions = json.RawMessage("[]")
	}
	var content any
	if len(e.Content) > 0 && string(e.Content) != "null" {
		content = string(e.Content)
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO automod_events (id, server_id, rule_id, rule_name, rule_kind, user_id, channel_id, message_id, actions, content, reporter_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		int64(e.ID), int64(e.ServerID), nullID(e.RuleID), e.RuleName, e.RuleKind, int64(e.UserID), nullID(e.ChannelID), nullID(e.MessageID), string(e.Actions), content, nullID(e.ReporterID), e.CreatedAt)
	return err
}

// AutomodEvents pages through a server's AutoMod log, newest first,
// optionally about one person.
func (s *Store) AutomodEvents(ctx context.Context, serverID ids.ID, user *ids.ID, before ids.ID, limit int) ([]*AutomodEvent, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	q := `SELECT id, server_id, rule_id, rule_name, rule_kind, user_id, channel_id, message_id, actions, content, reporter_id, created_at FROM automod_events WHERE server_id = ?`
	args := []any{int64(serverID)}
	if user != nil {
		q += ` AND user_id = ?`
		args = append(args, int64(*user))
	}
	if !before.IsZero() {
		q += ` AND id < ?`
		args = append(args, int64(before))
	}
	q += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AutomodEvent{}
	for rows.Next() {
		var e AutomodEvent
		var rule, channel, message, reporter sql.NullInt64
		var actions string
		var content sql.NullString
		if err := rows.Scan(&e.ID, &e.ServerID, &rule, &e.RuleName, &e.RuleKind, &e.UserID, &channel, &message, &actions, &content, &reporter, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.RuleID, e.ChannelID, e.MessageID, e.ReporterID = idPtr(rule), idPtr(channel), idPtr(message), idPtr(reporter)
		e.Actions = json.RawMessage(orJSON(actions, "[]"))
		if content.Valid {
			e.Content = json.RawMessage(content.String)
		} else {
			e.Content = json.RawMessage("null")
		}
		out = append(out, &e)
	}
	return out, rows.Err()
}

// RecentMessageCount counts what uid has said in a server's channels since a
// moment, up to max: what a flood rule weighs.
func (s *Store) RecentMessageCount(ctx context.Context, serverID, uid ids.ID, since int64, max int) (int, error) {
	// ids grow with time, so the first id of that moment bounds the walk
	// through the author's index to what is recent
	from := int64(0)
	if since > ids.Epoch {
		from = (since - ids.Epoch) << 22
	}
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM (SELECT 1 FROM messages m JOIN channels c ON c.id = m.channel_id
		WHERE m.author_id = ? AND m.id >= ? AND c.server_id = ? AND m.type NOT LIKE 'system!_%' ESCAPE '!' LIMIT ?) recent`, int64(uid), from, int64(serverID), max).Scan(&n)
	return n, err
}

// AutomodCount is how often one rule acted since a moment.
type AutomodCount struct {
	RuleID   *ids.ID `json:"rule_id"`
	RuleName string  `json:"rule_name"`
	RuleKind string  `json:"rule_kind"`
	Count    int     `json:"count"`
}

// AutomodCounts says how often each rule of a server acted since a moment,
// most first.
func (s *Store) AutomodCounts(ctx context.Context, serverID ids.ID, since int64) ([]AutomodCount, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT rule_id, max(rule_name), max(rule_kind), count(*) FROM automod_events WHERE server_id = ? AND created_at >= ? GROUP BY rule_id ORDER BY count(*) DESC`, int64(serverID), since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AutomodCount{}
	for rows.Next() {
		var c AutomodCount
		var rule sql.NullInt64
		if err := rows.Scan(&rule, &c.RuleName, &c.RuleKind, &c.Count); err != nil {
			return nil, err
		}
		c.RuleID = idPtr(rule)
		out = append(out, c)
	}
	return out, rows.Err()
}

// AutomodCaught reports whether a rule has already acted on a message.
func (s *Store) AutomodCaught(ctx context.Context, ruleID, messageID ids.ID) (bool, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM automod_events WHERE message_id = ? AND rule_id = ?`, int64(messageID), int64(ruleID)).Scan(&n)
	return n > 0, err
}

// CountAutomodCatches counts how often a rule caught someone since a moment.
func (s *Store) CountAutomodCatches(ctx context.Context, serverID, uid, ruleID ids.ID, since int64) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM automod_events WHERE server_id = ? AND user_id = ? AND rule_id = ? AND created_at >= ?`, int64(serverID), int64(uid), int64(ruleID), since).Scan(&n)
	return n, err
}

// RecentMentionCount counts the different people and roles uid's messages in
// a server have mentioned since a moment.
func (s *Store) RecentMentionCount(ctx context.Context, serverID, uid ids.ID, since int64) (int, error) {
	from := int64(0)
	if since > ids.Epoch {
		from = (since - ids.Epoch) << 22
	}
	rows, err := s.db.R.QueryContext(ctx, `SELECT m.mentions, m.mention_roles FROM messages m JOIN channels c ON c.id = m.channel_id
		WHERE m.author_id = ? AND m.id >= ? AND c.server_id = ? LIMIT 200`, int64(uid), from, int64(serverID))
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	seen := map[ids.ID]bool{}
	for rows.Next() {
		var users, roles string
		if err := rows.Scan(&users, &roles); err != nil {
			return 0, err
		}
		for _, id := range parseIDsJSON(users) {
			seen[id] = true
		}
		for _, id := range parseIDsJSON(roles) {
			seen[id] = true
		}
	}
	return len(seen), rows.Err()
}
