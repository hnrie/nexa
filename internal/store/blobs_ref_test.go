package store

import (
	"context"
	"errors"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

// A reference taken on a row the collector has already deleted must say so,
// or the upload that took it hands out an id nothing can be read from.
func TestReferencingAGoneBlobSaysSo(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()
	if err := st.AddBlobRef(ctx, ids.New(), 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reference on a missing blob: got %v, want ErrNotFound", err)
	}
	b := &Blob{SHA256: "ab", Size: 1, Mime: "image/png", Kind: "avatar", RefCount: 1}
	if err := st.InsertBlob(ctx, b); err != nil {
		t.Fatal(err)
	}
	if err := st.AddBlobRef(ctx, b.ID, 1); err != nil {
		t.Fatalf("reference on a present blob: %v", err)
	}
}
