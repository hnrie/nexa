package api

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/unfurl"
)

// A person's app fetches the previews for the links in their message before
// sealing it. A webhook's or a bot's message has no such app behind it, so the
// server fetches them, the same way and through the same guarded fetcher, and adds them to
// the message once they are in, as Discord does with the links a webhook
// posts.

// maxWebhookPreviews is how many links of one message get a preview.
const maxWebhookPreviews = 5

var reWebLink = regexp.MustCompile("https?://[^\\s<>\"'`]+")

// linksToPreview lists the links in text that should get a preview: not in
// code, and not wrapped in <angle brackets>, which is how a sender says no.
func linksToPreview(text string) []string {
	text = reCodeFence.ReplaceAllString(text, " ")
	text = reCodeSpan.ReplaceAllString(text, " ")
	var out []string
	seen := map[string]bool{}
	for _, loc := range reWebLink.FindAllStringIndex(text, -1) {
		link := text[loc[0]:loc[1]]
		if loc[0] > 0 && text[loc[0]-1] == '<' {
			continue
		}
		// the full stop or bracket that ends a sentence is not part of the link
		for len(link) > 0 {
			last := link[len(link)-1]
			if strings.IndexByte(".,;:!?*_~|", last) >= 0 || (last == ')' && strings.Count(link, "(") < strings.Count(link, ")")) {
				link = link[:len(link)-1]
				continue
			}
			break
		}
		if len(link) < len("http://x") || len(link) > 2048 || seen[link] {
			continue
		}
		seen[link] = true
		out = append(out, link)
		if len(out) >= maxWebhookPreviews {
			break
		}
	}
	return out
}

// unfurlWebhookMessage fetches previews for the links in a webhook message
// in the background, and adds them to it if it still says the same thing by
// the time they are in.
func (s *Server) unfurlWebhookMessage(msgID, chID ids.ID, content string) {
	if s.Unfurl == nil {
		return
	}
	links := linksToPreview(content)
	if len(links) == 0 {
		return
	}
	s.background.Go(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		var results []unfurl.Result
		for _, link := range links {
			if s.isAppInstallLink(link) {
				continue
			}
			if res := s.inviteUnfurlLink(ctx, link); res != nil {
				results = append(results, *res)
				continue
			}
			res, err := s.Unfurl.Lookup(ctx, link)
			if err != nil || res == nil {
				continue
			}
			results = append(results, *s.proxied(res))
		}
		if len(results) == 0 {
			return
		}
		m, err := s.Store.MessageByID(ctx, msgID, 0)
		if err != nil || m.Flags&store.MsgFlagSuppressEmbeds != 0 {
			return
		}
		var p wmPlain
		if err := json.Unmarshal(m.Webhook, &p); err != nil || p.Content != content {
			// edited since: the edit fetches its own
			return
		}
		// a webhook's message, or an app's (which has no webhook id unless it answers someone)
		if m.WebhookID == nil && p.ApplicationID == nil {
			return
		}
		p.LinkEmbeds = results
		plain, err := json.Marshal(&p)
		if err != nil {
			return
		}
		if err := s.Store.SetWebhookPlain(ctx, msgID, plain); err != nil {
			return
		}
		updated, err := s.Store.MessageByID(ctx, msgID, 0)
		if err != nil {
			return
		}
		s.Bcast.EmitChannel(chID, "message_update", messageUpdateEvent{updated, mentionsBefore{m.Mentions, m.MentionRoles, m.MentionEveryone}})
	})
}
