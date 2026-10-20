package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"regexp/syntax"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"evilion.xyz/chat/internal/automod"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

// AutoMod: rules a server's moderators write, applied before anyone has to
// see what they catch. Messages are end-to-end encrypted, so the rules that
// read what a message says (words, links, invites, addresses, capitals,
// emoji, files) are applied by each member's app: the sender's stops the
// message and says why, everyone else's hides it, and a moderator's clears it
// away. The ones the server can see for itself it applies here: mentions,
// floods of messages, and names and profiles. What was caught reaches the
// moderators sealed with the server's key, which every member's app holds
// and Nexa does not.

// Rule kinds.
const (
	ruleFlagged     = "flagged_words"
	ruleWords       = "words"
	ruleSpam        = "spam"
	ruleLinks       = "links"
	ruleInvites     = "invites"
	rulePersonal    = "personal"
	ruleCaps        = "caps"
	ruleEmojiSpam   = "emoji_spam"
	ruleAttachments = "attachments"
	ruleMentions    = "mentions"
	ruleFlood       = "flood"
	ruleProfile     = "profile"
)

// clientKinds are read by members' apps; the rest by the server. The word
// rules are read by both: the apps read messages with them, the server the
// titles of threads and forum posts.
var clientKinds = []string{ruleFlagged, ruleWords, ruleSpam, ruleLinks, ruleInvites, rulePersonal, ruleCaps, ruleEmojiSpam, ruleAttachments}

var allKinds = append(append([]string{}, clientKinds...), ruleMentions, ruleFlood, ruleProfile)

// Rule action types.
const (
	actBlock      = "block"
	actAlert      = "alert"
	actTimeout    = "timeout"
	actQuarantine = "quarantine"
)

// ruleAction is one thing a rule does.
type ruleAction struct {
	Type string `json:"type"`
	// Message is shown to whoever a block stops (block).
	Message string `json:"message,omitempty"`
	// ChannelID is where an alert goes (alert).
	ChannelID *ids.ID `json:"channel_id,omitempty"`
	// Seconds is how long a timeout lasts, and After how many times in a
	// day the rule has to catch someone before it times them out (1, or
	// unset: the first time).
	Seconds int `json:"seconds,omitempty"`
	After   int `json:"after,omitempty"`
}

// ruleConfig is what a rule looks for; each kind reads its own fields.
type ruleConfig struct {
	// flagged_words and profile: the ready-made lists used
	Lists []string `json:"lists,omitempty"`
	// words and profile
	Words []string `json:"words,omitempty"`
	Regex []string `json:"regex,omitempty"`
	// words, flagged_words, profile: words let through
	Allow []string `json:"allow,omitempty"`
	// Evasion also catches disguised spellings (automod.Fold); on unless turned off
	Evasion *bool `json:"evasion,omitempty"`
	// links: "all" blocks every link but Allow's domains; "list" only Domains
	Mode    string   `json:"mode,omitempty"`
	Domains []string `json:"domains,omitempty"`
	// spam: which signs of it to look for
	Scams   bool `json:"scams,omitempty"`
	Repeats bool `json:"repeats,omitempty"`
	Shady   bool `json:"shady_links,omitempty"`
	Zalgo   bool `json:"zalgo,omitempty"`
	Walls   bool `json:"walls,omitempty"`
	// personal: which details
	Emails bool `json:"emails,omitempty"`
	Phones bool `json:"phones,omitempty"`
	IPs    bool `json:"ips,omitempty"`
	Cards  bool `json:"cards,omitempty"`
	// caps: the share of capitals (percent) and the shortest text weighed
	Percent   int `json:"percent,omitempty"`
	MinLength int `json:"min_length,omitempty"`
	// emoji_spam and mentions: the most allowed in one message
	Max int `json:"max,omitempty"`
	// mentions: also catch someone pinging many people across messages
	Raid bool `json:"raid,omitempty"`
	// flood: so many messages within so many seconds
	Messages int `json:"messages,omitempty"`
	Seconds  int `json:"seconds,omitempty"`
	// attachments: file endings not allowed
	Extensions []string `json:"extensions,omitempty"`
	// invites: let links to this server itself through
	AllowOwn bool `json:"allow_own,omitempty"`
	// profile: which parts of a profile are read
	Names bool `json:"names,omitempty"`
	Bio   bool `json:"bio,omitempty"`
}

// evasion is whether a rule reads past disguised spellings.
func (c ruleConfig) evasion() bool { return c.Evasion == nil || *c.Evasion }

// matcher builds the word matcher of a words, flagged_words or profile rule.
func (c ruleConfig) matcher() *automod.Matcher {
	words := append([]string{}, c.Words...)
	for _, name := range c.Lists {
		words = append(words, automod.Presets[name]...)
	}
	return automod.NewMatcher(words, c.Regex, c.Allow, c.evasion())
}

// Limits on what a rule holds.
const (
	maxRuleWords      = 1000
	maxRuleWordLen    = 60
	maxRuleRegex      = 10
	maxRuleRegexLen   = 260
	maxRuleAllow      = 100
	maxRuleDomains    = 200
	maxRuleExtensions = 50
	maxRuleName       = 100
	maxBlockMessage   = 150
	maxRuleExempt     = 50
	maxAutomodTimeout = 28 * 24 * 3600
	maxStrikes        = 10
)

func (s *Server) automodRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/servers/{id}/automod", s.authed(s.handleAutomodForMembers))
	mux.Handle("GET /api/v1/servers/{id}/automod/rules", s.authed(s.handleAutomodRules))
	mux.Handle("POST /api/v1/servers/{id}/automod/rules", s.authed(s.handleAutomodRuleSave))
	mux.Handle("PATCH /api/v1/servers/{id}/automod/rules/{rid}", s.authed(s.handleAutomodRuleSave))
	mux.Handle("DELETE /api/v1/servers/{id}/automod/rules/{rid}", s.authed(s.handleAutomodRuleDelete))
	mux.Handle("POST /api/v1/servers/{id}/automod/report", s.authed(s.handleAutomodReport))
	mux.Handle("GET /api/v1/servers/{id}/automod/events", s.authed(s.handleAutomodEvents))
	mux.Handle("GET /api/v1/servers/{id}/automod/stats", s.authed(s.handleAutomodStats))
	mux.Handle("GET /api/v1/automod/presets", s.authed(s.handleAutomodPresets))
}

