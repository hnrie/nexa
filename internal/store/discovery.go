package store

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"evilion.xyz/chat/internal/ids"
)

// Discovery lists the servers their owners chose to show to everyone on
// Nexa, with nothing asked of them first. Nexa's staff can take one off
// (discovery_hidden).

// DiscoveryQuery picks and orders listed servers.
type DiscoveryQuery struct {
	// Query matches names, descriptions and tags.
	ShowNSFW bool
	NSFWOnly bool
	Query    string
	Category string
	Tag      string
	Language string
	// MinMembers and MaxMembers bound the member count; 0 for no bound.
	MinMembers int
	MaxMembers int
	// Sort is "members" (the default), "newest" (newest on the list first)
	// or "created" (newest servers first).
	Sort   string
	Offset int
	Limit  int
}

// Listed is a server as Discovery shows it.
type Listed struct {
	*Server
	MemberCount int `json:"member_count"`
}

// discoveryWhere is the condition every listed server meets.
const discoveryWhere = `s.discoverable = 1 AND s.discovery_hidden = 0`

// DiscoverServers lists servers on Discovery.
func (s *Store) DiscoverServers(ctx context.Context, q DiscoveryQuery) ([]*Listed, error) {
	if q.Limit <= 0 || q.Limit > 60 {
		q.Limit = 24
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	count := `(SELECT count(*) FROM server_members m WHERE m.server_id = s.id)`
	where := []string{discoveryWhere}
	if !q.ShowNSFW {
		where = append(where, "NOT "+ageRestrictedSQL)
	} else if q.NSFWOnly {
		where = append(where, ageRestrictedSQL)
	}
	var args []any
	if term := strings.ToLower(strings.TrimSpace(q.Query)); term != "" {
		like := "%" + escapeLike(term) + "%"
		where = append(where, `(`+s.db.Dialect.Lower("s.name")+` LIKE ? ESCAPE '\' OR `+s.db.Dialect.Lower("s.description")+` LIKE ? ESCAPE '\' OR `+s.db.Dialect.Lower("s.discovery_tags")+` LIKE ? ESCAPE '\')`)
		args = append(args, like, like, like)
	}
	if q.Category != "" {
		where = append(where, `s.discovery_category = ?`)
		args = append(args, q.Category)
	}
	if tag := strings.ToLower(strings.TrimSpace(q.Tag)); tag != "" {
		// tags are kept as a JSON list of lower-case words, each in quotes
		where = append(where, `s.discovery_tags LIKE ? ESCAPE '\'`)
		args = append(args, `%"`+escapeLike(tag)+`"%`)
	}
	if q.Language != "" {
		where = append(where, `s.discovery_language = ?`)
		args = append(args, q.Language)
	}
	if q.MinMembers > 0 {
		where = append(where, count+` >= ?`)
		args = append(args, q.MinMembers)
	}
	if q.MaxMembers > 0 {
		where = append(where, count+` <= ?`)
		args = append(args, q.MaxMembers)
	}
	order := count + ` DESC, s.id`
	switch q.Sort {
	case "newest":
		order = `coalesce(s.discovery_since, 0) DESC, s.id DESC`
	case "created":
		order = `s.id DESC`
	}
	query := `SELECT ` + prefixed("s", serverCols) + `, ` + prefixed("s", serverTagCols) + `, ` + prefixed("s", serverCommunityCols) + `, ` + count +
		` FROM servers s WHERE ` + strings.Join(where, " AND ") + ` ORDER BY ` + order + ` LIMIT ? OFFSET ?`
	args = append(args, q.Limit, q.Offset)
	rows, err := s.db.R.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Listed{}
	for rows.Next() {
		l, err := scanListed(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ListedServer loads one server as Discovery shows it; ErrNotFound when it is
// not on the list.
func (s *Store) ListedServer(ctx context.Context, id ids.ID) (*Listed, error) {
	return scanListed(s.db.R.QueryRowContext(ctx, `SELECT `+prefixed("s", serverCols)+`, `+prefixed("s", serverTagCols)+`, `+prefixed("s", serverCommunityCols)+`,
		(SELECT count(*) FROM server_members m WHERE m.server_id = s.id) FROM servers s WHERE s.id = ? AND `+discoveryWhere, int64(id)))
}

func scanListed(r rowScanner) (*Listed, error) {
	l := &Listed{}
	srv, err := scanServerTagged(extraScanner{r, []any{&l.MemberCount}})
	if err != nil {
		return nil, err
	}
	l.Server = srv
	return l, nil
}

// extraScanner reads more columns, after what the wrapped scan asks for.
type extraScanner struct {
	r    rowScanner
	more []any
}

func (e extraScanner) Scan(dest ...any) error {
	return e.r.Scan(append(dest, e.more...)...)
}

// DiscoveryCategoryCounts says how many listed servers each category has.
func (s *Store) DiscoveryCategoryCounts(ctx context.Context, showNSFW ...bool) (map[string]int, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT s.discovery_category, count(*) FROM servers s WHERE `+discoveryVisibility(showNSFW)+` GROUP BY s.discovery_category`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var cat string
		var n int
		if err := rows.Scan(&cat, &n); err != nil {
			return nil, err
		}
		out[cat] = n
	}
	return out, rows.Err()
}

// PopularDiscoveryTags lists the tags listed servers use most, for suggesting them.
func (s *Store) PopularDiscoveryTags(ctx context.Context, limit int, showNSFW ...bool) ([]string, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT s.discovery_tags FROM servers s WHERE `+discoveryVisibility(showNSFW)+` AND s.discovery_tags <> '' LIMIT 2000`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		for _, t := range parseTagList(raw) {
			counts[t]++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(counts))
	for t := range counts {
		out = append(out, t)
	}
	sortByCount(out, counts)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func parseTagList(raw string) []string {
	var list []string
	if raw == "" || json.Unmarshal([]byte(raw), &list) != nil {
		return nil
	}
	return list
}

// sortByCount orders words by how often they were counted, most first, then alphabetically.
func sortByCount(words []string, counts map[string]int) {
	sort.Slice(words, func(i, j int) bool {
		if counts[words[i]] != counts[words[j]] {
			return counts[words[i]] > counts[words[j]]
		}
		return words[i] < words[j]
	})
}

func discoveryVisibility(show []bool) string {
	if len(show) > 0 && show[0] {
		return discoveryWhere
	}
	return discoveryWhere + " AND NOT " + ageRestrictedSQL
}
