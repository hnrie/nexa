package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const (
	maxEnvelopeBytes = 64 << 10
	maxMentions      = 50
	maxAttachments   = 10
	maxNonce         = 64
	maxEmojiLen      = 64
)

func (s *Server) messageRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/channels/{id}/messages", s.authed(s.handleMessages))
	mux.Handle("POST /api/v1/channels/{id}/messages", s.authed(s.handleMessageCreate))
	mux.Handle("GET /api/v1/channels/{id}/messages/{mid}", s.authed(s.handleMessageGet))
	mux.Handle("PATCH /api/v1/channels/{id}/messages/{mid}", s.authed(s.handleMessageEdit))
	mux.Handle("DELETE /api/v1/channels/{id}/messages/{mid}", s.authed(s.handleMessageDelete))
	mux.Handle("POST /api/v1/channels/{id}/messages/{mid}/ack", s.authed(s.handleAck))
	mux.Handle("PUT /api/v1/channels/{id}/messages/{mid}/reactions/{emoji}/@me", s.authed(s.handleReactionAdd))
	mux.Handle("DELETE /api/v1/channels/{id}/messages/{mid}/reactions/{emoji}/@me", s.authed(s.handleReactionRemove))
	mux.Handle("GET /api/v1/channels/{id}/messages/{mid}/reactions/{emoji}", s.authed(s.handleReactors))
}

// envelope mirrors the client's encrypted message format.
type envelope struct {
	V     int    `json:"v"`
	Conv  ids.ID `json:"conv"`
	Epoch int    `json:"epoch"`
	IV    string `json:"iv"`
	CT    string `json:"ct"`
}

// validEnvelope checks structure only; the server never decrypts.
func validEnvelope(raw json.RawMessage) (*envelope, bool) {
	if len(raw) == 0 || len(raw) > maxEnvelopeBytes {
		return nil, false
	}
	var e envelope
	if err := json.Unmarshal(raw, &e); err != nil || e.V != 1 || e.Conv.IsZero() || e.Epoch < 0 || e.CT == "" {
		return nil, false
	}
	iv, err := base64.StdEncoding.DecodeString(e.IV)
	if err != nil || len(iv) != 12 {
		return nil, false
	}
	if _, err := base64.StdEncoding.DecodeString(e.CT); err != nil {
		return nil, false
	}
	return &e, true
}

// convForChannel is the conversation whose keys encrypt a channel.
func (s *Server) convForChannel(r *http.Request, ch *store.Channel) (ids.ID, error) {
	if s.isDM(ch) {
		return ch.ID, nil
	}
	if s.ConvForChannel != nil {
		return s.ConvForChannel(r.Context(), ch)
	}
	return ch.ID, nil
}

type messageBody struct {
	Ciphertext      json.RawMessage `json:"ciphertext"`
	KeyConvID       ids.ID          `json:"key_conv_id"`
	KeyEpoch        int             `json:"key_epoch"`
	ReplyToID       *ids.ID         `json:"reply_to_id"`
	Mentions        []ids.ID        `json:"mentions"`
	MentionRoles    []ids.ID        `json:"mention_roles"`
	MentionEveryone bool            `json:"mention_everyone"`
	Attachments     []struct {
		BlobID ids.ID `json:"blob_id"`
		Size   int64  `json:"size"`
	} `json:"attachments"`
	Nonce string `json:"nonce"`
	Flags int64  `json:"flags"`
}

func dedupeIDs(list []ids.ID, max int) []ids.ID {
	seen := map[ids.ID]bool{}
	out := make([]ids.ID, 0, len(list))
	for _, id := range list {
		if id.IsZero() || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
		if len(out) >= max {
			break
		}
	}
	return out
}

// dmBlocked answers 403 when the caller and the other person in a 1:1 DM have
// blocked each other, so a block also closes a conversation that already exists.
func (s *Server) dmBlocked(w http.ResponseWriter, r *http.Request, ch *store.Channel, me *store.User) bool {
	blocked, err := s.Store.DMBlocked(r.Context(), ch, me.ID)
	if err != nil {
		WriteError(w, err)
		return true
	}
	if blocked {
		WriteError(w, E(http.StatusForbidden, "blocked", "You cannot message this user."))
		return true
	}
	return false
}