// handleAutomodPresets hands apps the ready-made lists, the spam signs and the
// risky file endings, which every app applies the same way.
func (s *Server) handleAutomodPresets(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, max-age=3600")
	WriteJSON(w, http.StatusOK, map[string]any{"lists": automod.Presets, "spam_phrases": automod.SpamPhrases, "shorteners": automod.Shorteners,
		"impersonated": automod.Impersonated, "risky_extensions": automod.RiskyExtensions})
}

// handleAutomodStats says how much each rule caught in the past week.
func (s *Server) handleAutomodStats(w http.ResponseWriter, r *http.Request) {
	srv, _, p := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	if !p.Has(perms.ManageServer) && !p.Has(perms.ViewAuditLog) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Manage Server to see this."))
		return
	}
	since := time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
	counts, err := s.Store.AutomodCounts(r.Context(), srv.ID, since)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"since": since, "rules": counts})
}

// handleAutomodRules lists every rule, for the people who write them.
func (s *Server) handleAutomodRules(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	list, err := s.Store.AutomodRules(r.Context(), srv.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

// handleAutomodForMembers lists the rules members' apps apply: the enabled
// ones that read messages. Every member's app has to hold them to apply them.
func (s *Server) handleAutomodForMembers(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	list, err := s.Store.AutomodRules(r.Context(), srv.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	out := []*store.AutomodRule{}
	for _, a := range list {
		if a.Enabled && OneOf(a.Kind, clientKinds...) {
			out = append(out, a)
		}
	}
	WriteJSON(w, http.StatusOK, out)
}

type ruleBody struct {
	Name           *string          `json:"name"`
	Kind           *string          `json:"kind"`
	Enabled        *bool            `json:"enabled"`
	Config         *json.RawMessage `json:"config"`
	Actions        *json.RawMessage `json:"actions"`
	ExemptRoles    *[]ids.ID        `json:"exempt_roles"`
	ExemptChannels *[]ids.ID        `json:"exempt_channels"`
}

// handleAutomodRuleSave makes a rule (POST) or changes one (PATCH).
func (s *Server) handleAutomodRuleSave(w http.ResponseWriter, r *http.Request) {
	srv, me, actorPerms := s.serverCtx(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	var body ruleBody
	if err := ReadJSON(w, r, &body, 128<<10); err != nil {
		WriteError(w, err)
		return
	}
	rule := &store.AutomodRule{ServerID: srv.ID, CreatorID: me.ID, Enabled: true, Config: json.RawMessage(`{}`), Actions: json.RawMessage(`[]`)}
	action := "automod_rule_create"
	if rid := r.PathValue("rid"); rid != "" {
		id, err := ids.Parse(rid)
		if err != nil {
			WriteError(w, ErrNotFound)
			return
		}
		existing, err := s.Store.AutomodRule(r.Context(), id)
		if err != nil || existing.ServerID != srv.ID {
			WriteError(w, ErrNotFound)
			return
		}
		rule, action = existing, "automod_rule_update"
	} else if body.Kind == nil {
		WriteError(w, E(http.StatusBadRequest, "invalid_rule", "Say what the rule looks for."))
		return
	}
	if body.Name != nil {
		name, ok := CleanText(strings.TrimSpace(*body.Name), maxRuleName)
		if !ok || name == "" {
			WriteError(w, E(http.StatusBadRequest, "invalid_rule", "A rule's name is 1 to 100 characters."))
			return
		}
		rule.Name = name
	}
	if body.Kind != nil {
		if action == "automod_rule_update" && *body.Kind != rule.Kind {
			WriteError(w, E(http.StatusBadRequest, "invalid_rule", "What a rule looks for cannot change. Make a new rule instead."))
			return
		}
		if !OneOf(*body.Kind, allKinds...) {
			WriteError(w, E(http.StatusBadRequest, "invalid_rule", "That is not something AutoMod can look for."))
			return
		}
		rule.Kind = *body.Kind
	}
	if rule.Name == "" {
		rule.Name = rule.Kind
	}
	if body.Enabled != nil {
		rule.Enabled = *body.Enabled
	}
	if body.Config != nil {
		clean, err := cleanRuleConfig(rule.Kind, *body.Config)
		if err != nil {
			WriteError(w, err)
			return
		}
		rule.Config = clean
	}
	if body.Actions != nil {
		clean, err := s.cleanRuleActions(r.Context(), srv, rule.Kind, *body.Actions, actorPerms)
		if err != nil {
			WriteError(w, err)
			return
		}
		rule.Actions = clean
	}
	if body.ExemptRoles != nil {
		list := dedupeIDs(*body.ExemptRoles, maxRuleExempt+1)
		if len(list) > maxRuleExempt {
			WriteError(w, E(http.StatusBadRequest, "invalid_rule", "A rule leaves out at most 50 roles."))
			return
		}
		roles, _ := s.Store.Roles(r.Context(), srv.ID)
		known := map[ids.ID]bool{}
		for _, ro := range roles {
			known[ro.ID] = true
		}
		for _, id := range list {
			if !known[id] {
				WriteError(w, E(http.StatusBadRequest, "invalid_rule", "One of those roles is not in this server."))
				return
			}
		}
		rule.ExemptRoles = list
	}
	if body.ExemptChannels != nil {
		list := dedupeIDs(*body.ExemptChannels, maxRuleExempt+1)
		if len(list) > maxRuleExempt {
			WriteError(w, E(http.StatusBadRequest, "invalid_rule", "A rule leaves out at most 50 channels."))
			return
		}
		for _, id := range list {
			ch, err := s.Store.ChannelByID(r.Context(), id)
			if err != nil || ch.ServerID == nil || *ch.ServerID != srv.ID {
				WriteError(w, E(http.StatusBadRequest, "invalid_rule", "One of those channels is not in this server."))
				return
			}
		}
		rule.ExemptChannels = list
	}
	if len(ruleActions(rule.Actions)) == 0 {
		WriteError(w, E(http.StatusBadRequest, "invalid_rule", "Give the rule something to do when it catches something."))
		return
	}
	if err := s.Store.SaveAutomodRule(r.Context(), rule); err != nil {
		if errors.Is(err, store.ErrLimit) {
			WriteError(w, E(http.StatusBadRequest, "too_many_rules", "This server has as many rules as it can hold."))
			return
		}
		WriteError(w, err)
		return
	}
	s.audit(r, srv.ID, me.ID, action, "automod_rule", &rule.ID, map[string]any{"name": rule.Name, "kind": rule.Kind, "enabled": rule.Enabled}, "")
	s.automodChanged(r.Context(), srv.ID)
	status := http.StatusOK
	if action == "automod_rule_create" {
		status = http.StatusCreated
	}
	WriteJSON(w, status, rule)
}

func (s *Server) handleAutomodRuleDelete(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	id, err := ids.Parse(r.PathValue("rid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	rule, err := s.Store.AutomodRule(r.Context(), id)
	if err != nil || rule.ServerID != srv.ID {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.DeleteAutomodRule(r.Context(), srv.ID, id); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, srv.ID, me.ID, "automod_rule_delete", "automod_rule", &id, map[string]any{"name": rule.Name, "kind": rule.Kind}, "")
	s.automodChanged(r.Context(), srv.ID)
	w.WriteHeader(http.StatusNoContent)
}

// automodChanged tells a server's members' apps to fetch the rules again,
// and marks whether there are any for them to apply.
func (s *Server) automodChanged(ctx context.Context, serverID ids.ID) {
	at := int64(0)
	if rules, err := s.Store.AutomodRules(ctx, serverID); err == nil {
		for _, r := range rules {
			if r.Enabled && OneOf(r.Kind, clientKinds...) {
				at = time.Now().UnixMilli()
				break
			}
		}
	}
	if err := s.Store.SetAutomodAt(ctx, serverID, at); err != nil {
		s.Log.Warn("automod_at", "err", err)
	}
	s.emitServer(ctx, serverID, "automod_rules_update", map[string]any{"server_id": serverID, "automod_at": at})
}

// cleanRuleConfig checks what a rule looks for and keeps only what its kind reads.
func cleanRuleConfig(kind string, raw json.RawMessage) (json.RawMessage, error) {
	var c ruleConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, E(http.StatusBadRequest, "invalid_rule", "The rule's settings are malformed.")
	}
	var out ruleConfig
	words := func(need bool) error {
		ws, err := cleanList(c.Words, maxRuleWords, maxRuleWordLen, true)
		if err != nil {
			return err
		}
		if len(c.Regex) > maxRuleRegex {
			return E(http.StatusBadRequest, "invalid_rule", "A rule holds at most 10 patterns.")
		}
		var regex []string
		for _, p := range c.Regex {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			if err := checkPattern(p); err != nil {
				return err
			}
			regex = append(regex, p)
		}
		if need && len(ws) == 0 && len(regex) == 0 && len(out.Lists) == 0 {
			return E(http.StatusBadRequest, "invalid_rule", "Add at least one word, pattern or list.")
		}
		out.Words, out.Regex = ws, regex
		return nil
	}
	lists := func() error {
		for _, name := range c.Lists {
			if !OneOf(name, automod.PresetNames...) {
				return E(http.StatusBadRequest, "invalid_rule", "That is not one of the ready-made lists.")
			}
			if !OneOf(name, out.Lists...) {
				out.Lists = append(out.Lists, name)
			}
		}
		return nil
	}
	allow := func() error {
		a, err := cleanList(c.Allow, maxRuleAllow, maxRuleWordLen, true)
		out.Allow = a
		return err
	}
	switch kind {
	case ruleFlagged:
		if err := lists(); err != nil {
			return nil, err
		}
		if len(out.Lists) == 0 {
			return nil, E(http.StatusBadRequest, "invalid_rule", "Pick at least one list.")
		}
		if err := allow(); err != nil {
			return nil, err
		}
		out.Evasion = c.Evasion
	case ruleWords:
		if err := words(true); err != nil {
			return nil, err
		}
		if err := allow(); err != nil {
			return nil, err
		}
		out.Evasion = c.Evasion
	case ruleProfile:
		if err := lists(); err != nil {
			return nil, err
		}
		if err := words(true); err != nil {
			return nil, err
		}
		if err := allow(); err != nil {
			return nil, err
		}
		out.Evasion, out.Names, out.Bio = c.Evasion, c.Names, c.Bio
		if !out.Names && !out.Bio {
			out.Names = true
		}
	case ruleSpam:
		out.Scams, out.Repeats, out.Shady, out.Zalgo, out.Walls = c.Scams, c.Repeats, c.Shady, c.Zalgo, c.Walls
		if !out.Scams && !out.Repeats && !out.Shady && !out.Zalgo && !out.Walls {
			return nil, E(http.StatusBadRequest, "invalid_rule", "Pick at least one kind of spam to look for.")
		}
	case rulePersonal:
		out.Emails, out.Phones, out.IPs, out.Cards = c.Emails, c.Phones, c.IPs, c.Cards
		if !out.Emails && !out.Phones && !out.IPs && !out.Cards {
			return nil, E(http.StatusBadRequest, "invalid_rule", "Pick at least one kind of personal detail.")
		}
	case ruleInvites:
		out.AllowOwn = c.AllowOwn
	case ruleLinks:
		domains, err := cleanDomains(c.Domains)
		if err != nil {
			return nil, err
		}
		allowed, err := cleanDomains(c.Allow)
		if err != nil {
			return nil, err
		}
		switch c.Mode {
		case "all", "":
			out.Mode, out.Allow = "all", allowed
		case "list":
			if len(domains) == 0 {
				return nil, E(http.StatusBadRequest, "invalid_rule", "Add at least one site to block.")
			}
			out.Mode, out.Domains = "list", domains
		default:
			return nil, E(http.StatusBadRequest, "invalid_rule", "Links are blocked all but some, or only some.")
		}
	case ruleCaps:
		out.Percent, out.MinLength = c.Percent, c.MinLength
		if out.Percent < 50 || out.Percent > 100 {
			out.Percent = 70
		}
		if out.MinLength < 1 || out.MinLength > 2000 {
			out.MinLength = 10
		}
	case ruleEmojiSpam:
		out.Max = c.Max
		if out.Max < 1 || out.Max > 200 {
			out.Max = 10
		}
	case ruleMentions:
		out.Max, out.Raid = c.Max, c.Raid
		if out.Max < 1 || out.Max > maxMentions {
			out.Max = 5
		}
	case ruleFlood:
		out.Messages, out.Seconds = c.Messages, c.Seconds
		if out.Messages < 2 || out.Messages > 50 {
			out.Messages = 5
		}
		if out.Seconds < 1 || out.Seconds > 600 {
			out.Seconds = 10
		}
	case ruleAttachments:
		var exts []string
		seen := map[string]bool{}
		for _, e := range c.Extensions {
			e = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(e), "."))
			if e == "" || seen[e] {
				continue
			}
			if len(e) > 16 || strings.ContainsAny(e, "/\\ .") {
				return nil, E(http.StatusBadRequest, "invalid_rule", "A file ending is letters and numbers, like exe.")
			}
			seen[e] = true
			exts = append(exts, e)
		}
		if len(exts) == 0 || len(exts) > maxRuleExtensions {
			return nil, E(http.StatusBadRequest, "invalid_rule", "List between 1 and 50 file endings.")
		}
		out.Extensions = exts
	}
	b, _ := json.Marshal(out)
	return b, nil
}

func cleanList(list []string, max, maxLen int, lower bool) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, w := range list {
		w = strings.Join(strings.Fields(w), " ")
		if lower {
			w = strings.ToLower(w)
		}
		if w == "" || seen[w] {
			continue
		}
		if utf8.RuneCountInString(w) > maxLen {
			return nil, E(http.StatusBadRequest, "invalid_rule", fmt.Sprintf("Each word or phrase is at most %d characters.", maxLen))
		}
		seen[w] = true
		out = append(out, w)
	}
	if len(out) > max {
		return nil, E(http.StatusBadRequest, "invalid_rule", fmt.Sprintf("A rule holds at most %d words.", max))
	}
	return out, nil
}

var domainShape = regexp.MustCompile(`^(\*\.)?([a-z0-9-]+\.)+[a-z0-9-]{2,}$`)

func cleanDomains(list []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, d := range list {
		d = strings.ToLower(strings.TrimSpace(d))
		d = strings.TrimPrefix(strings.TrimPrefix(d, "https://"), "http://")
		d = strings.TrimSuffix(strings.SplitN(d, "/", 2)[0], ".")
		if d == "" || seen[d] {
			continue
		}
		if !domainShape.MatchString(d) {
			return nil, E(http.StatusBadRequest, "invalid_rule", "Sites are written as a domain, like example.com.")
		}
		seen[d] = true
		out = append(out, d)
	}
	if len(out) > maxRuleDomains {
		return nil, E(http.StatusBadRequest, "invalid_rule", "A rule lists at most 200 sites.")
	}
	return out, nil
}

// checkPattern accepts a regular expression members' apps can run safely:
// one Go reads, and without a repeat inside a repeat, which is what makes a
// browser's matcher take forever on a crafted message.
func checkPattern(p string) error {
	if len(p) > maxRuleRegexLen {
		return E(http.StatusBadRequest, "invalid_rule", "A pattern is at most 260 characters.")
	}
	re, err := syntax.Parse(p, syntax.Perl)
	if err != nil {
		return E(http.StatusBadRequest, "invalid_pattern", "That pattern is not a regular expression: "+err.Error())
	}
	if nestedRepeat(re, false) {
		return E(http.StatusBadRequest, "invalid_pattern", "A pattern cannot repeat something that already repeats, like (a+)+. Write it without the outer repeat.")
	}
	if strings.Contains(p, `\1`) || strings.Contains(p, "(?=") || strings.Contains(p, "(?!") || strings.Contains(p, "(?<") {
		return E(http.StatusBadRequest, "invalid_pattern", "Patterns cannot look ahead, look behind or refer back.")
	}
	return nil
}

func nestedRepeat(re *syntax.Regexp, inside bool) bool {
	switch re.Op {
	case syntax.OpStar, syntax.OpPlus, syntax.OpQuest, syntax.OpRepeat:
		repeats := re.Op != syntax.OpQuest && !(re.Op == syntax.OpRepeat && re.Max == re.Min && re.Max <= 1)
		if inside && repeats {
			return true
		}
		for _, sub := range re.Sub {
			if nestedRepeat(sub, inside || repeats) {
				return true
			}
		}
		return false
	}
	for _, sub := range re.Sub {
		if nestedRepeat(sub, inside) {
			return true
		}
	}
	return false
}

// cleanRuleActions checks what a rule does: a block for the rules that look
// at messages (with what it says to whoever it stops), an alert to one of the
// server's text channels, a timeout (needing Time Out Members to set), and a
// quarantine for names.
func (s *Server) cleanRuleActions(ctx context.Context, srv *store.Server, kind string, raw json.RawMessage, actor perms.Perm) (json.RawMessage, error) {
	var list []ruleAction
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, E(http.StatusBadRequest, "invalid_rule", "The rule's actions are malformed.")
	}
	out := []ruleAction{}
	seen := map[string]bool{}
	for _, a := range list {
		if seen[a.Type] {
			continue
		}
		seen[a.Type] = true
		switch a.Type {
		case actBlock:
			if kind == ruleProfile {
				return nil, E(http.StatusBadRequest, "invalid_rule", "A name rule quarantines rather than blocks.")
			}
			msg, ok := CleanText(strings.TrimSpace(a.Message), maxBlockMessage)
			if !ok {
				return nil, E(http.StatusBadRequest, "invalid_rule", "What a block says is at most 150 characters.")
			}
			out = append(out, ruleAction{Type: actBlock, Message: msg})
		case actAlert:
			if a.ChannelID == nil {
				return nil, E(http.StatusBadRequest, "invalid_rule", "Pick the channel alerts go to.")
			}
			ch, err := s.Store.ChannelByID(ctx, *a.ChannelID)
			if err != nil || ch.ServerID == nil || *ch.ServerID != srv.ID || !store.Talkable(ch.Type) || store.IsThread(ch.Type) {
				return nil, E(http.StatusBadRequest, "invalid_rule", "Alerts go to one of this server's text channels.")
			}
			out = append(out, ruleAction{Type: actAlert, ChannelID: a.ChannelID})
		case actTimeout:
			if kind == ruleProfile {
				return nil, E(http.StatusBadRequest, "invalid_rule", "A name rule quarantines rather than times out.")
			}
			if !actor.Has(perms.ModerateMembers) {
				return nil, E(http.StatusForbidden, "missing_permission", "You need Time Out Members to make a rule that times people out.")
			}
			if a.Seconds < 60 || a.Seconds > maxAutomodTimeout {
				return nil, E(http.StatusBadRequest, "invalid_rule", "A timeout lasts from a minute to 28 days.")
			}
			if a.After < 0 || a.After > maxStrikes {
				return nil, E(http.StatusBadRequest, "invalid_rule", "A timeout comes after 1 to 10 catches in a day.")
			}
			out = append(out, ruleAction{Type: actTimeout, Seconds: a.Seconds, After: max(a.After, 1)})
		case actQuarantine:
			if kind != ruleProfile {
				return nil, E(http.StatusBadRequest, "invalid_rule", "Only name rules quarantine.")
			}
			if !actor.Has(perms.ModerateMembers) {
				return nil, E(http.StatusForbidden, "missing_permission", "You need Time Out Members to make a rule that quarantines people.")
			}
			out = append(out, ruleAction{Type: actQuarantine})
		default:
			return nil, E(http.StatusBadRequest, "invalid_rule", "That is not something AutoMod can do.")
		}
	}
	b, _ := json.Marshal(out)
	return b, nil
}

func ruleActions(raw json.RawMessage) []ruleAction {
	var list []ruleAction
	_ = json.Unmarshal(raw, &list)
	return list
}

func ruleConfigOf(raw json.RawMessage) ruleConfig {
	var c ruleConfig
	_ = json.Unmarshal(raw, &c)
	return c
}

// exempt reports whether a rule leaves someone or a channel alone: its own
// exemptions, and everyone who may manage the server, who are never held by
// AutoMod.
func (s *Server) exempt(ctx context.Context, srv *store.Server, rule *store.AutomodRule, uid ids.ID, channel *store.Channel) bool {
	p, err := s.Store.ServerPerms(ctx, srv.ID, uid)
	if err != nil || p.Has(perms.ManageServer) || p.Has(perms.Administrator) {
		return true
	}
	if channel != nil {
		for _, id := range rule.ExemptChannels {
			// a thread is left alone where its channel is
			if id == channel.ID || (channel.ParentID != nil && id == *channel.ParentID) {
				return true
			}
		}
	}
	if len(rule.ExemptRoles) > 0 {
		m, err := s.Store.Member(ctx, srv.ID, uid)
		if err != nil {
			return true
		}
		for _, mine := range m.RoleIDs {
			for _, ex := range rule.ExemptRoles {
				if mine == ex {
					return true
				}
			}
		}
	}
	return false
}

// writeAutomodBlocked refuses what AutoMod stopped, saying which rule did and
// whether the words are the rule's own (custom) or the usual ones, which apps
// put in their own language.
func writeAutomodBlocked(w http.ResponseWriter, rule *store.AutomodRule, custom, fallback string) {
	msg := custom
	if msg == "" {
		msg = fallback
	}
	WriteJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "automod_blocked", "message": msg}, "rule": rule.Name, "kind": rule.Kind, "custom": custom != ""})
}

