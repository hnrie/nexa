package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

// OAuth2: how an application is added somewhere, and how it acts for
// someone. The consent screen is the app's own page (/oauth2/authorize),
// which reads what is asked for here (GET /api/v1/oauth2/authorize) and,
// once the person agrees, does it (POST): a bot joins the server they chose
// with a role holding the permissions it asked for, an application is
// installed on their account, or the application gets a code (or, for the
// implicit grant, a token) at its redirect. The application then trades the
// code for a token at the protocol's /oauth2/token, as bot libraries and
// OAuth2 clients made for Discord do.

const (
	oauthCodeLife  = 10 * time.Minute
	oauthTokenLife = 7 * 24 * time.Hour
	// oauthRefreshLife is how long a refresh token lasts unused, as a
	// session does: an application renews an access token that has run out
	// with it, and each renewal starts it again
	oauthRefreshLife = 90 * 24 * time.Hour
	oauthBearerType  = "Bearer"
)

// knownScopes are the OAuth2 scopes this server grants.
var knownScopes = map[string]bool{
	"bot": true, "applications.commands": true, "identify": true, "email": true, "guilds": true, "guilds.join": true,
	"guilds.members.read": true, "connections": true, "applications.commands.permissions.update": true,
	"applications.commands.update": true, "webhook.incoming": true,
}

func (s *Server) oauthRoutes(mux *http.ServeMux) {
	// the consent screen's side
	mux.Handle("GET /api/v1/oauth2/authorize", s.authed(s.handleAuthorizeInfo))
	mux.Handle("POST /api/v1/oauth2/authorize", s.userLimited(s.limApps, s.handleAuthorize))
	mux.Handle("GET /api/v1/oauth2/authorized", s.authed(s.handleAuthorizedApps))
	mux.Handle("DELETE /api/v1/oauth2/authorized/{id}", s.authed(s.handleDeauthorize))
	// a server's applications, for its managers
	mux.Handle("GET /api/v1/servers/{id}/integrations", s.authed(s.handleIntegrations))
	mux.Handle("DELETE /api/v1/servers/{id}/integrations/{app}", s.authed(s.handleIntegrationRemove))
	mux.Handle("GET /api/v1/servers/{id}/integrations/{app}/commands", s.authed(s.handleIntegrationCommands))
	mux.Handle("PUT /api/v1/servers/{id}/integrations/{app}/commands/{command}/permissions", s.authed(s.handleIntegrationCommandPerms))
	// the protocol's side
	s.botHandle(mux, "POST", "/oauth2/token", authNone, s.botOAuthToken, bucketed("oauth"))
	s.botHandle(mux, "POST", "/oauth2/token/revoke", authNone, s.botOAuthRevoke, bucketed("oauth"))
	s.botHandle(mux, "GET", "/oauth2/@me", authBearer, s.botOAuthMe)
	s.botHandle(mux, "GET", "/oauth2/applications/@me", authBot, s.botApplicationGet)
	s.botHandle(mux, "GET", "/oauth2/authorize", authNone, func(w http.ResponseWriter, r *http.Request) {
		// a browser sent here is sent on to the app's consent page
		http.Redirect(w, r, strings.TrimRight(s.Cfg.PublicURL, "/")+"/oauth2/authorize?"+r.URL.RawQuery, http.StatusFound)
	})
}

// --- what is asked for ------------------------------------------------------------------------

// authorizeRequest is an authorization request as its link carries it.
type authorizeRequest struct {
	app             *store.Application
	bot             *store.User
	scopes          []string
	permissions     perms.Perm
	redirect        string
	responseType    string
	state           string
	guild           *ids.ID
	disableGuild    bool
	integrationType int
	challenge       string
	challengeMethod string
	prompt          string
}

func (a *authorizeRequest) has(scope string) bool {
	for _, sc := range a.scopes {
		if sc == scope {
			return true
		}
	}
	return false
}

// installsInGuild reports whether the request adds the application to a
// server (its bot, or its commands), rather than to the account.
func (a *authorizeRequest) installsInGuild() bool {
	return a.has("bot") || a.has("webhook.incoming") || (a.has("applications.commands") && a.integrationType == installGuild)
}

