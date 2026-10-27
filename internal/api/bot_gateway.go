package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

// The bot gateway: the WebSocket bot libraries connect to (the address
// GET /gateway/bot gives them), speaking the protocol's opcodes. A session is
// one bot's view of everything that happens where it is. It hangs off the
// Nexa gateway hub as one of the bot account's connections
// (gateway.External), so whatever the bot's account may see reaches it the
// way it reaches anyone, and every event is translated (bot_dispatch.go) into
// the protocol's, filtered by the intents the bot asked for and the shard it
// is. Sessions outlive their socket for a while, so a library that lost its
// connection resumes and is sent what it missed.

const (
	botHeartbeatInterval = 41250 * time.Millisecond
	// botResumeWindow is how long a session waits for its library to come
	// back and resume after its socket closed
	botResumeWindow = 2 * time.Minute
	// botReplayKeep is how many events a session keeps for a resume
	botReplayKeep = 4096
	// botInbox is how many of the hub's events wait to be translated
	botInbox = 4096
	// botSendRate is what a bot may send: 120 frames a minute, as the protocol allows
	botSendRate = 120
	// botIdentifyWait is how long a socket may stay up before identifying
	botIdentifyWait = 20 * time.Second
)

// botRuntime holds the bot gateway's sessions and the interactions waiting
// for their first answer.
type botRuntime struct {
	mu       sync.Mutex
	sessions map[string]*botSession
	byBot    map[ids.ID]map[*botSession]bool
	// answers are interactions waiting for an application's first answer
	answers map[ids.ID]chan *interactionAnswer
	// starts are when each bot started its sessions, over the last day
	starts map[ids.ID][]time.Time
}

func newBotRuntime() *botRuntime {
	return &botRuntime{sessions: map[string]*botSession{}, byBot: map[ids.ID]map[*botSession]bool{}, answers: map[ids.ID]chan *interactionAnswer{},
		starts: map[ids.ID][]time.Time{}}
}

func (rt *botRuntime) add(s *botSession) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.sessions[s.id] = s
	set := rt.byBot[s.bot.ID]
	if set == nil {
		set = map[*botSession]bool{}
		rt.byBot[s.bot.ID] = set
	}
	set[s] = true
}

func (rt *botRuntime) remove(s *botSession) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	delete(rt.sessions, s.id)
	if set := rt.byBot[s.bot.ID]; set != nil {
		delete(set, s)
		if len(set) == 0 {
			delete(rt.byBot, s.bot.ID)
		}
	}
}

func (rt *botRuntime) get(id string) *botSession {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return rt.sessions[id]
}

// sessionsOf lists a bot's sessions.
func (rt *botRuntime) sessionsOf(bot ids.ID) []*botSession {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	out := make([]*botSession, 0, len(rt.byBot[bot]))
	for s := range rt.byBot[bot] {
		out = append(out, s)
	}
	return out
}

// botEvent is one dispatch a session sent, kept for a resume.
type botEvent struct {
	seq     uint64
	payload botproto.Payload
}

// botSession is one identified bot connection's state.
type botSession struct {
	s      *Server
	id     string
	bot    *store.User
	app    *store.Application
	intent int64
	shard  [2]int
	large  int
	ext    *gateway.External
	inbox  chan gateway.ServerFrame
	stop   chan struct{}
	once   sync.Once

	mu       sync.Mutex
	seq      uint64
	replay   []botEvent
	sock     *botSocket
	closedAt time.Time
	// what this session has been told, for events that say less than the
	// protocol's do (a channel's deletion carries only its id)
	guilds   map[ids.ID]bool
	channels map[ids.ID]dChannel
	// amRules is when each AutoMod rule a server has was last changed, as
	// last sent, so a change is told as what it was (bot_audit.go)
	amRules map[ids.ID]map[ids.ID]int64
}

// botSocket is one WebSocket a session is on.
type botSocket struct {
	ws     *websocket.Conn
	codec  *botproto.Codec
	codeMu sync.Mutex
	out    chan botFrame
	closed chan struct{}
	once   sync.Once
	beat   time.Time
	beatMu sync.Mutex
	sent   []time.Time
	// identified is set once the socket has a session, for the watchdog
	identified atomic.Bool
}

// botFrame is one encoded frame waiting to be written.
type botFrame struct {
	b      []byte
	binary bool
}

func newBotSocket(ws *websocket.Conn, codec *botproto.Codec) *botSocket {
	return &botSocket{ws: ws, codec: codec, out: make(chan botFrame, 1024), closed: make(chan struct{}), beat: time.Now()}
}

// close ends the socket with a close code; the session lives on for a resume.
func (k *botSocket) close(code int, reason string) {
	k.once.Do(func() {
		close(k.closed)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = k.ws.Close(websocket.StatusCode(code), reason)
			<-ctx.Done()
			_ = k.ws.CloseNow()
		}()
	})
}