// automodVerdict is what the server's own rules decided about a message.
type automodVerdict struct {
	blocked *store.AutomodRule
	message string
}

// checkMessageRules applies the rules the server can see for itself to a
// message about to be sent: how many it mentions, and how fast its sender is
// sending. Alerts and timeouts are carried out here; a block is the caller's
// to refuse.
func (s *Server) checkMessageRules(r *http.Request, ch *store.Channel, me *store.User, mentions int) automodVerdict {
	ctx := r.Context()
	if ch.ServerID == nil {
		return automodVerdict{}
	}
	rules, err := s.Store.AutomodRules(ctx, *ch.ServerID)
	if err != nil || len(rules) == 0 {
		return automodVerdict{}
	}
	srv, err := s.Store.ServerByID(ctx, *ch.ServerID)
	if err != nil {
		return automodVerdict{}
	}
	var v automodVerdict
	for _, rule := range rules {
		if !rule.Enabled || (rule.Kind != ruleMentions && rule.Kind != ruleFlood) {
			continue
		}
		cfg := ruleConfigOf(rule.Config)
		caught := false
		detail := map[string]any{}
		switch rule.Kind {
		case ruleMentions:
			caught = cfg.Max > 0 && mentions > cfg.Max
			detail["mentions"] = mentions
			// a raid pings a few at a time: count everyone pinged in five minutes
			if !caught && cfg.Raid && mentions > 0 {
				since := time.Now().Add(-5 * time.Minute).UnixMilli()
				if n, err := s.Store.RecentMentionCount(ctx, srv.ID, me.ID, since); err == nil && n+mentions > raidMentions(cfg.Max) {
					caught = true
					detail["mentions"], detail["raid"] = n+mentions, true
				}
			}
		case ruleFlood:
			if cfg.Messages > 1 && cfg.Seconds > 0 {
				since := time.Now().Add(-time.Duration(cfg.Seconds) * time.Second).UnixMilli()
				n, err := s.Store.RecentMessageCount(ctx, srv.ID, me.ID, since, cfg.Messages)
				caught = err == nil && n >= cfg.Messages
				detail["messages"], detail["seconds"] = cfg.Messages, cfg.Seconds
			}
		}
		if !caught || s.exempt(ctx, srv, rule, me.ID, ch) {
			continue
		}
		done := s.carryOut(r, srv, rule, me.ID, ch, nil, detail, nil, nil)
		if v.blocked == nil && hasAction(done, actBlock) {
			v.blocked = rule
			for _, a := range ruleActions(rule.Actions) {
				if a.Type == actBlock {
					v.message = a.Message
				}
			}
		}
	}
	return v
}