// readAuthorize reads and checks an authorization request.
func (s *Server) readAuthorize(ctx context.Context, q url.Values, me *store.User) (*authorizeRequest, error) {
	bad := func(code, msg string) error { return E(http.StatusBadRequest, code, msg) }
	id, err := parseBotID(q.Get("client_id"))
	if err != nil {
		return nil, bad("unknown_application", "That app does not exist.")
	}
	app, err := s.Store.ApplicationByID(ctx, id)
	if err != nil {
		return nil, bad("unknown_application", "That app does not exist.")
	}
	bot, err := s.Store.UserByID(ctx, app.ID)
	if err != nil || bot.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
		return nil, bad("unknown_application", "That app does not exist.")
	}
	a := &authorizeRequest{app: app, bot: bot, state: q.Get("state"), responseType: q.Get("response_type"), prompt: q.Get("prompt"),
		challenge: q.Get("code_challenge"), challengeMethod: q.Get("code_challenge_method")}
	seen := map[string]bool{}
	for _, sc := range strings.Fields(strings.ReplaceAll(q.Get("scope"), "+", " ")) {
		if !knownScopes[sc] {
			return nil, bad("invalid_scope", "The app asked for something this server does not grant: "+sc+".")
		}
		if sc == "applications.commands.update" {
			return nil, bad("invalid_scope", "That scope is only for the app's own credentials.")
		}
		if !seen[sc] {
			seen[sc] = true
			a.scopes = append(a.scopes, sc)
		}
	}
	if v := q.Get("permissions"); v != "" {
		n, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			return nil, bad("invalid_permissions", "The permissions asked for could not be read.")
		}
		a.permissions = perms.Perm(n) & perms.All
	}
	if v := q.Get("integration_type"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || (n != installGuild && n != installUser) {
			return nil, bad("invalid_integration_type", "That is not a way this app can be added.")
		}
		a.integrationType = n
	}
	// a link that does not say how goes the only way the app can be added
	if q.Get("integration_type") == "" {
		if _, guild := app.IntegrationTypes["0"]; !guild {
			if _, user := app.IntegrationTypes["1"]; user {
				a.integrationType = installUser
			}
		}
	}
	if _, ok := app.IntegrationTypes[strconv.Itoa(a.integrationType)]; !ok {
		return nil, bad("invalid_integration_type", "This app cannot be added that way.")
	}
	// a link with no scopes is the app's own install link: what it asks
	// for is what its settings say for that way of adding it
	if len(a.scopes) == 0 {
		params := app.InstallParams
		if cfg, ok := app.IntegrationTypes[strconv.Itoa(a.integrationType)]; ok && cfg.OAuth2InstallParams != nil {
			params = cfg.OAuth2InstallParams
		}
		if params != nil {
			for _, sc := range params.Scopes {
				if knownScopes[sc] && sc != "applications.commands.update" && !seen[sc] {
					seen[sc] = true
					a.scopes = append(a.scopes, sc)
				}
			}
			if q.Get("permissions") == "" {
				if n, err := strconv.ParseUint(params.Permissions, 10, 64); err == nil {
					a.permissions = perms.Perm(n) & perms.All
				}
			}
		}
	}
	if len(a.scopes) == 0 {
		return nil, bad("invalid_scope", "The app did not say what it asks for.")
	}
	if a.integrationType == installUser && a.has("bot") {
		return nil, bad("invalid_scope", "A bot joins servers, not accounts.")
	}
	if v := q.Get("guild_id"); v != "" {
		if gid, err := parseBotID(v); err == nil {
			a.guild = &gid
		}
	}
	a.disableGuild = q.Get("disable_guild_select") == "true"
	if a.has("bot") && !app.BotPublic && app.OwnerID != me.ID {
		return nil, bad("private_application", "Only this app's owner can add it.")
	}
	// the redirect: one the application registered, needed for a code
	a.redirect = q.Get("redirect_uri")
	if a.redirect != "" {
		ok := false
		for _, u := range app.RedirectURIs {
			if u == a.redirect {
				ok = true
				break
			}
		}
		if !ok {
			return nil, bad("invalid_redirect", "The app sent you back to an address it did not register.")
		}
	}
	switch a.responseType {
	case "", "code", "token":
	default:
		return nil, bad("invalid_response_type", "The app asked for an answer this server does not give.")
	}
	needsRedirect := false
	for _, sc := range a.scopes {
		if sc != "bot" && sc != "applications.commands" {
			needsRedirect = true
		}
	}
	if (needsRedirect || a.responseType != "" || a.app.BotRequireCodeGrant) && a.redirect == "" {
		return nil, bad("invalid_redirect", "The app did not say where to send you back.")
	}
	if a.challenge != "" && a.challengeMethod != "S256" && a.challengeMethod != "plain" && a.challengeMethod != "" {
		return nil, bad("invalid_request", "The app's code challenge method is not supported.")
	}
	return a, nil
}