// send queues a payload; a socket too slow to take it is closed, and its
// library resumes and is sent what it missed.
func (k *botSocket) send(p *botproto.Payload) {
	select {
	case <-k.closed:
		return
	default:
	}
	// a zlib stream is one context for the whole socket: frames are encoded
	// one at a time, in the order they go out
	k.codeMu.Lock()
	defer k.codeMu.Unlock()
	b, binary, err := k.codec.Encode(p)
	if err != nil {
		return
	}
	select {
	case k.out <- botFrame{b, binary}:
	default:
		k.close(botproto.CloseUnknownError, "slow consumer")
	}
}

func (k *botSocket) writeLoop() {
	for {
		select {
		case <-k.closed:
			return
		case f := <-k.out:
			typ := websocket.MessageText
			if f.binary {
				typ = websocket.MessageBinary
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := k.ws.Write(ctx, typ, f.b)
			cancel()
			if err != nil {
				k.close(botproto.CloseUnknownError, "write failed")
				return
			}
		}
	}
}

func op(code int, d any) *botproto.Payload { return &botproto.Payload{Op: code, D: d} }

// botGatewayURL is where bots connect, as GET /gateway/bot gives it.
func (s *Server) botGatewayURL() string {
	u := strings.TrimRight(s.Cfg.PublicURL, "/")
	switch {
	case strings.HasPrefix(u, "https://"):
		u = "wss://" + strings.TrimPrefix(u, "https://")
	case strings.HasPrefix(u, "http://"):
		u = "ws://" + strings.TrimPrefix(u, "http://")
	}
	return u + "/bot-gateway"
}

func (s *Server) botGatewayRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /bot-gateway", s.handleBotGateway)
	mux.HandleFunc("GET /bot-gateway/", s.handleBotGateway)
}

// handleBotGateway runs one WebSocket of the bot gateway.
func (s *Server) handleBotGateway(w http.ResponseWriter, r *http.Request) {
	if s.hub == nil {
		http.Error(w, "the gateway is not running", http.StatusServiceUnavailable)
		return
	}
	release, err := s.hub.AdmitWaiting(auth.RateKey(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	defer release()
	q := r.URL.Query()
	enc, ok := botproto.ParseEncoding(q.Get("encoding"))
	if v := q.Get("v"); v != "" {
		if n, err := strconv.Atoi(v); err != nil || n < 6 || n > botproto.Version {
			ok = false
		}
	}
	// a token is the only credential, so pages anywhere may connect
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	ws.SetReadLimit(botproto.MaxInbound)
	codec := &botproto.Codec{Enc: enc, Compress: botproto.ParseCompression(q.Get("compress"))}
	sock := newBotSocket(ws, codec)
	go sock.writeLoop()
	if !ok {
		sock.close(botproto.CloseInvalidAPIVersion, "Invalid API version")
		return
	}
	sock.send(op(botproto.OpHello, map[string]any{"heartbeat_interval": botHeartbeatInterval.Milliseconds(), "_trace": []string{"[\"nexa-gateway\"]"}}))
	s.runBotSocket(r, sock, release)
}

// runBotSocket reads a socket's frames until it closes.
func (s *Server) runBotSocket(r *http.Request, sock *botSocket, releaseWaiting func()) {
	ctx := r.Context()
	ip := auth.RateKey(r)
	var sess *botSession
	defer func() {
		sock.close(int(websocket.StatusNormalClosure), "")
		if sess != nil {
			sess.socketGone(sock)
		}
	}()
	identifyBy := time.Now().Add(botIdentifyWait)
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-sock.closed:
				return
			case <-t.C:
				sock.beatMu.Lock()
				last := sock.beat
				sock.beatMu.Unlock()
				if !sock.identified.Load() && time.Now().After(identifyBy) {
					sock.close(botproto.CloseSessionTimedOut, "Session timed out")
					return
				}
				if time.Since(last) > botHeartbeatInterval+20*time.Second {
					sock.close(botproto.CloseUnknownError, "Heartbeat timed out")
					return
				}
			}
		}
	}()
	for {
		_, raw, err := sock.ws.Read(ctx)
		if err != nil {
			return
		}
		// 120 frames a minute
		now := time.Now()
		kept := sock.sent[:0]
		for _, t := range sock.sent {
			if now.Sub(t) < time.Minute {
				kept = append(kept, t)
			}
		}
		sock.sent = append(kept, now)
		if len(sock.sent) > botSendRate {
			sock.close(botproto.CloseRateLimited, "You are being rate limited.")
			return
		}
		in, err := sock.codec.Decode(raw)
		if err != nil {
			sock.close(botproto.CloseDecodeError, "Error while decoding payload.")
			return
		}
		switch in.Op {
		case botproto.OpHeartbeat:
			sock.beatMu.Lock()
			sock.beat = time.Now()
			sock.beatMu.Unlock()
			if sess != nil && sess.ext != nil {
				sess.ext.Beat()
			}
			sock.send(op(botproto.OpHeartbeatAck, nil))
		case botproto.OpIdentify:
			if sess != nil {
				sock.close(botproto.CloseAlreadyAuthenticated, "Already authenticated.")
				return
			}
			sess = s.botIdentify(ctx, sock, in.D, ip)
			if sess == nil {
				return
			}
			sock.identified.Store(true)
			releaseWaiting()
		case botproto.OpResume:
			if sess != nil {
				sock.close(botproto.CloseAlreadyAuthenticated, "Already authenticated.")
				return
			}
			sess = s.botResume(ctx, sock, in.D)
			if sess == nil {
				return
			}
			sock.identified.Store(true)
			releaseWaiting()
		default:
			if sess == nil {
				sock.close(botproto.CloseNotAuthenticated, "Not authenticated.")
				return
			}
			if !sess.handleOp(ctx, sock, in) {
				return
			}
		}
	}
}