// actionList reads the actions an event recorded.
func actionList(raw json.RawMessage) []string {
	var list []string
	_ = json.Unmarshal(raw, &list)
	return list
}

func hasAction(list []string, t string) bool {
	for _, x := range list {
		if x == t {
			return true
		}
	}
	return false
}

// carryOut does what a rule says to someone it caught, and writes it down:
// the AutoMod log, the audit log, and an alert where the rule sends them.
// content is what was caught, sealed with the server's key, when an app sent
// it. It returns the actions taken.
func (s *Server) carryOut(r *http.Request, srv *store.Server, rule *store.AutomodRule, uid ids.ID, ch *store.Channel, reporter *ids.ID, detail map[string]any, content json.RawMessage, message *ids.ID) []string {
	ctx := r.Context()
	var done []string
	var alertTo *store.Channel
	for _, a := range ruleActions(rule.Actions) {
		switch a.Type {
		case actBlock:
			done = append(done, actBlock)
		case actTimeout:
			// a timeout that waits for repeat catches counts this one in
			if a.After > 1 {
				since := time.Now().Add(-24 * time.Hour).UnixMilli()
				if n, err := s.Store.CountAutomodCatches(ctx, srv.ID, uid, rule.ID, since); err != nil || n+1 < a.After {
					continue
				}
			}
			if s.automodTimeout(r, srv, uid, a.Seconds, rule) {
				done = append(done, actTimeout)
			}
		case actQuarantine:
			if s.setQuarantine(r, srv, uid, true, nil, rule.Name) {
				done = append(done, actQuarantine)
			}
		case actAlert:
			if a.ChannelID != nil {
				if c, err := s.Store.ChannelByID(ctx, *a.ChannelID); err == nil && c.ServerID != nil && *c.ServerID == srv.ID {
					alertTo = c
					done = append(done, actAlert)
				}
			}
		}
	}
	ruleID := rule.ID
	ev := &store.AutomodEvent{ServerID: srv.ID, RuleID: &ruleID, RuleName: rule.Name, RuleKind: rule.Kind, UserID: uid, ReporterID: reporter, Content: content, MessageID: message}
	if ch != nil {
		id := ch.ID
		ev.ChannelID = &id
	}
	ev.Actions = mustJSON(done)
	if err := s.Store.AddAutomodEvent(ctx, ev); err != nil {
		s.Log.Warn("automod event", "err", err)
	}
	changes := map[string]any{"rule": rule.Name, "kind": rule.Kind, "actions": done}
	if ch != nil {
		changes["channel_id"] = ch.ID
	}
	for k, v := range detail {
		changes[k] = v
	}
	target := uid
	s.auditAs(ctx, srv.ID, automodActor, "automod_action", "user", &target, changes, "")
	s.emitServerWithPerm(ctx, srv.ID, perms.ViewAuditLog, "automod_event", ev)
	if alertTo != nil {
		s.automodAlert(r, alertTo, uid, ev, detail)
	}
	return done
}

