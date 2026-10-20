//go:build ignore

// A discordgo bot that exercises the bot API, for tools/bot_e2e.py: the same
// steps and answers as dpy_bot.py, printed as JSON lines. The harness copies
// it into a module that requires discordgo and runs it there.
//
//	go run . BASE TOKEN GUILD_ID
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"sort"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
)

func out(kind string, kv ...any) {
	m := map[string]any{"kind": kind}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i].(string)] = kv[i+1]
	}
	b, _ := json.Marshal(m)
	fmt.Println(string(b))
}

// pointAt points discordgo's endpoints at a Nexa server: the API's roots and
// the CDN's, from which every other endpoint is built when it is used.
func pointAt(base string) {
	api := base + "/api/v" + discordgo.APIVersion + "/"
	discordgo.EndpointDiscord = base + "/"
	discordgo.EndpointAPI = api
	discordgo.EndpointGuilds = api + "guilds/"
	discordgo.EndpointChannels = api + "channels/"
	discordgo.EndpointUsers = api + "users/"
	discordgo.EndpointGateway = api + "gateway"
	discordgo.EndpointGatewayBot = discordgo.EndpointGateway + "/bot"
	discordgo.EndpointWebhooks = api + "webhooks/"
	discordgo.EndpointStickers = api + "stickers/"
	discordgo.EndpointStageInstances = api + "stage-instances"
	discordgo.EndpointSKUs = api + "skus"
	discordgo.EndpointVoice = api + "voice/"
	discordgo.EndpointVoiceRegions = discordgo.EndpointVoice + "regions"
	discordgo.EndpointNitroStickersPacks = api + "sticker-packs"
	discordgo.EndpointGuildCreate = api + "guilds"
	discordgo.EndpointApplications = api + "applications"
	discordgo.EndpointOAuth2 = api + "oauth2/"
	discordgo.EndpointOAuth2Applications = discordgo.EndpointOAuth2 + "applications"
	cdn := base + "/cdn/"
	discordgo.EndpointCDN = cdn
	discordgo.EndpointCDNAttachments = cdn + "attachments/"
	discordgo.EndpointCDNAvatars = cdn + "avatars/"
	discordgo.EndpointCDNIcons = cdn + "icons/"
	discordgo.EndpointCDNSplashes = cdn + "splashes/"
	discordgo.EndpointCDNChannelIcons = cdn + "channel-icons/"
	discordgo.EndpointCDNBanners = cdn + "banners/"
	discordgo.EndpointCDNGuilds = cdn + "guilds/"
	discordgo.EndpointCDNRoleIcons = cdn + "role-icons/"
}

var fruits = []string{"apple", "apricot", "banana", "cherry", "grape"}

func main() {
	base, token, guild := os.Args[1], os.Args[2], os.Args[3]
	pointAt(base)
	s, err := discordgo.New("Bot " + token)
	if err != nil {
		out("error", "error", err.Error())
		return
	}
	s.Identify.Intents = discordgo.IntentsAll
	created := make(chan *discordgo.Guild, 4)
	s.AddHandler(func(s *discordgo.Session, g *discordgo.GuildCreate) {
		if g.ID == guild {
			created <- g.Guild
		}
	})
	started := false
	s.AddHandler(func(s *discordgo.Session, r *discordgo.Ready) {
		gs := []string{}
		for _, g := range r.Guilds {
			gs = append(gs, g.ID)
		}
		out("ready", "user", r.User.Username, "id", r.User.ID, "guilds", gs)
		if started {
			return
		}
		started = true
		go func() {
			select {
			case <-created:
			case <-time.After(10 * time.Second):
				out("error", "error", "no GUILD_CREATE")
				return
			}
			if err := steps(s, guild); err != nil {
				out("error", "error", err.Error())
			}
		}()
	})
	s.AddHandler(func(s *discordgo.Session, i *discordgo.InteractionCreate) {
		if err := answer(s, i); err != nil {
			out("error", "error", err.Error())
		}
	})
	s.AddHandler(func(s *discordgo.Session, m *discordgo.MessageCreate) {
		if m.Author.ID == s.State.User.ID {
			return
		}
		out("message", "id", m.ID, "author", m.Author.ID, "content", m.Content, "guild", m.GuildID)
	})
	if err := s.Open(); err != nil {
		out("error", "error", err.Error())
		return
	}
	defer s.Close()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, os.Kill)
	<-stop
}

