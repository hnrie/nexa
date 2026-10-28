package store

import (
	"context"
	"evilion.xyz/chat/internal/ids"
)

// ageRestrictedSQL includes hidden and archived channels: Discovery must not
// depend on what channels the viewer has permission to see.
const ageRestrictedSQL = `(s.nsfw = 1 OR EXISTS (SELECT 1 FROM channels age_channel WHERE age_channel.server_id = s.id AND age_channel.nsfw = 1))`

func (s *Store) ServerAgeRestricted(ctx context.Context, id ids.ID) (bool, error) {
	var restricted bool
	err := s.db.R.QueryRowContext(ctx, `SELECT `+ageRestrictedSQL+` FROM servers s WHERE s.id = ?`, int64(id)).Scan(&restricted)
	return restricted, err
}
