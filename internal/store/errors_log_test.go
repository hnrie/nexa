package store

import (
	"context"
	"testing"
)

// The crash log stays bounded, but the trim is a full scan and this endpoint is
// the one most likely to be hit in a loop — a render error that re-renders and
// crashes again — so it runs every so often rather than on every insert.
func TestClientErrorLogStaysBounded(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	for i := 0; i < KeepClientErrors+trimSlack*2; i++ {
		if err := s.RecordClientError(ctx, &ClientError{Kind: "error", Message: "boom"}); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM client_errors`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n > KeepClientErrors+trimSlack {
		t.Errorf("%d reports kept, want at most %d", n, KeepClientErrors+trimSlack)
	}
	if n < KeepClientErrors {
		t.Errorf("%d reports kept, want at least the cap of %d", n, KeepClientErrors)
	}
	// and what the admin page reads is never more than the cap
	list, err := s.RecentClientErrors(ctx, KeepClientErrors)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) > KeepClientErrors {
		t.Errorf("admin view returned %d", len(list))
	}
}
