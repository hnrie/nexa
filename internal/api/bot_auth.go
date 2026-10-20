package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/ratelimit"
	"evilion.xyz/chat/internal/store"
)

// The bot API is the REST side of the protocol the bot libraries made for
// Discord speak (version 10; 6 to 9 are answered the same way), under
// /api/v6 to /api/v10, beside Nexa's own /api/v1. A request comes with a
// bot's token (Authorization: Bot <token>) or with an OAuth2 access token an
// application holds for a person (Authorization: Bearer <token>). Ids are
// written the way the libraries expect (internal/botproto) and errors in the
// protocol's own shape, so a bot written for those libraries runs here once
// it is pointed at this server and given a token from Settings, Developer
// Portal.
//
// Where the app already has a route that does the same thing (changing a
// member, banning, making a role), the bot route runs that route's own code
// as the bot (callNexa), so a bot is held to exactly the rules a person is
// and everyone sees the same events; the bot route only translates.

// botPrefixes are the paths the bot API answers under.
var botPrefixes = []string{"/api/v6", "/api/v7", "/api/v8", "/api/v9", "/api/v10"}

// botCtx is who a bot API request acts for.
type botCtx struct {
	// app is the bot's application, or the application holding the OAuth2 token
	app *store.Application
	// user acts: the bot's account, or the person who granted the token
	user *store.User
	// token is the OAuth2 token the request came with, if it did
	token *store.OAuthToken
}

func (b *botCtx) isBot() bool { return b != nil && b.token == nil }

// hasScope reports whether an OAuth2 request was granted scope; a bot's own
// token is not limited by scopes.
func (b *botCtx) hasScope(scope string) bool {
	if b.token == nil {
		return true
	}
	for _, sc := range b.token.Scopes {
		if sc == scope {
			return true
		}
	}
	return false
}

type botCtxKey struct{}

// botOf is the request's bot context.
func botOf(r *http.Request) *botCtx {
	b, _ := r.Context().Value(botCtxKey{}).(*botCtx)
	return b
}

// botAuth is what a bot route accepts as credentials.
type botAuth int

const (
	authNone        botAuth = iota // nothing (the gateway's address, a public invite)
	authBot                        // a bot's token only
	authBotOrBearer                // a bot's token, or an OAuth2 token with the route's scope
	authBearer                     // an OAuth2 token only
)

// botRoute is one route's settings.
type botRoute struct {
	auth  botAuth
	scope string
	// bucket names the rate limit the route counts against, kept per major
	// parameter (a channel, a server, a webhook) as the protocol does
	bucket string
	major  string
}

type botOpt func(*botRoute)

// scoped is the OAuth2 scope an OAuth2 token needs for the route.
func scoped(scope string) botOpt { return func(r *botRoute) { r.scope = scope } }

// bucketed puts the route in a rate limit bucket of its own.
func bucketed(name string) botOpt { return func(r *botRoute) { r.bucket = name } }

// botLimits are the rate limits of the bot API's buckets: how many requests,
// and over what time, before a 429. Discord's own figures, which libraries
// are written around.
var botLimits = map[string]struct {
	n   int
	per time.Duration
}{
	"default":      {10, 10 * time.Second},
	"message":      {5, 5 * time.Second},
	"edit":         {5, 5 * time.Second},
	"delete":       {5, time.Second},
	"bulk":         {1, time.Second},
	"reaction":     {4, time.Second},
	"typing":       {5, 5 * time.Second},
	"member":       {10, 10 * time.Second},
	"role":         {5, 5 * time.Second},
	"guild":        {5, 5 * time.Second},
	"command":      {5, 20 * time.Second},
	"interaction":  {20, time.Second},
	"oauth":        {5, 5 * time.Second},
	"read":         {50, time.Second},
	"emoji":        {5, 5 * time.Second},
	"channelwrite": {5, 5 * time.Second},
}

// botLimiters holds one limiter per bucket and the global one (50 requests
// a second for each bot or token, across every route).
type botLimiters struct {
	global  *ratelimit.Limiter
	buckets map[string]*ratelimit.Limiter
}

func newBotLimiters() *botLimiters {
	l := &botLimiters{global: ratelimit.New(ratelimit.Every(50, time.Second), 50, 10*time.Minute), buckets: map[string]*ratelimit.Limiter{}}
	for name, lim := range botLimits {
		l.buckets[name] = ratelimit.New(ratelimit.Every(lim.n, lim.per), lim.n, 10*time.Minute)
	}
	return l
}

