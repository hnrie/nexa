package botproto

import "encoding/json"

// Version is the gateway and REST version Nexa speaks; older libraries ask
// for 6 to 9 and are answered the same way.
const Version = 10

// Gateway opcodes.
const (
	OpDispatch                = 0
	OpHeartbeat               = 1
	OpIdentify                = 2
	OpPresenceUpdate          = 3
	OpVoiceStateUpdate        = 4
	OpResume                  = 6
	OpReconnect               = 7
	OpRequestGuildMembers     = 8
	OpInvalidSession          = 9
	OpHello                   = 10
	OpHeartbeatAck            = 11
	OpRequestSoundboardSounds = 31
	OpRequestChannelInfo      = 43
)

// Gateway close codes.
const (
	CloseUnknownError         = 4000
	CloseUnknownOpcode        = 4001
	CloseDecodeError          = 4002
	CloseNotAuthenticated     = 4003
	CloseAuthenticationFailed = 4004
	CloseAlreadyAuthenticated = 4005
	CloseInvalidSeq           = 4007
	CloseRateLimited          = 4008
	CloseSessionTimedOut      = 4009
	CloseInvalidShard         = 4010
	CloseShardingRequired     = 4011
	CloseInvalidAPIVersion    = 4012
	CloseInvalidIntents       = 4013
	CloseDisallowedIntents    = 4014
)

// Payload is one gateway frame the server sends: an opcode, its data, and
// for a dispatch its sequence number and event name.
type Payload struct {
	Op int     `json:"op"`
	D  any     `json:"d"`
	S  *uint64 `json:"s"`
	T  *string `json:"t"`
}

// Inbound is one frame a bot sent, its data left as JSON (a frame that came
// as ETF is turned into JSON first, so both are read one way).
type Inbound struct {
	Op int             `json:"op"`
	D  json.RawMessage `json:"d"`
}

// Gateway intents.
const (
	IntentGuilds                      int64 = 1 << 0
	IntentGuildMembers                int64 = 1 << 1
	IntentGuildModeration             int64 = 1 << 2
	IntentGuildExpressions            int64 = 1 << 3
	IntentGuildIntegrations           int64 = 1 << 4
	IntentGuildWebhooks               int64 = 1 << 5
	IntentGuildInvites                int64 = 1 << 6
	IntentGuildVoiceStates            int64 = 1 << 7
	IntentGuildPresences              int64 = 1 << 8
	IntentGuildMessages               int64 = 1 << 9
	IntentGuildMessageReactions       int64 = 1 << 10
	IntentGuildMessageTyping          int64 = 1 << 11
	IntentDirectMessages              int64 = 1 << 12
	IntentDirectMessageReactions      int64 = 1 << 13
	IntentDirectMessageTyping         int64 = 1 << 14
	IntentMessageContent              int64 = 1 << 15
	IntentGuildScheduledEvents        int64 = 1 << 16
	IntentAutoModerationConfiguration int64 = 1 << 20
	IntentAutoModerationExecution     int64 = 1 << 21
	IntentGuildMessagePolls           int64 = 1 << 24
	IntentDirectMessagePolls          int64 = 1 << 25
)

// AllIntents is every intent there is; a bot asking for a bit outside it
// gets CloseInvalidIntents.
const AllIntents = IntentGuilds | IntentGuildMembers | IntentGuildModeration | IntentGuildExpressions | IntentGuildIntegrations |
	IntentGuildWebhooks | IntentGuildInvites | IntentGuildVoiceStates | IntentGuildPresences | IntentGuildMessages |
	IntentGuildMessageReactions | IntentGuildMessageTyping | IntentDirectMessages | IntentDirectMessageReactions |
	IntentDirectMessageTyping | IntentMessageContent | IntentGuildScheduledEvents | IntentAutoModerationConfiguration |
	IntentAutoModerationExecution | IntentGuildMessagePolls | IntentDirectMessagePolls

// Application flags. The privileged intents a bot may ask for are switched
// on per application, in the developer portal; the _LIMITED forms are what
// an unverified bot is given and mean the same here.
const (
	AppFlagAutoModerationRuleCreateBadge int64 = 1 << 6
	AppFlagGatewayPresence               int64 = 1 << 12
	AppFlagGatewayPresenceLimited        int64 = 1 << 13
	AppFlagGatewayGuildMembers           int64 = 1 << 14
	AppFlagGatewayGuildMembersLimited    int64 = 1 << 15
	AppFlagVerificationPendingGuildLimit int64 = 1 << 16
	AppFlagEmbedded                      int64 = 1 << 17
	AppFlagGatewayMessageContent         int64 = 1 << 18
	AppFlagGatewayMessageContentLimited  int64 = 1 << 19
	AppFlagApplicationCommandBadge       int64 = 1 << 23
)

// Privileged reports which privileged intents of want the application's
// flags do not allow, for CloseDisallowedIntents.
func Privileged(want, appFlags int64) (missing int64) {
	if want&IntentGuildPresences != 0 && appFlags&(AppFlagGatewayPresence|AppFlagGatewayPresenceLimited) == 0 {
		missing |= IntentGuildPresences
	}
	if want&IntentGuildMembers != 0 && appFlags&(AppFlagGatewayGuildMembers|AppFlagGatewayGuildMembersLimited) == 0 {
		missing |= IntentGuildMembers
	}
	if want&IntentMessageContent != 0 && appFlags&(AppFlagGatewayMessageContent|AppFlagGatewayMessageContentLimited) == 0 {
		missing |= IntentMessageContent
	}
	return missing
}

