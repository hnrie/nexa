package store

import (
	"context"
	"strings"

	"evilion.xyz/chat/internal/ids"
)

// UserIPRetentionDays is how long an address an account stopped using is kept.
const UserIPRetentionDays = 180

// RecordUserIP notes that userID was active from ip at the time given.
func (s *Store) RecordUserIP(ctx context.Context, userID ids.ID, ip string, at int64) error {
	if ip == "" {
		return nil
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO user_ips (user_id, ip, first_seen_at, last_seen_at) VALUES (?,?,?,?)
		ON CONFLICT(user_id, ip) DO UPDATE SET last_seen_at = excluded.last_seen_at`, int64(userID), ip, at, at)
	return err
}

// DeleteStaleUserIPs forgets addresses not used since cutoff.
func (s *Store) DeleteStaleUserIPs(ctx context.Context, cutoff int64) (int64, error) {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM user_ips WHERE last_seen_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// AltAccount is another account seen at one of the same addresses.
type AltAccount struct {
	UserID ids.ID `json:"user_id"`
	// SharedIPs is how many addresses the two have in common.
	SharedIPs int `json:"shared_ips"`
	// LastSharedAt is the latest time either was at a shared address.
	LastSharedAt int64 `json:"last_shared_at"`
}

// altPeople leaves out deleted accounts, Nexa and apps' bots.
const altPeople = `JOIN users ou ON ou.id = o.user_id AND ou.flags & ? = 0`

// AltAccounts lists the accounts that share an address with userID, the most
// shared first.
func (s *Store) AltAccounts(ctx context.Context, userID ids.ID) ([]AltAccount, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT o.user_id, count(*), max(`+s.db.Dialect.Greatest("o.last_seen_at", "m.last_seen_at")+`)
		FROM user_ips m JOIN user_ips o ON o.ip = m.ip AND o.user_id != m.user_id `+altPeople+`
		WHERE m.user_id = ? GROUP BY o.user_id ORDER BY count(*) DESC, 3 DESC LIMIT 200`, FlagDeleted|NotPeople|FlagBot, int64(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AltAccount{}
	for rows.Next() {
		var a AltAccount
		if err := rows.Scan(&a.UserID, &a.SharedIPs, &a.LastSharedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// AltCounts says, for each of userIDs, how many other accounts share an
// address with it; accounts with none are left out.
func (s *Store) AltCounts(ctx context.Context, userIDs []ids.ID) (map[ids.ID]int, error) {
	out := map[ids.ID]int{}
	if len(userIDs) == 0 {
		return out, nil
	}
	args := []any{FlagDeleted | NotPeople | FlagBot}
	for _, id := range userIDs {
		args = append(args, int64(id))
	}
	marks := strings.TrimSuffix(strings.Repeat("?,", len(userIDs)), ",")
	rows, err := s.db.R.QueryContext(ctx, `SELECT m.user_id, count(DISTINCT o.user_id)
		FROM user_ips m JOIN user_ips o ON o.ip = m.ip AND o.user_id != m.user_id `+altPeople+`
		WHERE m.user_id IN (`+marks+`) GROUP BY m.user_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id ids.ID
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}