// automodActor stands for AutoMod in the audit log, where an action needs
// someone who did it.
const automodActor ids.ID = 0

// automodTimeout times someone out for a rule, unless they are already out
// for longer, and tells the server.
func (s *Server) automodTimeout(r *http.Request, srv *store.Server, uid ids.ID, seconds int, rule *store.AutomodRule) bool {
	ctx := r.Context()
	if uid == srv.OwnerID {
		return false
	}
	m, err := s.Store.Member(ctx, srv.ID, uid)
	if err != nil {
		return false
	}
	until := time.Now().Add(time.Duration(seconds) * time.Second).UnixMilli()
	if m.TimeoutUntil != nil && *m.TimeoutUntil >= until {
		return true
	}
	before, err := s.snapshotVisibility(ctx, srv.ID)
	if err != nil {
		return false
	}
	up := &until
	if err := s.Store.UpdateMember(ctx, srv.ID, uid, store.MemberPatch{TimeoutUntil: &up}); err != nil {
		return false
	}
	s.dropVoice(ctx, uid, func(ch *store.Channel) bool { return ch.ServerID != nil && *ch.ServerID == srv.ID })
	if updated, err := s.Store.Member(ctx, srv.ID, uid); err == nil {
		s.emitServer(ctx, srv.ID, "member_update", updated)
	}
	s.syncVisibility(ctx, srv.ID, before)
	return true
}

