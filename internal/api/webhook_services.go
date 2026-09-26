package api

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// A webhook URL with /slack or /github on the end takes what Slack's incoming
// webhooks or GitHub's repository webhooks send, and turns it into a webhook
// message: the formats Discord's webhooks take too, converted the way Discord
// converts them, so a repository or a tool set up for either posts here the
// same way.

// --- Slack ------------------------------------------------------------------------

var (
	reSlackLink    = regexp.MustCompile(`<((?:https?|mailto):[^|>\s]+)(?:\|([^>]*))?>`)
	reSlackSpecial = regexp.MustCompile(`<!(everyone|channel|here)(?:\|[^>]*)?>`)
	reSlackUser    = regexp.MustCompile(`<[@#][A-Z0-9]+\|([^>]+)>`)
	reSlackBold    = regexp.MustCompile(`(^|[\s(])\*([^*\n]+)\*`)
	reSlackStrike  = regexp.MustCompile(`(^|[\s(])~([^~\n]+)~`)
	reSlackItalic  = regexp.MustCompile(`(^|[\s(])_([^_\n]+)_`)
)

// slackText turns Slack's mrkdwn into this app's markdown: <url|label> links,
// *bold*, _italic_, ~strike~, <!here> and <!channel>, and its HTML escapes.
func slackText(s string) string {
	if s == "" {
		return ""
	}
	s = reSlackLink.ReplaceAllStringFunc(s, func(m string) string {
		parts := reSlackLink.FindStringSubmatch(m)
		if parts[2] == "" {
			return parts[1]
		}
		return "[" + parts[2] + "](" + parts[1] + ")"
	})
	s = reSlackSpecial.ReplaceAllStringFunc(s, func(m string) string {
		if strings.HasPrefix(m, "<!here") {
			return "@here"
		}
		return "@everyone"
	})
	s = reSlackUser.ReplaceAllString(s, "@$1")
	s = reSlackBold.ReplaceAllString(s, "$1**$2**")
	s = reSlackStrike.ReplaceAllString(s, "$1~~$2~~")
	s = reSlackItalic.ReplaceAllString(s, "$1*$2*")
	return strings.NewReplacer("&lt;", "<", "&gt;", ">", "&amp;", "&").Replace(s)
}

// slackColor reads an attachment's colour: a hex code or one of Slack's
// three names.
func slackColor(v any) (int, bool) {
	s, _ := v.(string)
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "":
		return 0, false
	case "good":
		return 0x2EB886, true
	case "warning":
		return 0xDAA038, true
	case "danger":
		return 0xA30200, true
	}
	n, err := strconv.ParseUint(strings.TrimPrefix(strings.TrimSpace(s), "#"), 16, 32)
	if err != nil || n > whMaxColor {
		return 0, false
	}
	return int(n), true
}

func str(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	case bool:
		return strconv.FormatBool(x)
	}
	return ""
}

