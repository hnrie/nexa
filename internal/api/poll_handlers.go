package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// Polls come with webhook messages, and with people's (sealed inside the
// message, like the rest of what they write). Anyone who can read the channel
// and react in it can vote; the counts, and who voted for what, are visible to
// everyone who can read it, as the question and answers are. A poll closes on
// its own when its time runs out, and a line under it says how it went.

func (s *Server) pollRoutes(mux *http.ServeMux) {
	mux.Handle("PUT /api/v1/channels/{id}/polls/{mid}/answers/@me", s.authed(s.handlePollVote))
	mux.Handle("GET /api/v1/channels/{id}/polls/{mid}/answers/{aid}", s.authed(s.handlePollVoters))
}

// pollVoteEvent is poll_vote_add and poll_vote_remove's payload: Discord's,
// and how many people have voted now, which the answers' counts cannot tell
// once a poll takes more than one answer from each.
type pollVoteEvent struct {
	ChannelID   ids.ID `json:"channel_id"`
	MessageID   ids.ID `json:"message_id"`
	UserID      ids.ID `json:"user_id"`
	AnswerID    int    `json:"answer_id"`
	TotalVoters int    `json:"total_voters"`
}

func (s *Server) pollMessage(w http.ResponseWriter, r *http.Request, need string) (*store.Channel, *store.User, *store.Message) {
	ch, me := s.channel(w, r, need)
	if ch == nil {
		return nil, nil, nil
	}
	mid, err := ids.Parse(r.PathValue("mid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil, nil
	}
	m, err := s.Store.MessageByID(r.Context(), mid, me.ID)
	if err != nil || m.ChannelID != ch.ID || m.Poll == nil {
		WriteError(w, ErrNotFound)
		return nil, nil, nil
	}
	return ch, me, m
}

// handlePollVote makes the caller's votes on a poll exactly the answers sent;
// an empty list takes them all back.
func (s *Server) handlePollVote(w http.ResponseWriter, r *http.Request) {
	ch, me, m := s.pollMessage(w, r, NeedReact)
	if ch == nil {
		return
	}
	if ok, retry := s.limVote.Allow("vote:" + me.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	var req struct {
		AnswerIDs []json.Number `json:"answer_ids"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	answers := make([]int, 0, len(req.AnswerIDs))
	for _, n := range req.AnswerIDs {
		a, err := strconv.Atoi(n.String())
		if err != nil {
			WriteError(w, E(http.StatusBadRequest, "bad_answer", "That poll has no such answer."))
			return
		}
		answers = append(answers, a)
	}
	added, removed, err := s.Store.SetPollVotes(r.Context(), m.ID, me.ID, answers, time.Now().UnixMilli())
	switch {
	case errors.Is(err, store.ErrPollClosed):
		WriteError(w, E(http.StatusBadRequest, "poll_closed", "This poll has closed."))
		return
	case errors.Is(err, store.ErrBadVote):
		WriteError(w, E(http.StatusBadRequest, "bad_answer", "Pick one of the poll's answers."))
		return
	case err != nil:
		WriteError(w, err)
		return
	}
	updated, err := s.Store.MessageByID(r.Context(), m.ID, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	voters := 0
	if updated.Poll != nil {
		voters = updated.Poll.Voters
	}
	for _, a := range removed {
		s.Bcast.EmitChannel(ch.ID, "poll_vote_remove", pollVoteEvent{ch.ID, m.ID, me.ID, a, voters})
	}
	for _, a := range added {
		s.Bcast.EmitChannel(ch.ID, "poll_vote_add", pollVoteEvent{ch.ID, m.ID, me.ID, a, voters})
	}
	WriteJSON(w, http.StatusOK, updated.Poll)
}

// handlePollVoters lists who picked one answer, as Discord's Get Answer
// Voters does: ?after= a user id, ?limit= up to 100.
func (s *Server) handlePollVoters(w http.ResponseWriter, r *http.Request) {
	ch, _, m := s.pollMessage(w, r, NeedHistory)
	if ch == nil {
		return
	}
	answer, err := strconv.Atoi(r.PathValue("aid"))
	if err != nil || answer < 1 || answer > len(m.Poll.Counts) {
		WriteError(w, ErrNotFound)
		return
	}
	var after ids.ID
	if v := r.URL.Query().Get("after"); v != "" {
		after, _ = ids.Parse(v)
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	list, err := s.Store.PollVoters(r.Context(), m.ID, answer, after, limit)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"users": list})
}

// pollSweep is how often polls whose time ran out are closed.
const pollSweep = 15 * time.Second

// StartPolls closes polls as their time runs out, until ctx ends.
func (s *Server) StartPolls(ctx context.Context) {
	s.background.Go(func() {
		t := time.NewTicker(pollSweep)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.closePolls(ctx)
			}
		}
	})
}

// closePolls ends the polls that ran out: each gets a line in its channel,
// answering it, that says how it went, and everyone who has it open sees it
// close.
func (s *Server) closePolls(ctx context.Context) {
	now := time.Now().UnixMilli()
	due, err := s.Store.DuePolls(ctx, now, 50)
	if err != nil {
		s.Log.Warn("polls: due", "err", err)
		return
	}
	for _, d := range due {
		s.endPoll(ctx, d.MessageID, d.ChannelID, now)
	}
}

// endPoll closes one poll, now: its time ran out, or whoever asked it ended
// it early (the bot API's Expire Poll). It reports whether it was still open.
func (s *Server) endPoll(ctx context.Context, msgID, channelID ids.ID, now int64) bool {
	ended, err := s.Store.EndPoll(ctx, msgID, now)
	if err != nil || !ended {
		return false
	}
	m, err := s.Store.MessageByID(ctx, msgID, 0)
	if err != nil {
		return true
	}
	s.Bcast.EmitChannel(channelID, "message_update", messageUpdateEvent{m, mentionsBefore{m.Mentions, m.MentionRoles, m.MentionEveryone}})
	mid := m.ID
	line := &store.Message{ChannelID: channelID, Type: "system_poll_result", ReplyToID: &mid, Mentions: []ids.ID{}}
	switch {
	case m.WebhookID != nil:
		author, err := s.webhookUser(ctx)
		if err != nil {
			return true
		}
		line.AuthorID, line.WebhookID, line.Webhook = author.ID, m.WebhookID, pollResult(m)
	case len(m.Webhook) > 0:
		// a bot's poll is in the clear, as a webhook's is, and its line too
		line.AuthorID, line.Webhook = m.AuthorID, pollResult(m)
	default:
		// A person's poll speaks for whoever asked it. What it asked is
		// sealed in its message, so the line carries only the numbers, and
		// readers put the two together.
		line.AuthorID, line.PollResult = m.AuthorID, pollOutcome(m)
	}
	if err := s.Store.InsertMessage(ctx, line); err != nil {
		s.Log.Warn("polls: result line", "err", err)
		return true
	}
	if full, err := s.Store.MessageByID(ctx, line.ID, 0); err == nil {
		// the line answers the poll, which readers may not have loaded
		s.withRefs(ctx, 0, full)
		s.Bcast.EmitChannel(channelID, "message_create", full)
	}
	return true
}

// pollResult is what a poll's closing line says, as Discord's poll result
// embed says it: the question, the answer that won and its votes, and how
// many voted in all. A tie has no winner.
func pollResult(m *store.Message) json.RawMessage {
	var p wmPlain
	_ = json.Unmarshal(m.Webhook, &p)
	if p.Poll == nil || m.Poll == nil {
		return nil
	}
	total, best, winner := 0, 0, 0
	for _, c := range m.Poll.Counts {
		total += c.Count
		switch {
		case c.Count > best:
			best, winner = c.Count, c.ID
		case c.Count == best && best > 0:
			winner = 0
		}
	}
	fields := []wmField{
		{Name: "poll_question_text", Value: p.Poll.Question.Text},
		{Name: "victor_answer_votes", Value: strconv.Itoa(best)},
		{Name: "total_votes", Value: strconv.Itoa(total)},
	}
	for _, a := range p.Poll.Answers {
		if a.AnswerID != winner || winner == 0 {
			continue
		}
		fields = append(fields, wmField{Name: "victor_answer_id", Value: strconv.Itoa(a.AnswerID)}, wmField{Name: "victor_answer_text", Value: a.PollMedia.Text})
		if e := a.PollMedia.Emoji; e != nil {
			if e.ID != nil {
				fields = append(fields, wmField{Name: "victor_answer_emoji_id", Value: e.ID.String()})
			}
			if e.Name != "" {
				fields = append(fields, wmField{Name: "victor_answer_emoji_name", Value: e.Name})
			}
			if e.Animated {
				fields = append(fields, wmField{Name: "victor_answer_emoji_animated", Value: "true"})
			}
		}
	}
	out, err := json.Marshal(&wmPlain{Name: p.Name, AvatarID: p.AvatarID, AvatarURL: p.AvatarURL, AvatarProxy: p.AvatarProxy, Embeds: []wmEmbed{{Type: "poll_result", Fields: fields}}})
	if err != nil {
		return nil
	}
	return out
}

// pollOutcome is how a person's poll went, in numbers alone: each answer's
// votes, the answer that won and its votes (none on a tie, as pollResult has
// it), and how many voted in all.
func pollOutcome(m *store.Message) *store.PollOutcome {
	if m.Poll == nil {
		return nil
	}
	out := &store.PollOutcome{Counts: make([]store.PollOutcomeCount, 0, len(m.Poll.Counts)), TotalVoters: m.Poll.Voters}
	for _, c := range m.Poll.Counts {
		out.Counts = append(out.Counts, store.PollOutcomeCount{ID: c.ID, Count: c.Count})
		out.TotalVotes += c.Count
		switch {
		case c.Count > out.WinnerVotes:
			out.WinnerVotes, out.WinnerID = c.Count, c.ID
		case c.Count == out.WinnerVotes && c.Count > 0:
			out.WinnerID = 0
		}
	}
	return out
}