func steps(s *discordgo.Session, guildID string) error {
	g, err := s.State.Guild(guildID)
	if err != nil {
		return fmt.Errorf("no guild in the state: %w", err)
	}
	chans := []string{}
	var general string
	for _, c := range g.Channels {
		chans = append(chans, c.Name)
		if c.Name == "general" {
			general = c.ID
		}
	}
	roles := []string{}
	for _, r := range g.Roles {
		roles = append(roles, r.Name)
	}
	out("guild", "name", g.Name, "members", g.MemberCount, "channels", chans, "roles", roles)
	min, max := float64(1), float64(5)
	cmds := []*discordgo.ApplicationCommand{
		{Name: "ping", Description: "Replies with pong"},
		{Name: "echo", Description: "Says it back, only to you", Options: []*discordgo.ApplicationCommandOption{
			{Type: discordgo.ApplicationCommandOptionString, Name: "text", Description: "What to say", Required: true},
			{Type: discordgo.ApplicationCommandOptionInteger, Name: "times", Description: "How many times", MinValue: &min, MaxValue: max},
		}},
		{Name: "slow", Description: "Thinks first"},
		{Name: "fruit", Description: "Pick a fruit", Options: []*discordgo.ApplicationCommandOption{
			{Type: discordgo.ApplicationCommandOptionString, Name: "name", Description: "The fruit", Required: true, Autocomplete: true},
		}},
		{Name: "form", Description: "Opens a form"},
		{Name: "Inspect", Type: discordgo.UserApplicationCommand},
		{Name: "Quote", Type: discordgo.MessageApplicationCommand},
	}
	synced, err := s.ApplicationCommandBulkOverwrite(s.State.User.ID, guildID, cmds)
	if err != nil {
		return fmt.Errorf("sync: %w", err)
	}
	names := []string{}
	for _, c := range synced {
		names = append(names, c.Name)
	}
	sort.Strings(names)
	out("synced", "names", names)
	m, err := s.ChannelMessageSendComplex(general, &discordgo.MessageSend{
		Content: "hello from discordgo",
		Embeds:  []*discordgo.MessageEmbed{{Title: "An Embed", Description: "Made by **discordgo**", Color: 0x5865F2, Fields: []*discordgo.MessageEmbedField{{Name: "Field", Value: "Value"}}, Footer: &discordgo.MessageEmbedFooter{Text: "footer"}}},
		Components: []discordgo.MessageComponent{
			discordgo.ActionsRow{Components: []discordgo.MessageComponent{discordgo.Button{Label: "Press", Style: discordgo.PrimaryButton, CustomID: "press"}}},
			discordgo.ActionsRow{Components: []discordgo.MessageComponent{discordgo.SelectMenu{CustomID: "pick", Placeholder: "Pick one", Options: []discordgo.SelectMenuOption{{Label: "Red", Value: "red"}, {Label: "Blue", Value: "blue"}}}}},
		},
	})
	if err != nil {
		return fmt.Errorf("send: %w", err)
	}
	out("sent", "message", m.ID, "channel", general, "created", m.Timestamp.Format(time.RFC3339))
	content := "hello, edited"
	if _, err := s.ChannelMessageEditComplex(&discordgo.MessageEdit{ID: m.ID, Channel: general, Content: &content}); err != nil {
		return fmt.Errorf("edit: %w", err)
	}
	if err := s.MessageReactionAdd(general, m.ID, "\U0001F44D"); err != nil {
		return fmt.Errorf("react: %w", err)
	}
	f, err := s.ChannelMessage(general, m.ID)
	if err != nil {
		return fmt.Errorf("fetch: %w", err)
	}
	reactions := []string{}
	for _, r := range f.Reactions {
		reactions = append(reactions, r.Emoji.Name)
	}
	out("fetched", "content", f.Content, "reactions", reactions, "embeds", len(f.Embeds), "components", len(f.Components))
	hist, err := s.ChannelMessages(general, 10, "", "", "")
	if err != nil {
		return fmt.Errorf("history: %w", err)
	}
	out("history", "count", len(hist))
	hoist := true
	color := 0x57F287
	role, err := s.GuildRoleCreate(guildID, &discordgo.RoleParams{Name: "Bot Made", Color: &color, Hoist: &hoist})
	if err != nil {
		return fmt.Errorf("role: %w", err)
	}
	out("role", "id", role.ID, "name", role.Name)
	th, err := s.MessageThreadStart(general, m.ID, "A Thread", 60)
	if err != nil {
		return fmt.Errorf("thread: %w", err)
	}
	if _, err := s.ChannelMessageSend(th.ID, "in the thread"); err != nil {
		return fmt.Errorf("thread message: %w", err)
	}
	out("thread", "id", th.ID, "name", th.Name)
	pin, err := s.ChannelMessageSend(general, "pin me")
	if err != nil {
		return err
	}
	if err := s.ChannelMessagePin(general, pin.ID); err != nil {
		return fmt.Errorf("pin: %w", err)
	}
	pins, err := s.ChannelMessagesPinned(general)
	if err != nil {
		return fmt.Errorf("pins: %w", err)
	}
	out("pins", "count", len(pins))
	if err := s.ChannelMessageUnpin(general, pin.ID); err != nil {
		return fmt.Errorf("unpin: %w", err)
	}
	if err := s.ChannelMessageDelete(general, pin.ID); err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	out("steps_done")
	return nil
}