// slackBlocksText is the text of Block Kit blocks, for a message that has
// blocks and no text: sections, headers, context lines and rich text.
func slackBlocksText(blocks []any) string {
	var lines []string
	textOf := func(v any) string {
		o, _ := v.(map[string]any)
		return slackText(str(o["text"]))
	}
	for _, b := range blocks {
		o, ok := b.(map[string]any)
		if !ok {
			continue
		}
		switch str(o["type"]) {
		case "header":
			if t := textOf(o["text"]); t != "" {
				lines = append(lines, "## "+t)
			}
		case "section":
			if t := textOf(o["text"]); t != "" {
				lines = append(lines, t)
			}
			if fields, ok := o["fields"].([]any); ok {
				for _, f := range fields {
					if t := textOf(f); t != "" {
						lines = append(lines, t)
					}
				}
			}
		case "context":
			var parts []string
			if els, ok := o["elements"].([]any); ok {
				for _, e := range els {
					if eo, ok := e.(map[string]any); ok && str(eo["type"]) != "image" {
						if t := slackText(str(eo["text"])); t != "" {
							parts = append(parts, t)
						}
					}
				}
			}
			if len(parts) > 0 {
				lines = append(lines, "-# "+strings.Join(parts, " "))
			}
		case "divider":
			lines = append(lines, "")
		}
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// slackToWebhook converts a Slack incoming-webhook payload. Slack's channel,
// icon_emoji and mrkdwn switches have no counterpart and are dropped.
func slackToWebhook(raw map[string]any) map[string]any {
	out := map[string]any{}
	content := slackText(str(raw["text"]))
	if content == "" {
		if blocks, ok := raw["blocks"].([]any); ok {
			content = slackBlocksText(blocks)
		}
	}
	if u := str(raw["username"]); u != "" {
		out["username"] = u
	}
	if u := str(raw["icon_url"]); u != "" {
		out["avatar_url"] = u
	}
	var embeds []any
	if list, ok := raw["attachments"].([]any); ok {
		for _, v := range list {
			a, ok := v.(map[string]any)
			if !ok {
				continue
			}
			e := map[string]any{}
			if c, ok := slackColor(a["color"]); ok {
				e["color"] = c
			}
			if name := str(a["author_name"]); name != "" {
				author := map[string]any{"name": name}
				if u := str(a["author_link"]); u != "" {
					author["url"] = u
				}
				if u := str(a["author_icon"]); u != "" {
					author["icon_url"] = u
				}
				e["author"] = author
			}
			if t := slackText(str(a["title"])); t != "" {
				e["title"] = t
				if u := str(a["title_link"]); u != "" {
					e["url"] = u
				}
			}
			// a pretext goes above the attachment's text, in the same box
			if t := strings.TrimSpace(strings.Join([]string{slackText(str(a["pretext"])), slackText(str(a["text"]))}, "\n")); t != "" {
				e["description"] = t
			}
			if fl, ok := a["fields"].([]any); ok {
				var fields []any
				for _, fv := range fl {
					f, ok := fv.(map[string]any)
					if !ok {
						continue
					}
					name, value := slackText(str(f["title"])), slackText(str(f["value"]))
					if name == "" && value == "" {
						continue
					}
					// an embed field needs both; a zero-width space stands in
					if name == "" {
						name = "​"
					}
					if value == "" {
						value = "​"
					}
					short, _ := f["short"].(bool)
					fields = append(fields, map[string]any{"name": name, "value": value, "inline": short})
				}
				if len(fields) > 0 {
					e["fields"] = fields
				}
			}
			if u := str(a["image_url"]); u != "" {
				e["image"] = map[string]any{"url": u}
			}
			if u := str(a["thumb_url"]); u != "" {
				e["thumbnail"] = map[string]any{"url": u}
			}
			if t := slackText(str(a["footer"])); t != "" {
				footer := map[string]any{"text": t}
				if u := str(a["footer_icon"]); u != "" {
					footer["icon_url"] = u
				}
				e["footer"] = footer
			}
			if ts := str(a["ts"]); ts != "" {
				if f, err := strconv.ParseFloat(ts, 64); err == nil && f > 0 {
					e["timestamp"] = time.UnixMilli(int64(f * 1000)).UTC().Format(time.RFC3339Nano)
				}
			}
			if len(e) == 0 || (e["title"] == nil && e["description"] == nil && e["fields"] == nil && e["image"] == nil && e["author"] == nil) {
				if fb := slackText(str(a["fallback"])); fb != "" {
					e["description"] = fb
				}
			}
			if len(e) > 0 {
				embeds = append(embeds, e)
			}
		}
	}
	if content != "" {
		out["content"] = content
	}
	if len(embeds) > whMaxEmbeds {
		embeds = embeds[:whMaxEmbeds]
	}
	if len(embeds) > 0 {
		out["embeds"] = embeds
	}
	return out
}

// --- GitHub -----------------------------------------------------------------------

// githubAvatar is the picture GitHub's messages go out with: GitHub's own,
// loaded through this server's proxy like any other remote picture.
const githubAvatar = "https://avatars.githubusercontent.com/u/9919?s=128&v=4"

// mdEscape keeps what someone typed in a title from turning into formatting.
var mdEscape = strings.NewReplacer(`\`, `\\`, `*`, `\*`, `_`, `\_`, "`", "\\`", `~`, `\~`, `|`, `\|`, `>`, `\>`, `[`, `\[`, `]`, `\]`)

// The colours Discord gives GitHub's events.
const (
	ghBlurple = 7506394  // commits
	ghRed     = 16525609 // a force push, a failed check
	ghGreen   = 38912    // a pull request opened, a check passed
	ghOrange  = 15426592 // an issue opened
	ghComment = 15109472 // a comment on an issue or a discussion
	ghPRNote  = 12576191 // a comment on a pull request
)

// obj walks into nested JSON objects: obj(raw, "repository", "owner").
func obj(v any, path ...string) map[string]any {
	cur, _ := v.(map[string]any)
	for _, p := range path {
		if cur == nil {
			return nil
		}
		cur, _ = cur[p].(map[string]any)
	}
	return cur
}

// ghClip shortens s to n characters, the last three of them dots.
func ghClip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-3]) + "..."
}

// githubToWebhook converts one of GitHub's webhook events into a message. ok
// is false for an event there is nothing to say about: one this does not
// cover, an action within one that is not shown (a label added to an issue),
// or GitHub's ping when the webhook is set up.
func githubToWebhook(event string, raw map[string]any) (map[string]any, bool) {
	repo := obj(raw, "repository")
	full, name := str(repo["full_name"]), str(repo["name"])
	if full == "" {
		full = name
	}
	sender := obj(raw, "sender")
	action := str(raw["action"])
	embed := map[string]any{}
	if login := str(sender["login"]); login != "" {
		author := map[string]any{"name": login}
		if u := str(sender["html_url"]); u != "" {
			author["url"] = u
		}
		if u := str(sender["avatar_url"]); u != "" {
			author["icon_url"] = u
		}
		embed["author"] = author
	}
	esc := mdEscape.Replace
	set := func(title, url, description string, color int) {
		embed["title"] = ghClip(title, whMaxTitle)
		if url != "" {
			embed["url"] = url
		}
		if description != "" {
			embed["description"] = ghClip(description, 500)
		}
		if color != 0 {
			embed["color"] = color
		}
	}
	switch event {
	case "push":
		ref := str(raw["ref"])
		branch, isBranch := strings.CutPrefix(ref, "refs/heads/")
		if !isBranch {
			return nil, false
		}
		if forced, _ := raw["forced"].(bool); forced {
			head := obj(raw, "head_commit")
			sha := str(head["id"])
			if sha == "" {
				sha = str(raw["after"])
			}
			set(fmt.Sprintf("[%s] Branch %s was force-pushed to `%s`", name, esc(branch), clip7(sha)), "", "[Compare changes]("+str(raw["compare"])+")", ghRed)
			break
		}
		commits, _ := raw["commits"].([]any)
		if len(commits) == 0 {
			return nil, false
		}
		var lines []string
		for i, cv := range commits {
			if i >= 5 {
				break
			}
			c := obj(cv)
			msg := strings.SplitN(str(c["message"]), "\n", 2)[0]
			who := str(obj(c, "author")["username"])
			if who == "" {
				who = str(obj(c, "author")["name"])
			}
			lines = append(lines, fmt.Sprintf("[`%s`](%s) %s - %s", clip7(str(c["id"])), str(c["url"]), ghClip(msg, 50), who))
		}
		plural := "s"
		if len(commits) == 1 {
			plural = ""
		}
		embed["title"] = ghClip(fmt.Sprintf("[%s:%s] %d new commit%s", name, esc(branch), len(commits), plural), whMaxTitle)
		// one commit links to itself, several to the comparison of them all
		embed["url"] = str(raw["compare"])
		if len(commits) == 1 {
			embed["url"] = str(obj(commits[0])["url"])
		}
		embed["description"] = strings.Join(lines, "\n")
		embed["color"] = ghBlurple
	case "pull_request":
		if action != "opened" && action != "closed" && action != "reopened" {
			return nil, false
		}
		pr := obj(raw, "pull_request")
		title := fmt.Sprintf("[%s] Pull request %s: #%s %s", full, action, str(raw["number"]), esc(ghClip(str(pr["title"]), 216)))
		if action == "opened" {
			set(title, str(pr["html_url"]), str(pr["body"]), ghGreen)
		} else {
			set(title, str(pr["html_url"]), "", 0)
		}
	case "issues":
		if action != "opened" && action != "closed" && action != "reopened" {
			return nil, false
		}
		issue := obj(raw, "issue")
		title := fmt.Sprintf("[%s] Issue %s: #%s %s", full, action, str(issue["number"]), esc(ghClip(str(issue["title"]), 150)))
		if action == "opened" {
			set(title, str(issue["html_url"]), str(issue["body"]), ghOrange)
		} else {
			set(title, str(issue["html_url"]), "", 0)
		}
	case "issue_comment":
		if action != "created" {
			return nil, false
		}
		issue, comment := obj(raw, "issue"), obj(raw, "comment")
		kind, color := "issue", ghComment
		if _, isPR := issue["pull_request"]; isPR {
			kind, color = "pull request", ghPRNote
		}
		set(fmt.Sprintf("[%s] New comment on %s #%s: %s", full, kind, str(issue["number"]), esc(ghClip(str(issue["title"]), 150))), str(comment["html_url"]), str(comment["body"]), color)
	case "commit_comment":
		if action != "created" && action != "" {
			return nil, false
		}
		comment := obj(raw, "comment")
		set(fmt.Sprintf("[%s] New comment on commit `%s`", full, clip7(str(comment["commit_id"]))), str(comment["html_url"]), str(comment["body"]), 0)
	case "create":
		set(fmt.Sprintf("[%s] New %s created: %s", full, str(raw["ref_type"]), esc(str(raw["ref"]))), "", "", 0)
	case "delete":
		set(fmt.Sprintf("[%s] %s deleted: %s", full, capitalise(str(raw["ref_type"])), esc(str(raw["ref"]))), "", "", 0)
	case "fork":
		forkee := obj(raw, "forkee")
		set(fmt.Sprintf("[%s] Fork created: %s", full, str(forkee["full_name"])), str(forkee["html_url"]), "", 0)
	case "watch":
		if action != "started" {
			return nil, false
		}
		set(fmt.Sprintf("[%s] New star added", full), str(repo["html_url"]), "", 0)
	case "release":
		if action != "published" {
			return nil, false
		}
		rel := obj(raw, "release")
		set(fmt.Sprintf("[%s] New release published: %s", full, esc(str(rel["tag_name"]))), str(rel["html_url"]), "", 0)
	case "member":
		if action != "added" {
			return nil, false
		}
		member := obj(raw, "member")
		set(fmt.Sprintf("[%s] New collaborator added: %s", full, esc(str(member["login"]))), str(member["html_url"]), "", 0)
	case "public":
		set(fmt.Sprintf("[%s] Now open sourced!", full), str(repo["html_url"]), "", 0)
	case "pull_request_review":
		if action != "submitted" {
			return nil, false
		}
		pr, review := obj(raw, "pull_request"), obj(raw, "review")
		set(fmt.Sprintf("[%s] Pull request review submitted: #%s %s", full, str(pr["number"]), esc(ghClip(str(pr["title"]), 216))), str(review["html_url"]), str(review["body"]), 0)
	case "pull_request_review_comment":
		if action != "created" {
			return nil, false
		}
		pr, comment := obj(raw, "pull_request"), obj(raw, "comment")
		set(fmt.Sprintf("[%s] New review comment on pull request #%s: %s", full, str(pr["number"]), esc(ghClip(str(pr["title"]), 216))), str(comment["html_url"]), str(comment["body"]), ghPRNote)
	case "check_run":
		if action != "completed" {
			return nil, false
		}
		run := obj(raw, "check_run")
		conclusion := str(run["conclusion"])
		color := ghRed
		if conclusion == "success" {
			color = ghGreen
		}
		set(fmt.Sprintf("[%s] %s %s on %s", name, esc(str(run["name"])), conclusion, esc(str(obj(run, "check_suite")["head_branch"]))), str(run["html_url"]), "", color)
		// a check is the build's, not whoever pushed
		delete(embed, "author")
	case "check_suite":
		if action != "completed" {
			return nil, false
		}
		suite := obj(raw, "check_suite")
		conclusion := str(suite["conclusion"])
		color := ghRed
		if conclusion == "success" {
			color = ghGreen
		}
		app := str(obj(suite, "app")["name"])
		if app == "" {
			app = "GitHub Actions"
		}
		commit := ""
		if sha := str(suite["head_sha"]); sha != "" && str(repo["html_url"]) != "" {
			commit = str(repo["html_url"]) + "/commit/" + sha
		}
		set(fmt.Sprintf("[%s] %s checks %s on %s", name, esc(app), conclusion, esc(str(suite["head_branch"]))), commit, "", color)
		delete(embed, "author")
	case "discussion":
		if action != "created" {
			return nil, false
		}
		d := obj(raw, "discussion")
		set(fmt.Sprintf("[%s] New discussion #%s: %s", full, str(d["number"]), esc(ghClip(str(d["title"]), 150))), str(d["html_url"]), str(d["body"]), ghComment)
	case "discussion_comment":
		if action != "created" {
			return nil, false
		}
		d, comment := obj(raw, "discussion"), obj(raw, "comment")
		set(fmt.Sprintf("[%s] New comment on discussion #%s: %s", full, str(d["number"]), esc(ghClip(str(d["title"]), 150))), str(comment["html_url"]), str(comment["body"]), ghComment)
	default:
		return nil, false
	}
	return map[string]any{"username": "GitHub", "avatar_url": githubAvatar, "embeds": []any{embed}}, true
}

func clip7(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

func capitalise(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