type identifyPayload struct {
	Token          string          `json:"token"`
	Intents        *json.Number    `json:"intents"`
	Shard          []int           `json:"shard"`
	LargeThreshold int             `json:"large_threshold"`
	Compress       bool            `json:"compress"`
	Presence       json.RawMessage `json:"presence"`
}

// botByToken finds the bot a gateway token is for, as a REST request would.
func (s *Server) botByToken(ctx context.Context, token string) (*store.Application, *store.User, error) {
	token = strings.TrimSpace(token)
	if kind, rest, ok := strings.Cut(token, " "); ok && strings.EqualFold(kind, "Bot") {
		token = strings.TrimSpace(rest)
	}
	if token == "" {
		return nil, nil, store.ErrNotFound
	}
	app, err := s.Store.ApplicationByToken(ctx, tokenHash(token))
	if err != nil {
		return nil, nil, err
	}
	bot, err := s.Store.UserByID(ctx, app.ID)
	if err != nil || bot.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
		return nil, nil, store.ErrNotFound
	}
	if owner, err := s.Store.UserByID(ctx, app.OwnerID); err != nil || owner.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
		return nil, nil, store.ErrNotFound
	}
	if _, ban, err := s.Store.ActiveRestrictions(ctx, bot.ID, time.Now().UnixMilli()); err == nil && ban != nil {
		return nil, nil, store.ErrNotFound
	}
	return app, bot, nil
}

func newSessionID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// botIdentify starts a session.
func (s *Server) botIdentify(ctx context.Context, sock *botSocket, raw json.RawMessage, ip string) *botSession {
	var p identifyPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		sock.close(botproto.CloseDecodeError, "Error while decoding payload.")
		return nil
	}
	app, bot, err := s.botByToken(ctx, p.Token)
	if err != nil {
		sock.close(botproto.CloseAuthenticationFailed, "Authentication failed.")
		return nil
	}
	if p.Intents == nil {
		sock.close(botproto.CloseInvalidIntents, "Invalid intent(s).")
		return nil
	}
	intents, err := p.Intents.Int64()
	if err != nil || intents < 0 || intents&^botproto.AllIntents != 0 {
		sock.close(botproto.CloseInvalidIntents, "Invalid intent(s).")
		return nil
	}
	if botproto.Privileged(intents, app.Flags) != 0 {
		sock.close(botproto.CloseDisallowedIntents, "Disallowed intent(s).")
		return nil
	}
	// a bot starts at most so many sessions a day, as GET /gateway/bot says
	if !s.bots.startSession(bot.ID) {
		sock.send(op(botproto.OpInvalidSession, false))
		return nil
	}
	shard := [2]int{0, 1}
	if len(p.Shard) == 2 {
		shard = [2]int{p.Shard[0], p.Shard[1]}
	}
	if shard[1] < 1 || shard[0] < 0 || shard[0] >= shard[1] || shard[1] > 128 {
		sock.close(botproto.CloseInvalidShard, "Invalid shard.")
		return nil
	}
	large := p.LargeThreshold
	if large < 50 || large > 250 {
		large = 50
	}
	// payload compression only on a connection that compresses nothing else
	if p.Compress && !sock.codec.Compress.Transport() && sock.codec.Compress == botproto.CompressNone {
		sock.codec.Compress = botproto.CompressPayload
	}
	sess := &botSession{s: s, id: newSessionID(), bot: bot, app: app, intent: intents, shard: shard, large: large,
		inbox: make(chan gateway.ServerFrame, botInbox), stop: make(chan struct{}), sock: sock,
		guilds: map[ids.ID]bool{}, channels: map[ids.ID]dChannel{}}
	ext, err := s.hub.AttachExternal(ctx, bot, ids.New(), ip, sess.deliver, sess.hubClosed)
	if err != nil {
		sock.close(botproto.CloseUnknownError, err.Error())
		return nil
	}
	sess.ext = ext
	s.bots.add(sess)
	if len(p.Presence) > 0 && string(p.Presence) != "null" {
		sess.setPresence(ctx, p.Presence)
	}
	// ready and the servers first, then what happened meanwhile
	sess.sendReady(ctx)
	go sess.translateLoop()
	return sess
}