// handleAuthorizeInfo describes an authorization request for the consent
// screen: the application, what it asks for, and where it can go.
func (s *Server) handleAuthorizeInfo(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	ctx := r.Context()
	a, err := s.readAuthorize(ctx, r.URL.Query(), me)
	if err != nil {
		WriteError(w, err)
		return
	}
	// the ways it can be added, so a link that did not choose can be chosen on
	ways := []int{}
	for _, k := range []int{installGuild, installUser} {
		if _, ok := a.app.IntegrationTypes[strconv.Itoa(k)]; ok {
			ways = append(ways, k)
		}
	}
	out := map[string]any{"application": map[string]any{"id": a.app.ID, "name": a.app.Name, "description": a.app.Description, "icon_id": a.app.IconID,
		"bot": a.bot.Public(), "terms_url": a.app.TermsURL, "privacy_url": a.app.PrivacyURL, "intents": intentsOf(a.app.Flags), "created_at": a.app.CreatedAt,
		"install_types": ways},
		"scopes": a.scopes, "permissions": a.permissions, "integration_type": a.integrationType, "redirect_uri": a.redirect,
		"guild_id": a.guild, "disable_guild_select": a.disableGuild, "type_chosen": r.URL.Query().Get("integration_type") != ""}
	if a.installsInGuild() {
		servers, err := s.Store.ServersForUser(ctx, me.ID)
		if err != nil {
			WriteError(w, err)
			return
		}
		list := []map[string]any{}
		for _, srv := range servers {
			p, err := s.Store.ServerPerms(ctx, srv.ID, me.ID)
			if err != nil || !p.Has(perms.ManageServer) {
				continue
			}
			member, _ := s.Store.IsMember(ctx, srv.ID, a.app.ID)
			installed := false
			if _, err := s.Store.GuildInstall(ctx, a.app.ID, srv.ID); err == nil {
				installed = true
			}
			banned, _ := s.Store.IsBanned(ctx, srv.ID, a.app.ID)
			list = append(list, map[string]any{"id": srv.ID, "name": srv.Name, "icon_id": srv.IconID, "permissions": p, "has_bot": member, "installed": installed, "banned": banned})
		}
		sort.Slice(list, func(i, j int) bool { return list[i]["name"].(string) < list[j]["name"].(string) })
		out["servers"] = list
	}
	if a.integrationType == installUser {
		has, _ := s.Store.HasUserInstall(ctx, a.app.ID, me.ID)
		out["installed"] = has
	}
	WriteJSON(w, http.StatusOK, out)
}

