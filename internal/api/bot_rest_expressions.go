package api

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

// The bot API's routes for a server's emoji, stickers and AutoMod rules.
// Emoji are known by their picture's id, as message text writes them. A
// server's stickers are those of its own sticker packs; a bot adds to the
// first of them, which it makes when there is none.

func (s *Server) botExpressionRoutes(mux *http.ServeMux) {
	g := "/guilds/{guild}"
	s.botHandle(mux, "GET", g+"/emojis", authBot, s.botEmojis, bucketed("read"))
	s.botHandle(mux, "GET", g+"/emojis/{emoji}", authBot, s.botEmojiGet, bucketed("read"))
	s.botHandle(mux, "POST", g+"/emojis", authBot, s.botEmojiCreate, bucketed("emoji"))
	s.botHandle(mux, "PATCH", g+"/emojis/{emoji}", authBot, s.botEmojiPatch, bucketed("emoji"))
	s.botHandle(mux, "DELETE", g+"/emojis/{emoji}", authBot, s.botEmojiDelete, bucketed("emoji"))
	s.botHandle(mux, "GET", g+"/stickers", authBot, s.botGuildStickers, bucketed("read"))
	s.botHandle(mux, "GET", g+"/stickers/{sticker}", authBot, s.botGuildStickerGet, bucketed("read"))
	s.botHandle(mux, "POST", g+"/stickers", authBot, s.botGuildStickerCreate, bucketed("emoji"))
	s.botHandle(mux, "PATCH", g+"/stickers/{sticker}", authBot, s.botGuildStickerPatch, bucketed("emoji"))
	s.botHandle(mux, "DELETE", g+"/stickers/{sticker}", authBot, s.botGuildStickerDelete, bucketed("emoji"))
	s.botHandle(mux, "GET", g+"/auto-moderation/rules", authBot, s.botAutomodRules, bucketed("read"))
	s.botHandle(mux, "GET", g+"/auto-moderation/rules/{rule}", authBot, s.botAutomodRuleGet, bucketed("read"))
	s.botHandle(mux, "POST", g+"/auto-moderation/rules", authBot, s.botAutomodRuleSave, bucketed("guild"))
	s.botHandle(mux, "PATCH", g+"/auto-moderation/rules/{rule}", authBot, s.botAutomodRuleSave, bucketed("guild"))
	s.botHandle(mux, "DELETE", g+"/auto-moderation/rules/{rule}", authBot, s.botAutomodRuleDelete, bucketed("guild"))
}

// --- emoji ------------------------------------------------------------------------------------------

func (s *Server) botEmojis(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	list, err := s.Store.ServerEmojis(r.Context(), srv.ID)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	b := s.builderFor(r, botOf(r))
	withUser := s.botHas(r, srv, perms.ManageEmojis|perms.CreateExpressions)
	out := make([]dEmoji, 0, len(list))
	for _, e := range list {
		out = append(out, b.emojiObj(e, withUser))
	}
	WriteJSON(w, http.StatusOK, out)
}

// botHas reports whether the bot holds any of the given permissions in a
// server.
func (s *Server) botHas(r *http.Request, srv *store.Server, any perms.Perm) bool {
	p, err := s.Store.ServerPerms(r.Context(), srv.ID, botOf(r).user.ID)
	return err == nil && p&any != 0
}

// botEmoji loads the {emoji} of a route, by its picture's id.
func (s *Server) botEmoji(w http.ResponseWriter, r *http.Request, srv *store.Server) *store.Emoji {
	id, ok := pathID(r, "emoji")
	if !ok {
		writeBotError(w, dErrUnknownEmoji, nil)
		return nil
	}
	list, err := s.Store.ServerEmojis(r.Context(), srv.ID)
	if err != nil {
		writeBotError(w, err, nil)
		return nil
	}
	for _, e := range list {
		if e.BlobID == id || e.ID == id {
			return e
		}
	}
	writeBotError(w, dErrUnknownEmoji, nil)
	return nil
}

func (s *Server) botEmojiGet(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	if e := s.botEmoji(w, r, srv); e != nil {
		WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).emojiObj(e, s.botHas(r, srv, perms.ManageEmojis|perms.CreateExpressions)))
	}
}