// botResume puts a socket back on a session it had, and sends what it missed.
func (s *Server) botResume(ctx context.Context, sock *botSocket, raw json.RawMessage) *botSession {
	var p struct {
		Token     string `json:"token"`
		SessionID string `json:"session_id"`
		Seq       uint64 `json:"seq"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		sock.close(botproto.CloseDecodeError, "Error while decoding payload.")
		return nil
	}
	_, bot, err := s.botByToken(ctx, p.Token)
	if err != nil {
		sock.close(botproto.CloseAuthenticationFailed, "Authentication failed.")
		return nil
	}
	sess := s.bots.get(p.SessionID)
	if sess == nil || sess.bot.ID != bot.ID {
		sock.send(op(botproto.OpInvalidSession, false))
		return nil
	}
	if !sess.attach(sock, p.Seq) {
		sock.send(op(botproto.OpInvalidSession, false))
		return nil
	}
	return sess
}

// attach puts a socket on the session, replaying what came after seq.
func (sess *botSession) attach(sock *botSocket, after uint64) bool {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	select {
	case <-sess.stop:
		return false
	default:
	}
	if after > sess.seq || (len(sess.replay) > 0 && after+1 < sess.replay[0].seq && after < sess.seq) {
		return false
	}
	if old := sess.sock; old != nil && old != sock {
		old.close(botproto.CloseUnknownError, "Resumed elsewhere")
	}
	sess.sock = sock
	sess.closedAt = time.Time{}
	for _, e := range sess.replay {
		if e.seq > after {
			p := e.payload
			sock.send(&p)
		}
	}
	name := "RESUMED"
	sock.send(&botproto.Payload{Op: botproto.OpDispatch, T: &name, S: &sess.seq, D: map[string]any{"_trace": []string{"[\"nexa-gateway\"]"}}})
	return true
}

// socketGone is told when the session's socket closed: the session waits
// for a resume, and ends if none comes.
func (sess *botSession) socketGone(sock *botSocket) {
	sess.mu.Lock()
	if sess.sock != sock {
		sess.mu.Unlock()
		return
	}
	sess.sock = nil
	sess.closedAt = time.Now()
	sess.mu.Unlock()
	time.AfterFunc(botResumeWindow, func() {
		sess.mu.Lock()
		gone := sess.sock == nil && !sess.closedAt.IsZero() && time.Since(sess.closedAt) >= botResumeWindow-time.Second
		sess.mu.Unlock()
		if gone {
			sess.end()
		}
	})
}

// end finishes the session for good.
func (sess *botSession) end() {
	sess.once.Do(func() {
		close(sess.stop)
		sess.s.bots.remove(sess)
		if sess.ext != nil {
			sess.ext.Detach()
		}
		sess.mu.Lock()
		sock := sess.sock
		sess.mu.Unlock()
		if sock != nil {
			sock.close(botproto.CloseSessionTimedOut, "Session ended")
		}
	})
}

// hubClosed is the hub ending the bot's connection: its token was reset, its
// application deleted, or Nexa's staff banned it. A server restart is not the
// bot's fault: it is told to reconnect, as Discord does, since its library
// gives up for good on Authentication failed.
func (sess *botSession) hubClosed(code int, reason string) {
	sess.mu.Lock()
	sock := sess.sock
	sess.mu.Unlock()
	if sock != nil {
		if code == int(websocket.StatusGoingAway) {
			sock.send(op(botproto.OpReconnect, nil))
			sock.close(botproto.CloseUnknownError, "Reconnect")
		} else {
			sock.close(botproto.CloseAuthenticationFailed, "Authentication failed.")
		}
	}
	sess.once.Do(func() {
		close(sess.stop)
		sess.s.bots.remove(sess)
	})
}

// deliver takes one of the hub's events; it must not block.
func (sess *botSession) deliver(f gateway.ServerFrame) {
	select {
	case sess.inbox <- f:
	default:
		// a session that cannot keep up starts again: its library is told to
		// reconnect, and resumes from what it has
		sess.mu.Lock()
		sock := sess.sock
		sess.mu.Unlock()
		if sock != nil {
			sock.send(op(botproto.OpReconnect, nil))
			sock.close(botproto.CloseUnknownError, "Reconnect")
		}
	}
}

// emit sends one dispatch, numbered, and keeps it for a resume.
func (sess *botSession) emit(event string, d any) {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.seq++
	seq := sess.seq
	name := event
	p := botproto.Payload{Op: botproto.OpDispatch, T: &name, S: &seq, D: d}
	sess.replay = append(sess.replay, botEvent{seq: seq, payload: p})
	if len(sess.replay) > botReplayKeep {
		sess.replay = append([]botEvent(nil), sess.replay[len(sess.replay)-botReplayKeep:]...)
	}
	if sess.sock != nil {
		sess.sock.send(&p)
	}
}

// wants reports whether the session takes an event by its intents.
func (sess *botSession) wants(event string, scope botproto.Scope) bool {
	need := botproto.Intent(event, scope)
	return need == 0 || sess.intent&need != 0
}

// emitIf sends an event the session's intents ask for.
func (sess *botSession) emitIf(event string, scope botproto.Scope, d any) {
	if sess.wants(event, scope) {
		sess.emit(event, d)
	}
}

// connected reports whether the session is on a socket now, rather than
// waiting for its library to come back and resume.
func (sess *botSession) connected() bool {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	return sess.sock != nil
}

// onShard reports whether a server's events belong to this session's shard;
// direct messages go to the first.
func (sess *botSession) onShard(guild *ids.ID) bool {
	if guild == nil {
		return sess.shard[0] == 0
	}
	return botproto.ShardOf(botproto.Out(*guild), sess.shard[1]) == sess.shard[0]
}

func (sess *botSession) builder(ctx context.Context) *dBuilder {
	return sess.s.builder(ctx, sess.bot, sess.app)
}

// selfUser is the bot as READY and USER_UPDATE give it.
func (sess *botSession) selfUser(b *dBuilder) dUser {
	u := b.userObj(sess.bot)
	f := false
	t := true
	u.MFAEnabled, u.Verified, u.Locale = &f, &t, "en-US"
	return u
}

// sendReady sends READY and then each of the shard's servers.
func (sess *botSession) sendReady(ctx context.Context) {
	b := sess.builder(ctx)
	servers, err := sess.s.Store.BotServers(ctx, sess.bot.ID)
	if err != nil {
		servers = nil
	}
	var mine []ids.ID
	unavailable := []map[string]any{}
	for _, id := range servers {
		gid := id
		if sess.onShard(&gid) {
			mine = append(mine, id)
			unavailable = append(unavailable, map[string]any{"id": snow(id), "unavailable": true})
		}
	}
	ready := map[string]any{
		"v": botproto.Version, "user": sess.selfUser(b), "guilds": unavailable, "session_id": sess.id, "resume_gateway_url": sess.s.botGatewayURL(),
		"shard": []int{sess.shard[0], sess.shard[1]}, "application": map[string]any{"id": snow(sess.app.ID), "flags": sess.app.Flags},
		"user_settings": map[string]any{}, "relationships": []any{}, "private_channels": []any{}, "presences": []any{},
		"guild_join_requests": []any{}, "geo_ordered_rtc_regions": []string{"nexa"}, "session_type": "normal", "auth": map[string]any{},
		"_trace": []string{"[\"nexa-gateway\"]"},
	}
	sess.emit("READY", ready)
	for _, id := range mine {
		srv, err := sess.s.Store.ServerByID(ctx, id)
		if err != nil {
			continue
		}
		sess.emitGuildCreate(ctx, srv)
	}
}

// dGuildCreate is a whole server as GUILD_CREATE carries it.
type dGuildCreate struct {
	dGuild
	JoinedAt                 *string        `json:"joined_at"`
	Large                    bool           `json:"large"`
	Unavailable              bool           `json:"unavailable"`
	Lazy                     bool           `json:"lazy"`
	MemberCount              int            `json:"member_count"`
	VoiceStates              []dVoiceState  `json:"voice_states"`
	Members                  []dMember      `json:"members"`
	Channels                 []dChannel     `json:"channels"`
	Threads                  []dChannel     `json:"threads"`
	Presences                []dPresence    `json:"presences"`
	StageInstances           []any          `json:"stage_instances"`
	GuildScheduledEvents     []any          `json:"guild_scheduled_events"`
	SoundboardSounds         []any          `json:"soundboard_sounds"`
	EmbeddedActivities       []any          `json:"embedded_activities"`
	ApplicationCommandCounts map[string]int `json:"application_command_counts"`
}

// guildCreate is a whole server for this session.
func (sess *botSession) guildCreate(ctx context.Context, srv *store.Server) dGuildCreate {
	s := sess.s
	b := sess.builder(ctx)
	out := dGuildCreate{dGuild: b.guildObj(srv), Lazy: true, StageInstances: []any{}, GuildScheduledEvents: []any{}, SoundboardSounds: []any{},
		EmbeddedActivities: []any{}, ApplicationCommandCounts: map[string]int{}}
	count, _ := s.Store.MemberCount(ctx, srv.ID)
	out.MemberCount, out.Large = count, count > sess.large
	if me, err := s.Store.Member(ctx, srv.ID, sess.bot.ID); err == nil {
		joined := botproto.Timestamp(me.JoinedAt)
		out.JoinedAt = &joined
	}
	// channels and threads it can see
	visible, _ := s.Store.ViewableServerChannels(ctx, srv.ID, sess.bot.ID)
	chans, _ := s.Store.ServerChannels(ctx, srv.ID)
	sess.mu.Lock()
	sess.guilds[srv.ID] = true
	sess.mu.Unlock()
	if rules, err := s.Store.AutomodRules(ctx, srv.ID); err == nil {
		seen := map[ids.ID]int64{}
		for _, r := range rules {
			seen[r.ID] = r.UpdatedAt
		}
		sess.mu.Lock()
		if sess.amRules == nil {
			sess.amRules = map[ids.ID]map[ids.ID]int64{}
		}
		sess.amRules[srv.ID] = seen
		sess.mu.Unlock()
	}
	out.Channels = []dChannel{}
	for _, c := range chans {
		if _, ok := visible[c.ID]; !ok {
			continue
		}
		if dc, ok := b.channelObj(c); ok {
			out.Channels = append(out.Channels, dc)
			sess.remember(dc)
		}
	}
	out.Threads = []dChannel{}
	if active, err := s.Store.ActiveThreads(ctx, srv.ID); err == nil {
		for _, th := range active {
			if _, ok := visible[th.ID]; !ok {
				continue
			}
			if dc, ok := b.channelObj(th); ok {
				out.Threads = append(out.Threads, dc)
				sess.remember(dc)
			}
		}
	}
	// members: all of a small server's with the members intent, otherwise
	// the bot itself and whoever is in a call
	out.Members, out.Presences, out.VoiceStates = []dMember{}, []dPresence{}, []dVoiceState{}
	inVoice := map[ids.ID]bool{}
	if s.Voice != nil {
		for _, c := range chans {
			if c.Type != "voice" {
				continue
			}
			if _, ok := visible[c.ID]; !ok {
				continue
			}
			for _, st := range s.Voice.Participants(c.ID) {
				if st.UserID.IsZero() {
					continue
				}
				inVoice[st.UserID] = true
				chID := c.ID
				out.VoiceStates = append(out.VoiceStates, b.voiceStateObj(nil, &chID, st.UserID, st.SessionID, st.SelfMute, st.SelfDeaf, st.Video, st.Streaming, st.ServerMute || st.Suppress, st.ServerDeaf, false))
			}
		}
	}
	var list []*store.Member
	if sess.intent&botproto.IntentGuildMembers != 0 && count <= sess.large {
		list, _ = s.Store.Members(ctx, srv.ID, 0, 1000, "")
	} else {
		want := []ids.ID{sess.bot.ID}
		for id := range inVoice {
			want = append(want, id)
		}
		for _, id := range want {
			if m, err := s.Store.Member(ctx, srv.ID, id); err == nil {
				list = append(list, m)
			}
		}
	}
	b.preloadMembers(list)
	for _, m := range list {
		out.Members = append(out.Members, b.memberObj(m, true))
	}
	if sess.intent&botproto.IntentGuildPresences != 0 && s.hub != nil {
		for _, m := range list {
			if !s.hub.Online(m.UserID) {
				continue
			}
			if u := b.user(m.UserID); u != nil {
				if p := s.hub.PresenceOf(ctx, u); p.Status != "offline" {
					out.Presences = append(out.Presences, b.presenceObj(p, nil))
				}
			}
		}
	}
	return out
}

func (sess *botSession) emitGuildCreate(ctx context.Context, srv *store.Server) {
	if !sess.wants("GUILD_CREATE", botproto.InGuild) {
		sess.mu.Lock()
		sess.guilds[srv.ID] = true
		sess.mu.Unlock()
		return
	}
	sess.emit("GUILD_CREATE", sess.guildCreate(ctx, srv))
}

// remember keeps the last object a channel was sent as.
func (sess *botSession) remember(c dChannel) {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.channels[c.ID.ID()] = c
}

// forget drops a channel and returns its last object.
func (sess *botSession) forget(id ids.ID) (dChannel, bool) {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	c, ok := sess.channels[id]
	delete(sess.channels, id)
	return c, ok
}

// knownChannel is a channel's last object, if the session has one.
func (sess *botSession) knownChannel(id ids.ID) (dChannel, bool) {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	c, ok := sess.channels[id]
	return c, ok
}

// --- what a bot sends -------------------------------------------------------------------

// handleOp runs one of a session's frames; false ends the socket.
func (sess *botSession) handleOp(ctx context.Context, sock *botSocket, in *botproto.Inbound) bool {
	switch in.Op {
	case botproto.OpPresenceUpdate:
		sess.setPresence(ctx, in.D)
	case botproto.OpRequestGuildMembers:
		return sess.requestMembers(ctx, sock, in.D)
	case botproto.OpVoiceStateUpdate:
		sess.voiceStateUpdate(ctx, in.D)
	case botproto.OpRequestSoundboardSounds:
		var p struct {
			GuildIDs []snow `json:"guild_ids"`
		}
		_ = json.Unmarshal(in.D, &p)
		for _, g := range p.GuildIDs {
			sess.emit("SOUNDBOARD_SOUNDS", map[string]any{"guild_id": g, "soundboard_sounds": []any{}})
		}
	case botproto.OpRequestChannelInfo:
		sess.channelInfo(ctx, in.D)
	default:
		sock.close(botproto.CloseUnknownOpcode, "Unknown opcode.")
		return false
	}
	return true
}

// setPresence is the bot saying what it is doing: its status, kept on its
// account, and its activities, a custom status among them as its status text.
func (sess *botSession) setPresence(ctx context.Context, raw json.RawMessage) {
	var p struct {
		Status     string            `json:"status"`
		Activities []json.RawMessage `json:"activities"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return
	}
	var patch store.ProfilePatch
	switch p.Status {
	case "online", "idle", "dnd", "invisible":
		st := p.Status
		patch.PresencePref = &st
	case "offline":
		st := "invisible"
		patch.PresencePref = &st
	}
	var rest []json.RawMessage
	text, emoji := "", ""
	for _, a := range p.Activities {
		var head struct {
			Type  int    `json:"type"`
			Name  string `json:"name"`
			State string `json:"state"`
			Emoji *struct {
				Name string `json:"name"`
			} `json:"emoji"`
		}
		if json.Unmarshal(a, &head) != nil {
			continue
		}
		if head.Type == 4 {
			text = head.State
			if text == "" && head.Name != "Custom Status" {
				text = head.Name
			}
			if head.Emoji != nil {
				emoji = head.Emoji.Name
			}
			continue
		}
		rest = append(rest, a)
	}
	clean, _ := CleanText(strings.ReplaceAll(text, "\n", " "), 128)
	patch.StatusText, patch.StatusEmoji = &clean, &emoji
	var noExpiry *int64
	patch.StatusExpiresAt = &noExpiry
	if err := sess.s.Store.UpdateProfile(ctx, sess.bot.ID, patch); err == nil {
		if u, err := sess.s.Store.UserByID(ctx, sess.bot.ID); err == nil {
			sess.bot = u
			sess.ext.Refresh(ctx, u)
		}
	}
	sess.ext.SetActivities(rest)
}

