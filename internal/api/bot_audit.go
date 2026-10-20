package api

import (
	"context"
	"encoding/json"
	"strconv"

	"evilion.xyz/chat/internal/automod"
	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// The audit log and AutoMod as the protocol shows them. Nexa's log names its
// actions in words and its AutoMod knows more kinds of rule than the
// protocol does; what has a counterpart there is shown under it, and the
// rest is left out of what bots are told.

// auditActions numbers Nexa's audit log actions as the protocol does.
var auditActions = map[string]int{
	"server_update": 1, "invites_pause": 1, "invites_resume": 1,
	"channel_create": 10, "channel_update": 11, "channel_delete": 12, "channel_positions": 11,
	"overwrite_create": 13, "overwrite_update": 14, "overwrite_delete": 15,
	"member_kick": 20, "member_prune": 21, "member_ban": 22, "member_unban": 23, "member_update": 24, "member_timeout": 24,
	"member_timeout_remove": 24, "member_role_add": 25, "member_role_remove": 25, "member_voice": 24, "member_quarantine_lift": 24,
	"member_move": 26, "member_disconnect": 27, "bot_add": 28,
	"role_create": 30, "role_update": 31, "role_delete": 32, "role_positions": 31,
	"invite_create": 40, "invite_delete": 42, "invite_delete_all": 42,
	"webhook_create": 50, "webhook_update": 51, "webhook_delete": 52,
	"emoji_create": 60, "emoji_update": 61, "emoji_delete": 62,
	"message_delete": 72, "message_bulk_delete": 73, "message_pin": 74, "message_unpin": 75,
	"integration_create": 80, "integration_delete": 82,
	"sticker_pack_create": 90, "sticker_pack_update": 91, "sticker_pack_delete": 92,
	"thread_create": 110, "thread_update": 111, "thread_delete": 112,
	"command_permission_update": 121, "application_command_permission_update": 121,
	"automod_rule": 140, "automod_rule_create": 140, "automod_rule_update": 141, "automod_rule_delete": 142,
	"automod_action":    143,
	"server_tag_update": 1, "server_tag_delete": 1, "server_transfer": 1,
}

// auditTypeOf is the protocol's action type of an entry, or 0 for one it
// has none for.
func auditTypeOf(action string) int { return auditActions[action] }

type dAuditChange struct {
	Key      string `json:"key"`
	NewValue any    `json:"new_value,omitempty"`
	OldValue any    `json:"old_value,omitempty"`
}

type dAuditEntry struct {
	ID         snow           `json:"id"`
	UserID     *snow          `json:"user_id"`
	TargetID   *string        `json:"target_id"`
	ActionType int            `json:"action_type"`
	Changes    []dAuditChange `json:"changes,omitempty"`
	Options    map[string]any `json:"options,omitempty"`
	Reason     *string        `json:"reason,omitempty"`
}

// auditEntryObj is a line of a server's audit log; ok is false for an
// action the protocol has no number for.
func (b *dBuilder) auditEntryObj(e *store.AuditEntry) (dAuditEntry, bool) {
	t := auditTypeOf(e.Action)
	if t == 0 {
		return dAuditEntry{}, false
	}
	out := dAuditEntry{ID: snow(e.ID), UserID: botproto.SP(&e.ActorID), ActionType: t}
	if e.TargetID != nil {
		target := botproto.OutString(*e.TargetID)
		out.TargetID = &target
	} else if t == 1 {
		target := botproto.OutString(e.ServerID)
		out.TargetID = &target
	}
	if e.Reason != "" {
		r := e.Reason
		out.Reason = &r
	}
	var changes map[string]any
	if len(e.Changes) > 0 {
		_ = json.Unmarshal(e.Changes, &changes)
	}
	if changes == nil {
		changes = map[string]any{}
	}
	idOf := func(key string) string {
		switch v := changes[key].(type) {
		case string:
			if id, err := ids.Parse(v); err == nil {
				return botproto.OutString(id)
			}
		case float64:
			return botproto.OutString(ids.ID(int64(v)))
		}
		return ""
	}
	countOf := func(key string) string {
		if n, ok := changes[key].(float64); ok {
			return strconv.Itoa(int(n))
		}
		return "1"
	}
	// the actions whose entries carry options, as the protocol fills them
	switch t {
	case 21: // prune
		out.Options = map[string]any{"delete_member_days": countOf("days"), "members_removed": countOf("count")}
		return out, true
	case 26: // moved between voice channels
		out.Options = map[string]any{"channel_id": idOf("channel_id"), "count": countOf("count")}
	case 27: // put out of a voice channel
		out.Options = map[string]any{"count": countOf("count")}
	case 72: // messages deleted
		out.Options = map[string]any{"channel_id": idOf("channel_id"), "count": countOf("count")}
		return out, true
	case 73: // messages deleted at once: the entry is about the channel
		ch := idOf("channel_id")
		out.TargetID = &ch
		out.Options = map[string]any{"count": countOf("count")}
		return out, true
	case 74, 75: // pinned, unpinned
		out.Options = map[string]any{"channel_id": idOf("channel_id"), "message_id": idOf("message_id")}
		return out, true
	case 13, 14, 15: // a channel's permission overwrite
		target := idOf("target_id")
		if target == "" {
			target = idOf("target")
		}
		kind := "0"
		if tt, _ := changes["target_type"].(string); tt == "member" {
			kind = "1"
		}
		opts := map[string]any{"id": target, "type": kind}
		if kind == "0" {
			if id, err := botproto.ParseID(target); err == nil {
				if role, err := b.s.Store.RoleByID(b.ctx, id); err == nil {
					opts["role_name"] = role.Name
				}
			}
		}
		out.Options = opts
		for _, k := range []string{"allow", "deny"} {
			if v, ok := changes[k]; ok {
				out.Changes = append(out.Changes, dAuditChange{Key: k, NewValue: v})
			}
		}
		return out, true
	case 121: // who may use an application's commands
		out.Options = map[string]any{"application_id": idOf("application_id")}
		return out, true
	case 143, 144, 145: // AutoMod acting
		trig, _ := amTrigger(stringOf(changes["kind"]))
		out.Options = map[string]any{"auto_moderation_rule_name": stringOf(changes["rule"]), "auto_moderation_rule_trigger_type": strconv.Itoa(trig), "channel_id": idOf("channel_id")}
		return out, true
	case 80, 81, 82: // an application added or taken away
		out.Options = map[string]any{"integration_type": "discord"}
	}
	switch e.Action {
	case "member_role_add", "member_role_remove":
		if rid, ok := changes["role"].(string); ok {
			if id, err := ids.Parse(rid); err == nil {
				name := ""
				if role, err := b.s.Store.RoleByID(b.ctx, id); err == nil {
					name = role.Name
				}
				key := "$add"
				if e.Action == "member_role_remove" {
					key = "$remove"
				}
				out.Changes = append(out.Changes, dAuditChange{Key: key, NewValue: []map[string]any{{"id": snow(id), "name": name}}})
			}
		}
	default:
		for k, v := range changes {
			key := k
			switch k {
			case "timeout_until":
				key = "communication_disabled_until"
				if ms, ok := v.(float64); ok {
					v = botproto.Timestamp(int64(ms))
				}
			case "channel_id", "message_id", "parent_id", "system_channel_id":
				v = idOf(k)
			case "slowmode_seconds":
				key = "rate_limit_per_user"
			}
			out.Changes = append(out.Changes, dAuditChange{Key: key, NewValue: v})
		}
	}
	return out, true
}

// stringOf is a value's string, or "".
func stringOf(v any) string {
	s, _ := v.(string)
	return s
}

// --- AutoMod -----------------------------------------------------------------------------------

// Trigger types, event types and action types as the protocol numbers them.
const (
	amTriggerKeyword       = 1
	amTriggerSpam          = 3
	amTriggerKeywordPreset = 4
	amTriggerMentionSpam   = 5
	amTriggerMemberProfile = 6

	amActionBlock       = 1
	amActionAlert       = 2
	amActionTimeout     = 3
	amActionBlockMember = 4
)

// amPresets numbers Nexa's ready-made lists as the protocol does.
var amPresets = map[string]int{automod.PresetProfanity: 1, automod.PresetSexual: 2, automod.PresetSlurs: 3}

// amTrigger is the protocol's trigger type of a Nexa rule kind; ok is false
// for a kind it has none for.
func amTrigger(kind string) (int, bool) {
	switch kind {
	case ruleWords:
		return amTriggerKeyword, true
	case ruleSpam:
		return amTriggerSpam, true
	case ruleFlagged:
		return amTriggerKeywordPreset, true
	case ruleMentions:
		return amTriggerMentionSpam, true
	case ruleProfile:
		return amTriggerMemberProfile, true
	}
	return 0, false
}

type dAMAction struct {
	Type     int            `json:"type"`
	Metadata map[string]any `json:"metadata"`
}

type dAMRule struct {
	ID              snow           `json:"id"`
	GuildID         snow           `json:"guild_id"`
	Name            string         `json:"name"`
	CreatorID       snow           `json:"creator_id"`
	EventType       int            `json:"event_type"`
	TriggerType     int            `json:"trigger_type"`
	TriggerMetadata map[string]any `json:"trigger_metadata"`
	Actions         []dAMAction    `json:"actions"`
	Enabled         bool           `json:"enabled"`
	ExemptRoles     []snow         `json:"exempt_roles"`
	ExemptChannels  []snow         `json:"exempt_channels"`
}

// automodRuleObj is a rule as the protocol shows it; ok is false for a kind
// it has no trigger for.
func (b *dBuilder) automodRuleObj(r *store.AutomodRule) (dAMRule, bool) {
	trig, ok := amTrigger(r.Kind)
	if !ok {
		return dAMRule{}, false
	}
	var c ruleConfig
	_ = json.Unmarshal(r.Config, &c)
	meta := map[string]any{}
	strs := func(l []string) []string {
		if l == nil {
			return []string{}
		}
		return l
	}
	switch trig {
	case amTriggerKeyword, amTriggerMemberProfile:
		meta["keyword_filter"], meta["regex_patterns"], meta["allow_list"] = strs(c.Words), strs(c.Regex), strs(c.Allow)
	case amTriggerKeywordPreset:
		presets := []int{}
		for _, l := range c.Lists {
			if n, ok := amPresets[l]; ok {
				presets = append(presets, n)
			}
		}
		meta["presets"], meta["allow_list"] = presets, strs(c.Allow)
	case amTriggerMentionSpam:
		meta["mention_total_limit"], meta["mention_raid_protection_enabled"] = c.Max, c.Raid
	}
	out := dAMRule{ID: snow(r.ID), GuildID: snow(r.ServerID), Name: r.Name, CreatorID: snow(r.CreatorID), EventType: 1, TriggerType: trig,
		TriggerMetadata: meta, Actions: []dAMAction{}, Enabled: r.Enabled, ExemptRoles: botproto.Snows(r.ExemptRoles), ExemptChannels: botproto.Snows(r.ExemptChannels)}
	if trig == amTriggerMemberProfile {
		out.EventType = 2
	}
	var acts []ruleAction
	_ = json.Unmarshal(r.Actions, &acts)
	for _, a := range acts {
		switch a.Type {
		case actBlock:
			md := map[string]any{}
			if a.Message != "" {
				md["custom_message"] = a.Message
			}
			out.Actions = append(out.Actions, dAMAction{Type: amActionBlock, Metadata: md})
		case actAlert:
			md := map[string]any{}
			if a.ChannelID != nil {
				md["channel_id"] = snow(*a.ChannelID)
			}
			out.Actions = append(out.Actions, dAMAction{Type: amActionAlert, Metadata: md})
		case actTimeout:
			out.Actions = append(out.Actions, dAMAction{Type: amActionTimeout, Metadata: map[string]any{"duration_seconds": a.Seconds}})
		case actQuarantine:
			out.Actions = append(out.Actions, dAMAction{Type: amActionBlockMember, Metadata: map[string]any{}})
		}
	}
	return out, true
}

// automodExecutionObj is AutoMod acting, as AUTO_MODERATION_ACTION_EXECUTION
// carries it: one event for each of what the rule did. What was caught in a
// message stays sealed with the server's key, so its words are empty unless
// the server could read them itself.
func (b *dBuilder) automodExecutionObj(e *store.AutomodEvent, content bool) ([]map[string]any, bool) {
	trig, ok := amTrigger(e.RuleKind)
	if !ok || e.RuleID == nil {
		return nil, false
	}
	var acts []ruleAction
	_ = json.Unmarshal(e.Actions, &acts)
	out := []map[string]any{}
	for _, a := range acts {
		var action dAMAction
		switch a.Type {
		case actBlock:
			action = dAMAction{Type: amActionBlock, Metadata: map[string]any{}}
		case actAlert:
			md := map[string]any{}
			if a.ChannelID != nil {
				md["channel_id"] = snow(*a.ChannelID)
			}
			action = dAMAction{Type: amActionAlert, Metadata: md}
		case actTimeout:
			action = dAMAction{Type: amActionTimeout, Metadata: map[string]any{"duration_seconds": a.Seconds}}
		case actQuarantine:
			action = dAMAction{Type: amActionBlockMember, Metadata: map[string]any{}}
		default:
			continue
		}
		ev := map[string]any{"guild_id": snow(e.ServerID), "action": action, "rule_id": snow(*e.RuleID), "rule_trigger_type": trig, "user_id": snow(e.UserID),
			"channel_id": botproto.SP(e.ChannelID), "message_id": botproto.SP(e.MessageID), "content": "", "matched_keyword": nil, "matched_content": nil}
		out = append(out, ev)
	}
	return out, len(out) > 0
}

// automodRuleEvent compares a server's rules with what this session last
// sent of them, and sends what was made, changed and taken away.
func (sess *botSession) automodRuleEvent(ctx context.Context, b *dBuilder, serverID ids.ID, _ json.RawMessage, _ *ids.ID, _ bool) {
	if !sess.wants("AUTO_MODERATION_RULE_UPDATE", botproto.InGuild) {
		return
	}
	rules, err := sess.s.Store.AutomodRules(ctx, serverID)
	if err != nil {
		return
	}
	sess.mu.Lock()
	if sess.amRules == nil {
		sess.amRules = map[ids.ID]map[ids.ID]int64{}
	}
	before := sess.amRules[serverID]
	now := map[ids.ID]int64{}
	sess.mu.Unlock()
	for _, r := range rules {
		obj, ok := b.automodRuleObj(r)
		if !ok {
			continue
		}
		now[r.ID] = r.UpdatedAt
		if was, seen := before[r.ID]; !seen {
			sess.emit("AUTO_MODERATION_RULE_CREATE", obj)
		} else if was != r.UpdatedAt {
			sess.emit("AUTO_MODERATION_RULE_UPDATE", obj)
		}
	}
	for id := range before {
		if _, still := now[id]; !still {
			sess.emit("AUTO_MODERATION_RULE_DELETE", map[string]any{"id": snow(id), "guild_id": snow(serverID), "name": "", "creator_id": snow(0), "event_type": 1,
				"trigger_type": amTriggerKeyword, "trigger_metadata": map[string]any{}, "actions": []any{}, "enabled": false, "exempt_roles": []any{}, "exempt_channels": []any{}})
		}
	}
	sess.mu.Lock()
	sess.amRules[serverID] = now
	sess.mu.Unlock()
}
