# Evilion Chat — Phase 0–1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `chat.evilion.xyz` with accounts, end-to-end-encrypted DMs and group DMs, friends, profiles, settings, and the Discord-shaped app shell on desktop and phone, running as a launchd service behind the Cloudflare tunnel.

**Architecture:** One Go binary (`chatd`) serves the REST API, the WebSocket gateway, media blobs and the built SPA from SQLite + local blob storage. The React/TypeScript SPA does all encryption client-side (Argon2id → X25519 identity → per-conversation root keys → AES-GCM message envelopes) and keeps decrypted state in zustand stores. Servers/roles/permissions arrive in Phase 2; this phase lays every table and interface they need.

**Tech Stack:** Go 1.27 (stdlib `net/http` mux, `modernc.org/sqlite`, `github.com/coder/websocket`, `golang.org/x/crypto/argon2`, `golang.org/x/image/webp`, `golang.org/x/net/html`, `golang.org/x/time/rate`); Node 22 + Vite 6 + React 18 + TypeScript strict; `zustand`, `react-router-dom` 6, `@tanstack/react-virtual`, `@noble/curves`, `@noble/hashes`, `hash-wasm`, `emojibase-data`, `highlight.js`, `lucide-react`, `@fontsource/noto-sans`, `@fontsource/jetbrains-mono`; `vitest` + `@testing-library/react`; Playwright (Python venv) for screenshots/e2e.

**Spec:** `docs/superpowers/specs/2026-09-11-chat-design.md` (read §2 architecture, §4 data model, §5 server internals, §6 encryption, §7 frontend, §9 tokens, §10 deployment before starting any task).

## Global Constraints

- Go module path `evilion.xyz/chat`; `go 1.27`; only the dependencies listed above (all pure Go, no cgo). `go vet ./...` and `go test -race ./...` must pass before every commit.
- Web: `"strict": true`, `noUncheckedIndexedAccess: true`; `npm run typecheck` (`tsc --noEmit`) and `npm test` (vitest) must pass before every commit. No `any` outside `*.d.ts`.
- Never copy a Discord asset, font, logo, sound or string; use Noto Sans / JetBrains Mono / lucide icons; sounds are synthesised.
- IDs are snowflakes serialised as JSON strings everywhere (Go `ids.ID` marshals to string; TS treats ids as `string`).
- All timestamps are Unix milliseconds (`int64` / `number`).
- Server listens on `127.0.0.1:8090` by default; public URL `https://chat.evilion.xyz`; uploads ≤ 104857600 bytes.
- Every REST error is `{"error":{"code":"snake_case","message":"human text"}}` with a matching HTTP status.
- Every mutating endpoint checks authorisation server-side; the client never decides access.
- Commit after every task with a conventional message (`feat:`, `fix:`, `test:`, `chore:`, `docs:`) and the attribution trailer used in this repo.
- Compile-heavy tooling is forbidden (no brew builds, no cgo); prebuilt Node lives at `/usr/local/lib/nodejs/current`.

## File structure

```
chat/
├── go.mod, go.sum, Makefile, chatd.env.example, README.md
├── cmd/chatd/main.go                       wiring: config → db → store → hub → api → http server → signals
├── internal/config/config.go|_test.go      Config struct, Load(getenv), LoadEnvFile(path)
├── internal/ids/ids.go|_test.go            ID type, generator, JSON string marshalling
├── internal/db/db.go|_test.go              Open (WAL pragmas), writer/reader pools, Tx helper, Migrate
├── internal/db/migrations/0001_init.sql    full schema (spec §4)
├── internal/store/{store.go,models.go,users.go,sessions.go,channels.go,messages.go,
│                   relationships.go,keys.go,readstates.go,blobs.go,settings.go}(+_test.go)
├── internal/auth/{password.go,tokens.go,middleware.go}(+_test.go)
├── internal/ratelimit/limiter.go|_test.go
├── internal/media/{store.go,validate.go,handler.go}(+_test.go)
├── internal/unfurl/{guard.go,fetch.go,handler.go}(+_test.go)
├── internal/gateway/{protocol.go,hub.go,conn.go,presence.go,handler.go}(+_test.go)
├── internal/api/{router.go,respond.go,errors.go,middleware.go,auth_handlers.go,user_handlers.go,
│                 channel_handlers.go,message_handlers.go,relationship_handlers.go,key_handlers.go,
│                 static.go}(+_test.go, testutil_test.go)
├── deploy/{xyz.evilion.chat.plist.in,install.sh,route-dns.sh,README.md}
├── tools/{screenshot.py,e2e.py,requirements.txt}
└── web/
    ├── package.json, vite.config.ts, tsconfig.json, index.html, public/manifest.webmanifest
    └── src/
        ├── main.tsx, App.tsx, routes.tsx
        ├── api/{client.ts,types.ts,auth.ts,users.ts,channels.ts,messages.ts,relationships.ts,keys.ts,unfurl.ts}
        ├── gateway/{client.ts,events.ts,dispatch.ts}
        ├── crypto/{bytes.ts,kdf.ts,keys.ts,conv.ts,message.ts,file.ts,keystore.ts,worker.ts}(+.test.ts)
        ├── markdown/{tokenize.ts,parse.ts,ast.ts,render.tsx}(+.test.ts)
        ├── stores/{auth.ts,users.ts,channels.ts,messages.ts,relationships.ts,readStates.ts,
        │           typing.ts,presence.ts,settings.ts,ui.ts,keys.ts}(+.test.ts)
        ├── lib/{time.ts,idb.ts,sounds.ts,notify.ts,shortcuts.ts,format.ts}
        ├── components/{shell,rail,sidebar,chat,composer,members,profile,settings,modals,pickers,common}/…
        ├── pages/{LoginPage,RegisterPage,RecoverPage,FriendsPage,DMPage,AppPage}.tsx
        └── styles/{tokens.css,base.css,fonts.css}
```

---

### Task 1: Go module, config, health endpoint, Makefile

**Files:**
- Create: `go.mod`, `Makefile`, `chatd.env.example`, `cmd/chatd/main.go`, `internal/config/config.go`, `internal/config/config_test.go`, `.gitignore` (exists)

**Interfaces:**
- Produces: `config.Config` struct and `config.Load(getenv func(string) string) (Config, error)`, `config.LoadEnvFile(path string) (map[string]string, error)`; `main` starts an HTTP server answering `GET /api/health` → `{"ok":true,"version":"<ldflags var>"}`.

- [ ] **Step 1: Write the failing config tests**

```go
// internal/config/config_test.go
package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	c, err := Load(func(string) string { return "" })
	if err != nil { t.Fatal(err) }
	if c.Listen != "127.0.0.1:8090" { t.Errorf("Listen = %q", c.Listen) }
	if c.PublicURL != "https://chat.evilion.xyz" { t.Errorf("PublicURL = %q", c.PublicURL) }
	if c.MaxUploadBytes != 104857600 { t.Errorf("MaxUploadBytes = %d", c.MaxUploadBytes) }
	if c.Registration != "open" { t.Errorf("Registration = %q", c.Registration) }
	if c.SessionTTL != 90*24*time.Hour { t.Errorf("SessionTTL = %v", c.SessionTTL) }
}

func TestLoadOverridesAndValidation(t *testing.T) {
	env := map[string]string{"LISTEN": "127.0.0.1:9000", "MAX_UPLOAD_BYTES": "10", "REGISTRATION": "invite", "TURN_URLS": "turn:a:3478,turns:b:5349"}
	c, err := Load(func(k string) string { return env[k] })
	if err != nil { t.Fatal(err) }
	if c.Listen != "127.0.0.1:9000" || c.MaxUploadBytes != 10 || c.Registration != "invite" { t.Errorf("overrides not applied: %+v", c) }
	if len(c.TurnURLs) != 2 || c.TurnURLs[1] != "turns:b:5349" { t.Errorf("TurnURLs = %v", c.TurnURLs) }
	_, err = Load(func(k string) string { if k == "REGISTRATION" { return "sometimes" }; return "" })
	if err == nil { t.Error("expected error for bad REGISTRATION") }
	_, err = Load(func(k string) string { if k == "MAX_UPLOAD_BYTES" { return "abc" }; return "" })
	if err == nil { t.Error("expected error for bad MAX_UPLOAD_BYTES") }
}

func TestLoadEnvFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "chatd.env")
	os.WriteFile(p, []byte("# comment\nLISTEN=127.0.0.1:1\n\nPUBLIC_URL = \"http://x\"\nexport TENOR_API_KEY='k'\n"), 0o600)
	m, err := LoadEnvFile(p)
	if err != nil { t.Fatal(err) }
	if m["LISTEN"] != "127.0.0.1:1" || m["PUBLIC_URL"] != "http://x" || m["TENOR_API_KEY"] != "k" { t.Errorf("parsed %v", m) }
	if _, err := LoadEnvFile(filepath.Join(t.TempDir(), "missing")); err == nil { t.Error("missing file should error") }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /path/to/nexa && go test ./internal/config/` — Expected: build failure (package missing).

- [ ] **Step 3: Implement config**

```go
// internal/config/config.go
package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Listen          string
	PublicURL       string
	DataDir         string
	WebDist         string
	MaxUploadBytes  int64
	MaxAvatarBytes  int64
	MaxEmojiBytes   int64
	MaxStickerBytes int64
	Registration    string // open | invite | closed
	AdminUsername   string
	TurnURLs        []string
	TurnUsername    string
	TurnCredential  string
	TenorAPIKey     string
	LogLevel        string
	SessionTTL      time.Duration
}

func Load(getenv func(string) string) (Config, error) {
	c := Config{Listen: "127.0.0.1:8090", PublicURL: "https://chat.evilion.xyz", DataDir: "./data", WebDist: "./web/dist",
		MaxUploadBytes: 104857600, MaxAvatarBytes: 10 << 20, MaxEmojiBytes: 2 << 20, MaxStickerBytes: 5 << 20,
		Registration: "open", LogLevel: "info", SessionTTL: 90 * 24 * time.Hour}
	str := func(k string, dst *string) { if v := getenv(k); v != "" { *dst = v } }
	str("LISTEN", &c.Listen); str("PUBLIC_URL", &c.PublicURL); str("DATA_DIR", &c.DataDir); str("WEB_DIST", &c.WebDist)
	str("REGISTRATION", &c.Registration); str("ADMIN_USERNAME", &c.AdminUsername); str("TURN_USERNAME", &c.TurnUsername)
	str("TURN_CREDENTIAL", &c.TurnCredential); str("TENOR_API_KEY", &c.TenorAPIKey); str("LOG_LEVEL", &c.LogLevel)
	for _, kv := range []struct{ k string; dst *int64 }{{"MAX_UPLOAD_BYTES", &c.MaxUploadBytes}, {"MAX_AVATAR_BYTES", &c.MaxAvatarBytes}, {"MAX_EMOJI_BYTES", &c.MaxEmojiBytes}, {"MAX_STICKER_BYTES", &c.MaxStickerBytes}} {
		if v := getenv(kv.k); v != "" {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil || n <= 0 { return c, fmt.Errorf("%s: expected a positive integer, got %q", kv.k, v) }
			*kv.dst = n
		}
	}
	if v := getenv("SESSION_TTL_DAYS"); v != "" {
		n, err := strconv.Atoi(v); if err != nil || n <= 0 { return c, fmt.Errorf("SESSION_TTL_DAYS: expected a positive integer, got %q", v) }
		c.SessionTTL = time.Duration(n) * 24 * time.Hour
	}
	if v := getenv("TURN_URLS"); v != "" {
		for _, u := range strings.Split(v, ",") { if u = strings.TrimSpace(u); u != "" { c.TurnURLs = append(c.TurnURLs, u) } }
	}
	switch c.Registration { case "open", "invite", "closed": default: return c, fmt.Errorf("REGISTRATION: expected open|invite|closed, got %q", c.Registration) }
	c.PublicURL = strings.TrimRight(c.PublicURL, "/")
	return c, nil
}

// LoadEnvFile parses KEY=VALUE lines (optional `export `, optional quotes, # comments).
func LoadEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path); if err != nil { return nil, err }
	defer f.Close()
	m := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") { continue }
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "="); if !ok { continue }
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' && v[len(v)-1] == '"' || v[0] == '\'' && v[len(v)-1] == '\'') { v = v[1 : len(v)-1] }
		m[k] = v
	}
	return m, sc.Err()
}
```