// setQuarantine holds someone (or lets them go) for what their name or
// profile says; by is the moderator who did it, nil for AutoMod.
func (s *Server) setQuarantine(r *http.Request, srv *store.Server, uid ids.ID, on bool, by *ids.ID, rule string) bool {
	ctx := r.Context()
	if uid == srv.OwnerID {
		return false
	}
	m, err := s.Store.Member(ctx, srv.ID, uid)
	if err != nil {
		return false
	}
	flags := m.Flags &^ store.MemberQuarantined
	if on {
		flags |= store.MemberQuarantined
	}
	if flags == m.Flags {
		return true
	}
	before, err := s.snapshotVisibility(ctx, srv.ID)
	if err != nil {
		return false
	}
	// only this bit: the member's other flags (a moderator's server mute) may change meanwhile
	set, clear := int64(0), store.MemberQuarantined
	if on {
		set, clear = store.MemberQuarantined, 0
	}
	if err := s.Store.SetMemberFlags(ctx, srv.ID, uid, set, clear); err != nil {
		return false
	}
	if on {
		s.dropVoice(ctx, uid, func(ch *store.Channel) bool { return ch.ServerID != nil && *ch.ServerID == srv.ID })
	}
	if updated, err := s.Store.Member(ctx, srv.ID, uid); err == nil {
		s.emitServer(ctx, srv.ID, "member_update", updated)
	}
	s.syncVisibility(ctx, srv.ID, before)
	if !on {
		actor := automodActor
		if by != nil {
			actor = *by
		}
		target := uid
		s.auditAs(ctx, srv.ID, actor, "member_quarantine_lift", "user", &target, map[string]any{"rule": rule}, "")
	}
	return true
}