func answer(s *discordgo.Session, i *discordgo.InteractionCreate) error {
	user := i.User
	if i.Member != nil {
		user = i.Member.User
	}
	reply := func(content string, ephemeral bool) error {
		data := &discordgo.InteractionResponseData{Content: content}
		if ephemeral {
			data.Flags = discordgo.MessageFlagsEphemeral
		}
		return s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{Type: discordgo.InteractionResponseChannelMessageWithSource, Data: data})
	}
	switch i.Type {
	case discordgo.InteractionApplicationCommandAutocomplete:
		typed := ""
		for _, o := range i.ApplicationCommandData().Options {
			if o.Focused {
				typed = strings.ToLower(o.StringValue())
			}
		}
		choices := []*discordgo.ApplicationCommandOptionChoice{}
		for _, f := range fruits {
			if strings.HasPrefix(f, typed) {
				choices = append(choices, &discordgo.ApplicationCommandOptionChoice{Name: f, Value: f})
			}
		}
		return s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{Type: discordgo.InteractionApplicationCommandAutocompleteResult, Data: &discordgo.InteractionResponseData{Choices: choices}})
	case discordgo.InteractionApplicationCommand:
		d := i.ApplicationCommandData()
		switch d.Name {
		case "ping":
			if err := reply("pong", false); err != nil {
				return err
			}
			msg, err := s.InteractionResponse(i.Interaction)
			if err != nil {
				return err
			}
			out("ping", "message", msg.ID, "user", user.ID, "guild", i.GuildID)
		case "echo":
			text, times := "", int64(1)
			for _, o := range d.Options {
				switch o.Name {
				case "text":
					text = o.StringValue()
				case "times":
					times = o.IntValue()
				}
			}
			words := make([]string, times)
			for k := range words {
				words[k] = text
			}
			if err := reply(strings.Join(words, " "), true); err != nil {
				return err
			}
			out("echo", "text", text, "times", times)
		case "slow":
			if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{Type: discordgo.InteractionResponseDeferredChannelMessageWithSource}); err != nil {
				return err
			}
			time.Sleep(time.Second)
			f, err := s.FollowupMessageCreate(i.Interaction, true, &discordgo.WebhookParams{Content: "done slowly"})
			if err != nil {
				return err
			}
			content := "thought about it"
			if _, err := s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{Content: &content}); err != nil {
				return err
			}
			out("slow", "followup", f.ID)
		case "fruit":
			name := d.Options[0].StringValue()
			if err := reply("you picked "+name, false); err != nil {
				return err
			}
			out("fruit", "name", name)
		case "form":
			if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{Type: discordgo.InteractionResponseModal, Data: &discordgo.InteractionResponseData{
				CustomID: "tell", Title: "Tell Me",
				Components: []discordgo.MessageComponent{discordgo.ActionsRow{Components: []discordgo.MessageComponent{
					discordgo.TextInput{CustomID: "answer", Label: "Your answer", Style: discordgo.TextInputShort, MaxLength: 100, Required: true},
				}}},
			}}); err != nil {
				return err
			}
			out("form_opened")
		case "Inspect":
			target := d.Resolved.Users[d.TargetID]
			if err := reply("that is "+target.Username, true); err != nil {
				return err
			}
			out("inspect", "target", target.ID)
		case "Quote":
			target := d.Resolved.Messages[d.TargetID]
			if err := reply("quoting: "+target.Content, false); err != nil {
				return err
			}
			out("quote", "target", target.ID, "content", target.Content)
		}
	case discordgo.InteractionModalSubmit:
		d := i.ModalSubmitData()
		value := d.Components[0].(*discordgo.ActionsRow).Components[0].(*discordgo.TextInput).Value
		if err := reply("form said "+value, false); err != nil {
			return err
		}
		out("form", "value", value)
	case discordgo.InteractionMessageComponent:
		d := i.MessageComponentData()
		switch d.CustomID {
		case "press":
			// discordgo sends every field of an update, so the message keeps
			// its components and embeds only if they are sent again, here as
			// on Discord
			data := &discordgo.InteractionResponseData{Content: "pressed by " + user.Username, Components: i.Message.Components, Embeds: i.Message.Embeds}
			if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{Type: discordgo.InteractionResponseUpdateMessage, Data: data}); err != nil {
				return err
			}
			out("pressed", "user", user.ID)
		case "pick":
			if err := reply("picked "+d.Values[0], true); err != nil {
				return err
			}
			out("picked", "values", d.Values)
		}
	}
	return nil
}