// handleAuthorize does what someone agreed to on the consent screen.
func (s *Server) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	ctx := r.Context()
	var body struct {
		Query       string      `json:"query"`
		GuildID     *ids.ID     `json:"guild_id"`
		ChannelID   *ids.ID     `json:"channel_id"`
		Permissions *perms.Perm `json:"permissions"`
	}
	if err := ReadJSON(w, r, &body, 16<<10); err != nil {
		WriteError(w, err)
		return
	}
	q, err := url.ParseQuery(body.Query)
	if err != nil {
		WriteError(w, E(http.StatusBadRequest, "invalid_request", "The request could not be read."))
		return
	}
	a, err := s.readAuthorize(ctx, q, me)
	if err != nil {
		WriteError(w, err)
		return
	}
	// someone may take away permissions the bot asked for, never add any
	if body.Permissions != nil {
		a.permissions &= *body.Permissions
	}
	var guild *store.Server
	if a.installsInGuild() {
		gid := body.GuildID
		if gid == nil {
			gid = a.guild
		}
		if gid == nil {
			WriteError(w, E(http.StatusBadRequest, "pick_server", "Pick a server to add the app to."))
			return
		}
		if a.disableGuild && a.guild != nil && *gid != *a.guild {
			WriteError(w, E(http.StatusBadRequest, "pick_server", "This link is for one server only."))
			return
		}
		srv, err := s.Store.ServerByID(ctx, *gid)
		if err != nil {
			WriteError(w, ErrNotFound)
			return
		}
		p, err := s.Store.ServerPerms(ctx, srv.ID, me.ID)
		if err != nil || !p.Has(perms.ManageServer) {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Manage Server to add apps there."))
			return
		}
		// nobody can hand a bot permissions they do not have themselves
		if !p.Has(perms.Administrator) && p != perms.All {
			a.permissions &= p
		}
		guild = srv
	}
	var webhook *store.Webhook
	if guild != nil {
		if a.has("bot") {
			if err := s.addBotToServer(r, a.app, a.bot, guild, me, a.permissions); err != nil {
				WriteError(w, err)
				return
			}
		}
		if err := s.Store.AddGuildInstall(ctx, a.app.ID, guild.ID, me.ID, a.scopes); err != nil {
			WriteError(w, err)
			return
		}
		s.emitServer(ctx, guild.ID, gateway.EvIntegrationsUpdate, map[string]any{"server_id": guild.ID})
		gid := guild.ID
		s.tellBot(a.app.ID, &gid, "GUILD_INTEGRATIONS_UPDATE", map[string]any{"guild_id": snow(guild.ID)})
		s.commandsChanged(ctx, a.app.ID, &gid)
		if a.has("webhook.incoming") {
			wh, err := s.webhookForApp(r, a.app, guild, body.ChannelID, me)
			if err != nil {
				WriteError(w, err)
				return
			}
			webhook = wh
		}
		s.sendAppEvent(ctx, a.app.ID, "APPLICATION_AUTHORIZED", map[string]any{"integration_type": installGuild, "scopes": a.scopes,
			"user": s.builder(ctx, nil, nil).userObj(me), "guild": map[string]any{"id": snow(guild.ID), "name": guild.Name}})
	} else if a.has("applications.commands") && a.integrationType == installUser {
		if err := s.Store.AddUserInstall(ctx, a.app.ID, me.ID, a.scopes); err != nil {
			WriteError(w, err)
			return
		}
		s.Bcast.EmitUsers([]ids.ID{me.ID}, gateway.EvAppCommandsUpdate, map[string]any{"application_id": a.app.ID})
		s.sendAppEvent(ctx, a.app.ID, "APPLICATION_AUTHORIZED", map[string]any{"integration_type": installUser, "scopes": a.scopes,
			"user": s.builder(ctx, nil, nil).userObj(me)})
	}
	if a.redirect == "" {
		WriteJSON(w, http.StatusOK, map[string]any{"location": nil, "guild_id": guildID(guild)})
		return
	}
	target, err := url.Parse(a.redirect)
	if err != nil {
		WriteError(w, E(http.StatusBadRequest, "invalid_redirect", "The app's address could not be read."))
		return
	}
	if a.responseType == "token" {
		access, _, t, err := s.issueToken(ctx, a.app.ID, me.ID, a.scopes, false)
		if err != nil {
			WriteError(w, err)
			return
		}
		frag := url.Values{"access_token": {access}, "token_type": {oauthBearerType}, "expires_in": {strconv.FormatInt(int64(oauthTokenLife.Seconds()), 10)},
			"scope": {strings.Join(t.Scopes, " ")}}
		if a.state != "" {
			frag.Set("state", a.state)
		}
		target.Fragment = frag.Encode()
	} else {
		code := newClientSecret()
		c := &store.OAuthCode{CodeHash: tokenHash(code), ApplicationID: a.app.ID, UserID: me.ID, Scopes: a.scopes, RedirectURI: a.redirect,
			Permissions: int64(a.permissions), Challenge: a.challenge, ChallengeMethod: a.challengeMethod, ExpiresAt: time.Now().Add(oauthCodeLife).UnixMilli()}
		if guild != nil {
			c.GuildID = &guild.ID
		}
		if webhook != nil {
			c.WebhookID = &webhook.ID
		}
		if err := s.Store.CreateOAuthCode(ctx, c); err != nil {
			WriteError(w, err)
			return
		}
		qv := target.Query()
		qv.Set("code", code)
		if a.state != "" {
			qv.Set("state", a.state)
		}
		if guild != nil {
			qv.Set("guild_id", botproto.OutString(guild.ID))
			qv.Set("permissions", strconv.FormatUint(uint64(a.permissions), 10))
		}
		target.RawQuery = qv.Encode()
	}
	WriteJSON(w, http.StatusOK, map[string]any{"location": target.String(), "guild_id": guildID(guild)})
}

func guildID(srv *store.Server) *ids.ID {
	if srv == nil {
		return nil
	}
	return &srv.ID
}

// addBotToServer brings an application's bot into a server, with a role of
// its own holding the permissions it was given.
func (s *Server) addBotToServer(r *http.Request, app *store.Application, bot *store.User, srv *store.Server, by *store.User, granted perms.Perm) error {
	ctx := r.Context()
	if member, _ := s.Store.IsMember(ctx, srv.ID, bot.ID); member {
		return nil
	}
	if banned, _ := s.Store.IsBanned(ctx, srv.ID, bot.ID); banned {
		return E(http.StatusForbidden, "banned", "This bot is banned from that server.")
	}
	s.forgetCounts(srv.ID)
	member, err := s.Store.Join(ctx, srv.ID, bot.ID, store.JoinInfo{})
	if errors.Is(err, store.ErrJoinsPaused) {
		return errJoinsPaused
	}
	if err != nil && !errors.Is(err, store.ErrAlreadyExists) {
		return err
	}
	if granted != 0 {
		role, err := s.Store.CreateManagedRole(ctx, srv.ID, bot.ID, app.Name, granted)
		if err != nil {
			return err
		}
		if err := s.Store.AddMemberRole(ctx, srv.ID, bot.ID, role.ID); err != nil {
			return err
		}
		member.RoleIDs = append(member.RoleIDs, role.ID)
		s.announceNewRole(ctx, srv.ID, role)
	}
	s.joined(r, srv, bot, member)
	view, users, err := s.serverView(ctx, srv, bot.ID)
	if err == nil {
		s.Bcast.EmitUsers([]ids.ID{bot.ID}, "server_create", serverCreateEvent{view, users})
	}
	s.audit(r, srv.ID, by.ID, "bot_add", "user", &bot.ID, map[string]any{"permissions": granted}, "")
	return nil
}