func (s *Server) botEmojiCreate(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	var body struct {
		Name  string `json:"name"`
		Image string `json:"image"`
	}
	if err := ReadJSON(w, r, &body, s.Cfg.MaxEmojiBytes*2+16<<10); err != nil {
		writeBotError(w, dErrBadJSON, nil)
		return
	}
	if _, ok := emojiName(body.Name); !ok {
		writeBotError(w, dFormError("BASE_TYPE_BAD_LENGTH", "Must be between 2 and 32 in length.", "name"), nil)
		return
	}
	img, err := imageData(body.Image)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	ans := s.nexaGuild(r, s.handleEmojiCreate, http.MethodPost, srv, nil, url.Values{"name": {body.Name}}, img)
	if !ans.ok() {
		e := ans.err()
		if ae, ok := e.(*Error); ok && ae.Code == "name_taken" {
			writeBotError(w, dFormError("EMOJI_NAME_ALREADY_TAKEN", "Emoji name already taken", "name"), nil)
			return
		}
		writeBotError(w, e, dErrUnknownGuild)
		return
	}
	var e store.Emoji
	if err := ans.decode(&e); err != nil {
		writeBotError(w, err, nil)
		return
	}
	WriteJSON(w, http.StatusCreated, s.builderFor(r, botOf(r)).emojiObj(&e, true))
}

func (s *Server) botEmojiPatch(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	e := s.botEmoji(w, r, srv)
	if e == nil {
		return
	}
	raw, derr := readBotObject(w, r, 8<<10)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	if v, ok := (jsonReader{&formErrors{}}).str(raw, "name", nil); ok {
		ans := s.nexaGuild(r, s.handleEmojiPatch, http.MethodPatch, srv, map[string]string{"eid": e.ID.String()}, nil, map[string]any{"name": v})
		if !ans.ok() {
			writeBotError(w, ans.err(), dErrUnknownEmoji)
			return
		}
		if fresh, err := s.Store.EmojiByID(r.Context(), e.ID); err == nil {
			e = fresh
		}
	}
	WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).emojiObj(e, true))
}

func (s *Server) botEmojiDelete(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	e := s.botEmoji(w, r, srv)
	if e == nil {
		return
	}
	if ans := s.nexaGuild(r, s.handleEmojiDelete, http.MethodDelete, srv, map[string]string{"eid": e.ID.String()}, nil, nil); !ans.ok() {
		writeBotError(w, ans.err(), dErrUnknownEmoji)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- stickers ---------------------------------------------------------------------------------------

func (s *Server) botGuildStickers(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).guildStickers(srv.ID))
}

// botGuildSticker loads the {sticker} of a route, one of the server's own.
func (s *Server) botGuildSticker(w http.ResponseWriter, r *http.Request, srv *store.Server) (*store.Sticker, *store.StickerPack) {
	id, ok := pathID(r, "sticker")
	if !ok {
		writeBotError(w, dErrUnknownSticker, nil)
		return nil, nil
	}
	st, err := s.Store.StickerByID(r.Context(), id)
	if err != nil {
		writeBotError(w, dErrUnknownSticker, nil)
		return nil, nil
	}
	pack, err := s.Store.PackByID(r.Context(), st.PackID)
	if err != nil || pack.ServerID == nil || *pack.ServerID != srv.ID || pack.Kind == "emoji" {
		writeBotError(w, dErrUnknownSticker, nil)
		return nil, nil
	}
	return st, pack
}

func (s *Server) botGuildStickerGet(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	if st, pack := s.botGuildSticker(w, r, srv); st != nil {
		WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).stickerObj(st, pack))
	}
}

