package store

import (
	"context"
	"evilion.xyz/chat/internal/ids"
)

// Discovery follows the whole-server setting. Individual NSFW channels retain
// their own age gates without classifying the entire community as NSFW.
const ageRestrictedSQL = `(s.nsfw = 1)`

func (s *Store) ServerAgeRestricted(ctx context.Context, id ids.ID) (bool, error) {
	var restricted bool
	err := s.db.R.QueryRowContext(ctx, `SELECT `+ageRestrictedSQL+` FROM servers s WHERE s.id = ?`, int64(id)).Scan(&restricted)
	return restricted, err
}