// webhookForApp makes the webhook an application asked for with
// webhook.incoming, in a channel the person chose.
func (s *Server) webhookForApp(r *http.Request, app *store.Application, srv *store.Server, channel *ids.ID, by *store.User) (*store.Webhook, error) {
	ctx := r.Context()
	if channel == nil {
		return nil, E(http.StatusBadRequest, "pick_channel", "Pick a channel for the app's webhook.")
	}
	ch, err := s.Store.ChannelByID(ctx, *channel)
	if err != nil || ch.ServerID == nil || *ch.ServerID != srv.ID {
		return nil, ErrNotFound
	}
	p, err := s.Store.PermsIn(ctx, ch, by.ID)
	if err != nil || !p.Has(perms.ManageWebhooks) {
		return nil, E(http.StatusForbidden, "missing_permission", "You need Manage Webhooks in that channel.")
	}
	token := newWebhookToken()
	sealed, err := s.sealWebhookToken(token)
	if err != nil {
		return nil, err
	}
	name, apiErr := cleanWebhookName(app.Name)
	if apiErr != nil {
		name = "Webhook"
	}
	creator := by.ID
	wh := &store.Webhook{ServerID: srv.ID, ChannelID: ch.ID, CreatorID: &creator, Name: name, TokenHash: webhookTokenHash(token), TokenSealed: sealed}
	if err := s.Store.CreateWebhook(ctx, wh); err != nil {
		return nil, err
	}
	s.audit(r, srv.ID, by.ID, "webhook_create", "webhook", &wh.ID, map[string]any{"name": wh.Name, "channel_id": wh.ChannelID}, "")
	s.webhookChanged(ctx, srv.ID, ch.ID)
	return wh, nil
}

// --- tokens ---------------------------------------------------------------------------------

// issueToken gives an application an access token for an account, and the
// refresh token that renews it when refreshable (the implicit and client
// credentials grants hand out no refresh token, so theirs goes with the
// access token).
func (s *Server) issueToken(ctx context.Context, app, user ids.ID, scopes []string, refreshable bool) (access, refresh string, t *store.OAuthToken, err error) {
	access, refresh = newClientSecret()+newClientSecret()[:8], newClientSecret()+newClientSecret()[:8]
	now := time.Now()
	t = &store.OAuthToken{ApplicationID: app, UserID: user, Scopes: scopes, AccessHash: tokenHash(access), RefreshHash: tokenHash(refresh),
		ExpiresAt: now.Add(oauthTokenLife).UnixMilli(), RefreshExpiresAt: now.Add(oauthTokenLife).UnixMilli()}
	if refreshable {
		t.RefreshExpiresAt = now.Add(oauthRefreshLife).UnixMilli()
	}
	return access, refresh, t, s.Store.CreateOAuthToken(ctx, t)
}