// serverStickerPack is the pack a server's new stickers go in: its first
// sticker pack, made when it has none.
func (s *Server) serverStickerPack(r *http.Request, srv *store.Server) (*store.StickerPack, error) {
	packs, err := s.Store.ServerPacks(r.Context(), srv.ID)
	if err != nil {
		return nil, err
	}
	for _, p := range packs {
		if p.Kind != "emoji" {
			return p, nil
		}
	}
	name := srv.Name
	if len([]rune(name)) > 60 {
		name = string([]rune(name)[:60])
	}
	ans := s.callNexa(r, s.handlePackCreate, http.MethodPost, nil, nil, map[string]any{"name": name, "server_id": srv.ID, "kind": "sticker"})
	if !ans.ok() {
		return nil, ans.err()
	}
	var p store.StickerPack
	if err := ans.decode(&p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Server) botGuildStickerCreate(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	if !s.botHas(r, srv, perms.ManageEmojis|perms.CreateExpressions) {
		writeBotError(w, dErrMissingPerms, nil)
		return
	}
	ct, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if ct != "multipart/form-data" || params["boundary"] == "" {
		writeBotError(w, dFormError("BASE_TYPE_REQUIRED", "This field is required", "file"), nil)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.Cfg.MaxStickerBytes+64<<10)
	mr, err := r.MultipartReader()
	if err != nil {
		writeBotError(w, dErrBadJSON, nil)
		return
	}
	fields := map[string]string{}
	var file []byte
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeBotError(w, dErrBadJSON, nil)
			return
		}
		if part.FormName() == "file" {
			if file, err = io.ReadAll(io.LimitReader(part, s.Cfg.MaxStickerBytes+1)); err != nil {
				writeBotError(w, dErrBadJSON, nil)
				return
			}
			continue
		}
		v, _ := io.ReadAll(io.LimitReader(part, 4<<10))
		fields[part.FormName()] = string(v)
	}
	if file == nil {
		writeBotError(w, dFormError("BASE_TYPE_REQUIRED", "This field is required", "file"), nil)
		return
	}
	if int64(len(file)) > s.Cfg.MaxStickerBytes {
		writeBotError(w, dErrFileTooLarge, nil)
		return
	}
	name := strings.TrimSpace(fields["name"])
	if n := len([]rune(name)); n < 2 || n > 30 {
		writeBotError(w, dFormError("BASE_TYPE_BAD_LENGTH", "Must be between 2 and 30 in length.", "name"), nil)
		return
	}
	pack, err := s.serverStickerPack(r, srv)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	q := url.Values{"name": {name}, "tags": {fields["tags"]}}
	ans := s.callNexa(r, s.handleStickerCreate, http.MethodPost, map[string]string{"id": pack.ID.String()}, q, &rawBody{data: file, contentType: "application/octet-stream"})
	if !ans.ok() {
		writeBotError(w, ans.err(), dErrUnknownSticker)
		return
	}
	var st store.Sticker
	if err := ans.decode(&st); err != nil || st.ID.IsZero() {
		var wrapped struct {
			Sticker store.Sticker `json:"sticker"`
		}
		_ = json.Unmarshal(ans.body, &wrapped)
		st = wrapped.Sticker
	}
	fresh, err := s.Store.StickerByID(r.Context(), st.ID)
	if err != nil {
		writeBotError(w, err, dErrUnknownSticker)
		return
	}
	WriteJSON(w, http.StatusCreated, s.builderFor(r, botOf(r)).stickerObj(fresh, pack))
}

func (s *Server) botGuildStickerPatch(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	st, pack := s.botGuildSticker(w, r, srv)
	if st == nil {
		return
	}
	raw, derr := readBotObject(w, r, 8<<10)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	rd := jsonReader{&formErrors{}}
	body := map[string]any{}
	if v, ok := rd.str(raw, "name", nil); ok {
		body["name"] = v
	}
	if v, ok := rd.str(raw, "tags", nil); ok {
		body["tags"] = v
	}
	if len(body) > 0 {
		ans := s.callNexa(r, s.handleStickerPatch, http.MethodPatch, map[string]string{"id": pack.ID.String(), "sid": st.ID.String()}, nil, body)
		if !ans.ok() {
			writeBotError(w, ans.err(), dErrUnknownSticker)
			return
		}
	}
	fresh, err := s.Store.StickerByID(r.Context(), st.ID)
	if err != nil {
		writeBotError(w, err, dErrUnknownSticker)
		return
	}
	WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).stickerObj(fresh, pack))
}