// requestMembers answers op 8 with GUILD_MEMBERS_CHUNK events.
func (sess *botSession) requestMembers(ctx context.Context, sock *botSocket, raw json.RawMessage) bool {
	var p struct {
		GuildID   json.RawMessage `json:"guild_id"`
		Query     *string         `json:"query"`
		Limit     int             `json:"limit"`
		Presences bool            `json:"presences"`
		UserIDs   json.RawMessage `json:"user_ids"`
		Nonce     string          `json:"nonce"`
	}
	if json.Unmarshal(raw, &p) != nil {
		sock.close(botproto.CloseDecodeError, "Error while decoding payload.")
		return false
	}
	var guilds []snow
	var one snow
	if json.Unmarshal(p.GuildID, &one) == nil && one != 0 {
		guilds = []snow{one}
	} else {
		_ = json.Unmarshal(p.GuildID, &guilds)
	}
	var users []snow
	if len(p.UserIDs) > 0 && string(p.UserIDs) != "null" {
		if json.Unmarshal(p.UserIDs, &one) == nil && one != 0 {
			users = []snow{one}
		} else {
			_ = json.Unmarshal(p.UserIDs, &users)
		}
	}
	everyone := users == nil && (p.Query == nil || *p.Query == "") && p.Limit == 0
	if (everyone && sess.intent&botproto.IntentGuildMembers == 0) || (p.Presences && sess.intent&botproto.IntentGuildPresences == 0) {
		sock.close(botproto.CloseDisallowedIntents, "Disallowed intent(s).")
		return false
	}
	if len(p.Nonce) > 32 {
		p.Nonce = ""
	}
	b := sess.builder(ctx)
	for _, g := range guilds {
		gid := g.ID()
		if ok, _ := sess.s.Store.IsMember(ctx, gid, sess.bot.ID); !ok {
			continue
		}
		var list []*store.Member
		var notFound []snow
		switch {
		case users != nil:
			for _, u := range users {
				if m, err := sess.s.Store.Member(ctx, gid, u.ID()); err == nil {
					list = append(list, m)
				} else {
					notFound = append(notFound, u)
				}
			}
		case everyone:
			after := ids.ID(0)
			for {
				page, err := sess.s.Store.Members(ctx, gid, after, 1000, "")
				if err != nil || len(page) == 0 {
					break
				}
				list = append(list, page...)
				after = page[len(page)-1].UserID
				if len(page) < 1000 {
					break
				}
			}
		default:
			limit := p.Limit
			if limit <= 0 || limit > 100 {
				limit = 100
			}
			q := ""
			if p.Query != nil {
				q = *p.Query
			}
			list, _ = sess.s.Store.Members(ctx, gid, 0, limit, q)
		}
		chunks := (len(list) + 999) / 1000
		if chunks == 0 {
			chunks = 1
		}
		b.preloadMembers(list)
		for i := 0; i < chunks; i++ {
			part := list[min(i*1000, len(list)):min((i+1)*1000, len(list))]
			members := make([]dMember, 0, len(part))
			for _, m := range part {
				members = append(members, b.memberObj(m, true))
			}
			chunk := map[string]any{"guild_id": g, "members": members, "chunk_index": i, "chunk_count": chunks}
			if i == 0 && len(notFound) > 0 {
				chunk["not_found"] = notFound
			}
			if p.Presences {
				pres := []dPresence{}
				for _, m := range part {
					if u := b.user(m.UserID); u != nil && sess.s.hub.Online(u.ID) {
						if pr := sess.s.hub.PresenceOf(ctx, u); pr.Status != "offline" {
							pres = append(pres, b.presenceObj(pr, nil))
						}
					}
				}
				chunk["presences"] = pres
			}
			if p.Nonce != "" {
				chunk["nonce"] = p.Nonce
			}
			sess.emit("GUILD_MEMBERS_CHUNK", chunk)
		}
	}
	return true
}