// all names every limiter, for sweeping and sharing (router.go limiters).
func (l *botLimiters) all() map[string]*ratelimit.Limiter {
	out := map[string]*ratelimit.Limiter{"bot-global": l.global}
	for name, lim := range l.buckets {
		out["bot-"+name] = lim
	}
	return out
}

// botHandle registers a bot API route under every version prefix. path is
// written as the protocol writes it, with {guild}, {channel} and the like.
func (s *Server) botHandle(mux *http.ServeMux, method, path string, a botAuth, h http.HandlerFunc, opts ...botOpt) {
	rt := &botRoute{auth: a, bucket: "default"}
	for _, o := range opts {
		o(rt)
	}
	// the major parameter: the route's first channel, server or webhook
	for _, p := range []string{"{channel}", "{guild}", "{webhook}", "{app}"} {
		if strings.Contains(path, p) {
			rt.major = strings.Trim(p, "{}")
			break
		}
	}
	wrapped := s.botMiddleware(rt, h)
	for _, prefix := range botPrefixes {
		mux.Handle(method+" "+prefix+path, wrapped)
	}
}

// botMiddleware checks a bot route's credentials, the account's standing and
// the rate limits, then runs it.
func (s *Server) botMiddleware(rt *botRoute, h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hd := w.Header()
		// discord.py waits out a 429 only when it came through a proxy it
		// recognises, by this header
		hd.Set("Via", "1.1 nexa")
		ctx := r.Context()
		var b *botCtx
		if rt.auth != authNone {
			var err error
			b, err = s.botAuthenticate(ctx, r, rt)
			if err != nil {
				writeBotError(w, err, nil)
				return
			}
			ctx = context.WithValue(ctx, botCtxKey{}, b)
			ctx = auth.WithUser(ctx, b.user, nil)
			r = r.WithContext(ctx)
			if b.isBot() {
				// a bot banned by Nexa's staff is a bot whose token no
				// longer works; a muted one may only read. Its owner's
				// standing is its own: a muted owner's bot is muted too.
				now := time.Now().UnixMilli()
				mute, ban, err := s.Store.ActiveRestrictions(ctx, b.user.ID, now)
				if err != nil {
					writeBotError(w, err, nil)
					return
				}
				if mute == nil && ban == nil {
					if ownerMute, ownerBan, err := s.Store.ActiveRestrictions(ctx, b.app.OwnerID, now); err == nil {
						mute, ban = ownerMute, ownerBan
					}
				}
				if ban != nil {
					writeBotError(w, dErrUnauthorized, nil)
					return
				}
				if mute != nil {
					if r.Method != http.MethodGet && r.Method != http.MethodHead {
						writeBotError(w, dErr(http.StatusForbidden, 40004, "Send messages has been temporarily disabled"), nil)
						return
					}
					r = r.WithContext(context.WithValue(r.Context(), ctxMuteKey{}, mute))
				}
			}
		}
		who := "ip:" + auth.RateKey(r)
		if b != nil {
			who = "u:" + b.user.ID.String()
			if b.token != nil {
				who = "t:" + b.token.ID.String()
			}
		}
		if ok, _, retry := s.botLim.global.AllowRemaining(who); !ok {
			writeRateLimited(w, retry, true, "global", 50)
			return
		}
		lim := s.botLim.buckets[rt.bucket]
		key := who + ":" + rt.bucket
		if rt.major != "" {
			key += ":" + r.PathValue(rt.major)
		}
		ok, remaining, retry := lim.AllowRemaining(key)
		limit := lim.Burst()
		bucketID := bucketHash(rt.bucket + ":" + rt.major)
		if !ok {
			hd.Set("X-RateLimit-Bucket", bucketID)
			writeRateLimited(w, retry, false, "user", limit)
			return
		}
		if remaining < 0 {
			remaining = limit - 1
		}
		per := float64(limit) / float64(lim.Rate())
		resetAfter := per * float64(limit-remaining) / float64(limit)
		if remaining == 0 {
			resetAfter = 1 / float64(lim.Rate())
		}
		hd.Set("X-RateLimit-Limit", strconv.Itoa(limit))
		hd.Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
		hd.Set("X-RateLimit-Reset", strconv.FormatFloat(float64(time.Now().UnixMilli())/1000+resetAfter, 'f', 3, 64))
		hd.Set("X-RateLimit-Reset-After", strconv.FormatFloat(resetAfter, 'f', 3, 64))
		hd.Set("X-RateLimit-Bucket", bucketID)
		h(w, r)
	})
}

// bucketHash is a bucket's opaque name, as the protocol's are.
func bucketHash(s string) string {
	sum := sha256.Sum256([]byte("bucket:" + s))
	return hex.EncodeToString(sum[:16])
}