func (s *Server) botGuildStickerDelete(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, 0)
	if srv == nil {
		return
	}
	st, pack := s.botGuildSticker(w, r, srv)
	if st == nil {
		return
	}
	if ans := s.callNexa(r, s.handleStickerDelete, http.MethodDelete, map[string]string{"id": pack.ID.String(), "sid": st.ID.String()}, nil, nil); !ans.ok() {
		writeBotError(w, ans.err(), dErrUnknownSticker)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- AutoMod ----------------------------------------------------------------------------------------

func (s *Server) botAutomodRules(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	list, err := s.Store.AutomodRules(r.Context(), srv.ID)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	b := s.builderFor(r, botOf(r))
	out := []dAMRule{}
	for _, rule := range list {
		if obj, ok := b.automodRuleObj(rule); ok {
			out = append(out, obj)
		}
	}
	WriteJSON(w, http.StatusOK, out)
}

func (s *Server) botAutomodRule(w http.ResponseWriter, r *http.Request, srv *store.Server) *store.AutomodRule {
	id, ok := pathID(r, "rule")
	if !ok {
		writeBotError(w, dErrUnknownAutomod, nil)
		return nil
	}
	rule, err := s.Store.AutomodRule(r.Context(), id)
	if err != nil || rule.ServerID != srv.ID {
		writeBotError(w, dErrUnknownAutomod, nil)
		return nil
	}
	return rule
}

func (s *Server) botAutomodRuleGet(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	rule := s.botAutomodRule(w, r, srv)
	if rule == nil {
		return
	}
	obj, ok := s.builderFor(r, botOf(r)).automodRuleObj(rule)
	if !ok {
		writeBotError(w, dErrUnknownAutomod, nil)
		return
	}
	WriteJSON(w, http.StatusOK, obj)
}

// automodBody turns the protocol's rule into the app's: what it looks for
// (its trigger), what it does (its actions) and who it leaves alone.
func automodBody(rd jsonReader, raw map[string]any, existing *store.AutomodRule) (map[string]any, error) {
	body := map[string]any{}
	if v, ok := rd.str(raw, "name", nil); ok {
		body["name"] = v
	}
	if v, ok := rd.boolean(raw, "enabled", nil); ok {
		body["enabled"] = v
	}
	kind := ""
	if existing != nil {
		kind = existing.Kind
	}
	if t, ok := rd.integer(raw, "trigger_type", nil); ok {
		switch t {
		case amTriggerKeyword:
			kind = ruleWords
		case amTriggerSpam:
			kind = ruleSpam
		case amTriggerKeywordPreset:
			kind = ruleFlagged
		case amTriggerMentionSpam:
			kind = ruleMentions
		case amTriggerMemberProfile:
			kind = ruleProfile
		default:
			return nil, dFormError("AUTO_MODERATION_TRIGGER_TYPE_INVALID", "Invalid trigger type", "trigger_type")
		}
		if existing == nil {
			body["kind"] = kind
		}
	} else if existing == nil {
		return nil, dFormError("BASE_TYPE_REQUIRED", "This field is required", "trigger_type")
	}
	meta, hasMeta := rd.object(raw, "trigger_metadata", nil)
	if hasMeta || existing == nil {
		cfg := ruleConfig{}
		if existing != nil {
			_ = json.Unmarshal(existing.Config, &cfg)
		}
		strs := func(key string) ([]string, bool) {
			list, ok := rd.list(meta, key, fieldPath("trigger_metadata"))
			if !ok {
				return nil, false
			}
			out := []string{}
			for _, v := range list {
				if sv, ok := v.(string); ok {
					out = append(out, sv)
				}
			}
			return out, true
		}
		switch kind {
		case ruleWords, ruleProfile:
			if v, ok := strs("keyword_filter"); ok {
				cfg.Words = v
			}
			if v, ok := strs("regex_patterns"); ok {
				cfg.Regex = v
			}
			if v, ok := strs("allow_list"); ok {
				cfg.Allow = v
			}
			if kind == ruleProfile {
				cfg.Names, cfg.Bio = true, true
			}
		case ruleFlagged:
			if list, ok := rd.list(meta, "presets", fieldPath("trigger_metadata")); ok {
				cfg.Lists = []string{}
				for _, v := range list {
					n, _ := rd.integer(map[string]any{"v": v}, "v", nil)
					for name, num := range amPresets {
						if int64(num) == n {
							cfg.Lists = append(cfg.Lists, name)
						}
					}
				}
			}
			if v, ok := strs("allow_list"); ok {
				cfg.Allow = v
			}
		case ruleMentions:
			if v, ok := rd.integer(meta, "mention_total_limit", fieldPath("trigger_metadata")); ok {
				cfg.Max = int(v)
			}
			if v, ok := rd.boolean(meta, "mention_raid_protection_enabled", fieldPath("trigger_metadata")); ok {
				cfg.Raid = v
			}
		case ruleSpam:
			if existing == nil {
				cfg.Scams, cfg.Repeats, cfg.Shady = true, true, true
			}
		}
		raw, _ := json.Marshal(cfg)
		body["config"] = json.RawMessage(raw)
	}
	if list, ok := rd.list(raw, "actions", nil); ok {
		acts := []ruleAction{}
		for i, v := range list {
			obj, ok := v.(map[string]any)
			if !ok {
				continue
			}
			p := fieldPath("actions", i)
			t, _ := rd.integer(obj, "type", p)
			md, _ := rd.object(obj, "metadata", p)
			switch t {
			case amActionBlock:
				a := ruleAction{Type: actBlock}
				if md != nil {
					a.Message, _ = rd.str(md, "custom_message", fieldPath(p, "metadata"))
				}
				acts = append(acts, a)
			case amActionAlert:
				a := ruleAction{Type: actAlert}
				if md != nil {
					if sv, ok := rd.str(md, "channel_id", fieldPath(p, "metadata")); ok {
						if id, err := parseBotID(sv); err == nil {
							a.ChannelID = &id
						}
					}
				}
				acts = append(acts, a)
			case amActionTimeout:
				a := ruleAction{Type: actTimeout}
				if md != nil {
					if n, ok := rd.integer(md, "duration_seconds", fieldPath(p, "metadata")); ok {
						a.Seconds = int(n)
					}
				}
				acts = append(acts, a)
			case amActionBlockMember:
				acts = append(acts, ruleAction{Type: actQuarantine})
			default:
				return nil, dFormError("AUTO_MODERATION_ACTION_TYPE_INVALID", "Invalid action type", "actions", "0", "type")
			}
		}
		raw, _ := json.Marshal(acts)
		body["actions"] = json.RawMessage(raw)
	}
	for key, dst := range map[string]string{"exempt_roles": "exempt_roles", "exempt_channels": "exempt_channels"} {
		if list, ok := rd.list(raw, key, nil); ok {
			body[dst] = snowList(list)
		}
	}
	if !rd.errs.empty() {
		return nil, rd.errs.err()
	}
	return body, nil
}

// botAutomodRuleSave makes a rule (POST) or changes one (PATCH).
func (s *Server) botAutomodRuleSave(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	var existing *store.AutomodRule
	if r.PathValue("rule") != "" {
		if existing = s.botAutomodRule(w, r, srv); existing == nil {
			return
		}
	}
	raw, derr := readBotObject(w, r, 128<<10)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	body, err := automodBody(jsonReader{&formErrors{}}, raw, existing)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	var ans *nexaAnswer
	if existing == nil {
		ans = s.nexaGuild(r, s.handleAutomodRuleSave, http.MethodPost, srv, nil, nil, body)
	} else {
		ans = s.nexaGuild(r, s.handleAutomodRuleSave, http.MethodPatch, srv, map[string]string{"rid": existing.ID.String()}, nil, body)
	}
	if !ans.ok() {
		e := ans.err()
		if ae, ok := e.(*Error); ok && ae.Status == http.StatusBadRequest {
			writeBotError(w, dFormError(strings.ToUpper(ae.Code), ae.Message), nil)
			return
		}
		writeBotError(w, e, dErrUnknownAutomod)
		return
	}
	var saved store.AutomodRule
	if err := ans.decode(&saved); err != nil {
		writeBotError(w, err, nil)
		return
	}
	rule, err := s.Store.AutomodRule(r.Context(), saved.ID)
	if err != nil {
		writeBotError(w, err, dErrUnknownAutomod)
		return
	}
	obj, ok := s.builderFor(r, botOf(r)).automodRuleObj(rule)
	if !ok {
		writeBotError(w, dErrUnknownAutomod, nil)
		return
	}
	WriteJSON(w, http.StatusOK, obj)
}

func (s *Server) botAutomodRuleDelete(w http.ResponseWriter, r *http.Request) {
	srv := s.botGuild(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	rule := s.botAutomodRule(w, r, srv)
	if rule == nil {
		return
	}
	if ans := s.nexaGuild(r, s.handleAutomodRuleDelete, http.MethodDelete, srv, map[string]string{"rid": rule.ID.String()}, nil, nil); !ans.ok() {
		writeBotError(w, ans.err(), dErrUnknownAutomod)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