// voiceStateUpdate is a bot asking to join a call. Bots cannot take part in
// calls here yet (their voice protocol needs UDP, which nothing in front of
// this server carries), so the answer is the protocol's own for a voice
// server that is not there: a state with no channel, at once, which the
// libraries read as having been disconnected.
func (sess *botSession) voiceStateUpdate(ctx context.Context, raw json.RawMessage) {
	var p struct {
		GuildID   *snow `json:"guild_id"`
		ChannelID *snow `json:"channel_id"`
		SelfMute  bool  `json:"self_mute"`
		SelfDeaf  bool  `json:"self_deaf"`
	}
	if json.Unmarshal(raw, &p) != nil || p.GuildID == nil {
		return
	}
	gid := p.GuildID.ID()
	b := sess.builder(ctx)
	st := b.voiceStateObj(&gid, nil, sess.bot.ID, ids.ID(0), p.SelfMute, p.SelfDeaf, false, false, false, false, true)
	st.SessionID = sess.id
	sess.emitIf("VOICE_STATE_UPDATE", botproto.InGuild, st)
}

// channelInfo answers op 43: when each voice channel's call began.
func (sess *botSession) channelInfo(ctx context.Context, raw json.RawMessage) {
	var p struct {
		GuildID snow     `json:"guild_id"`
		Fields  []string `json:"fields"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return
	}
	gid := p.GuildID.ID()
	chans, err := sess.s.Store.ServerChannels(ctx, gid)
	if err != nil {
		return
	}
	out := []map[string]any{}
	for _, c := range chans {
		if c.Type != "voice" {
			continue
		}
		info := map[string]any{"id": snow(c.ID), "status": nil, "voice_start_time": nil}
		if sess.s.Voice != nil {
			for _, st := range sess.s.Voice.Participants(c.ID) {
				if st.CallSince > 0 {
					info["voice_start_time"] = st.CallSince / 1000
					break
				}
			}
		}
		out = append(out, info)
	}
	sess.emit("CHANNEL_INFO", map[string]any{"guild_id": p.GuildID, "channels": out})
}

// botCanSee reports whether the session's bot may view a channel.
func (sess *botSession) botCanSee(ctx context.Context, ch *store.Channel) bool {
	if store.IsDMLike(ch.Type) {
		return hasID(ch.Recipients, sess.bot.ID)
	}
	p, err := sess.s.Store.PermsIn(ctx, ch, sess.bot.ID)
	return err == nil && p.Has(perms.ViewChannel)
}

// disconnectBot ends every gateway session of a bot (its token was reset,
// its application deleted).
func (s *Server) disconnectBot(botID ids.ID) {
	for _, sess := range s.bots.sessionsOf(botID) {
		sess.mu.Lock()
		sock := sess.sock
		sess.mu.Unlock()
		if sock != nil {
			sock.close(botproto.CloseAuthenticationFailed, "Authentication failed.")
		}
		sess.end()
	}
}

var errNoSession = errors.New("bot: no gateway session")