// clientAuth reads an OAuth2 client's credentials: HTTP Basic, or the form's
// client_id and client_secret. secretOK says the secret was given and right.
func (s *Server) clientAuth(r *http.Request) (*store.Application, bool, error) {
	id, secret, basic := r.BasicAuth()
	if !basic {
		id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	appID, err := parseBotID(id)
	if err != nil {
		return nil, false, oauthErr("invalid_client", "Unknown client")
	}
	app, err := s.Store.ApplicationByID(r.Context(), appID)
	if err != nil {
		return nil, false, oauthErr("invalid_client", "Unknown client")
	}
	if secret == "" {
		return app, false, nil
	}
	if app.SecretHash == "" || subtle.ConstantTimeCompare([]byte(tokenHash(secret)), []byte(app.SecretHash)) != 1 {
		return nil, false, oauthErr("invalid_client", "Invalid client secret")
	}
	return app, true, nil
}

// oauthError is an OAuth2 error, which has a shape of its own.
type oauthError struct {
	Code        string `json:"error"`
	Description string `json:"error_description"`
}

func (e *oauthError) Error() string { return e.Code + ": " + e.Description }

func oauthErr(code, desc string) *oauthError { return &oauthError{Code: code, Description: desc} }

func writeOAuthError(w http.ResponseWriter, err error) {
	var oe *oauthError
	if errors.As(err, &oe) {
		status := http.StatusBadRequest
		if oe.Code == "invalid_client" {
			status = http.StatusUnauthorized
		}
		WriteJSON(w, status, oe)
		return
	}
	writeBotError(w, err, nil)
}

// botOAuthToken trades a code, a refresh token or the application's own
// credentials for an access token.
func (s *Server) botOAuthToken(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := r.ParseForm(); err != nil {
		writeOAuthError(w, oauthErr("invalid_request", "The request could not be read."))
		return
	}
	ctx := r.Context()
	app, secretOK, err := s.clientAuth(r)
	if err != nil {
		writeOAuthError(w, err)
		return
	}
	form := r.PostForm
	var t *store.OAuthToken
	var access, refresh string
	extra := map[string]any{}
	switch form.Get("grant_type") {
	case "authorization_code":
		c, err := s.Store.TakeOAuthCode(ctx, tokenHash(form.Get("code")))
		if err != nil || c.ApplicationID != app.ID || c.ExpiresAt < time.Now().UnixMilli() {
			writeOAuthError(w, oauthErr("invalid_grant", "Invalid \"code\" in request."))
			return
		}
		if c.RedirectURI != "" && form.Get("redirect_uri") != c.RedirectURI {
			writeOAuthError(w, oauthErr("invalid_grant", "Invalid \"redirect_uri\" in request."))
			return
		}
		switch {
		case c.Challenge != "":
			verifier := form.Get("code_verifier")
			want := verifier
			if c.ChallengeMethod == "S256" || c.ChallengeMethod == "" {
				sum := sha256.Sum256([]byte(verifier))
				want = base64.RawURLEncoding.EncodeToString(sum[:])
			}
			if verifier == "" || subtle.ConstantTimeCompare([]byte(want), []byte(c.Challenge)) != 1 {
				writeOAuthError(w, oauthErr("invalid_grant", "Invalid \"code_verifier\" in request."))
				return
			}
		case !secretOK:
			writeOAuthError(w, oauthErr("invalid_client", "The client secret is required."))
			return
		}
		if access, refresh, t, err = s.issueToken(ctx, app.ID, c.UserID, c.Scopes, true); err != nil {
			writeOAuthError(w, err)
			return
		}
		b := s.builder(ctx, nil, app)
		if c.GuildID != nil {
			if srv, err := s.Store.ServerByID(ctx, *c.GuildID); err == nil {
				extra["guild"] = b.guildObj(srv)
			}
		}
		if c.WebhookID != nil {
			if wh, err := s.Store.WebhookByID(ctx, *c.WebhookID); err == nil {
				extra["webhook"] = s.webhookObj(ctx, wh, true)
			}
		}
	case "refresh_token":
		old, err := s.Store.OAuthTokenByRefresh(ctx, tokenHash(form.Get("refresh_token")))
		if err != nil || old.ApplicationID != app.ID || old.RefreshExpiresAt < time.Now().UnixMilli() {
			writeOAuthError(w, oauthErr("invalid_grant", "Invalid \"refresh_token\" in request."))
			return
		}
		if !secretOK {
			writeOAuthError(w, oauthErr("invalid_client", "The client secret is required."))
			return
		}
		_ = s.Store.DeleteOAuthToken(ctx, old.ID)
		if access, refresh, t, err = s.issueToken(ctx, app.ID, old.UserID, old.Scopes, true); err != nil {
			writeOAuthError(w, err)
			return
		}
	case "client_credentials":
		if !secretOK {
			writeOAuthError(w, oauthErr("invalid_client", "The client secret is required."))
			return
		}
		scopes := []string{}
		for _, sc := range strings.Fields(form.Get("scope")) {
			switch sc {
			case "identify", "connections", "guilds", "applications.commands.update", "applications.commands.permissions.update", "email":
				scopes = append(scopes, sc)
			default:
				writeOAuthError(w, oauthErr("invalid_scope", "The requested scope is invalid, unknown, or malformed."))
				return
			}
		}
		// the token acts for the application's owner, as the protocol's does
		if access, _, t, err = s.issueToken(ctx, app.ID, app.OwnerID, scopes, false); err != nil {
			writeOAuthError(w, err)
			return
		}
	default:
		writeOAuthError(w, oauthErr("unsupported_grant_type", "Unsupported grant type"))
		return
	}
	out := map[string]any{"access_token": access, "token_type": oauthBearerType, "expires_in": int64(oauthTokenLife.Seconds()), "scope": strings.Join(t.Scopes, " ")}
	if refresh != "" {
		out["refresh_token"] = refresh
	}
	for k, v := range extra {
		out[k] = v
	}
	w.Header().Set("Cache-Control", "no-store")
	WriteJSON(w, http.StatusOK, out)
}

// botOAuthRevoke takes back an access or refresh token.
func (s *Server) botOAuthRevoke(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := r.ParseForm(); err != nil {
		writeOAuthError(w, oauthErr("invalid_request", "The request could not be read."))
		return
	}
	app, _, err := s.clientAuth(r)
	if err != nil {
		writeOAuthError(w, err)
		return
	}
	ctx := r.Context()
	hash := tokenHash(r.PostForm.Get("token"))
	t, err := s.Store.OAuthTokenByAccess(ctx, hash)
	if err != nil {
		t, err = s.Store.OAuthTokenByRefresh(ctx, hash)
	}
	if err == nil && t.ApplicationID == app.ID {
		_ = s.Store.DeleteOAuthToken(ctx, t.ID)
	}
	// revoking an unknown token succeeds, as OAuth2 has it
	WriteJSON(w, http.StatusOK, map[string]any{})
}

// botOAuthMe describes the token a request came with.
func (s *Server) botOAuthMe(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	bld := s.builderFor(r, b)
	out := map[string]any{"application": bld.applicationObj(b.app, false), "scopes": b.token.Scopes, "expires": botproto.Timestamp(b.token.ExpiresAt)}
	if b.hasScope("identify") {
		out["user"] = bld.userObj(b.user)
	}
	WriteJSON(w, http.StatusOK, out)
}

// --- an account's applications ---------------------------------------------------------------

// handleAuthorizedApps lists the applications someone let act for them or
// added to their account.
func (s *Server) handleAuthorizedApps(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	ctx := r.Context()
	byApp := map[ids.ID]map[string]any{}
	grants, err := s.Store.OAuthGrants(ctx, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	for _, t := range grants {
		byApp[t.ApplicationID] = map[string]any{"scopes": t.Scopes, "authorized_at": t.CreatedAt, "installed": false}
	}
	installs, err := s.Store.UserInstalls(ctx, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	for _, in := range installs {
		e := byApp[in.ApplicationID]
		if e == nil {
			e = map[string]any{"scopes": in.Scopes, "authorized_at": in.CreatedAt}
			byApp[in.ApplicationID] = e
		}
		e["installed"] = true
	}
	list := []map[string]any{}
	for id, e := range byApp {
		app, err := s.Store.ApplicationByID(ctx, id)
		if err != nil {
			continue
		}
		bot, err := s.Store.UserByID(ctx, id)
		if err != nil {
			continue
		}
		e["application"] = map[string]any{"id": app.ID, "name": app.Name, "description": app.Description, "icon_id": app.IconID, "bot": bot.Public(),
			"terms_url": app.TermsURL, "privacy_url": app.PrivacyURL}
		list = append(list, e)
	}
	sort.Slice(list, func(i, j int) bool { return list[i]["authorized_at"].(int64) > list[j]["authorized_at"].(int64) })
	WriteJSON(w, http.StatusOK, list)
}

// handleDeauthorize takes back what someone let an application do: its
// tokens for them, and its place on their account.
func (s *Server) handleDeauthorize(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	ctx := r.Context()
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.DeleteOAuthTokensFor(ctx, id, me.ID); err != nil {
		WriteError(w, err)
		return
	}
	if removed, err := s.Store.RemoveUserInstall(ctx, id, me.ID); err == nil && removed {
		s.Bcast.EmitUsers([]ids.ID{me.ID}, gateway.EvAppCommandsUpdate, map[string]any{"application_id": id})
	}
	s.sendAppEvent(ctx, id, "APPLICATION_DEAUTHORIZED", map[string]any{"user": s.builder(ctx, nil, nil).userObj(me)})
	w.WriteHeader(http.StatusNoContent)
}

// --- a server's applications -----------------------------------------------------------------

// handleIntegrations lists the applications of a server, for whoever
// manages it.
func (s *Server) handleIntegrations(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	ctx := r.Context()
	installs, err := s.Store.GuildInstalls(ctx, srv.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	out := []map[string]any{}
	for _, in := range installs {
		app, err := s.Store.ApplicationByID(ctx, in.ApplicationID)
		if err != nil {
			continue
		}
		bot, err := s.Store.UserByID(ctx, in.ApplicationID)
		if err != nil {
			continue
		}
		e := map[string]any{"application": map[string]any{"id": app.ID, "name": app.Name, "description": app.Description, "icon_id": app.IconID,
			"bot": bot.Public(), "intents": intentsOf(app.Flags)}, "scopes": in.Scopes, "installed_by": in.InstalledBy, "installed_at": in.CreatedAt}
		if member, _ := s.Store.IsMember(ctx, srv.ID, bot.ID); member {
			e["bot_member"] = true
		}
		if roles, err := s.Store.Roles(ctx, srv.ID); err == nil {
			for _, role := range roles {
				if role.ManagedBy != nil && *role.ManagedBy == bot.ID {
					e["role_id"] = role.ID
				}
			}
		}
		if cmds, err := s.Store.CommandsOf(ctx, []ids.ID{app.ID}, srv.ID); err == nil {
			e["command_count"] = len(cmds)
		}
		out = append(out, e)
	}
	WriteJSON(w, http.StatusOK, out)
}

// handleIntegrationRemove takes an application out of a server: its bot
// leaves, and its commands go from there.
func (s *Server) handleIntegrationRemove(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	appID, err := ids.Parse(r.PathValue("app"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	ctx := r.Context()
	if _, err := s.Store.GuildInstall(ctx, appID, srv.ID); err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if member, _ := s.Store.IsMember(ctx, srv.ID, appID); member {
		if err := s.removeMember(r, srv, appID, "member_remove", map[string]any{"reason": "kick"}); err != nil {
			WriteError(w, err)
			return
		}
	} else {
		s.botLeftServer(r, srv, appID)
	}
	s.audit(r, srv.ID, me.ID, "integration_delete", "user", &appID, nil, "")
	s.commandsChanged(ctx, appID, &srv.ID)
	w.WriteHeader(http.StatusNoContent)
}

// handleIntegrationCommands lists an application's commands in a server,
// with who may use each, for its managers.
func (s *Server) handleIntegrationCommands(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	appID, err := ids.Parse(r.PathValue("app"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	ctx := r.Context()
	if _, err := s.Store.GuildInstall(ctx, appID, srv.ID); err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	cmds, err := s.Store.CommandsOf(ctx, []ids.ID{appID}, srv.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	views := []commandView{}
	for _, c := range cmds {
		views = append(views, commandView{ID: c.ID, ApplicationID: c.ApplicationID, GuildID: c.GuildID, Version: c.Version, commandDef: *readCommandDef(c)})
	}
	sets, err := s.Store.CommandPermissionsIn(ctx, appID, srv.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	permissions := map[string][]commandPermission{}
	for _, set := range sets {
		permissions[set.CommandID.String()] = readCommandPermissions(set.Permissions)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"commands": views, "permissions": permissions, "all_channels_id": allChannelsID(srv.ID)})
}

// handleIntegrationCommandPerms sets who may use a command (or, with the
// application's id, all of them) in a server, from Server Settings.
func (s *Server) handleIntegrationCommandPerms(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	appID, err := ids.Parse(r.PathValue("app"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	cmdID, err := ids.Parse(r.PathValue("command"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	ctx := r.Context()
	app, err := s.Store.ApplicationByID(ctx, appID)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if _, err := s.Store.GuildInstall(ctx, appID, srv.ID); err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if cmdID != appID {
		c, err := s.Store.CommandByID(ctx, cmdID)
		if err != nil || c.ApplicationID != appID || (c.GuildID != nil && *c.GuildID != srv.ID) {
			WriteError(w, ErrNotFound)
			return
		}
	}
	var body struct {
		Permissions []commandPermission `json:"permissions"`
	}
	if err := ReadJSON(w, r, &body, 32<<10); err != nil {
		WriteError(w, err)
		return
	}
	if len(body.Permissions) > cmdMaxPermEntries {
		WriteError(w, E(http.StatusBadRequest, "too_many", "That is too many entries for one command."))
		return
	}
	for _, e := range body.Permissions {
		if e.Type < cmdPermRole || e.Type > cmdPermChannel {
			WriteError(w, E(http.StatusBadRequest, "invalid_type", "That is not something a command's permissions name."))
			return
		}
	}
	set, err := s.setCommandPermissions(r, me, app, srv.ID, cmdID, body.Permissions)
	if err != nil {
		writeAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"command_id": set.CommandID, "permissions": readCommandPermissions(set.Permissions)})
}

// --- event webhooks ---------------------------------------------------------------------------

// sendAppEvent tells an application's event webhook something happened to
// it, when it has one switched on for that kind of event: signed as
// interactions are, through the egress proxy, without waiting.
func (s *Server) sendAppEvent(ctx context.Context, appID ids.ID, kind string, data map[string]any) {
	app, err := s.Store.ApplicationByID(ctx, appID)
	if err != nil || app.EventWebhooksStatus != 2 || app.EventWebhooksURL == "" {
		return
	}
	wanted := false
	for _, t := range app.EventWebhooksTypes {
		if t == kind {
			wanted = true
		}
	}
	if !wanted {
		return
	}
	body, err := json.Marshal(map[string]any{"version": 1, "application_id": snow(app.ID), "type": 1,
		"event": map[string]any{"type": kind, "timestamp": botproto.Timestamp(time.Now().UnixMilli()), "data": data}})
	if err != nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, _, err := s.signedPost(ctx, app, app.EventWebhooksURL, body, false); err != nil {
			s.Log.Info("app event webhook", "app", app.ID, "err", err)
		}
	}()
}

// announceNewRole tells a server's members of a role just made at the
// bottom, which moved every other role up one, as making a role in the app
// does.
func (s *Server) announceNewRole(ctx context.Context, serverID ids.ID, role *store.Role) {
	members, err := s.Store.MemberIDs(ctx, serverID)
	if err != nil {
		return
	}
	if all, err := s.Store.Roles(ctx, serverID); err == nil {
		for _, ro := range all {
			if ro.ID != role.ID && ro.ID != serverID {
				s.Bcast.EmitUsers(members, "role_update", ro)
			}
		}
	}
	s.Bcast.EmitUsers(members, "role_create", role)
}