// writeRateLimited answers 429 the way the protocol does.
func writeRateLimited(w http.ResponseWriter, retry time.Duration, global bool, scope string, limit int) {
	secs := retry.Seconds()
	if secs < 0.001 {
		secs = 0.001
	}
	hd := w.Header()
	hd.Set("Retry-After", retryAfter(retry))
	hd.Set("X-RateLimit-Limit", strconv.Itoa(limit))
	hd.Set("X-RateLimit-Remaining", "0")
	hd.Set("X-RateLimit-Reset", strconv.FormatFloat(float64(time.Now().Add(retry).UnixMilli())/1000, 'f', 3, 64))
	hd.Set("X-RateLimit-Reset-After", strconv.FormatFloat(secs, 'f', 3, 64))
	hd.Set("X-RateLimit-Scope", scope)
	if global {
		hd.Set("X-RateLimit-Global", "true")
	}
	WriteJSON(w, http.StatusTooManyRequests, map[string]any{"message": "You are being rate limited.", "retry_after": secs, "global": global})
}

// tokenHash is how a bot's token or an OAuth2 token is kept: SHA-256, hex.
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// botAuthenticate reads a request's credentials for a route.
func (s *Server) botAuthenticate(ctx context.Context, r *http.Request, rt *botRoute) (*botCtx, error) {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	kind, token, _ := strings.Cut(h, " ")
	token = strings.TrimSpace(token)
	switch {
	case strings.EqualFold(kind, "Bot") && token != "" && rt.auth != authBearer:
		app, err := s.Store.ApplicationByToken(ctx, tokenHash(token))
		if errors.Is(err, store.ErrNotFound) {
			return nil, dErrUnauthorized
		}
		if err != nil {
			return nil, err
		}
		u, err := s.Store.UserByID(ctx, app.ID)
		if err != nil {
			return nil, dErrUnauthorized
		}
		if u.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
			return nil, dErrUnauthorized
		}
		// the person behind it can be banned too, which takes their bots down
		if owner, err := s.Store.UserByID(ctx, app.OwnerID); err != nil || owner.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
			return nil, dErrUnauthorized
		}
		return &botCtx{app: app, user: u}, nil
	case strings.EqualFold(kind, "Bearer") && token != "" && (rt.auth == authBearer || rt.auth == authBotOrBearer):
		t, err := s.Store.OAuthTokenByAccess(ctx, tokenHash(token))
		if errors.Is(err, store.ErrNotFound) || (err == nil && t.ExpiresAt < time.Now().UnixMilli()) {
			return nil, dErrUnauthorized
		}
		if err != nil {
			return nil, err
		}
		if rt.scope != "" && !(&botCtx{token: t}).hasScope(rt.scope) {
			return nil, dErr(http.StatusForbidden, 50026, "Missing required OAuth2 scope")
		}
		u, err := s.Store.UserByID(ctx, t.UserID)
		if err != nil || u.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
			return nil, dErrUnauthorized
		}
		app, err := s.Store.ApplicationByID(ctx, t.ApplicationID)
		if err != nil {
			return nil, dErrUnauthorized
		}
		return &botCtx{app: app, user: u, token: t}, nil
	}
	return nil, dErrUnauthorized
}

// --- errors -------------------------------------------------------------------------