// ReadsMessages reports whether an application's flags let its bot read
// every message it can see (the Message Content intent), which is what makes
// it a holder of the keys of the servers it is in.
func ReadsMessages(appFlags int64) bool {
	return appFlags&(AppFlagGatewayMessageContent|AppFlagGatewayMessageContentLimited) != 0
}

// Scope is whether an event happened in a server or in a direct conversation,
// which decides the intent some events need.
type Scope int

const (
	InGuild Scope = iota
	InDM
)

// Intent is the intent an event needs, or 0 for one every connection gets.
// Events that differ between servers and direct conversations take the scope.
func Intent(event string, scope Scope) int64 {
	switch event {
	case "GUILD_CREATE", "GUILD_UPDATE", "GUILD_DELETE", "GUILD_ROLE_CREATE", "GUILD_ROLE_UPDATE", "GUILD_ROLE_DELETE",
		"CHANNEL_CREATE", "CHANNEL_UPDATE", "CHANNEL_DELETE", "THREAD_CREATE", "THREAD_UPDATE", "THREAD_DELETE",
		"THREAD_LIST_SYNC", "THREAD_MEMBER_UPDATE", "STAGE_INSTANCE_CREATE", "STAGE_INSTANCE_UPDATE", "STAGE_INSTANCE_DELETE",
		"VOICE_CHANNEL_STATUS_UPDATE", "VOICE_CHANNEL_START_TIME_UPDATE":
		return IntentGuilds
	case "CHANNEL_PINS_UPDATE":
		if scope == InDM {
			return IntentDirectMessages
		}
		return IntentGuilds
	case "GUILD_MEMBER_ADD", "GUILD_MEMBER_UPDATE", "GUILD_MEMBER_REMOVE", "THREAD_MEMBERS_UPDATE":
		return IntentGuildMembers
	case "GUILD_AUDIT_LOG_ENTRY_CREATE", "GUILD_BAN_ADD", "GUILD_BAN_REMOVE":
		return IntentGuildModeration
	case "GUILD_EMOJIS_UPDATE", "GUILD_STICKERS_UPDATE", "GUILD_SOUNDBOARD_SOUND_CREATE", "GUILD_SOUNDBOARD_SOUND_UPDATE",
		"GUILD_SOUNDBOARD_SOUND_DELETE", "GUILD_SOUNDBOARD_SOUNDS_UPDATE":
		return IntentGuildExpressions
	case "GUILD_INTEGRATIONS_UPDATE", "INTEGRATION_CREATE", "INTEGRATION_UPDATE", "INTEGRATION_DELETE":
		return IntentGuildIntegrations
	case "WEBHOOKS_UPDATE":
		return IntentGuildWebhooks
	case "INVITE_CREATE", "INVITE_DELETE":
		return IntentGuildInvites
	case "VOICE_STATE_UPDATE", "VOICE_CHANNEL_EFFECT_SEND":
		return IntentGuildVoiceStates
	case "PRESENCE_UPDATE":
		return IntentGuildPresences
	case "MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_DELETE_BULK":
		if scope == InDM {
			return IntentDirectMessages
		}
		return IntentGuildMessages
	case "MESSAGE_REACTION_ADD", "MESSAGE_REACTION_REMOVE", "MESSAGE_REACTION_REMOVE_ALL", "MESSAGE_REACTION_REMOVE_EMOJI":
		if scope == InDM {
			return IntentDirectMessageReactions
		}
		return IntentGuildMessageReactions
	case "TYPING_START":
		if scope == InDM {
			return IntentDirectMessageTyping
		}
		return IntentGuildMessageTyping
	case "GUILD_SCHEDULED_EVENT_CREATE", "GUILD_SCHEDULED_EVENT_UPDATE", "GUILD_SCHEDULED_EVENT_DELETE",
		"GUILD_SCHEDULED_EVENT_USER_ADD", "GUILD_SCHEDULED_EVENT_USER_REMOVE":
		return IntentGuildScheduledEvents
	case "AUTO_MODERATION_RULE_CREATE", "AUTO_MODERATION_RULE_UPDATE", "AUTO_MODERATION_RULE_DELETE":
		return IntentAutoModerationConfiguration
	case "AUTO_MODERATION_ACTION_EXECUTION":
		return IntentAutoModerationExecution
	case "MESSAGE_POLL_VOTE_ADD", "MESSAGE_POLL_VOTE_REMOVE":
		if scope == InDM {
			return IntentDirectMessagePolls
		}
		return IntentGuildMessagePolls
	}
	return 0
}

// ShardOf is the shard a server's events go to, by the server's id as bots
// see it: the libraries work this out themselves and must agree.
func ShardOf(guildOut int64, shards int) int {
	if shards <= 1 {
		return 0
	}
	return int((uint64(guildOut) >> 22) % uint64(shards))
}