// checkEnvelope validates the ciphertext against the channel's conversation.
// An edit may instead keep the conversation its message was first sealed for,
// passed as alt: a channel that later got its own key still has older
// messages under the server's.
func (s *Server) checkEnvelope(w http.ResponseWriter, r *http.Request, ch *store.Channel, body *messageBody, alt *ids.ID) (*envelope, bool) {
	env, ok := validEnvelope(body.Ciphertext)
	if !ok {
		WriteError(w, E(http.StatusBadRequest, "bad_envelope", "The encrypted message envelope is malformed."))
		return nil, false
	}
	conv, err := s.convForChannel(r, ch)
	if err != nil {
		WriteError(w, err)
		return nil, false
	}
	if alt != nil && !alt.IsZero() && env.Conv == *alt {
		conv = *alt
	}
	if env.Conv != conv || body.KeyConvID != conv || env.Epoch != body.KeyEpoch {
		WriteError(w, E(http.StatusBadRequest, "wrong_conversation", "The message is encrypted for a different conversation."))
		return nil, false
	}
	latest, exists, err := s.Store.LatestEpoch(r.Context(), conv)
	if err != nil {
		WriteError(w, err)
		return nil, false
	}
	if !exists || env.Epoch > latest {
		WriteError(w, E(http.StatusBadRequest, "unknown_epoch", "That key epoch does not exist yet."))
		return nil, false
	}
	return env, true
}

