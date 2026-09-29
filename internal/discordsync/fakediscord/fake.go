// Package fakediscord stands in for Discord in tests: the REST calls the
// activity sync makes (OAuth tokens, the account, adding and removing
// members) and a bot gateway that says hello, takes an identify or a resume,
// answers member requests and sends whatever presence a test pushes.
package fakediscord

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Server is a fake Discord.
type Server struct {
	*httptest.Server
	GuildID string
	OwnerID string
	BotID   string
	// Intents are what the last identify asked for.
	Intents int

	mu        sync.Mutex
	users     map[string]User   // Discord accounts, by id
	codes     map[string]string // OAuth codes, to the account they sign in as
	access    map[string]string // access tokens, to their account
	refresh   map[string]string // refresh tokens, to their account
	members   map[string]bool
	conn      *websocket.Conn
	seq       int64
	session   string
	identify  int
	resume    int
	revoked   []string
	removed   []string
	scope     string
	failJoin  bool
	nextToken int
}

// User is a Discord account.
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Global   string `json:"global_name"`
	Avatar   string `json:"avatar"`
}

// New starts a fake Discord with one guild, owned by someone else.
func New() *Server {
	f := &Server{GuildID: "900000000000000001", OwnerID: "900000000000000002", BotID: "900000000000000003",
		users: map[string]User{}, codes: map[string]string{}, access: map[string]string{}, refresh: map[string]string{},
		members: map[string]bool{"900000000000000002": true, "900000000000000003": true}, scope: "identify guilds.join"}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v10/gateway/bot", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bot bot-token" {
			http.Error(w, `{"message":"401: Unauthorized","code":0}`, http.StatusUnauthorized)
			return
		}
		writeJSON(w, map[string]any{"url": "ws://" + r.Host + "/gw", "shards": 1, "session_start_limit": map[string]any{"total": 1000, "remaining": 999, "reset_after": 0, "max_concurrency": 1}})
	})
	mux.HandleFunc("POST /api/v10/oauth2/token", f.token)
	mux.HandleFunc("POST /api/v10/oauth2/token/revoke", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.mu.Lock()
		f.revoked = append(f.revoked, r.PostForm.Get("token"))
		f.mu.Unlock()
		writeJSON(w, map[string]any{})
	})
	mux.HandleFunc("GET /api/v10/users/@me", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		id := f.access[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
		u, ok := f.users[id]
		f.mu.Unlock()
		if !ok {
			http.Error(w, `{"message":"401: Unauthorized","code":0}`, http.StatusUnauthorized)
			return
		}
		writeJSON(w, u)
	})
	mux.HandleFunc("GET /api/v10/guilds/{guild}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"id": f.GuildID, "owner_id": f.OwnerID})
	})
	mux.HandleFunc("PUT /api/v10/guilds/{guild}/members/{user}", f.addMember)
	mux.HandleFunc("DELETE /api/v10/guilds/{guild}/members/{user}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("user")
		f.mu.Lock()
		f.removed = append(f.removed, id)
		delete(f.members, id)
		f.mu.Unlock()
		f.dispatch("GUILD_MEMBER_REMOVE", map[string]any{"guild_id": f.GuildID, "user": map[string]any{"id": id}})
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /gw", f.gateway)
	f.Server = httptest.NewServer(mux)
	return f
}

// API is the address the sync service calls as Discord's REST API.
func (f *Server) API() string { return f.URL + "/api/v10" }

// AddUser makes a Discord account and returns a code that signs in as it, as
// Discord's page would hand back to the redirect.
func (f *Server) AddUser(id, username string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.users[id] = User{ID: id, Username: username, Global: strings.ToUpper(username[:1]) + username[1:], Avatar: "0123456789abcdef0123456789abcdef"}
	code := "code-" + id + fmt.Sprint(len(f.codes))
	f.codes[code] = id
	return code
}

// Scope sets the scope the next tokens are granted with.
func (f *Server) Scope(scope string) {
	f.mu.Lock()
	f.scope = scope
	f.mu.Unlock()
}

// FailJoin makes adding members fail, as Discord does for someone banned from the server.
func (f *Server) FailJoin(fail bool) {
	f.mu.Lock()
	f.failJoin = fail
	f.mu.Unlock()
}

// Member says whether an account is in the guild.
func (f *Server) Member(id string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.members[id]
}

// Revoked and Removed are the tokens revoked and the members removed, in order.
func (f *Server) Revoked() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.revoked...)
}

func (f *Server) Removed() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.removed...)
}

// Sessions says how many identifies and resumes the gateway has had.
func (f *Server) Sessions() (identifies, resumes int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.identify, f.resume
}

// Presence sends a PRESENCE_UPDATE for an account.
func (f *Server) Presence(id, status string, activities ...map[string]any) {
	if activities == nil {
		activities = []map[string]any{}
	}
	f.dispatch("PRESENCE_UPDATE", map[string]any{"user": map[string]any{"id": id}, "guild_id": f.GuildID, "status": status, "activities": activities})
}

// Leave takes an account out of the guild, as leaving it on Discord does.
func (f *Server) Leave(id string) {
	f.mu.Lock()
	delete(f.members, id)
	f.mu.Unlock()
	f.dispatch("GUILD_MEMBER_REMOVE", map[string]any{"guild_id": f.GuildID, "user": map[string]any{"id": id}})
}

// Drop closes the gateway connection with a code, as Discord does when it wants a reconnect.
func (f *Server) Drop(code websocket.StatusCode) {
	f.mu.Lock()
	c := f.conn
	f.mu.Unlock()
	if c != nil {
		_ = c.Close(code, "fake drop")
	}
}

