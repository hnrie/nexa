package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/store"
)

func TestHashVerify(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	phc, err := HashAuthKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(phc, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Errorf("unexpected format %s", phc)
	}
	ok, err := VerifyAuthKey(key, phc)
	if err != nil || !ok {
		t.Fatalf("verify: %v %v", ok, err)
	}
	ok, _ = VerifyAuthKey([]byte("wrong"), phc)
	if ok {
		t.Error("wrong key verified")
	}
	if _, err := VerifyAuthKey(key, "$argon2id$v=19$m=1,t=1$x"); err == nil {
		t.Error("malformed hash should error")
	}
	if _, err := HashAuthKey(nil); err == nil {
		t.Error("empty key should error")
	}
	phc2, _ := HashAuthKey(key)
	if phc2 == phc {
		t.Error("salts must differ")
	}
}

func TestTokens(t *testing.T) {
	tok, hash := NewToken()
	if len(tok) != 43 || strings.ContainsAny(tok, "+/=") {
		t.Errorf("token %q should be 43 chars of base64url", tok)
	}
	if HashToken(tok) != hash || len(hash) != 64 {
		t.Error("hash mismatch")
	}
	tok2, _ := NewToken()
	if tok2 == tok {
		t.Error("tokens must be unique")
	}
}

func newStore(t *testing.T) *store.Store {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return store.New(d)
}

func TestMiddleware(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()
	u := &store.User{Username: "a", DisplayName: "A", AuthHash: "h", KDFSalt: []byte{1}, KDFParams: "{}", PublicKey: []byte{1}, EncPrivateKey: []byte{1}}
	if err := st.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	tok, hash := NewToken()
	se := &store.Session{UserID: u.ID, TokenHash: hash, CreatedAt: time.Now().UnixMilli() - 10*time.Minute.Milliseconds(), LastSeenAt: time.Now().UnixMilli() - 10*time.Minute.Milliseconds()}
	if err := st.CreateSession(ctx, se); err != nil {
		t.Fatal(err)
	}
	a := &Authenticator{Store: st, TTL: 24 * time.Hour}
	var seen *store.User
	h := a.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = UserFrom(r.Context())
		if SessionFrom(r.Context()) == nil {
			t.Error("session missing from context")
		}
		w.WriteHeader(204)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/x", nil))
	if rec.Code != 401 || !strings.Contains(rec.Body.String(), `"unauthorized"`) {
		t.Errorf("no header: %d %s", rec.Code, rec.Body.String())
	}
	req := httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 204 || seen == nil || seen.ID != u.ID {
		t.Fatalf("valid token: %d %v", rec.Code, seen)
	}
	got, _ := st.SessionByID(ctx, se.ID)
	if got.LastSeenAt <= se.LastSeenAt {
		t.Error("session should have been touched")
	}
	// expired by TTL
	a2 := &Authenticator{Store: st, TTL: time.Minute}
	_ = st.TouchSession(ctx, se, "", time.Now().UnixMilli()-2*time.Minute.Milliseconds())
	rec = httptest.NewRecorder()
	a2.Middleware(h).ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Errorf("expired session should be 401, got %d", rec.Code)
	}
	if _, err := st.SessionByID(ctx, se.ID); err == nil {
		t.Error("expired session should be deleted")
	}
	// disabled user
	tok2, hash2 := NewToken()
	_ = st.CreateSession(ctx, &store.Session{UserID: u.ID, TokenHash: hash2})
	_ = st.SetUserFlags(ctx, u.ID, store.FlagDisabled)
	req.Header.Set("Authorization", "Bearer "+tok2)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Errorf("disabled user should be 401, got %d", rec.Code)
	}
}

func TestClientIP(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("CF-Connecting-IP", "203.0.113.5")
	if ClientIP(r) != "203.0.113.5" {
		t.Error("cf header from loopback should be trusted")
	}
	r.RemoteAddr = "198.51.100.7:99"
	if ClientIP(r) != "198.51.100.7" {
		t.Error("cf header from non-loopback must be ignored")
	}
	r.RemoteAddr = "127.0.0.1:1"
	r.Header.Del("CF-Connecting-IP")
	r.Header.Set("X-Forwarded-For", "10.1.1.1, 127.0.0.1")
	if ClientIP(r) != "127.0.0.1" {
		t.Error("untrusted XFF must not choose the visitor's rate-limit key")
	}
	r.Header.Set("CF-Connecting-IP", "invalid-client-address")
	if ClientIP(r) != "127.0.0.1" {
		t.Error("invalid proxy address must fall back to the peer")
	}
}