func (s *Server) handleMessages(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedHistory)
	if ch == nil {
		return
	}
	q := store.MessageQuery{}
	get := func(k string) ids.ID {
		v := r.URL.Query().Get(k)
		if v == "" {
			return 0
		}
		id, _ := ids.Parse(v)
		return id
	}
	q.Before, q.After, q.Around = get("before"), get("after"), get("around")
	if l := r.URL.Query().Get("limit"); l != "" {
		q.Limit, _ = strconv.Atoi(l)
	}
	list, err := s.Store.Messages(r.Context(), ch.ID, q, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

func (s *Server) handleMessageGet(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedHistory)
	if ch == nil {
		return
	}
	mid, err := ids.Parse(r.PathValue("mid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	m, err := s.Store.MessageByID(r.Context(), mid, me.ID)
	if err != nil || m.ChannelID != ch.ID {
		WriteError(w, ErrNotFound)
		return
	}
	WriteJSON(w, http.StatusOK, m)
}

func (s *Server) handleMessageCreate(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedSend)
	if ch == nil {
		return
	}
	var body messageBody
	if err := ReadJSON(w, r, &body, maxEnvelopeBytes+16<<10); err != nil {
		WriteError(w, err)
		return
	}
	if ok, retry := s.limMsg.Allow("msg:" + me.ID.String() + ":" + ch.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	if len(body.Nonce) > maxNonce {
		WriteError(w, E(http.StatusBadRequest, "bad_nonce", "Nonce is too long."))
		return
	}
	ctx := r.Context()
	if body.Nonce != "" {
		if existing, err := s.Store.MessageByNonce(ctx, ch.ID, me.ID, body.Nonce, me.ID); err == nil {
			WriteJSON(w, http.StatusOK, existing)
			return
		}
	}
	if ch.SlowmodeSeconds > 0 && !s.isDM(ch) && s.ChannelAccess != nil {
		if ok, _ := s.ChannelAccess(ctx, me, ch, NeedManage); !ok {
			if last, err := s.Store.LastMessageAt(ctx, ch.ID, me.ID); err == nil && last > 0 {
				wait := time.Duration(ch.SlowmodeSeconds)*time.Second - time.Since(time.UnixMilli(last))
				if wait > 0 {
					w.Header().Set("Retry-After", retryAfter(wait))
					WriteError(w, E(http.StatusTooManyRequests, "slowmode", "Slow mode is on: wait before sending another message."))
					return
				}
			}
		}
	}
	if s.dmBlocked(w, r, ch, me) {
		return
	}
	env, ok := s.checkEnvelope(w, r, ch, &body, nil)
	if !ok {
		return
	}
	if len(body.Attachments) > maxAttachments {
		WriteError(w, E(http.StatusBadRequest, "too_many_attachments", "At most 10 files per message."))
		return
	}
	if !s.isDM(ch) && body.MentionEveryone && s.ChannelAccess != nil {
		if ok, _ := s.ChannelAccess(ctx, me, ch, "mention_everyone"); !ok {
			body.MentionEveryone = false
		}
	}
	if !s.isDM(ch) && len(body.Attachments) > 0 && s.ChannelAccess != nil {
		if ok, _ := s.ChannelAccess(ctx, me, ch, NeedAttach); !ok {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You cannot attach files here."))
			return
		}
	}
	if s.isDM(ch) {
		// a conversation someone closed comes back when it has something new in it
		if reopened, err := s.Store.UnhideDM(ctx, ch.ID); err == nil && len(reopened) > 0 {
			s.Bcast.EmitUsers(reopened, "channel_create", ch)
		}
	}
	m := &store.Message{ChannelID: ch.ID, AuthorID: me.ID, Type: "default", Ciphertext: body.Ciphertext, KeyConvID: &env.Conv, KeyEpoch: &env.Epoch,
		Mentions: dedupeIDs(body.Mentions, maxMentions), MentionRoles: dedupeIDs(body.MentionRoles, maxMentions), MentionEveryone: body.MentionEveryone, Nonce: body.Nonce, Flags: body.Flags & store.MsgFlagSuppressEmbeds}
	if body.ReplyToID != nil {
		target, err := s.Store.MessageByID(ctx, *body.ReplyToID, me.ID)
		if err != nil || target.ChannelID != ch.ID {
			WriteError(w, E(http.StatusBadRequest, "bad_reply", "The message you are replying to is not in this channel."))
			return
		}
		m.ReplyToID = body.ReplyToID
		m.Type = "reply"
	}
	seenBlobs := map[ids.ID]bool{}
	for _, a := range body.Attachments {
		if seenBlobs[a.BlobID] {
			continue // the same file listed twice is attached once
		}
		seenBlobs[a.BlobID] = true
		b, err := s.Store.BlobByID(ctx, a.BlobID)
		if err != nil || b.Kind != "attachment" || b.OwnerID == nil || *b.OwnerID != me.ID {
			WriteError(w, E(http.StatusBadRequest, "bad_attachment", "One of the attachments is not yours or does not exist."))
			return
		}
		if _, err := s.Store.AttachmentByBlob(ctx, a.BlobID); err == nil {
			WriteError(w, E(http.StatusBadRequest, "bad_attachment", "An attachment was already used by another message."))
			return
		}
		m.Attachments = append(m.Attachments, store.Attachment{BlobID: a.BlobID, Size: b.Size})
	}
	if err := s.Store.InsertMessage(ctx, m); err != nil {
		if err == store.ErrAlreadyExists {
			if existing, err := s.Store.MessageByNonce(ctx, ch.ID, me.ID, body.Nonce, me.ID); err == nil {
				WriteJSON(w, http.StatusOK, existing)
				return
			}
		}
		WriteError(w, err)
		return
	}
	full, err := s.Store.MessageByID(ctx, m.ID, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitChannel(ch.ID, "message_create", full)
	s.Bcast.KeysMaybeNeeded(env.Conv)
	WriteJSON(w, http.StatusCreated, full)
}

func (s *Server) handleMessageEdit(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedSend)
	if ch == nil {
		return
	}
	mid, err := ids.Parse(r.PathValue("mid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	m, err := s.Store.MessageByID(r.Context(), mid, me.ID)
	if err != nil || m.ChannelID != ch.ID {
		WriteError(w, ErrNotFound)
		return
	}
	var body messageBody
	if err := ReadJSON(w, r, &body, maxEnvelopeBytes+16<<10); err != nil {
		WriteError(w, err)
		return
	}
	if len(body.Ciphertext) == 0 || string(body.Ciphertext) == "null" {
		// flags-only edit (e.g. suppress embeds)
		if m.AuthorID != me.ID {
			WriteError(w, ErrForbidden)
			return
		}
		flags := (m.Flags &^ store.MsgFlagSuppressEmbeds) | (body.Flags & store.MsgFlagSuppressEmbeds)
		if err := s.Store.SetMessageFlags(r.Context(), mid, flags); err != nil {
			WriteError(w, err)
			return
		}
	} else {
		if m.AuthorID != me.ID || m.Type != "default" && m.Type != "reply" {
			WriteError(w, ErrForbidden)
			return
		}
		if s.dmBlocked(w, r, ch, me) {
			return
		}
		env, ok := s.checkEnvelope(w, r, ch, &body, m.KeyConvID)
		if !ok {
			return
		}
		// readers open a message with the key its row names, so the row follows the new envelope
		if err := s.Store.UpdateMessage(r.Context(), mid, body.Ciphertext, env.Conv, env.Epoch, dedupeIDs(body.Mentions, maxMentions), dedupeIDs(body.MentionRoles, maxMentions), body.MentionEveryone, time.Now().UnixMilli()); err != nil {
			WriteError(w, err)
			return
		}
	}
	updated, err := s.Store.MessageByID(r.Context(), mid, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	// Reactions carry a "me" flag for whoever loaded them, so everyone gets a
	// copy loaded for no one rather than the editor's.
	if shared, err := s.Store.MessageByID(r.Context(), mid, 0); err == nil {
		s.Bcast.EmitChannel(ch.ID, "message_update", shared)
	}
	WriteJSON(w, http.StatusOK, updated)
}

func (s *Server) handleMessageDelete(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedView)
	if ch == nil {
		return
	}
	mid, err := ids.Parse(r.PathValue("mid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	m, err := s.Store.MessageByID(r.Context(), mid, me.ID)
	if err != nil || m.ChannelID != ch.ID {
		WriteError(w, ErrNotFound)
		return
	}
	allowed := m.AuthorID == me.ID
	if !allowed && ch.Type == "group_dm" && ch.OwnerID != nil && *ch.OwnerID == me.ID {
		allowed = true
	}
	if !allowed && !s.isDM(ch) && s.ChannelAccess != nil {
		allowed, _ = s.ChannelAccess(r.Context(), me, ch, NeedManage)
	}
	// whoever runs the instance can take down any message they can see
	if !allowed && me.Flags&store.FlagAdmin != 0 {
		allowed = true
	}
	if !allowed {
		WriteError(w, ErrForbidden)
		return
	}
	if err := s.Store.DeleteMessage(r.Context(), mid); err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitChannel(ch.ID, "message_delete", map[string]any{"id": mid, "channel_id": ch.ID})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAck(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedView)
	if ch == nil {
		return
	}
	mid, err := ids.Parse(r.PathValue("mid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	var body struct {
		Manual bool `json:"manual"`
	}
	if r.ContentLength > 0 {
		_ = ReadJSON(w, r, &body, 1<<10)
	}
	if err := s.Store.Ack(r.Context(), me.ID, ch.ID, mid, body.Manual); err != nil {
		WriteError(w, err)
		return
	}
	states, err := s.Store.ReadStatesFor(r.Context(), me.ID, []ids.ID{ch.ID})
	if err != nil || len(states) == 0 {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers([]ids.ID{me.ID}, "read_state", states[0])
	WriteJSON(w, http.StatusOK, states[0])
}

func parseEmoji(raw string) (string, bool) {
	e, err := url.PathUnescape(raw)
	if err != nil {
		return "", false
	}
	e = strings.TrimSpace(e)
	if e == "" || len(e) > maxEmojiLen || strings.ContainsAny(e, " \t\n/") {
		return "", false
	}
	return e, true
}

// reactionTarget loads the channel, message and emoji of a reaction route.
// Only adding a reaction needs Add Reactions: taking your own back needs to see
// the channel, and listing who reacted needs its history.
func (s *Server) reactionTarget(w http.ResponseWriter, r *http.Request, need string) (*store.Channel, *store.User, *store.Message, string) {
	ch, me := s.channel(w, r, need)
	if ch == nil {
		return nil, nil, nil, ""
	}
	mid, err := ids.Parse(r.PathValue("mid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil, nil, ""
	}
	m, err := s.Store.MessageByID(r.Context(), mid, me.ID)
	if err != nil || m.ChannelID != ch.ID {
		WriteError(w, ErrNotFound)
		return nil, nil, nil, ""
	}
	emoji, ok := parseEmoji(r.PathValue("emoji"))
	if !ok {
		WriteError(w, E(http.StatusBadRequest, "bad_emoji", "That emoji is malformed."))
		return nil, nil, nil, ""
	}
	return ch, me, m, emoji
}

func (s *Server) handleReactionAdd(w http.ResponseWriter, r *http.Request) {
	ch, me, m, emoji := s.reactionTarget(w, r, NeedReact)
	if ch == nil || s.dmBlocked(w, r, ch, me) {
		return
	}
	added, err := s.Store.AddReaction(r.Context(), m.ID, me.ID, emoji)
	if err != nil {
		if err == store.ErrLimit {
			WriteError(w, E(http.StatusBadRequest, "too_many_reactions", "A message can have at most 20 different reactions."))
			return
		}
		WriteError(w, err)
		return
	}
	if added {
		s.Bcast.EmitChannel(ch.ID, "reaction_add", map[string]any{"channel_id": ch.ID, "message_id": m.ID, "user_id": me.ID, "emoji": emoji})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleReactionRemove(w http.ResponseWriter, r *http.Request) {
	ch, me, m, emoji := s.reactionTarget(w, r, NeedView)
	if ch == nil {
		return
	}
	removed, err := s.Store.RemoveReaction(r.Context(), m.ID, me.ID, emoji)
	if err != nil {
		WriteError(w, err)
		return
	}
	if removed {
		s.Bcast.EmitChannel(ch.ID, "reaction_remove", map[string]any{"channel_id": ch.ID, "message_id": m.ID, "user_id": me.ID, "emoji": emoji})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleReactors(w http.ResponseWriter, r *http.Request) {
	ch, _, m, emoji := s.reactionTarget(w, r, NeedHistory)
	if ch == nil {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	users, err := s.Store.Reactors(r.Context(), m.ID, emoji, limit)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, users)
}

var _ = auth.UserFrom