var (
	dErrUnauthorized      = dErr(http.StatusUnauthorized, 0, "401: Unauthorized")
	dErrMissingPerms      = dErr(http.StatusForbidden, 50013, "Missing Permissions")
	dErrMissingAccess     = dErr(http.StatusForbidden, 50001, "Missing Access")
	dErrUnknownGuild      = dErr(http.StatusNotFound, 10004, "Unknown Guild")
	dErrUnknownMember     = dErr(http.StatusNotFound, 10007, "Unknown Member")
	dErrUnknownRole       = dErr(http.StatusNotFound, 10011, "Unknown Role")
	dErrUnknownUser       = dErr(http.StatusNotFound, 10013, "Unknown User")
	dErrUnknownEmoji      = dErr(http.StatusNotFound, 10014, "Unknown Emoji")
	dErrUnknownBan        = dErr(http.StatusNotFound, 10026, "Unknown Ban")
	dErrUnknownInvite     = dErr(http.StatusNotFound, 10006, "Unknown Invite")
	dErrUnknownSticker    = dErr(http.StatusNotFound, 10060, "Unknown Sticker")
	dErrUnknownApp        = dErr(http.StatusNotFound, 10002, "Unknown Application")
	dErrUnknownCommand    = dErr(http.StatusNotFound, 10063, "Unknown application command")
	dErrUnknownInteract   = dErr(http.StatusNotFound, 10062, "Unknown interaction")
	dErrUnknownOverwrite  = dErr(http.StatusNotFound, 10009, "Unknown Overwrite")
	dErrUnknownIntegrate  = dErr(http.StatusNotFound, 10005, "Unknown Integration")
	dErrUnknownAutomod    = dErr(http.StatusNotFound, 10066, "Unknown auto moderation rule")
	dErrUnknownVoiceState = dErr(http.StatusNotFound, 10065, "Unknown Voice State")
	dErrUnknownEntity     = dErr(http.StatusNotFound, 0, "404: Not Found")
	dErrNoBotEndpoint     = dErr(http.StatusForbidden, 20001, "Bots cannot use this endpoint")
	dErrOnlyBots          = dErr(http.StatusForbidden, 20002, "Only bots can use this endpoint")
	dErrCannotDM          = dErr(http.StatusForbidden, 50007, "Cannot send messages to this user")
	dErrAcknowledged      = dErr(http.StatusBadRequest, 40060, "Interaction has already been acknowledged.")
	dErrThreadArchived    = dErr(http.StatusBadRequest, 50083, "Thread is archived")
	dErrWrongChannelType  = dErr(http.StatusBadRequest, 50024, "Cannot execute action on this channel type")
	dErrSystemMessage     = dErr(http.StatusBadRequest, 50021, "Cannot execute action on a system message")
	dErrNotAuthor         = dErr(http.StatusForbidden, 50005, "Cannot edit a message authored by another user")
	dErrTooOldToBulk      = dErr(http.StatusBadRequest, 50034, "You can only bulk delete messages that are under 14 days old.")
	dErrBulkCount         = dErr(http.StatusBadRequest, 50016, "Provided too few or too many messages to delete. Must provide at least 2 and fewer than 100 messages to delete.")
	dErrAutomodBlocked    = dErr(http.StatusBadRequest, 200000, "Message was blocked by automatic moderation")
	dErrVoiceNotAvailable = dErr(http.StatusBadRequest, 50024, "Voice connections are not available to bots on this server")
)

// dFormError is a 50035 with one problem at path.
func dFormError(code, msg string, path ...string) *dError {
	f := &formErrors{}
	f.add(path, code, msg)
	return f.err()
}

// writeBotError answers err in the protocol's shape. An error from the app's
// own routes (callNexa) is mapped onto the protocol's codes; unknown is the
// answer for something that was not found, Unknown Channel and the like.
func writeBotError(w http.ResponseWriter, err error, unknown *dError) {
	writeDiscordError(w, botError(err, unknown))
}

func botError(err error, unknown *dError) error {
	if unknown == nil {
		unknown = dErrUnknownEntity
	}
	var de *dError
	if errors.As(err, &de) {
		return de
	}
	var apiErr *Error
	if errors.As(err, &apiErr) {
		return mapAppError(apiErr, unknown)
	}
	switch {
	case errors.Is(err, store.ErrNotFound), errors.Is(err, media.ErrNotFound):
		return unknown
	case errors.Is(err, media.ErrTooLarge):
		return dErrFileTooLarge
	case errors.Is(err, media.ErrUnsupported):
		return dErr(http.StatusBadRequest, 50046, "Invalid file uploaded")
	case errors.Is(err, store.ErrTooMany), errors.Is(err, store.ErrLimit):
		return dErr(http.StatusBadRequest, 30000, "Maximum number reached")
	case errors.Is(err, store.ErrAlreadyExists):
		return dFormError("ALREADY_EXISTS", "That already exists.")
	}
	return err
}