// automodAlert posts AutoMod's note about what it caught into the channel a
// rule sends alerts to. What was caught travels sealed, as the app sent it.
func (s *Server) automodAlert(r *http.Request, ch *store.Channel, uid ids.ID, ev *store.AutomodEvent, detail map[string]any) {
	info := map[string]any{"event_id": ev.ID, "rule_id": ev.RuleID, "rule_name": ev.RuleName, "rule_kind": ev.RuleKind, "channel_id": ev.ChannelID, "actions": ev.Actions}
	// a message that was let through can be jumped to from the alert
	if ev.MessageID != nil && !hasAction(actionList(ev.Actions), actBlock) {
		info["message_id"] = ev.MessageID
	}
	if len(ev.Content) > 0 && string(ev.Content) != "null" {
		info["content"] = ev.Content
	}
	for k, v := range detail {
		info[k] = v
	}
	m := &store.Message{ChannelID: ch.ID, AuthorID: uid, Type: "system_automod", Mentions: []ids.ID{}, Automod: mustJSON(info)}
	if err := s.Store.InsertMessage(r.Context(), m); err != nil {
		s.Log.Warn("automod alert", "err", err)
		return
	}
	m.MentionRoles, m.Attachments, m.Reactions = []ids.ID{}, []store.Attachment{}, []store.ReactionSummary{}
	s.Bcast.EmitChannel(ch.ID, "message_create", m)
}