func (f *Server) token(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	if r.PostForm.Get("client_id") != "client-id" || r.PostForm.Get("client_secret") != "client-secret" {
		w.WriteHeader(http.StatusUnauthorized)
		writeJSON(w, map[string]any{"error": "invalid_client"})
		return
	}
	f.mu.Lock()
	var id string
	var ok bool
	switch r.PostForm.Get("grant_type") {
	case "authorization_code":
		id, ok = f.codes[r.PostForm.Get("code")]
		delete(f.codes, r.PostForm.Get("code"))
		if !strings.HasSuffix(r.PostForm.Get("redirect_uri"), "/api/v1/connections/discord/callback") {
			ok = false
		}
	case "refresh_token":
		id, ok = f.refresh[r.PostForm.Get("refresh_token")]
		delete(f.refresh, r.PostForm.Get("refresh_token"))
	}
	if !ok {
		f.mu.Unlock()
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "invalid_grant"})
		return
	}
	f.nextToken++
	access, refresh := fmt.Sprintf("access-%s-%d", id, f.nextToken), fmt.Sprintf("refresh-%s-%d", id, f.nextToken)
	f.access[access], f.refresh[refresh] = id, id
	scope := f.scope
	f.mu.Unlock()
	writeJSON(w, map[string]any{"access_token": access, "refresh_token": refresh, "token_type": "Bearer", "expires_in": 604800, "scope": scope})
}

func (f *Server) addMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("user")
	var body struct {
		AccessToken string `json:"access_token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.mu.Lock()
	if r.Header.Get("Authorization") != "Bot bot-token" || f.access[body.AccessToken] != id || r.PathValue("guild") != f.GuildID {
		f.mu.Unlock()
		w.WriteHeader(http.StatusForbidden)
		writeJSON(w, map[string]any{"message": "Missing Access", "code": 50001})
		return
	}
	if f.failJoin {
		f.mu.Unlock()
		w.WriteHeader(http.StatusForbidden)
		writeJSON(w, map[string]any{"message": "You are banned from this guild", "code": 40007})
		return
	}
	already := f.members[id]
	f.members[id] = true
	f.mu.Unlock()
	if already {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	f.dispatch("GUILD_MEMBER_ADD", map[string]any{"guild_id": f.GuildID, "user": map[string]any{"id": id}})
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]any{"user": map[string]any{"id": id}})
}

func (f *Server) gateway(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	ctx := r.Context()
	write := func(v any) error {
		raw, _ := json.Marshal(v)
		wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return c.Write(wctx, websocket.MessageText, raw)
	}
	if write(map[string]any{"op": 10, "d": map[string]any{"heartbeat_interval": 45000}}) != nil {
		return
	}
	for {
		_, raw, err := c.Read(ctx)
		if err != nil {
			f.mu.Lock()
			if f.conn == c {
				f.conn = nil
			}
			f.mu.Unlock()
			return
		}
		var m struct {
			Op int             `json:"op"`
			D  json.RawMessage `json:"d"`
		}
		_ = json.Unmarshal(raw, &m)
		switch m.Op {
		case 1:
			_ = write(map[string]any{"op": 11})
		case 2:
			var d struct {
				Token   string `json:"token"`
				Intents int    `json:"intents"`
			}
			_ = json.Unmarshal(m.D, &d)
			if d.Token != "bot-token" {
				_ = c.Close(4004, "Authentication failed.")
				return
			}
			f.mu.Lock()
			f.identify++
			f.Intents = d.Intents
			f.session = fmt.Sprintf("session-%d", f.identify)
			f.seq = 0
			f.conn = c
			session := f.session
			f.mu.Unlock()
			f.dispatch("READY", map[string]any{"v": 10, "session_id": session, "resume_gateway_url": "ws://" + r.Host + "/gw", "user": map[string]any{"id": f.BotID, "bot": true}, "guilds": []any{map[string]any{"id": f.GuildID, "unavailable": true}}})
			f.dispatch("GUILD_CREATE", map[string]any{"id": f.GuildID, "owner_id": f.OwnerID, "presences": []any{}})
		case 6:
			var d struct {
				SessionID string `json:"session_id"`
			}
			_ = json.Unmarshal(m.D, &d)
			f.mu.Lock()
			ok := d.SessionID == f.session
			if ok {
				f.resume++
				f.conn = c
			}
			f.mu.Unlock()
			if !ok {
				_ = write(map[string]any{"op": 9, "d": false})
				continue
			}
			f.dispatch("RESUMED", map[string]any{})
		case 8:
			var d struct {
				GuildID string   `json:"guild_id"`
				UserIDs []string `json:"user_ids"`
				Nonce   string   `json:"nonce"`
			}
			_ = json.Unmarshal(m.D, &d)
			f.mu.Lock()
			var members []any
			for id := range f.members {
				if len(d.UserIDs) > 0 && !contains(d.UserIDs, id) {
					continue
				}
				members = append(members, map[string]any{"user": map[string]any{"id": id}})
			}
			f.mu.Unlock()
			f.dispatch("GUILD_MEMBERS_CHUNK", map[string]any{"guild_id": d.GuildID, "members": members, "presences": []any{}, "chunk_index": 0, "chunk_count": 1, "nonce": d.Nonce})
		}
	}
}

// dispatch sends an event on the open gateway connection, if there is one.
func (f *Server) dispatch(event string, d any) {
	f.mu.Lock()
	c := f.conn
	f.seq++
	seq := f.seq
	f.mu.Unlock()
	if c == nil {
		return
	}
	raw, _ := json.Marshal(map[string]any{"op": 0, "t": event, "s": seq, "d": d})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = c.Write(ctx, websocket.MessageText, raw)
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