// mapAppError turns an error of the app's own routes into the protocol's.
func mapAppError(e *Error, unknown *dError) *dError {
	switch e.Status {
	case http.StatusNotFound:
		return unknown
	case http.StatusUnauthorized:
		return dErrUnauthorized
	case http.StatusForbidden:
		switch e.Code {
		case "blocked", "dm_privacy", "dms_closed":
			return dErrCannotDM
		case "banned":
			return dErr(http.StatusForbidden, 40007, "The user is banned from this guild.")
		case "account_muted":
			return dErr(http.StatusForbidden, 40004, "Send messages has been temporarily disabled")
		case "locked":
			return dErrMissingAccess
		case "automod_blocked":
			return dErrAutomodBlocked
		}
		return dErrMissingPerms
	case http.StatusRequestEntityTooLarge:
		if e.Code == "too_large" {
			return dErrFileTooLarge
		}
		return dErrTooLarge
	case http.StatusTooManyRequests:
		if e.Code == "slowmode" {
			return dErr(http.StatusTooManyRequests, 20016, "This action cannot be performed due to slowmode rate limit.")
		}
		return dErr(http.StatusTooManyRequests, 0, "You are being rate limited.")
	case http.StatusConflict:
		return dErr(http.StatusConflict, 0, e.Message)
	case http.StatusBadRequest:
		switch e.Code {
		case "limit_reached", "too_many_roles", "too_many_channels", "too_many_webhooks":
			return dErr(http.StatusBadRequest, 30000, e.Message)
		case "too_many_reactions":
			return dErr(http.StatusBadRequest, 30010, "Maximum number of reactions reached (20)")
		case "too_many_pins":
			return dErr(http.StatusBadRequest, 30003, "Maximum number of pins reached (50)")
		case "bad_emoji":
			return dErrUnknownEmoji
		case "thread_archived":
			return dErrThreadArchived
		case "thread_locked":
			return dErr(http.StatusBadRequest, 160005, "Thread is locked")
		case "not_text":
			return dErrNotText
		case "forum_posts_only":
			return dErr(http.StatusBadRequest, 40058, "Cannot send a message in a forum channel")
		}
		return dFormError(strings.ToUpper(e.Code), e.Message)
	}
	if e.Status >= 500 {
		return dErrInternal
	}
	return dErr(e.Status, 0, e.Message)
}

// --- running the app's own routes ----------------------------------------------------

// nexaAnswer is what one of the app's routes answered a bot.
type nexaAnswer struct {
	status int
	body   []byte
}

// ok reports a 2xx answer.
func (a *nexaAnswer) ok() bool { return a.status >= 200 && a.status < 300 }

// decode reads the answer's JSON into v.
func (a *nexaAnswer) decode(v any) error { return json.Unmarshal(a.body, v) }

// err is the answer as an error, for one that is not ok.
func (a *nexaAnswer) err() error {
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(a.body, &env) == nil && env.Error.Code != "" {
		return E(a.status, env.Error.Code, env.Error.Message)
	}
	return E(a.status, "error", strings.TrimSpace(string(a.body)))
}

// bufferWriter collects what a handler writes.
type bufferWriter struct {
	header http.Header
	status int
	buf    bytes.Buffer
}

func (b *bufferWriter) Header() http.Header { return b.header }
func (b *bufferWriter) Write(p []byte) (int, error) {
	if b.status == 0 {
		b.status = http.StatusOK
	}
	return b.buf.Write(p)
}
func (b *bufferWriter) WriteHeader(code int) {
	if b.status == 0 {
		b.status = code
	}
}

// callNexa runs one of the app's own handlers for a bot request, as the bot
// (or the person an OAuth2 token stands for): path holds the route's path
// values, query its query string, body what it would have been sent. What
// the request carries for the log (X-Audit-Log-Reason) goes along.
func (s *Server) callNexa(r *http.Request, h http.HandlerFunc, method string, path map[string]string, query url.Values, body any) *nexaAnswer {
	var rd io.Reader = http.NoBody
	contentType := ""
	switch b := body.(type) {
	case nil:
	case *rawBody:
		rd, contentType = bytes.NewReader(b.data), b.contentType
	default:
		raw, err := json.Marshal(body)
		if err != nil {
			return &nexaAnswer{status: http.StatusInternalServerError}
		}
		rd, contentType = bytes.NewReader(raw), "application/json"
	}
	u := &url.URL{Path: "/", RawQuery: query.Encode()}
	req, err := http.NewRequestWithContext(r.Context(), method, u.String(), rd)
	if err != nil {
		return &nexaAnswer{status: http.StatusInternalServerError}
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if reason := r.Header.Get("X-Audit-Log-Reason"); reason != "" {
		req.Header.Set("X-Audit-Log-Reason", reason)
	}
	req.RemoteAddr = r.RemoteAddr
	for _, k := range []string{"CF-Connecting-IP", "X-Forwarded-For", "User-Agent"} {
		if v := r.Header.Get(k); v != "" {
			req.Header.Set(k, v)
		}
	}
	for k, v := range path {
		req.SetPathValue(k, v)
	}
	bw := &bufferWriter{header: http.Header{}}
	h(bw, req)
	if bw.status == 0 {
		bw.status = http.StatusOK
	}
	return &nexaAnswer{status: bw.status, body: bw.buf.Bytes()}
}

// pathID reads a path value as an id in either form (botproto.ParseID).
func pathID(r *http.Request, name string) (ids.ID, bool) {
	id, err := parseBotID(r.PathValue(name))
	return id, err == nil
}