`cmd/chatd/main.go` (this task's version; later tasks extend it):

```go
package main

import (
	"context"; "encoding/json"; "errors"; "flag"; "log/slog"; "net/http"; "os"; "os/signal"; "syscall"; "time"
	"evilion.xyz/chat/internal/config"
)

var version = "dev" // set with -ldflags "-X main.version=…"

func main() {
	envFile := flag.String("env", "chatd.env", "env file (optional)")
	flag.Parse()
	fileEnv, _ := config.LoadEnvFile(*envFile)
	getenv := func(k string) string { if v := os.Getenv(k); v != "" { return v }; return fileEnv[k] }
	cfg, err := config.Load(getenv)
	if err != nil { slog.Error("config", "err", err); os.Exit(2) }
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "version": version})
	})
	srv := &http.Server{Addr: cfg.Listen, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { slog.Info("listening", "addr", cfg.Listen, "version", version); if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) { slog.Error("serve", "err", err); os.Exit(1) } }()
	stop := make(chan os.Signal, 1); signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM); <-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second); defer cancel()
	_ = srv.Shutdown(ctx)
}
```

`Makefile`:

```make
GO ?= go
NODE_BIN ?= /usr/local/lib/nodejs/current/bin
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)
.PHONY: build web server test check run
build: web server
web: ; cd web && PATH="$(NODE_BIN):$$PATH" npm ci --no-audit --no-fund && PATH="$(NODE_BIN):$$PATH" npm run build
server: ; $(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o bin/chatd ./cmd/chatd
test: ; $(GO) vet ./... && $(GO) test -race ./... && cd web && PATH="$(NODE_BIN):$$PATH" npm run typecheck && PATH="$(NODE_BIN):$$PATH" npm test -- --run
run: server ; ./bin/chatd
```

`chatd.env.example` lists every key from spec §10.2 with its default and a one-line comment.

- [ ] **Step 4: Run tests, build, smoke the health route**

Run: `go mod init evilion.xyz/chat && go test ./... && go build -o bin/chatd ./cmd/chatd && (./bin/chatd & sleep 1; curl -s localhost:8090/api/health; kill %1)` — Expected: tests PASS; `{"ok":true,"version":"dev"}`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: chatd skeleton with config loading and health route"`

---

### Task 2: Snowflake ids

**Files:** Create `internal/ids/ids.go`, `internal/ids/ids_test.go`

**Interfaces:**
- Produces: `type ID int64`; `func New() ID` (process-global generator); `func Parse(s string) (ID, error)`; `func (id ID) String() string`; `func (id ID) Time() time.Time`; `func (id ID) MarshalJSON()/UnmarshalJSON` (string form; UnmarshalJSON also accepts a bare number); `func (id ID) IsZero() bool`; `const Epoch int64 = 1767225600000` (2026-01-01T00:00:00Z ms); `func FromTime(t time.Time) ID` (lowest id at that ms — for "before this time" queries).

- [ ] **Step 1: Tests**

```go
package ids

import ("encoding/json"; "testing"; "time")

func TestNewIsMonotonicAndUnique(t *testing.T) {
	seen := map[ID]bool{}; var last ID
	for i := 0; i < 20000; i++ { id := New(); if id <= last { t.Fatalf("not increasing at %d: %d <= %d", i, id, last) }; if seen[id] { t.Fatal("dup") }; seen[id] = true; last = id }
}
func TestTimeRoundTrip(t *testing.T) {
	before := time.Now().Truncate(time.Millisecond); id := New()
	if id.Time().Before(before) || id.Time().After(time.Now().Add(time.Second)) { t.Errorf("time %v out of range", id.Time()) }
	if FromTime(id.Time()) > id { t.Error("FromTime should be <= id at same ms") }
}
func TestJSON(t *testing.T) {
	id := ID(123456789012345678)
	b, _ := json.Marshal(struct{ ID ID `json:"id"`; P *ID `json:"p"` }{id, nil})
	if string(b) != `{"id":"123456789012345678","p":null}` { t.Errorf("got %s", b) }
	var out struct{ ID ID `json:"id"` }
	if err := json.Unmarshal([]byte(`{"id":"42"}`), &out); err != nil || out.ID != 42 { t.Errorf("string unmarshal: %v %d", err, out.ID) }
	if err := json.Unmarshal([]byte(`{"id":42}`), &out); err != nil || out.ID != 42 { t.Errorf("number unmarshal: %v", err) }
	if err := json.Unmarshal([]byte(`{"id":"x"}`), &out); err == nil { t.Error("expected error") }
	if _, err := Parse("-1"); err == nil { t.Error("negative should fail") }
}
```

- [ ] **Step 2: Run → fails.** `go test ./internal/ids/`

- [ ] **Step 3: Implement** — 41 bits ms since Epoch << 22 | node(10 bits, 0) << 12 | seq(12 bits). Generator holds `mu sync.Mutex; lastMs int64; seq int64`; when seq overflows within one ms, spin until the next ms; if the clock goes backwards, keep using `lastMs`. `Parse` uses `strconv.ParseInt(s, 10, 64)` and rejects `< 0`. `UnmarshalJSON` checks for a leading `"` to choose string vs number.

- [ ] **Step 4: Run → passes.** `go test -race ./internal/ids/`

- [ ] **Step 5: Commit** — `git commit -am "feat: snowflake ids"`

---

### Task 3: SQLite database layer and initial schema

**Files:** Create `internal/db/db.go`, `internal/db/db_test.go`, `internal/db/migrations/0001_init.sql`; Modify `go.mod` (add `modernc.org/sqlite`).

**Interfaces:**
- Produces: `type DB struct { W *sql.DB; R *sql.DB }`; `func Open(path string) (*DB, error)` (creates parent dir; `W` has `SetMaxOpenConns(1)`; both apply pragmas `journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000, temp_store=MEMORY`); `func (d *DB) Migrate(ctx) error` (applies `migrations/NNNN_*.sql` in order, tracked with `PRAGMA user_version`, each file in one transaction); `func (d *DB) Tx(ctx, fn func(tx *sql.Tx) error) error` (on `W`, rollback on error/panic); `func (d *DB) Close() error` (checkpoints WAL: `PRAGMA wal_checkpoint(TRUNCATE)`).

- [ ] **Step 1: Tests**

```go
package db

import ("context"; "path/filepath"; "testing")

func TestOpenMigrateIdempotent(t *testing.T) {
	p := filepath.Join(t.TempDir(), "sub", "chat.db")
	d, err := Open(p); if err != nil { t.Fatal(err) }
	defer d.Close()
	ctx := context.Background()
	if err := d.Migrate(ctx); err != nil { t.Fatal(err) }
	if err := d.Migrate(ctx); err != nil { t.Fatal("second migrate:", err) }
	var v int; d.R.QueryRow("PRAGMA user_version").Scan(&v); if v < 1 { t.Errorf("user_version = %d", v) }
	var mode string; d.R.QueryRow("PRAGMA journal_mode").Scan(&mode); if mode != "wal" { t.Errorf("journal_mode = %s", mode) }
	var fk int; d.W.QueryRow("PRAGMA foreign_keys").Scan(&fk); if fk != 1 { t.Error("foreign keys off") }
	for _, tbl := range []string{"users","sessions","user_settings","relationships","servers","server_members","roles","member_roles","channels","channel_overwrites","dm_participants","messages","attachments","reactions","pins","read_states","invites","bans","audit_log","emojis","sticker_packs","stickers","sticker_installs","blobs","key_epochs","key_grants","key_flags"} {
		var n int; if err := d.R.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", tbl).Scan(&n); err != nil || n != 1 { t.Errorf("table %s missing", tbl) }
	}
}

func TestTxRollback(t *testing.T) {
	d, _ := Open(filepath.Join(t.TempDir(), "x.db")); defer d.Close(); ctx := context.Background(); d.Migrate(ctx)
	err := d.Tx(ctx, func(tx *sql.Tx) error { tx.Exec("INSERT INTO blobs(id,sha256,size,mime,kind,encrypted,ref_count,created_at) VALUES(1,'a',1,'x','avatar',0,1,0)"); return errors.New("boom") })
	if err == nil { t.Fatal("expected error") }
	var n int; d.R.QueryRow("SELECT count(*) FROM blobs").Scan(&n); if n != 0 { t.Error("rollback failed") }
}
```
(add `database/sql` and `errors` imports.)

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** `db.go` (driver name `"sqlite"`, DSN `file:<path>?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)&_pragma=temp_store(MEMORY)`; migrations via `embed.FS`, sorted by name, parse leading number, skip `<= user_version`, `Exec` the file inside `Tx`, then `PRAGMA user_version = N` inside the same tx) and write `0001_init.sql` with exactly the tables, columns and indexes of spec §4 (use `INTEGER PRIMARY KEY` for snowflake ids, `TEXT` for strings, `BLOB` for binary, `INTEGER` for bools/ms; composite primary keys on join tables; `ON DELETE CASCADE` from messages→channels, attachments→messages, reactions→messages, member_roles→roles, key_grants→key_epochs (conv_id, epoch), dm_participants→channels, server_members→servers, channel_overwrites→channels, pins→messages, sticker_installs→sticker_packs, stickers→sticker_packs). Include `polls` and `poll_votes` now (P2 uses them).

- [ ] **Step 4: Run → passes.** `go test -race ./internal/db/`

- [ ] **Step 5: Commit** — `git commit -am "feat: sqlite layer with WAL pragmas, migrations, initial schema"`

---

### Task 4: Store — users, sessions, settings, blobs

**Files:** Create `internal/store/store.go`, `models.go`, `users.go`, `sessions.go`, `settings.go`, `blobs.go`, `users_test.go`, `sessions_test.go`, `testutil_test.go`.

**Interfaces:**
- Produces:
  - `store.New(d *db.DB) *Store`
  - `models.go`: `User` (fields per spec §4 with json tags; private fields `json:"-"`), `PublicUser` view via `func (u *User) Public() PublicUser` (id, username, display_name, avatar_id, banner_id, about_me, pronouns, accent_color, status_text, status_emoji, status_expires_at, public_key, flags, created_at), `Session{ID, UserID, TokenHash, UserAgent, IP, CreatedAt, LastSeenAt}`, `Blob{ID, SHA256, Size, Mime, Kind, Encrypted bool, RefCount, CreatedAt}`, `Settings{Blob []byte, Version int64, UpdatedAt int64}`.
  - `users.go`: `CreateUser(ctx, *User) error` (returns `ErrUsernameTaken`), `UserByID(ctx, ids.ID) (*User, error)` (`ErrNotFound`), `UserByUsername(ctx, string)`, `UpdateProfile(ctx, id, ProfilePatch) error` where `ProfilePatch{DisplayName, AboutMe, Pronouns *string; AccentColor **int; AvatarID, BannerID **ids.ID; StatusText, StatusEmoji *string; StatusExpiresAt **int64; PresencePref *string; Username *string}`, `UpdateAuth(ctx, id, authHash string, encPriv []byte, encPrivRecovery []byte, recoveryHash string) error`, `UsersByIDs(ctx, []ids.ID) (map[ids.ID]*User, error)`, `SearchUsers(ctx, q string, limit int) ([]*User, error)` (prefix on username/display_name), `CountUsers(ctx) (int, error)`, `SetUserFlags(ctx, id, flags int64) error`.
  - `sessions.go`: `CreateSession(ctx, *Session) error`, `SessionByTokenHash(ctx, hash string) (*Session, error)`, `TouchSession(ctx, id, lastSeen int64) error`, `DeleteSession(ctx, id) error`, `DeleteUserSessions(ctx, userID, exceptID ids.ID) error`, `SessionsByUser(ctx, userID) ([]*Session, error)`.
  - `settings.go`: `GetSettings(ctx, userID) (*Settings, error)` (nil,nil when none), `PutSettings(ctx, userID, blob []byte, ifVersion int64) (newVersion int64, err error)` (`ErrConflict` when version mismatch; ifVersion 0 = create).
  - `blobs.go`: `BlobBySHA(ctx, sha) (*Blob, error)`, `InsertBlob(ctx, *Blob) error`, `BlobByID`, `AddBlobRef(ctx, id, delta int) error`, `UnreferencedBlobs(ctx, olderThan int64) ([]*Blob, error)`, `DeleteBlob(ctx, id)`.
  - Errors: `var ErrNotFound, ErrUsernameTaken, ErrConflict = errors.New(...)`.

- [ ] **Step 1: Tests** (`testutil_test.go` has `func newStore(t *testing.T) *Store` opening a temp db + migrate). Cover: create user → fetch by id/username → username taken → profile patch (set and clear avatar via `**ids.ID`) → `Public()` hides hashes; sessions create/lookup/delete/list; settings version conflict; blob ref counting and `UnreferencedBlobs`.

```go
func TestUsersCRUD(t *testing.T) {
	s := newStore(t); ctx := context.Background()
	u := &User{ID: ids.New(), Username: "alice", DisplayName: "Alice", AuthHash: "h", KDFSalt: []byte{1}, KDFParams: `{"m":65536,"t":3,"p":1,"v":1}`, PublicKey: make([]byte, 32), EncPrivateKey: []byte{2}, CreatedAt: 1}
	if err := s.CreateUser(ctx, u); err != nil { t.Fatal(err) }
	if err := s.CreateUser(ctx, &User{ID: ids.New(), Username: "alice", DisplayName: "x", CreatedAt: 1}); !errors.Is(err, ErrUsernameTaken) { t.Errorf("want ErrUsernameTaken, got %v", err) }
	got, err := s.UserByUsername(ctx, "alice"); if err != nil || got.ID != u.ID { t.Fatal(err) }
	av := ids.New(); avp := &av
	if err := s.UpdateProfile(ctx, u.ID, ProfilePatch{AvatarID: &avp, AboutMe: ptr("hi")}); err != nil { t.Fatal(err) }
	got, _ = s.UserByID(ctx, u.ID); if got.AvatarID == nil || *got.AvatarID != av || got.AboutMe != "hi" { t.Errorf("patch not applied: %+v", got) }
	var nilID *ids.ID
	if err := s.UpdateProfile(ctx, u.ID, ProfilePatch{AvatarID: &nilID}); err != nil { t.Fatal(err) }
	got, _ = s.UserByID(ctx, u.ID); if got.AvatarID != nil { t.Error("avatar should be cleared") }
	b, _ := json.Marshal(got.Public()); if strings.Contains(string(b), "auth") || strings.Contains(string(b), `"h"`) { t.Errorf("public view leaks: %s", b) }
	if _, err := s.UserByID(ctx, ids.ID(1)); !errors.Is(err, ErrNotFound) { t.Error("want ErrNotFound") }
}
```
(plus analogous tests for sessions, settings, blobs — write them fully.)

- [ ] **Step 2: Run → fails.** — [ ] **Step 3: Implement** with plain `database/sql` queries (`?` placeholders, `INSERT … ON CONFLICT(username) DO NOTHING` + rows-affected check for `ErrUsernameTaken`; nullable columns scanned through `sql.NullInt64`/`sql.NullString`). — [ ] **Step 4: Run → passes** (`go test -race ./internal/store/`). — [ ] **Step 5: Commit** — `git commit -am "feat: store for users, sessions, settings, blobs"`.

---

### Task 5: Auth primitives, rate limiter, HTTP scaffolding (router, JSON, errors, middleware)

**Files:** Create `internal/auth/password.go`, `tokens.go`, `middleware.go` (+tests); `internal/ratelimit/limiter.go` (+test); `internal/api/router.go`, `respond.go`, `errors.go`, `middleware.go`, `testutil_test.go`.

**Interfaces:**
- `auth.HashAuthKey(authKey []byte) (string, error)` → PHC string `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`; `auth.VerifyAuthKey(authKey []byte, phc string) (bool, error)` (constant time); `auth.NewToken() (token string, hash string)` (32 random bytes → base64url token; hash = hex(sha256(token))); `auth.HashToken(token string) string`.
- `auth.Middleware(st *store.Store) func(http.Handler) http.Handler`: reads `Authorization: Bearer`, loads session by hash, rejects expired (`created_at + ttl < now`... TTL passed in), touches `last_seen_at` at most once per 5 minutes, puts `*store.User` and `*store.Session` in context; `auth.UserFrom(ctx) *store.User`, `auth.SessionFrom(ctx)`. Returns 401 `{"error":{"code":"unauthorized"}}` when missing/invalid.
- `ratelimit.Limiter`: `New(r rate.Limit, burst int, ttl time.Duration) *Limiter`; `Allow(key string) (ok bool, retryAfter time.Duration)`; entries expire after `ttl` idle (sweeper goroutine started with `Start(ctx)`).
- `api.Server{Cfg, Store, Hub (later), Media (later), …}`; `func (s *Server) Handler() http.Handler` returning the mux; `api.WriteJSON(w, status, v)`; `api.WriteError(w, status, code, msg)`; `api.ReadJSON(r, dst, maxBytes) error`; error helpers `ErrBadRequest(code,msg)` etc.; middleware: `RequestID`, `Logging` (slog: method, path, status, ms, req id), `Recover` (500 with req id), `BodyLimit(n)`, `SecurityHeaders(cfg)` (CSP etc. per spec §5.7), `RateLimit(limiter, keyFunc)`.
- `testutil_test.go`: `newTestServer(t) (*Server, *httptest.Server)` with temp db; helpers `do(t, srv, method, path, token, body) (*http.Response, map[string]any)`.

- [ ] **Step 1: Tests** — argon2 round trip + wrong key false + PHC parse of tampered string errors; token hash stable and 43-char base64url; middleware 401 without header, 200 with a real session and user in context, 401 when session deleted; limiter allows `burst` then denies with retryAfter > 0 and recovers after refill; router `GET /api/health` and unknown `/api/v1/nope` → 404 JSON error envelope; CSP header present on `/`.

- [ ] **Step 2: Run → fails.** — [ ] **Step 3: Implement.** Argon2id parameters m=19456 KiB, t=2, p=1, 16-byte salt, 32-byte output (`argon2.IDKey`). PHC encoding with `base64.RawStdEncoding`. — [ ] **Step 4: Run → passes.** — [ ] **Step 5: Commit** — `git commit -am "feat: auth primitives, rate limiter, API scaffolding"`.

---

### Task 6: Auth and user endpoints

**Files:** Create `internal/api/auth_handlers.go`, `user_handlers.go`, `auth_handlers_test.go`, `user_handlers_test.go`; Modify `router.go`.

**Interfaces (REST, all under `/api/v1`):**
- `POST /auth/register` body `{username, display_name, auth_key, kdf_salt, kdf_params, public_key, enc_private_key, enc_private_key_recovery, recovery_auth_key}` (binary fields base64 std). Validates username `^[a-z0-9_.]{2,32}$` (no leading/trailing `.`, no `..`), display name 1–32 (trimmed, no control chars), `auth_key` 32 bytes, `public_key` 32 bytes, `kdf_params` parses as `{m,t,p,v}` with m ≥ 65536 (KiB), t ≥ 2, wrapped keys ≤ 256 bytes. Honors `cfg.Registration` (`closed` → 403 `registration_closed`; `invite` → requires `invite_code` valid — Phase 2 wires the check; Phase 1 accepts a `REGISTRATION_KEY` env compare). First user ever (`CountUsers==0`) or username == `cfg.AdminUsername` gets `FlagAdmin = 1`. Creates session. Returns 201 `{user: PublicUser, token}`. Rate limit 3/hour per IP.
- `GET /auth/kdf?username=` → `{salt, params}`; unknown username → deterministic fake `salt = sha256(serverSecret || username)[:16]`, default params (server secret = random 32 bytes generated once and stored in `data/server.secret`, 0600).
- `POST /auth/login` `{username, auth_key}` → `{user, token, enc_private_key, public_key, kdf_salt, kdf_params}`; 401 `invalid_credentials` for both unknown user and bad key; minimum 300 ms response; limiter 5/min per IP and per username.
- `POST /auth/recover` `{username, recovery_auth_key, new_auth_key, new_enc_private_key, new_recovery_auth_key?, new_enc_private_key_recovery?}` → verifies recovery hash, replaces auth hash + wrapped key (+ optional new recovery pair), deletes all sessions, returns `{user, token, enc_private_key}`; if the account has no recovery hash → 400 `no_recovery_key`.
- `POST /auth/password` (authed) `{auth_key, new_auth_key, new_enc_private_key}` → verifies, updates, deletes other sessions → 204.
- `POST /auth/logout` → deletes current session → 204. `GET /auth/sessions` → `[{id, user_agent, ip, created_at, last_seen_at, current}]`; `DELETE /auth/sessions/{id}` → 204 (own sessions only).
- `GET /users/@me` → `PublicUser` + `{private: {flags, has_recovery}}`; `PATCH /users/@me` body any of `{username, display_name, about_me, pronouns, accent_color, status_text, status_emoji, status_expires_at, presence_pref}` (nulls clear) → updated user, and the handler calls `s.Hub.EmitUserUpdate(user)` (a no-op interface until Task 9 — define `type Broadcaster interface { UserUpdated(u *store.User); … }` in `api` now with a `noopBroadcaster`). `GET /users/{id}` → `PublicUser` (404 unknown). `GET /users/{id}/profile` → `{user, mutual_friends: [ids], mutual_servers: []}` (servers empty until Phase 2). `GET /users/search?q=` → up to 10 `PublicUser` (min 2 chars).
- `GET /users/@me/settings` → `{blob (base64), version}` or 204; `PUT /users/@me/settings` `{blob, version}` → `{version}`; 409 `settings_conflict` on version mismatch; blob ≤ 1 MiB.
- `GET /users/@me/keys` → `{public_key, enc_private_key, kdf_salt, kdf_params}`; `GET /users/{id}/public-key` → `{public_key}`.

- [ ] **Step 1: Tests** — register (201; second same username 409 `username_taken`; bad username 400 `invalid_username`; closed registration 403), kdf for unknown user returns 16-byte salt and is stable across calls, login OK then wrong key 401 and unknown user 401 (both ≥ 300 ms), `GET /users/@me` with the token 200 and without 401, patch profile and clear avatar with null, settings put/get/conflict, sessions list/delete/logout invalidates, password change invalidates other sessions, recover flow with a recovery key replaces auth and returns a working token. Assert first registered user has `flags & 1`.

- [ ] **Step 2: Run → fails.** — [ ] **Step 3: Implement** (validation helpers in `internal/api/validate.go`: `ValidUsername`, `CleanDisplayName`, `CleanText(max)` stripping C0/C1 controls except `\n\t`). — [ ] **Step 4: Run → passes.** — [ ] **Step 5: Commit** — `git commit -am "feat: auth and user endpoints"`.

---

### Task 7: Media blobs — validation, storage, upload of avatar/banner, serving

**Files:** Create `internal/media/store.go`, `validate.go`, `handler.go` (+tests); Modify `router.go`, `user_handlers.go` (avatar/banner routes).

**Interfaces:**
- `media.Sniff(head []byte) (mime string, animated bool, ok bool)` recognising PNG (and APNG via `acTL` chunk within the first 64 KiB), JPEG, GIF (animated if > 1 image descriptor in first 1 MiB — scan lazily), WebP (`VP8X` with animation bit or `ANIM` chunk).
- `media.ImageDims(r io.Reader, mime string) (w, h int, err error)` via `image.DecodeConfig` (+ `x/image/webp`).
- `media.Limits{MaxBytes int64; MaxW, MaxH int}` per kind: avatar/icon 10 MiB & 4096², banner 10 MiB & 8192×4096, emoji 2 MiB & 512², sticker 5 MiB & 1024².
- `media.Store{Dir string; st *store.Store}`: `PutPublic(ctx, kind string, r io.Reader, limits) (*store.Blob, error)` (streams to temp file while hashing SHA-256, validates sniff+dims, moves to `Dir/ab/cd/<sha>`; dedups by sha with ref_count++; returns codes `too_large`, `unsupported_type`, `bad_dimensions`), `PutEncrypted(ctx, r, maxBytes) (*store.Blob, error)` (opaque), `Open(id) (*os.File, *store.Blob, error)`, `Delete(id)`.
- Routes: `PUT /users/@me/avatar` (raw body, `Content-Type` image/*) → `{avatar_id}`; `DELETE /users/@me/avatar` → 204; same for banner. `GET /media/{kind}/{id}` serves public kinds with `Content-Type` from blob, `Cache-Control: public, max-age=31536000, immutable`, `ETag`, ranges via `http.ServeContent`; wrong kind for id → 404. Old avatar blob ref decremented on replace.

- [ ] **Step 1: Tests** — sniff table (tiny valid PNG/GIF/JPEG/WebP byte fixtures generated in the test with `image/png` + `image/gif` + `image/jpeg` encoders and a hand-built minimal WebP header), reject text/SVG, dims limit, size limit, dedupe by sha increments ref, upload avatar → GET /media/avatar/{id} 200 with immutable cache and 404 under `/media/emoji/{id}`.

- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: media blob storage, validation, avatar and banner upload"`.

---

### Task 8: Store — channels (DM/group), messages, reactions, pins, read states, relationships, keys

**Files:** Create `internal/store/channels.go`, `messages.go`, `relationships.go`, `keys.go`, `readstates.go` (+tests); Modify `models.go`.

**Interfaces:**
- Models: `Channel` (spec §4 + `Recipients []ids.ID json:"recipient_ids"` populated for dm/group_dm), `Message`, `Attachment{ID, MessageID, ChannelID, UploaderID, BlobID, Size, CreatedAt}`, `ReactionSummary{Emoji string; Count int; Me bool}`, `Relationship{UserID, TargetID, Type, CreatedAt}`, `KeyEpoch{ConvID, Epoch, CreatedBy, CreatedAt, Reason}`, `KeyGrant{ConvID, Epoch, UserID, WrappedKey []byte, WrappedBy, CreatedAt}`, `ReadState{ChannelID, LastReadMessageID *ids.ID, LastAckAt, MentionCount int}`.
- channels.go: `CreateDM(ctx, a, b ids.ID) (*Channel, created bool, error)` (finds existing dm with exactly these two participants), `CreateGroupDM(ctx, owner, recipients []ids.ID, name string) (*Channel, error)`, `ChannelByID`, `DMChannelsForUser(ctx, uid) ([]*Channel, error)`, `IsParticipant(ctx, chID, uid) (bool, error)`, `Participants(ctx, chID) ([]ids.ID, error)`, `AddParticipant`, `RemoveParticipant`, `UpdateChannel(ctx, id, ChannelPatch{Name, Topic *string; IconID **ids.ID; OwnerID *ids.ID; …})`, `SetLastMessage(ctx, chID, msgID)`.
- messages.go: `InsertMessage(ctx, *Message) error`, `MessageByID`, `Messages(ctx, chID, MessageQuery{Before, After, Around ids.ID; Limit int}) ([]*Message, error)` (returns newest-first for `before`, includes attachments and reaction summaries for `forUser`), `UpdateMessage(ctx, id, ciphertext json.RawMessage, mentions…, editedAt)`, `DeleteMessage(ctx, id)`, `AddReaction(ctx, msgID, uid, emoji) (added bool, err)`, `RemoveReaction`, `Reactors(ctx, msgID, emoji, limit)`, `PinMessage/UnpinMessage/Pins(ctx, chID)`, `InsertAttachment`, `AttachmentByID`, `CountMentionsAfter(ctx, chID, uid, afterID) (int, error)` (messages with `mentions` JSON containing uid or mention_everyone, after id, not by uid).
- readstates.go: `Ack(ctx, uid, chID, msgID)`, `ReadStates(ctx, uid) ([]*ReadState, error)` (with mention counts computed).
- relationships.go: `Relationships(ctx, uid)`, `Relationship(ctx, uid, target)`, `SetRelationship(ctx, uid, target, type)`, `DeleteRelationship`, `AreFriends`, `IsBlocked(ctx, a, b) (aBlockedB bool, bBlockedA bool, err)`.
- keys.go: `CreateEpoch(ctx, *KeyEpoch) error` (epoch must equal current max+1 else `ErrConflict`), `LatestEpoch(ctx, conv) (int, bool, error)`, `Epochs(ctx, conv)`, `PutGrants(ctx, []KeyGrant) (inserted int, err)` (ignore duplicates), `GrantsForUser(ctx, uid) ([]*KeyGrant, error)`, `GrantsForUserConv(ctx, uid, conv)`, `HoldersOf(ctx, conv, epoch) ([]ids.ID, error)`, `UsersLackingGrant(ctx, conv, epoch, entitled []ids.ID) ([]ids.ID, error)`, `SetKeyFlags(ctx, conv, needsRotation, needsOwnKey *bool)`, `KeyFlags(ctx, conv)`.

- [ ] **Step 1: Tests** — DM dedupe (creating twice returns same id, `created=false`); group DM participants; pagination before/after/around ordering and limit; reaction summary with `Me`; pins; mention counting; relationships transitions; epochs sequence enforcement and `UsersLackingGrant`.
- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: store for channels, messages, reactions, read states, relationships, keys"`.

---

### Task 9: Gateway hub — protocol, connections, presence, ready, typing, fan-out

**Files:** Create `internal/gateway/protocol.go`, `hub.go`, `conn.go`, `presence.go`, `handler.go`, `hub_test.go`; Modify `cmd/chatd/main.go`, `internal/api/router.go` (mount `/gateway`), replace `noopBroadcaster`.

**Interfaces:**
- `protocol.go`: `type ClientFrame struct{ Op string json:"op"; D json.RawMessage json:"d" }`; `type ServerFrame struct{ T string json:"t"; S uint64 json:"s,omitempty"; D any json:"d,omitempty" }`; op names `identify, heartbeat, presence, typing, voice_state, voice_signal, subscribe_members`; event names as constants `EvReady="ready"`, `EvMessageCreate="message_create"`, … (full list in spec §5.2). `ReadyPayload{User *store.User (private view for self: PublicUser + flags), Channels []*store.Channel, Relationships []*store.Relationship, ReadStates []*store.ReadState, Presences []Presence, KeyGrants []*store.KeyGrant, Settings *store.Settings, Servers []any (empty), Users []store.PublicUser (every user referenced by channels/relationships), SessionID string}`.
- `presence.go`: `type Presence struct{ UserID ids.ID; Status string; StatusText, StatusEmoji string; StatusExpiresAt *int64 }`; effective status = `invisible` → shown as `offline`; a user is online if any connection is open.
- `hub.go`: `New(st *store.Store, log *slog.Logger) *Hub`; `Run(ctx)` (sweeper for heartbeat timeouts); `EmitUsers(ids []ids.ID, t string, d any)`; `EmitChannel(chID ids.ID, t string, d any)` (participants via `store.Participants`; Phase 2 adds a `ViewerResolver` hook for server channels); `EmitAll(t, d)` (rare); `Online(uid) bool`; `PresenceOf(uid) Presence`; `Interested(uid) []ids.ID` (friends + DM co-participants; Phase 2 adds server co-members) for presence fan-out; implements `api.Broadcaster` (`UserUpdated`, `MessageCreated`, … thin wrappers that pick the recipient set).
- `conn.go`: one goroutine reading, one writing from a `chan ServerFrame` (cap 256; on full → close with code 1008 "slow consumer"); first frame must be `identify` within 10 s; heartbeat every 25 s expected, close after 60 s silence; `typing` op → `EmitChannel(ch, "typing", {channel_id, user_id, ts})` after verifying participation, rate-limited 1/8 s per channel; `presence` op updates presence and stores `presence_pref` + custom status on the user row.
- `handler.go`: `func (h *Hub) ServeHTTP(w, r)` using `websocket.Accept` with `OriginPatterns` = host of `PublicURL` plus `localhost:*` for dev; compression enabled.

- [ ] **Step 1: Tests** (`hub_test.go` uses `httptest.NewServer` + `websocket.Dial`): identify with bad token → close 4001; identify OK → `ready` with the user and an empty channel list; two users in a DM: typing from A arrives at B and not at C; `EmitUsers` delivers to all of a user's connections; presence: B sees `presence` online when A connects and `offline` when A's last connection closes; missing heartbeat closes after the timeout (use an injected `time` clock or shortened durations via unexported fields).
- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: websocket gateway with identify, ready, presence, typing"`.

---

### Task 10: DM / group DM channel, message, reaction, pin, ack, attachment, typing endpoints (with gateway events)

**Files:** Create `internal/api/channel_handlers.go`, `message_handlers.go` (+tests); Modify `router.go`.

**Interfaces:**
- `POST /users/@me/channels` `{recipient_ids: [..]}` → 1 recipient: DM (needs: not blocked either way, and target's DM privacy allows — Phase 1 stores privacy in the encrypted settings blob, so the server enforces only blocks; friends-only DM privacy is a Phase 2 server-side setting `dm_privacy` on users; add the column now, default `everyone`, enforce it); 2–24 recipients: group DM (all must be friends of creator). Returns channel; emits `channel_create` to all participants.
- `GET /users/@me/channels` → DM channels; `GET /channels/{id}`; `PATCH /channels/{id}` (group name/icon by any participant; owner-only for owner transfer); `PUT /channels/{id}/icon` (raw image); `POST /channels/{id}/recipients/{uid}` and `DELETE …` (group; owner or self-leave; owner leaving transfers to earliest participant; last participant leaving deletes the channel) with `channel_update`/`channel_delete` events and system messages (`system_member_add/remove`, plaintext-safe: `ciphertext` is `null`, `type` carries the meaning, `mentions` holds the affected user ids).
- `GET /channels/{id}/messages?before|after|around&limit` (participant only; limit default 50 max 100) → `[]Message` newest-first for `before`, oldest-first for `after`, chronological for `around`.
- `POST /channels/{id}/messages` body `{ciphertext: Envelope JSON, key_conv_id, key_epoch, reply_to_id?, mentions: [], mention_everyone?: bool, attachments: [{blob_id, size}], nonce: string}` → validates: participant; envelope ≤ 64 KiB, well-formed (`v==1`, base64 iv 12 bytes, ct non-empty); `key_conv_id` must equal the channel id (DMs) and epoch must exist; attachments must be blobs uploaded by this user and unattached; rate limit 5 per 5 s; dedupe by `(author, channel, nonce)` in a 2-minute LRU → returns existing message. Sets `channels.last_message_id`, emits `message_create` to participants. Response 201 `Message`.
- `PATCH /channels/{id}/messages/{mid}` `{ciphertext, mentions}` (author only) → `message_update`; `DELETE` (author, or group owner) → `message_delete {id, channel_id}`.
- `PUT /channels/{id}/messages/{mid}/reactions/{emoji}/@me` (emoji = URL-encoded unicode or `name:id` custom) → 204 + `reaction_add {channel_id, message_id, user_id, emoji}`; `DELETE` likewise; `GET …/reactions/{emoji}?limit` → users. Max 20 distinct emoji per message → 400 `too_many_reactions`.
- `PUT /channels/{id}/pins/{mid}` → 204 + `pin_update {channel_id, message_id, pinned: true}` + system message `system_pin`; `DELETE`; `GET /channels/{id}/pins` → messages.
- `POST /channels/{id}/messages/{mid}/ack` → 204 + `read_state {channel_id, last_read_message_id, mention_count: 0}` to the user's other connections.
- `POST /channels/{id}/attachments` (raw body, header `X-Attachment-Size` = plaintext size for UI; body is ciphertext; ≤ `MaxUploadBytes`) → `{blob_id, size}`; `GET /media/attachments/{blobId}` → ciphertext with `Range` support, requires participant of the channel that owns the attachment (`attachments` row) or the uploader while unattached.
- `POST /channels/{id}/typing` → same as gateway op (for clients without socket).

- [ ] **Step 1: Tests** — DM creation dedupe & blocked → 403 `blocked`; group DM requires friends; non-participant 403 on messages; message create emits to the other participant (use a gateway test client); pagination before/after; edit by non-author 403; delete by author; reactions add/remove/idempotent and 20-emoji cap; pins; ack read state; attachment upload → message with attachment → download allowed for participant, 403 for stranger, 404 unknown; nonce dedupe returns the same id.
- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: DM channels, messages, reactions, pins, acks, attachments"`.

---

### Task 11: Relationships and key endpoints

**Files:** Create `internal/api/relationship_handlers.go`, `key_handlers.go` (+tests); Modify `router.go`, `hub.go` (`Interested` uses friends).

**Interfaces:**
- `GET /users/@me/relationships` → `[{user: PublicUser, type, created_at}]`; `POST /users/@me/relationships` `{username}` → creates `outgoing` for me and `incoming` for them (if they already sent one → both become `friend`); blocks prevent; self → 400; emits `relationship_add` to both. `PUT /users/@me/relationships/{id}` (accept incoming → both `friend`); `DELETE /users/@me/relationships/{id}` (remove friend / cancel / decline → `relationship_remove` to both); `PUT /users/@me/blocks/{id}` (sets `blocked`, removes any friendship) ; `DELETE /users/@me/blocks/{id}`.
- `GET /keys/grants` → all grants for me; `GET /keys/needs` → for every conv where I hold the latest epoch: `[{conv_id, epoch, user_ids: [...lacking]}]` — entitlement for a DM/group conv = participants (Phase 2 extends with servers and channel viewers through a `store.Entitled(ctx, conv) ([]ids.ID, error)` function that this task creates with the DM/group logic); `POST /keys/grants` `[{conv_id, epoch, user_id, wrapped_key}]` (≤ 200; each must be for a conv I hold and a user entitled; wrapped_key ≤ 512 B) → `{inserted}` and emits `key_grant {conv_id, epoch, wrapped_key, wrapped_by}` to each recipient; `POST /keys/epochs` `{conv_id, reason}` → creates `latest+1` (participant of conv; for DMs any participant) → returns `{conv_id, epoch}` and emits `keys_needed {conv_id, epoch, user_ids}` to the creator (who then grants); `GET /users/{id}/public-key`.
- Hub: after `message_create` for a channel and after `channel_create`/participant add, the hub emits `keys_needed` to current holders for any lacking participants (call `store.UsersLackingGrant`). Implement as `hub.NudgeKeys(convID)`.

- [ ] **Step 1: Tests** — friend request flow (outgoing/incoming/friend/decline), block removes friendship and prevents requests, key epochs/grants/needs including "needs after adding a participant to a group DM" and the `key_grant` event reaching the recipient socket.
- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: relationships and key distribution endpoints"`.

---

### Task 12: Unfurl service and static SPA serving; main wiring; graceful shutdown

**Files:** Create `internal/unfurl/guard.go`, `fetch.go`, `handler.go` (+tests), `internal/api/static.go` (+test); Modify `cmd/chatd/main.go`, `router.go`.

**Interfaces:**
- `unfurl.SafeDialer(ctx, network, addr)` resolves and rejects loopback, RFC1918, link-local, CGNAT `100.64/10`, multicast, unspecified, IPv6 ULA/link-local; used by an `http.Transport` with `Proxy: nil`, `DisableKeepAlives`, redirects re-validated via `CheckRedirect` (max 3).
- `unfurl.Fetch(ctx, rawURL string) (*Result, error)`; `Result{URL, Type "link"|"image"|"gif"|"video"|"youtube", Title, Description, SiteName, Image, ImageW, ImageH, VideoID, Color? string}`; 6 s timeout; 2 MiB read cap; only `text/html` parsed; `image/*` → `image`/`gif`; `video/mp4|webm` → `video`; YouTube hosts → `youtube` with id (watch?v=, youtu.be/, shorts/, embed/).
- `unfurl.Cache` LRU 2000 entries, 1 h TTL. Route `GET /unfurl?url=` (auth; 30/min per user) → `Result` or 204 when nothing embeddable. Errors never leak internals (`fetch_failed`).
- `static.go`: serves `cfg.WebDist`; `/assets/*` with `Cache-Control: public, max-age=31536000, immutable`; everything else not under `/api`, `/gateway`, `/media` returns `index.html` with `no-cache` (SPA fallback); precompressed `.br`/`.gz` served when present and accepted; `manifest.webmanifest` correct content type. Security headers on HTML: CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' wss: https:; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
- `main.go`: load config → `db.Open` + `Migrate` → `store.New` → `media.Store` → `gateway.New` + `Run` → `api.Server` → `http.Server` with timeouts (`ReadHeaderTimeout 10s`, `IdleTimeout 120s`, no WriteTimeout because of long downloads/websocket) → on SIGTERM: stop accepting, `hub.CloseAll(1001)`, `srv.Shutdown(10s)`, `db.Close()`; a `blob GC` ticker hourly.

- [ ] **Step 1: Tests** — guard rejects `127.0.0.1`, `10.0.0.1`, `169.254.1.1`, `[::1]`, `fd00::1`, `100.64.0.1`, and a hostname resolving to loopback (`localhost`); parses og tags from an `httptest` page; detects gif/video by content type; youtube ids from 4 URL forms; size cap truncates; static: `/` and `/channels/@me/1` return index.html, `/assets/x.js` immutable, `/api/v1/nope` JSON 404, CSP present.
- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: link unfurling with SSRF guard, SPA serving, main wiring"`.

---

### Task 13: Deploy scripts — launchd daemon, tunnel ingress, DNS helper

**Files:** Create `deploy/xyz.evilion.chat.plist.in`, `deploy/install.sh`, `deploy/route-dns.sh`, `deploy/README.md`, `run.sh`, `backup.sh`.

**Interfaces:** `bash deploy/install.sh [--check] [--no-start]`; mirrors the parent's `setup.sh` conventions (idempotent, `ok/todo` output, renders `@ROOT@ @USER@ @GROUP@ @HOME@ @PATH@`, installs to `/Library/LaunchDaemons/xyz.evilion.chat.plist`, bootstraps it, waits for `/api/health`). It also: creates `chatd.env` from the example if missing (mode 600), `data/` and `logs/`, inserts the ingress rule into `../server/tunnel/config.yml` before the `http_status:404` catch-all if absent (Python one-liner for the YAML edit, exact indentation preserved), restarts `xyz.evilion.evilionxyz` via `launchctl kickstart -k` only when the ingress changed, checks `dig +short chat.evilion.xyz` and prints the two DNS options if empty, and finally `curl -sf https://chat.evilion.xyz/api/health` when DNS exists. `run.sh` = `exec ./bin/chatd -env chatd.env` from the repo dir (used by the plist via `@BASH@ @ROOT@/run.sh`). `backup.sh` = `sqlite3 data/chat.db ".backup 'backup/chat-<date>.db'"` + tar of `data/blobs`.

- [ ] **Step 1: Write scripts**, run `bash deploy/install.sh --check` and confirm it reports every step without changing anything. — [ ] **Step 2:** `make server && sudo bash deploy/install.sh` → `sudo launchctl print system/xyz.evilion.chat | grep state` shows running; `curl localhost:8090/api/health` ok; `grep chat.evilion.xyz ../server/tunnel/config.yml` present. — [ ] **Step 3: Commit** — `git commit -am "feat: launchd daemon, tunnel ingress and DNS helper scripts"`.

---

### Task 14: Web scaffold — Vite, TypeScript strict, vitest, fonts, theme tokens, PWA manifest

**Files:** Create `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/public/manifest.webmanifest`, `web/public/icons/*.png` (generated with a tiny Python PIL-free PNG writer or an SVG → keep SVG icon + 192/512 PNG produced by Playwright screenshot of the SVG), `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles/{tokens.css,base.css,fonts.css}`, `web/src/lib/bytes.test.ts` (smoke), `web/vitest.config.ts`.

**Interfaces:**
- `package.json` scripts: `dev` (vite, proxy `/api`, `/gateway` (ws), `/media` → `http://127.0.0.1:8090`), `build` (`tsc --noEmit && vite build`), `typecheck`, `test` (vitest), `preview`. Dependencies exactly: `react@18`, `react-dom@18`, `react-router-dom@6`, `zustand@5`, `@tanstack/react-virtual@3`, `@noble/curves@1`, `@noble/hashes@1`, `hash-wasm@4`, `emojibase-data@16`, `highlight.js@11`, `lucide-react`, `@fontsource/noto-sans`, `@fontsource/jetbrains-mono`; dev: `vite@6`, `@vitejs/plugin-react`, `typescript@5`, `vitest@3`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `fake-indexeddb`, `@types/react`, `@types/react-dom`.
- `tokens.css` defines on `:root` (Dark) and on `[data-theme="light"|"ash"|"onyx"]` the variables (values from spec §9): `--bg-base, --bg-raised, --bg-surface, --bg-floating, --bg-hover, --bg-selected, --bg-active, --bg-input, --text, --text-strong, --text-subtle, --text-muted, --text-channel, --text-placeholder, --brand, --brand-hover, --brand-active, --link, --text-brand, --mention-bg, --mention-fg, --positive, --warning, --danger, --border-subtle, --border, --border-strong, --scroll-thumb, --scroll-track, --spoiler, --spoiler-revealed, --radius-xs:4px, --radius-sm:8px, --radius-md:12px, --radius-lg:16px, --radius-xl:24px, --shadow-low, --shadow-medium, --shadow-high, --font: "Noto Sans", system-ui, sans-serif, --font-mono: "JetBrains Mono", ui-monospace, monospace, --font-scale:1, --rail-w:72px, --sidebar-w:240px, --members-w:240px, --header-h:49px`; `[data-accent]` overrides `--brand` from a CSS variable set by JS (`--accent-h/s/l`).
- `base.css`: reset, `html{color-scheme}`, body `background: var(--bg-base); color: var(--text); font: 16px/1.375 var(--font)`, custom scrollbars (thin, `--scroll-thumb`, 8 px, radius 4), `.visually-hidden`, focus rings (`outline: 2px solid var(--brand)` on `:focus-visible`), reduced-motion media query, `@media (max-width: 767px)` helpers.
- `index.html`: `<title>Evilion Chat</title>`, viewport `width=device-width, initial-scale=1, viewport-fit=cover`, theme-color `#2c2d32`, manifest link, `<div id="root">`.
- `main.tsx` mounts `<App/>` inside `BrowserRouter`; `App.tsx` renders a placeholder "Evilion Chat" heading (replaced in Task 21).

- [ ] **Step 1:** `cd web && npm init -y` then install the pinned dependencies; write configs; write `bytes.test.ts` asserting `1+1===2` to prove vitest runs. Run `npm run typecheck && npm test -- --run && npm run build` → all pass, `dist/index.html` exists. — [ ] **Step 2:** `go run ./cmd/chatd` with `WEB_DIST=./web/dist` and open `http://127.0.0.1:8090/` → heading renders; `tools/screenshot.py` (Task 25 creates it; for now use a 5-line Playwright script) confirms. — [ ] **Step 3: Commit** — `git commit -am "feat: web scaffold with theme tokens and PWA manifest"`.

---

### Task 15: Crypto module (client)

**Files:** Create `web/src/crypto/bytes.ts`, `kdf.ts`, `keys.ts`, `conv.ts`, `message.ts`, `file.ts`, `keystore.ts`, and `*.test.ts` for each.

**Interfaces (exact):**
```ts
// bytes.ts
export const b64 = { enc(u: Uint8Array): string; dec(s: string): Uint8Array }          // standard base64 (matches Go)
export const utf8 = { enc(s: string): Uint8Array; dec(u: Uint8Array): string }
export function concat(...parts: Uint8Array[]): Uint8Array
export function randomBytes(n: number): Uint8Array
export function equal(a: Uint8Array, b: Uint8Array): boolean                              // constant-time
// kdf.ts
export interface KdfParams { m: number; t: number; p: number; v: 1 }                      // m in KiB
export const DEFAULT_KDF: KdfParams = { m: 65536, t: 3, p: 1, v: 1 }
export async function deriveMaster(password: string, salt: Uint8Array, p: KdfParams): Promise<Uint8Array> // argon2id, 32 B (hash-wasm)
export function deriveAuthKey(master: Uint8Array): Uint8Array   // hkdf(sha256, master, salt="", info="evilion-chat/auth/v1", 32)
export function deriveEncKey(master: Uint8Array): Uint8Array    // info "evilion-chat/enc/v1"
export function recoveryKeyToBytes(display: string): Uint8Array // "XXXX-XXXX-…" base32 (Crockford) → 32 B; throws on bad checksum
export function newRecoveryKey(): { bytes: Uint8Array; display: string }               // 32 random B + 8-char groups
// keys.ts
export interface Identity { publicKey: Uint8Array; privateKey: Uint8Array }
export function generateIdentity(): Identity                                             // x25519 from @noble/curves
export async function wrapPrivateKey(priv: Uint8Array, encKey: Uint8Array): Promise<Uint8Array>      // iv(12)‖gcm(ct), aad "privkey/v1"
export async function unwrapPrivateKey(blob: Uint8Array, encKey: Uint8Array): Promise<Uint8Array>
export async function seal(recipientPub: Uint8Array, data: Uint8Array): Promise<Uint8Array>          // ephPub(32)‖iv(12)‖ct; key = hkdf(x25519(eph, recipient), info "evilion-chat/seal/v1"‖ephPub‖recipientPub)
export async function open(recipientPriv: Uint8Array, recipientPub: Uint8Array, blob: Uint8Array): Promise<Uint8Array>
// conv.ts
export function newRootKey(): Uint8Array                                                 // 32 random B
export function channelKey(root: Uint8Array, channelId: string): Uint8Array             // hkdf info "chan:"+channelId
export class KeyRing {  // in-memory cache of root keys: conv → Map<epoch, root>
  set(conv: string, epoch: number, root: Uint8Array): void; get(conv: string, epoch: number): Uint8Array | undefined
  latest(conv: string): { epoch: number; root: Uint8Array } | undefined; has(conv: string): boolean; convs(): string[]
}
// message.ts
export interface Envelope { v: 1; conv: string; epoch: number; iv: string; ct: string }
export interface Aad { conv: string; epoch: number; channelId: string; authorId: string }
export interface MessagePayload { t?: string; att?: AttachmentMeta[]; sticker?: { id: string }; embeds?: unknown[]; flags?: number }
export interface AttachmentMeta { blob_id: string; name: string; type: string; size: number; w?: number; h?: number; key: string; spoiler?: boolean; duration?: number }
export async function encryptMessage(chanKey: Uint8Array, aad: Aad, payload: MessagePayload): Promise<Envelope>
export async function decryptMessage(chanKey: Uint8Array, env: Envelope, aad: Aad): Promise<MessagePayload>   // throws DecryptError
export function aadBytes(a: Aad): Uint8Array   // utf8(`${conv}|${epoch}|${channelId}|${authorId}`)
// file.ts
export const CHUNK = 4 * 1024 * 1024
export async function encryptFile(data: Blob, onProgress?: (done: number, total: number) => void): Promise<{ key: Uint8Array; blob: Blob }>
export async function decryptFile(blob: Blob, key: Uint8Array, onProgress?): Promise<Blob>
// layout: header "ECF1"(4) ‖ baseIv(8) ‖ chunks of [len u32be][gcm ct (plain 4 MiB + 16 tag)], iv = baseIv ‖ u32be(index), aad = "file/v1"
// keystore.ts (IndexedDB "evilion-chat", stores "identity", "roots")
export const keystore = { saveIdentity(userId, id: Identity): Promise<void>; loadIdentity(userId): Promise<Identity | null>;
  saveRoot(userId, conv, epoch, root): Promise<void>; loadRoots(userId): Promise<Array<{conv, epoch, root}>>; clear(userId): Promise<void> }
```
Grant wrapping helpers (in `keys.ts`): `wrapGrant(recipientPub, root) = seal(recipientPub, root)`; `unwrapGrant(myPriv, myPub, wrapped) = open(...)`.

- [ ] **Step 1: Tests** (vitest, node environment; `hash-wasm` works in node): kdf deterministic and salt-sensitive (use small params m=1024 t=1 in tests for speed); auth ≠ enc keys; recovery key display round-trip and checksum failure; wrap/unwrap private key and wrong encKey throws; seal/open round trip, tampered byte throws, wrong recipient throws; channelKey differs per channel and is stable; encrypt/decrypt message round trip with unicode; AAD mismatch (different channelId) throws; envelope fields base64 with 12-byte iv; file round trip for 0 B, 10 B, exactly 4 MiB, 4 MiB + 1, 9 MiB with progress callbacks called; corrupted chunk throws; keystore with `fake-indexeddb` saves/loads/clears.
- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: client crypto (argon2id, x25519 sealed boxes, AES-GCM envelopes, chunked files)"`.

---

### Task 16: API client, shared types, gateway client, event dispatch skeleton

**Files:** Create `web/src/api/{client.ts,types.ts,auth.ts,users.ts,channels.ts,messages.ts,relationships.ts,keys.ts,unfurl.ts}`, `web/src/gateway/{client.ts,events.ts}`, tests `client.test.ts`, `gateway/client.test.ts`.

**Interfaces:**
- `types.ts` mirrors Go JSON exactly: `User`, `Channel`, `Message`, `Attachment`, `ReactionSummary`, `Relationship`, `ReadState`, `KeyGrant`, `Presence`, `ReadyPayload`, `UnfurlResult`, `Session`, `ApiError`.
- `client.ts`: `class ApiError extends Error { status: number; code: string }`; `api.setToken(t: string | null)`; `api.request<T>(method, path, body?, opts?: { raw?: BodyInit; headers?; signal? }): Promise<T>` (JSON by default; throws `ApiError` from the envelope; 401 → calls `onUnauthorized` hook); `api.upload(path, blob, headers, onProgress): Promise<T>` via `XMLHttpRequest` for progress.
- Domain modules export typed functions, e.g. `auth.register(body): Promise<{user: User; token: string}>`, `auth.kdf(username)`, `auth.login(...)`, `messages.list(channelId, {before?, after?, around?, limit?})`, `messages.send(channelId, body)`, `keys.needs()`, `keys.grants()`, `keys.putGrants(list)`, `keys.createEpoch(conv, reason)`, `users.publicKey(id)`, `unfurl.fetch(url)`.
- `gateway/events.ts`: discriminated union `GatewayEvent = { t: "ready"; d: ReadyPayload } | { t: "message_create"; d: Message } | …` for every event in spec §5.2 (voice ones included as types now).
- `gateway/client.ts`: `class GatewayClient { constructor(opts: { url: () => string; token: () => string | null; onEvent: (e: GatewayEvent) => void; onStatus: (s: "connecting" | "open" | "closed") => void; WebSocketImpl?: typeof WebSocket }); connect(); close(); send(op: string, d?: unknown); sendTyping(channelId); sendPresence(p); }` — identify on open, heartbeat 25 s (skips when hidden tab? no — always), reconnect with backoff 1 s → 30 s ×1.7 + jitter, resets on `ready`; queue outbound ops while connecting (drop typing).

- [ ] **Step 1: Tests** — `ApiError` from envelope; token header set; gateway client with a fake WebSocket class: sends identify first, heartbeats on a fake timer, reconnects after close with growing delay, dispatches parsed events, ignores malformed frames.
- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: typed API client and gateway client"`.

---

### Task 17: Stores (zustand) and the gateway → store dispatcher; key manager

**Files:** Create `web/src/stores/{auth.ts,users.ts,channels.ts,messages.ts,relationships.ts,readStates.ts,typing.ts,presence.ts,settings.ts,ui.ts,keys.ts}`, `web/src/gateway/dispatch.ts`, tests `messages.test.ts`, `dispatch.test.ts`, `keys.test.ts`.

**Interfaces:**
- `auth`: `{ token, me: User | null, status: "idle"|"loading"|"ready"|"locked"; identity: Identity | null; login(username, password); register(...); logout(); unlockWith(password) }` (login/register implement the spec §5.4 flows using `crypto/`; on success saves identity to keystore and token to localStorage `ec.token`).
- `users`: `{ byId: Record<string, User>; upsert(u | u[]); get(id) }`.
- `channels`: `{ byId; dmIds: string[] (sorted by last_message_id desc); upsert; remove; setLastMessage(chId, msgId) }`.
- `messages`: per channel `{ ids: string[] (ascending); byId: Record<string, DecryptedMessage>; hasOlder: boolean; loading: boolean }` where `DecryptedMessage = Message & { payload?: MessagePayload; decryptError?: "no_key"|"bad" }`; actions `insert(chId, msgs, {prepend?})` (merge, dedupe, keep ascending), `update`, `remove`, `setReaction(chId, msgId, emoji, userId, add, isMe)`, `markDecrypted(chId, msgId, payload)`, `loadOlder(chId)`, `loadInitial(chId)`.
- `readStates`: `{ byChannel: Record<string,{lastReadId: string|null; mentions: number}>; ack(chId, msgId) (optimistic + API); isUnread(chId): boolean (compares with channel.last_message_id as BigInt) }`.
- `typing`: `{ byChannel: Record<string, Record<userId, expiresAt>> ; add; sweep }`.
- `presence`: `{ byUser: Record<string, Presence>; set; statusOf(id): "online"|"idle"|"dnd"|"offline" }`.
- `settings`: decrypted blob shape `Settings { theme: "dark"|"light"|"ash"|"onyx"|"system"; accent: string|null; fontScale: number; messageDisplay: "cozy"|"compact"; favoriteGifs: {url, w, h}[]; notifications: {desktop: boolean; sounds: boolean; perChannel: Record<string,"all"|"mentions"|"none">; muted: string[]}; linkPreviews: boolean; developerMode: boolean; sidebarWidth: number; showMembers: boolean; recentEmoji: string[]; drafts: Record<string,string> }` with defaults; `load()` decrypts blob with `HKDF(encKey,"settings")` — the settings key is derived from the identity private key (`hkdf(privateKey, "evilion-chat/settings/v1")`) so it survives password changes; `patch(partial)` debounced save with version and conflict reload.
- `ui`: `{ theme resolved; leftOpen/rightOpen (mobile); modal: null | {kind, props}; contextMenu; quickSwitcherOpen; activeChannelId; replyTo: {channelId, messageId} | null; editing: messageId | null }`.
- `keys` (key manager): `{ ring: KeyRing; ready: boolean; ingestGrants(grants: KeyGrant[]) (unwrap with identity, add to ring + keystore); ensureConvKey(conv): Promise<{epoch, root}> (creates epoch via API + self-grant if none); grantTo(conv, epoch, userIds) (fetch public keys, seal, POST); reconcile() (GET needs → grantTo for each); waiting: Set<conv> }`.
- `dispatch.ts`: `applyEvent(e: GatewayEvent)` exhaustive switch; on `ready`: reset stores, upsert everything, ingest grants, set presence, kick `keys.reconcile()`, decrypt pending; `message_create` → insert + decrypt (async via `decryptInto(chId, msg)` helper that finds `channelKey(ring.get(conv, epoch), channelId)`; missing key → `decryptError: "no_key"` and `keys.waiting.add(conv)`), bump unread unless it's mine or the active channel is visible (then ack); `key_grant` → ingest → re-decrypt every message with `no_key` for that conv; `keys_needed` → `grantTo`; etc.

- [ ] **Step 1: Tests** — messages store ordering/merge/dedupe/prepend, reaction toggling with `me`, dispatch of `message_create` inserts and increments unread for inactive channel, `key_grant` re-decrypts (use real crypto with generated keys), `ready` resets state.
- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: client stores, event dispatcher, key manager"`.

---

### Task 18: Markdown parser and renderer

**Files:** Create `web/src/markdown/{ast.ts,tokenize.ts,parse.ts,render.tsx,emoji.ts}`, `parse.test.ts`, `render.test.tsx`, fixtures `parse.fixtures.ts`.

**Interfaces:**
```ts
export type Node = { type: "text"; text: string } | { type: "strong" | "em" | "u" | "s" | "spoiler" | "paragraph" | "quote" | "listItem"; children: Node[] }
  | { type: "code"; text: string } | { type: "codeblock"; lang: string | null; text: string } | { type: "heading"; level: 1|2|3; children: Node[] }
  | { type: "subtext"; children: Node[] } | { type: "list"; ordered: boolean; start: number; items: Node[][] }
  | { type: "link"; url: string; children: Node[]; masked: boolean } | { type: "mention"; kind: "user"|"channel"|"role"; id: string } | { type: "mention"; kind: "everyone"|"here" }
  | { type: "emoji"; name: string; id: string; animated: boolean } | { type: "unicodeEmoji"; text: string } | { type: "timestamp"; unix: number; style: "t"|"T"|"d"|"D"|"f"|"F"|"R" } | { type: "br" }
export function parse(src: string, opts?: { inline?: boolean }): Node[]
export function isEmojiOnly(nodes: Node[]): boolean   // ≤ 30 emoji/unicodeEmoji and whitespace only
export function plainText(nodes: Node[]): string     // for notifications / previews
export function Markdown(props: { source: string; ctx: RenderCtx; inline?: boolean; jumbo?: boolean }): JSX.Element
export interface RenderCtx { users: Record<string, User>; channels: Record<string, Channel>; roles?: Record<string, {name, color}>; onUserClick?(id, el): void; onChannelClick?(id): void; emojiUrl(id, animated): string; revealSpoilers?: boolean }
```
Grammar rules (Discord behaviour): `**` strong, `*`/`_` em (underscore only at word boundaries), `__` underline, `~~` strike, `||` spoiler, `` ` `` inline code (no nesting inside), ``` fences with optional lang on the first line, `>` quote (line-start; consecutive lines merge), `>>>` rest-of-message quote, `# ## ###` headings at line start followed by a space, `-#` subtext, `- ` / `* ` bullets and `1. ` ordered at line start (one nesting level by 2 spaces), `[text](https://…)` masked links (only http/https; no `<`), bare URLs `https?://` autolinked (trailing `.,;:!?)` excluded, balanced `)` kept), `<https://…>` no-embed links, `<@id>`, `<#id>`, `<@&id>`, `@everyone`, `@here`, `<:name:id>`, `<a:name:id>`, `<t:unix:X>` (default `f`), `\` escapes any punctuation, unicode emoji detected with a regex over `\p{Extended_Pictographic}` sequences (with ZWJ/VS16/skin tones). Formatting does not cross line breaks except inside code blocks and quotes. Max input 4000 chars; parser is linear-time.

- [ ] **Step 1: Tests** — ≥ 80 fixtures: each `{src, ast}` (e.g. `"**a** *b* __c__ ~~d~~ ||e||"`, unmatched `**a`, nested `***x***`, `_a_b_`, code containing `*`, fence with lang and without closing (renders to end), quote lines, `>>>`, headings and not-headings (`#nospace`), list nesting, masked link with `javascript:` rejected (rendered as text), URL with trailing paren, mentions, emoji, timestamps, escapes, emoji-only detection, 4000-char random input never throws (fuzz with seeded PRNG, 500 iterations)). Render tests: spoiler hidden until click, link has `rel="noopener noreferrer" target="_blank"`, mention renders display name from ctx, code block highlights `js`.
- [ ] **Step 2–5:** run/implement/run/commit — `git commit -am "feat: Discord-flavoured markdown parser and renderer"`.

---

### Task 19: Auth pages — register (with recovery key), login, recover; session bootstrap

**Files:** Create `web/src/pages/{LoginPage,RegisterPage,RecoverPage}.tsx`, `web/src/components/common/{Button,TextInput,Spinner,Toast}.tsx` (+CSS modules), `web/src/routes.tsx`, `web/src/components/shell/Bootstrap.tsx`; Modify `App.tsx`.

**Behaviour:** Centered 480 px card on `--bg-raised` with radius 8 and shadow-high, brand wordmark "Evilion Chat" (text, no logo), fields with labels in 12 px uppercase 700 muted, inputs 40 px on `--bg-input` radius 4; primary button `--brand` 44 px radius 4; links `--link`. Register: username (live validity), display name, password (min 8, strength meter), confirm; submit → derive (progress "Securing your account…") → API → then a full-screen "Save your recovery key" step showing the 8-group key in mono with copy + download `.txt`, requires ticking "I saved it" to continue. Login: username → fetch kdf → derive → login → unwrap keys → to `/channels/@me`; errors inline (`invalid_credentials` → "Username or password is wrong"). Recover: username + recovery key + new password. Bootstrap: on load with a stored token, fetch `/users/@me` and keys, if the identity is not in the keystore show a lock screen asking for the password to unlock (derives encKey, unwraps). Routes: unauthenticated → `/login` (remember `?next=`).

- [ ] **Step 1:** Component tests: register form validation messages, recovery step gating; login error rendering (mock api). — [ ] **Step 2:** Implement. — [ ] **Step 3:** Screenshots of the three pages at 1366×768 and 390×844 via `tools/screenshot.py` (Task 25's script — create it now if not present) and review. — [ ] **Step 4: Commit** — `git commit -am "feat: register, login, recover pages and session bootstrap"`.

---

### Task 20: App shell — rail, sidebar (DM list), user panel, responsive layout, theming

**Files:** Create `web/src/components/shell/{AppShell.tsx,AppShell.module.css,MobileDrawers.tsx}`, `rail/{Rail.tsx,RailItem.tsx,Rail.module.css}`, `sidebar/{DMSidebar.tsx,DMListItem.tsx,SidebarSearch.tsx,Sidebar.module.css}`, `common/{Avatar.tsx,StatusDot.tsx,Tooltip.tsx,ContextMenu.tsx,Popover.tsx,Modal.tsx}`, `shell/UserPanel.tsx`, `pages/AppPage.tsx`; Modify `routes.tsx`.

**Layout contract (desktop ≥ 1024):** grid `[rail 72px][sidebar var(--sidebar-w)][main 1fr][members var(--members-w) when open]`, full viewport height, `overflow hidden`. Rail: `--bg-base`, items 48×48 with 8 px gaps in a 72 px column (icon centered), radius 16 → 12 on hover/selected with 200 ms ease, selection pill 8×40 on the left edge (`--text-strong`), unread pill 8×8, mention badge 16 px red `#da3e44` with 12 px/700 count, tooltip to the right. Rail contents: Home (DM) item with a chat-bubble icon, separator (2 px × 32 px `--border`), servers (Phase 2), "+" add. Sidebar: `--bg-base` with the list container having `border-top-left-radius: 12px` over `--bg-raised`? — no: per the reference the *sidebar list* stays on `--bg-base` and the *chat pane* is the raised surface with radius 12 on its top-left corner; keep that. Sidebar top: 49 px search button "Find or start a conversation" (`--bg-input`, radius 4, 12 px muted text) then nav items "Friends" (32 px icon row, 42 px tall) then header "Direct messages" (12 px/600 uppercase muted, 40 px row with "+" at right) then DM items (44 px tall, 32 px avatar with status dot, name 16 px/500, sub-line 12 px muted (custom status / "N members"), close × on hover, selected `--bg-selected` radius 4, margin 0 8 px). User panel (bottom of sidebar): 52 px card `--bg-surface` radius 8 margin 8, 32 px avatar with status, display name 14 px/600 + username/custom status 12 px muted, icon buttons mute/deafen/settings 32 px; clicking avatar opens the status popover (Online/Idle/DND/Invisible + "Set custom status").

**Tablet (768–1023):** members list becomes an overlay toggle; sidebar 240 stays. **Phone (< 768):** single pane; rail+sidebar in a left drawer (width 100% - 56 px), members in a right drawer; edge-swipe and a hamburger in the header open them; drawers animate 200 ms; body scroll locked; `100dvh`; safe-area padding.

Theming: `data-theme` on `<html>` from settings (`system` follows `prefers-color-scheme`), `--font-scale` applied to `html { font-size }`, accent → `--brand`.

- [ ] **Step 1:** Component tests: rail selection pill for active route, DM list sorting by last message, user panel status popover changes presence (mock gateway), drawer opens on hamburger click (jsdom). — [ ] **Step 2:** Implement. — [ ] **Step 3:** Screenshots at 1920×1080, 1366×768, 820×1180, 390×844 with seeded fake data (a `?demo=1` dev flag that loads fixture stores, only in dev builds); compare against synthetic screenshots for proportions; fix. — [ ] **Step 4: Commit** — `git commit -am "feat: app shell with rail, DM sidebar, user panel, responsive drawers"`.

---

### Task 21: Chat view — header, virtualised message list, message row, reactions, hover toolbar, context menu, typing bar

**Files:** Create `web/src/components/chat/{ChatView.tsx,ChatHeader.tsx,MessageList.tsx,MessageItem.tsx,MessageContent.tsx,Reactions.tsx,MessageToolbar.tsx,MessageContextMenu.tsx,DateDivider.tsx,UnreadDivider.tsx,TypingBar.tsx,JumpToPresent.tsx,PinsPanel.tsx,EmptyChannel.tsx,Chat.module.css}`, `pages/DMPage.tsx`.

**Contract:** Header 49 px on `--bg-raised` with 1 px bottom `--border-subtle`: for DMs `@` icon + display name 16 px/600 + status dot, right side icon buttons (call, video, pins, add friends to DM, members toggle, search field 144 px → 240 px on focus). Message list: `@tanstack/react-virtual` with dynamic measurement (`measureElement`), anchored to bottom (`scrollToIndex(last)` on new messages when within 100 px of bottom; otherwise show "New messages" jump pill), load older when the first 10 rows enter view (keep scroll offset by adjusting after prepend), skeleton loaders. Rows: group start when author changes, > 7 min gap, or a reply; group-start row `padding: 2px 24px 2px 72px; margin-top: 17px` with 40 px avatar at `left: 16px; top: 2px`, header line `username 16px/500 (role colour later) · timestamp 12px/500 muted "Today at 4:10 PM" / "Yesterday at" / "MM/DD/YYYY h:mm A"`; continuation rows show the `h:mm A` timestamp in the 72 px gutter on hover (11 px). Content 16 px/22 px `--text` via `Markdown`. Reply preview line above a reply (24 px, avatar 16 px, name, first line, click → jump/highlight 2 s `--mention-bg`). Attachments (Task 24) and embeds below content. Reactions row: pills 24 px tall radius 8, `--bg-surface` border 1 px transparent; mine → `--mention-bg` border `--brand`; hover tooltip lists reactors; "+" add. Hover: row bg `rgba(151,151,159,0.06)` and toolbar (top-right, floating on `--bg-floating` radius 4 shadow-low) with react / edit (own) / reply / more. Context menu (right-click) with the items from the reference (Add Reaction › quick 4 recent, Edit, Reply, Forward (disabled until P2), Copy Text, Pin/Unpin, Mark Unread, Copy Message Link, Copy ID (dev mode), Delete (danger, confirm modal)). Dividers: date (centered 12 px/600 muted with lines), unread (red line "NEW" pill at right). Typing bar 24 px above composer: "**A** is typing…", "**A** and **B** are typing…", "Several people are typing…" with 3-dot animation. Empty state at top of history: 80 px avatar, display name 32 px/700, username, "This is the beginning of your direct message history with **X**." Message decrypt states: `no_key` → italic muted "Waiting for encryption key…" with a lock icon; `bad` → "Could not decrypt this message". System messages (member add/remove/pin) render centered-icon rows.

- [ ] **Step 1:** Tests: grouping logic (`shouldGroup(prev, next)`), timestamp formatting, reaction toggle optimistic update rollback on API error, context menu items depend on ownership. — [ ] **Step 2:** Implement. — [ ] **Step 3:** Screenshot review with demo data (long history 300 messages; scroll performance check by scripted scrolling: no dropped frames in DevTools trace is not measurable here — verify with Playwright that scrolling 5000 px keeps the list responsive (`page.evaluate` timing < 100 ms per scroll step)). — [ ] **Step 4: Commit** — `git commit -am "feat: chat view with virtualised list, message rows, reactions, context menu"`.

---

### Task 22: Composer — autosize input, send/edit/reply, autocomplete, text commands, drafts, attachments tray, emoji picker (unicode)

**Files:** Create `web/src/components/composer/{Composer.tsx,Composer.module.css,Autocomplete.tsx,AttachmentTray.tsx,ReplyBar.tsx,EditBar.tsx,commands.ts,useAutosize.ts}`, `web/src/components/pickers/{ExpressionPicker.tsx,EmojiPicker.tsx,EmojiGrid.tsx,emojiIndex.ts,Picker.module.css}`; Modify `ChatView.tsx`.

**Contract:** Container margin `0 16px 24px` on `--bg-surface` radius 8, min-height 44 px, `+` attach button 40 px at left (file input multiple), textarea 16 px/22 px padding `11px 10px 11px 0` autosize to 50 vh, right buttons (gift-less): emoji (opens picker), GIF, sticker (Phase 3 fills), send button visible on phones only. Enter sends; Shift+Enter newline; on touch devices Enter is newline. Slowmode not applicable to DMs. Empty/whitespace messages blocked; 4000 char cap with counter after 3800 (`--danger` when over). Drafts saved per channel to settings (debounced 1 s). `↑` in empty composer edits your last message; Esc cancels edit/reply. Reply bar 32 px above composer "Replying to **Name**" with a ping toggle (@ on/off) and ×. Edit mode replaces the message row with an inline editor and "escape to cancel • enter to save" hint. Autocomplete popover (above the composer, `--bg-floating`, radius 8, shadow-high, max 8 rows 40 px): `@` → participants + friends (display name, username), `#` → (Phase 2 channels; DMs: none), `:xx` → emoji (unicode from emojibase index: shortcode + name search, custom later) with arrow-key navigation, Tab/Enter to insert, mouse hover selects. Commands (typed at start): `/shrug` `/tableflip` `/unflip` `/lenny` append ASCII; `/me text` → `*text*`; `/spoiler text` → `||text||`. Pasting an image inserts an attachment; drag-over shows a full-pane drop overlay ("Upload to **@Name**"). Attachment tray above the textarea: 200 px cards with image/video thumbnails, filename (editable), size, spoiler toggle, remove; encrypted upload progress bar per file (Task 24 wires the crypto/worker). Emoji picker: 498×498 (phone: full-width sheet), search box 32 px, category rail 40 px wide with 9 lucide icons, grid 40 px cells with 32 px emoji, section headers 12 px/600 uppercase sticky, skin-tone selector (persisted), inspector footer showing `:shortcode:` 40 px; "Frequently used" from `settings.recentEmoji` (max 40).

Send flow: `keys.ensureConvKey(channelId)` → `channelKey` → `encryptMessage` → optimistic insert (pending id `tmp-…`, greyed) → POST with nonce → replace by server message (or mark failed with retry/delete).

- [ ] **Step 1:** Tests: command expansion, autocomplete query extraction (`"hi @al"` → `{kind:"user", q:"al"}`), Enter vs Shift+Enter, char counter, draft restore. — [ ] **Step 2:** Implement. — [ ] **Step 3:** Screenshots incl. open emoji picker (desktop + phone). — [ ] **Step 4: Commit** — `git commit -am "feat: composer with autocomplete, replies, edits, drafts, emoji picker"`.

---

### Task 23: Friends page, DM creation, group DM management, profile popout, user settings modal

**Files:** Create `web/src/pages/FriendsPage.tsx`, `components/friends/{FriendsList.tsx,FriendRow.tsx,AddFriend.tsx,Friends.module.css}`, `components/modals/{CreateGroupDM.tsx,ConfirmModal.tsx,GroupDMSettings.tsx}`, `components/profile/{ProfilePopout.tsx,ProfileCard.tsx,Profile.module.css}`, `components/settings/{SettingsLayout.tsx,SettingsNav.tsx,AccountPage.tsx,ProfilePage.tsx,AppearancePage.tsx,PrivacyPage.tsx,SessionsPage.tsx,Settings.module.css,ImageCropUpload.tsx,StatusModal.tsx}`.

**Contract:** Friends page: header tabs Online / All / Pending / Blocked / **Add Friend** (brand button), 40 px search, sections "Online — N", rows 62 px (32 px avatar, name 16/600 + status 14 muted, hover shows message and ⋮ buttons), pending shows incoming/outgoing with accept ✓ / decline ✗, Add Friend input "You can add friends with their username." with success/error banners. Group DM creation modal: friend checklist (max 24), optional name, creates channel; group settings (name, icon upload, members list with remove for owner, leave). Profile popout (anchored, 300 px wide, `--bg-floating`, radius 8, shadow-high): banner 60 px (accent colour or image), 80 px avatar overlapping with 6 px border, display name 20/700, username 14 muted, pronouns, custom status, "About me" (Markdown, unlimited but the popout scrolls after 300 px), member since, mutual friends count, actions: Message, Add Friend/Pending/Remove, Block, Copy user ID (dev). Own popout adds "Edit profile". User settings modal (full-screen layer, Esc/× closes, route `?settings=account`): nav 218 px with headers "User settings" (My Account, Profiles, Privacy & Safety, Devices), "App settings" (Appearance, Notifications (Task 25), Voice & Video (Phase 4)), Log Out; content 740 px. My Account: card with banner/avatar/display name/username and "Edit" buttons, password change modal (needs current password → derive both → API), "Reveal recovery key" (not possible — instead "Generate a new recovery key" which re-wraps and replaces), delete account (typing username to confirm; API `DELETE /users/@me` — add to Task 6's handler set now: deletes sessions, anonymises username to `deleted-<id>`, keeps messages). Profiles: display name, pronouns, avatar (upload with preview incl. animated, crop to square client-side via canvas *only for static images*; animated files are sent as-is), banner, accent colour, about me (textarea with live markdown preview, no limit). Privacy: DM privacy (everyone / friends / nobody → server `dm_privacy`), link previews toggle, "Proxy images" (P3, hidden). Devices: sessions list with current highlighted and "Log out" per device / all others. Appearance: theme cards (Dark/Light/Ash/Onyx/System) with live preview, accent colour picker (preset swatches + hex), font scale slider 12–20 px, message display cozy/compact, reduced motion. Status modal: emoji + text + clear-after.

- [ ] **Step 1:** Tests: friends filtering by tab/search, add-friend error mapping, settings nav routing, theme switch sets `data-theme`, avatar upload rejects > 10 MiB client-side. — [ ] **Step 2:** Implement. — [ ] **Step 3:** Screenshots: friends page, profile popout, settings (account, profiles, appearance) on desktop and phone. — [ ] **Step 4: Commit** — `git commit -am "feat: friends, group DMs, profile popout, user settings"`.

---

### Task 24: Attachments (encrypted upload/download in a worker), lightbox, link/GIF/video/YouTube embeds, favourite GIFs

**Files:** Create `web/src/crypto/worker.ts` (+ `workerClient.ts`), `components/chat/{Attachments.tsx,ImageAttachment.tsx,VideoAttachment.tsx,AudioAttachment.tsx,FileAttachment.tsx,Lightbox.tsx,Embeds.tsx,LinkEmbed.tsx,ImageEmbed.tsx,VideoEmbed.tsx,YouTubeEmbed.tsx}`, `lib/mediaCache.ts`, `stores/media.ts`; Modify `Composer.tsx`, `MessageItem.tsx`, `settings.ts`.

**Contract:** Worker performs `encryptFile`/`decryptFile` (transferable ArrayBuffers) with progress messages. Upload: for each file → worker encrypt → `api.upload` with progress → `blob_id`; the message payload gets `att[]` with name/type/size/dims (read via `createImageBitmap` / video metadata) and the key. Download: on first view, fetch ciphertext (`/media/attachments/{id}`) → worker decrypt → `URL.createObjectURL`, cached in an LRU (`mediaCache`, 200 MB budget, revokes URLs on eviction); images ≤ 2 MB decrypt eagerly when visible (IntersectionObserver), larger show a placeholder with size and "Load" (auto on desktop). Rendering sizes like Discord: max 550×350 keeping aspect, min 100 px, radius 8, spoiler overlay blur with "SPOILER" pill until clicked; video with native controls poster from first frame; audio bar with play/seek/duration; generic file card 432 px (icon, name, size, download button which triggers decrypt then `a[download]`). Lightbox: fullscreen overlay, image fit, zoom on click (1×→2×, drag to pan), arrows between images in the same message, "Open original" (blob URL) and download, Esc closes. Embeds: sender-side — when composing, URLs detected in the text are unfurled (debounced 600 ms, only if `settings.linkPreviews`) and the results attached to `payload.embeds` (max 5); recipients render from payload without network. Link embed card: 4 px left border (`--brand`), `--bg-surface`, radius 4, padding 8 16, max-width 516: site name 12 muted, title 16/600 link, description 14 (clamped 3 lines), thumbnail 80×80 right or large image ≤ 400 wide below; image/GIF URLs render as ImageEmbed (max 400×300; GIF plays; "GIF" badge; ★ favourite button on hover → `settings.favoriteGifs`); direct video → native player; YouTube → 16:9 iframe `https://www.youtube-nocookie.com/embed/{id}` loaded on click of a thumbnail (`https://i.ytimg.com/vi/{id}/hqdefault.jpg`). Own message "Remove embeds" in context menu sets `flags & SUPPRESS_EMBEDS` via PATCH (server keeps flag in plaintext `flags`). GIF tab in the picker (Task 22) lists favourites (masonry 2 columns) and sends the URL as message text so it embeds.

- [ ] **Step 1:** Tests: attachment size fit function, URL extraction for unfurl (dedupe, `<no-embed>` excluded), media cache eviction, worker round trip in vitest via direct function calls. — [ ] **Step 2:** Implement. — [ ] **Step 3:** Manual e2e: send image/video/file/GIF link/YouTube/OG link between two contexts; screenshots. — [ ] **Step 4: Commit** — `git commit -am "feat: encrypted attachments, lightbox, link and media embeds, favourite GIFs"`.

---

### Task 25: Notifications, sounds, unread badges, keyboard shortcuts, quick switcher, PWA service worker, tooling scripts

**Files:** Create `web/src/lib/{sounds.ts,notify.ts,shortcuts.ts,title.ts}`, `components/modals/{QuickSwitcher.tsx,ShortcutsHelp.tsx}`, `components/settings/NotificationsPage.tsx`, `web/src/sw.ts` (+ `vite` build as a separate entry to `dist/sw.js`), `tools/screenshot.py`, `tools/e2e.py`, `tools/requirements.txt`, `tools/README.md`.

**Contract:** Sounds synthesised with an `AudioContext` (message: 2-note 880→1174 Hz sine 90 ms; mention: 3 notes; call ring: repeating 2-tone 1 s; join/leave: short up/down chirps), gated by settings and user gesture unlock. Notifications: `Notification` permission prompt from the settings page; on `message_create` not from me, in a non-focused window or non-active channel, unless muted/DND → desktop notification with display name and decrypted preview (plainText, 120 chars) + click focuses channel. Title: `(N) Evilion Chat` where N = total mentions + unread DMs. Shortcuts (registered centrally; ignored while typing except where noted): `Ctrl/Cmd+K` quick switcher (fuzzy over DMs, friends; Phase 2 adds channels/servers), `Esc` (in chat: mark read + clear reply/edit), `Alt+↑/↓` previous/next DM, `Ctrl+Shift+M` / `Ctrl+Shift+D` (Phase 4 mute/deafen; stub no-op now), `Ctrl+E` emoji picker, `Ctrl+/` help sheet, `Shift+PageUp/Down` scroll list. PWA: `manifest.webmanifest` (name, short_name "Chat", icons 192/512, `display: standalone`, theme/background `#2c2d32`, start_url `/channels/@me`), service worker caching the app shell (cache-first for `/assets/*`, network-first for `index.html`, never caches `/api`, `/gateway`, `/media/attachments`), registered from `main.tsx` in production only. Tooling: `tools/screenshot.py <url> <out.png> [--viewport WxH] [--login user:pass] [--goto path]` (uses the venv at `/private/tmp/…/pwvenv` or `tools/.venv` — `tools/README.md` says `python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt && PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac14 tools/.venv/bin/python -m playwright install chromium`); `tools/e2e.py`: starts `bin/chatd` on a temp `DATA_DIR` and free port, drives two browser contexts (register alice & bob → bob adds alice → alice accepts → alice DMs bob "hello **bob**" → asserts bob sees the decrypted bold text → bob reacts 👍 → alice sees reaction → alice uploads a PNG → bob opens lightbox → group DM with a third user → key `no_key` state resolves after grant), then takes the four-viewport screenshot set into `tools/out/`; exits non-zero on any failure.

- [ ] **Step 1:** Tests: title count, shortcut matching (`isShortcut(e, "Ctrl+Shift+M")` with mod-key normalisation for macOS), quick switcher ranking. — [ ] **Step 2:** Implement. — [ ] **Step 3:** Run `tools/e2e.py` → passes; review screenshots in `tools/out/`. — [ ] **Step 4: Commit** — `git commit -am "feat: notifications, sounds, shortcuts, quick switcher, PWA, e2e tooling"`.

---

### Task 26: Phase-1 release — build, install as daemon, verify startup, docs

**Files:** Create `README.md` (repo root: what it is, how to build/run/update/back up, config keys, the DNS step, architecture pointer), `docs/superpowers/plans/…` checkboxes ticked; Modify `deploy/README.md`.

- [ ] **Step 1:** `make test` green; `make build`; `sudo bash deploy/install.sh` → daemon running; `curl -s http://127.0.0.1:8090/api/health`; `sudo launchctl kickstart -k system/xyz.evilion.chat` and confirm it comes back within 5 s; reboot-safety reasoning: `RunAtLoad` + `KeepAlive` in the plist, verified with `sudo launchctl print system/xyz.evilion.chat | grep -E "state|runs"`.
- [ ] **Step 2:** If `dig +short chat.evilion.xyz` resolves: `curl -s https://chat.evilion.xyz/api/health` and a public screenshot; else leave the DNS instructions in the final report.
- [ ] **Step 3:** Restore Discord to a normal launch (quit and reopen without the debug flag) — it was relaunched with `--remote-debugging-port=9222` for UI reference capture.
- [ ] **Step 4: Commit** — `git commit -am "docs: README and phase-1 release notes"`.

---

## Self-review

- **Spec coverage (Phase 0–1 scope):** §2 layout → Tasks 1–3, 12–14; §4 tables → Task 3 (all tables incl. Phase-2/3 ones); §5.1 auth/users/channels/messages/relationships/keys/unfurl/media/health → Tasks 6, 7, 10, 11, 12; §5.2 gateway → Tasks 9, 16, 17; §5.4 auth → Tasks 5, 6, 15, 19; §5.5 media → Task 7, 24; §5.6 unfurl → Task 12, 24; §5.7 hardening → Tasks 5, 12; §6 crypto (identity, epochs, grants, reconciliation, envelope, attachments, rotation for DMs) → Tasks 11, 15, 17, 22, 24; §7.1–7.5 frontend → Tasks 14–25; §10 deploy → Tasks 13, 26; §11 tests → each task + Task 25 e2e. Not in this plan by design: servers/roles/permissions (§5.3, §7 server screens), expressions beyond unicode emoji (custom emoji, stickers, Tenor), voice (§8), search/admin/export — they are Phases 2–5.
- **Placeholder scan:** none of "TBD/TODO/later" remain; every code step carries code or an exact contract; "Phase 2 wires…" notes name the exact hook that exists now (`noopBroadcaster`, `store.Entitled`, `ViewerResolver`, `dm_privacy`).
- **Type consistency:** `ids.ID` string JSON (Task 2) ↔ TS `string` ids (Task 16); `Envelope {v, conv, epoch, iv, ct}` identical in Task 10 validation and Task 15; `Aad` order `conv|epoch|channelId|authorId` used by Task 15 and documented for Task 10's server (server never decrypts, so only field names matter); `KeyGrant {conv_id, epoch, user_id, wrapped_key, wrapped_by}` identical in Tasks 8, 11, 16, 17; `store.Entitled` referenced by Task 11 is created there; `hub.NudgeKeys` created in Task 11 and used by Task 10's message create (Task 10 must call it through the `Broadcaster` interface — add `KeysMaybeNeeded(convID)` to that interface in Task 5 as a no-op until Task 11).