// handleAutomodReport takes what a member's app caught: its own message,
// stopped before it was sent, or (from a moderator's app) someone else's
// that slipped past, which this then clears away.
func (s *Server) handleAutomodReport(w http.ResponseWriter, r *http.Request) {
	srv, me, myPerms := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	if ok, retry := s.limAutomod.Allow("automod:" + me.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	var req struct {
		RuleID    ids.ID          `json:"rule_id"`
		ChannelID ids.ID          `json:"channel_id"`
		MessageID *ids.ID         `json:"message_id"`
		Content   json.RawMessage `json:"content"`
	}
	if err := ReadJSON(w, r, &req, maxEnvelopeBytes+8<<10); err != nil {
		WriteError(w, err)
		return
	}
	rule, err := s.Store.AutomodRule(r.Context(), req.RuleID)
	if err != nil || rule.ServerID != srv.ID || !rule.Enabled || !OneOf(rule.Kind, clientKinds...) {
		WriteError(w, E(http.StatusNotFound, "unknown_rule", "That rule is not in force here."))
		return
	}
	ch, err := s.Store.ChannelByID(r.Context(), req.ChannelID)
	if err != nil || ch.ServerID == nil || *ch.ServerID != srv.ID {
		WriteError(w, ErrNotFound)
		return
	}
	// what was caught is sealed with the server's own key, which this server
	// cannot open: only its shape is checked
	var content json.RawMessage
	if len(req.Content) > 0 && string(req.Content) != "null" {
		env, ok := validEnvelope(req.Content)
		if !ok || env.Conv != srv.ID {
			WriteError(w, E(http.StatusBadRequest, "bad_envelope", "What was caught has to be sealed for the server."))
			return
		}
		content = req.Content
	}
	offender := me.ID
	var reporter *ids.ID
	blocks := false
	for _, a := range ruleActions(rule.Actions) {
		blocks = blocks || a.Type == actBlock
	}
	if req.MessageID != nil {
		// a message already sent: the sender's own, caught by a rule that lets
		// it through, or someone else's that a moderator's app caught, which
		// has to be theirs to delete when the rule stops such messages
		m, err := s.Store.MessageByID(r.Context(), *req.MessageID, me.ID)
		if err != nil || m.ChannelID != ch.ID {
			WriteError(w, ErrNotFound)
			return
		}
		offender = m.AuthorID
		if offender != me.ID {
			cp, err := s.Store.PermsIn(r.Context(), ch, me.ID)
			if err != nil || !cp.Has(perms.ManageMessages) {
				WriteError(w, E(http.StatusForbidden, "missing_permission", "Only moderators' apps report what AutoMod catches in other people's messages."))
				return
			}
			mine := me.ID
			reporter = &mine
			if !s.canActOn(r.Context(), srv, me.ID, offender) {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		// each rule acts on a message once, however many apps saw it
		if s.exempt(r.Context(), srv, rule, offender, ch) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if seen, err := s.Store.AutomodCaught(r.Context(), rule.ID, m.ID); err != nil || seen {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if blocks {
			if err := s.Store.DeleteMessage(r.Context(), m.ID); err == nil {
				ev := map[string]any{"id": m.ID, "channel_id": ch.ID, "author_id": m.AuthorID, "mentions": m.Mentions, "mention_roles": m.MentionRoles, "mention_everyone": m.MentionEveryone}
				s.withLastMessage(r.Context(), ev, ch.ID)
				s.Bcast.EmitChannel(ch.ID, "message_delete", ev)
			}
		}
	} else if s.exempt(r.Context(), srv, rule, me.ID, ch) {
		// the app should not have stopped it: nothing to do
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// a moderator's app may only do what its moderator could
	if reporter != nil && !myPerms.Has(perms.ModerateMembers) {
		trimmed := []ruleAction{}
		for _, a := range ruleActions(rule.Actions) {
			if a.Type != actTimeout {
				trimmed = append(trimmed, a)
			}
		}
		copied := *rule
		copied.Actions = mustJSON(trimmed)
		rule = &copied
	}
	done := s.carryOut(r, srv, rule, offender, ch, reporter, nil, content, req.MessageID)
	WriteJSON(w, http.StatusOK, map[string]any{"actions": done})
}

// handleAutomodEvents pages through the AutoMod log.
func (s *Server) handleAutomodEvents(w http.ResponseWriter, r *http.Request) {
	srv, _, p := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	if !p.Has(perms.ViewAuditLog) && !p.Has(perms.ManageServer) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You need View Audit Log to read what AutoMod did."))
		return
	}
	q := r.URL.Query()
	before, _ := ids.Parse(q.Get("before"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	var user *ids.ID
	if u, err := ids.Parse(q.Get("user_id")); err == nil {
		user = &u
	}
	list, err := s.Store.AutomodEvents(r.Context(), srv.ID, user, before, limit)
	if err != nil {
		WriteError(w, err)
		return
	}
	who := []ids.ID{}
	for _, e := range list {
		who = append(who, e.UserID)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"events": list, "users": s.publicUsers(r.Context(), who)})
}

// checkProfileRules reads someone's names and profile in a server against its
// name rules, quarantining them when one catches it and letting them go when
// none does any more (if AutoMod was what held them).
func (s *Server) checkProfileRules(r *http.Request, srv *store.Server, uid ids.ID) {
	ctx := r.Context()
	rules, err := s.Store.AutomodRules(ctx, srv.ID)
	if err != nil {
		return
	}
	u, err := s.Store.UserByID(ctx, uid)
	if err != nil {
		return
	}
	m, err := s.Store.Member(ctx, srv.ID, uid)
	if err != nil {
		return
	}
	caughtAny := false
	for _, rule := range rules {
		if !rule.Enabled || rule.Kind != ruleProfile || s.exempt(ctx, srv, rule, uid, nil) {
			continue
		}
		cfg := ruleConfigOf(rule.Config)
		var texts []string
		if cfg.Names {
			// the name shown in the server: the nickname, else the account's own
			texts = append(texts, u.Username)
			if m.Nickname != "" {
				texts = append(texts, m.Nickname)
			} else {
				texts = append(texts, u.DisplayName)
			}
		}
		if cfg.Bio {
			if m.Bio != "" {
				texts = append(texts, m.Bio)
			} else {
				texts = append(texts, u.AboutMe)
			}
			texts = append(texts, u.Pronouns, m.Pronouns)
		}
		found := ""
		matcher := cfg.matcher()
		for _, t := range texts {
			if hit, ok := matcher.Match(t); ok {
				found = hit
				break
			}
		}
		if found == "" {
			continue
		}
		caughtAny = true
		if m.Flags&store.MemberQuarantined == 0 {
			s.carryOut(r, srv, rule, uid, nil, nil, map[string]any{"matched": found}, nil, nil)
		}
	}
	// AutoMod lets go of someone whose profile no longer trips any rule
	if !caughtAny && m.Flags&store.MemberQuarantined != 0 {
		s.setQuarantine(r, srv, uid, false, nil, "")
	}
}

// publicUsers is the people a list names, as anyone may see them.
func (s *Server) publicUsers(ctx context.Context, list []ids.ID) []store.PublicUser {
	byID, err := s.Store.UsersByIDs(ctx, dedupeIDs(list, len(list)+1))
	out := []store.PublicUser{}
	if err != nil {
		return out
	}
	for _, id := range dedupeIDs(list, len(list)+1) {
		if u := byID[id]; u != nil {
			out = append(out, u.Public())
		}
	}
	return out
}

// raidMentions is how many people one member may ping in five minutes under
// a mention rule with raid protection: three messages' worth.
func raidMentions(max int) int { return max * 3 }

// checkTitle reads a thread's or a forum post's title against the server's
// word rules, which the server can read for itself there. A rule that blocks
// stops the title, with what it says; alerts and timeouts happen either way.
func (s *Server) checkTitle(r *http.Request, parent *store.Channel, me *store.User, title string) *Error {
	ctx := r.Context()
	if parent.ServerID == nil {
		return nil
	}
	rules, err := s.Store.AutomodRules(ctx, *parent.ServerID)
	if err != nil || len(rules) == 0 {
		return nil
	}
	srv, err := s.Store.ServerByID(ctx, *parent.ServerID)
	if err != nil {
		return nil
	}
	for _, rule := range rules {
		if !rule.Enabled || (rule.Kind != ruleWords && rule.Kind != ruleFlagged) {
			continue
		}
		hit, ok := ruleConfigOf(rule.Config).matcher().Match(title)
		if !ok || s.exempt(ctx, srv, rule, me.ID, parent) {
			continue
		}
		done := s.carryOut(r, srv, rule, me.ID, parent, nil, map[string]any{"matched": hit, "title": true}, nil, nil)
		if hasAction(done, actBlock) {
			msg := "This server's AutoMod does not allow that title."
			for _, a := range ruleActions(rule.Actions) {
				if a.Type == actBlock && a.Message != "" {
					msg = a.Message
				}
			}
			return E(http.StatusForbidden, "automod_blocked", msg)
		}
	}
	return nil
}
