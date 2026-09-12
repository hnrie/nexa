package api

import (
	"context"
	"net/http"

	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

// needBits maps the channel access needs used by DM handlers onto permissions.
func needBits(need string) perms.Perm {
	switch need {
	case NeedSend:
		return perms.ViewChannel | perms.SendMessages
	case NeedManage, NeedPin:
		return perms.ViewChannel | perms.ManageMessages
	case NeedHistory:
		return perms.ViewChannel | perms.ReadMessageHistory
	case NeedReact:
		return perms.ViewChannel | perms.AddReactions
	case NeedAttach:
		return perms.ViewChannel | perms.AttachFiles
	case "mention_everyone":
		return perms.ViewChannel | perms.MentionEveryone
	default:
		return perms.ViewChannel
	}
}

// ServerView is a server as the ready payload and join responses carry it.
type ServerView struct {
	*store.Server
	Channels      []*store.Channel `json:"channels"`
	Roles         []*store.Role    `json:"roles"`
	Members       []*store.Member  `json:"members"`
	MemberCount   int              `json:"member_count"`
	Me            *store.Member    `json:"me"`
	MyPermissions perms.Perm       `json:"my_permissions"`
}

const readyMemberLimit = 500

// serverView assembles a member's view of a server (only channels they can see).
func (s *Server) serverView(ctx context.Context, srv *store.Server, uid ids.ID) (*ServerView, []store.PublicUser, error) {
	me, err := s.Store.Member(ctx, srv.ID, uid)
	if err != nil {
		return nil, nil, err
	}
	roles, err := s.Store.Roles(ctx, srv.ID)
	if err != nil {
		return nil, nil, err
	}
	visible, err := s.Store.ViewableServerChannels(ctx, srv.ID, uid)
	if err != nil {
		return nil, nil, err
	}
	all, err := s.Store.ServerChannels(ctx, srv.ID)
	if err != nil {
		return nil, nil, err
	}
	chans := make([]*store.Channel, 0, len(all))
	for _, c := range all {
		if _, ok := visible[c.ID]; ok {
			chans = append(chans, c)
		}
	}
	count, err := s.Store.MemberCount(ctx, srv.ID)
	if err != nil {
		return nil, nil, err
	}
	view := &ServerView{Server: srv, Channels: chans, Roles: roles, Members: []*store.Member{}, MemberCount: count, Me: me}
	view.MyPermissions, err = s.Store.ServerPerms(ctx, srv.ID, uid)
	if err != nil {
		return nil, nil, err
	}
	var users []store.PublicUser
	if count <= readyMemberLimit {
		members, err := s.Store.Members(ctx, srv.ID, 0, readyMemberLimit, "")
		if err != nil {
			return nil, nil, err
		}
		view.Members = members
		list := make([]ids.ID, 0, len(members))
		for _, m := range members {
			list = append(list, m.UserID)
		}
		byID, err := s.Store.UsersByIDs(ctx, list)
		if err != nil {
			return nil, nil, err
		}
		for _, id := range list {
			if u := byID[id]; u != nil {
				users = append(users, u.Public())
			}
		}
	}
	return view, users, nil
}

// WireServers installs the server-aware hooks on the API server and the hub.
func (s *Server) WireServers(hub *gateway.Hub) {
	s.ChannelAccess = func(ctx context.Context, u *store.User, ch *store.Channel, need string) (bool, error) {
		p, _, err := s.Store.ChannelPerms(ctx, ch.ID, u.ID)
		if err != nil {
			return false, err
		}
		return p.Has(needBits(need)), nil
	}
	s.ConvForChannel = func(ctx context.Context, ch *store.Channel) (ids.ID, error) {
		if ch.KeyConvID.IsZero() {
			fresh, err := s.Store.ChannelByID(ctx, ch.ID)
			if err != nil {
				return 0, err
			}
			return fresh.KeyConvID, nil
		}
		return ch.KeyConvID, nil
	}
	s.ServerChannelPatch = s.handleServerChannelPatch
	s.CanRotate = func(ctx context.Context, u *store.User, conv ids.ID) (bool, error) {
		if _, err := s.Store.ServerByID(ctx, conv); err == nil {
			return true, nil // any member holding the key may rotate the server root
		}
		return true, nil
	}
	s.InviteCheck = func(ctx context.Context, code string) bool {
		_, err := s.Store.InviteByCode(ctx, code)
		return err == nil
	}
	s.Profile.MutualServers = func(r *http.Request, me, other ids.ID) ([]ids.ID, error) {
		mine, err := s.Store.ServersForUser(r.Context(), me)
		if err != nil {
			return nil, err
		}
		out := []ids.ID{}
		for _, srv := range mine {
			if ok, _ := s.Store.IsMember(r.Context(), srv.ID, other); ok {
				out = append(out, srv.ID)
			}
		}
		return out, nil
	}
	if hub == nil {
		return
	}
	hub.ViewerResolver = func(ctx context.Context, channelID ids.ID) ([]ids.ID, error) {
		return s.Store.ChannelViewers(ctx, channelID)
	}
	hub.Access = func(ctx context.Context, uid, channelID ids.ID) (bool, error) {
		p, _, err := s.Store.ChannelPerms(ctx, channelID, uid)
		if err != nil {
			return false, err
		}
		return p.Has(perms.ViewChannel), nil
	}
	hub.Interested = func(ctx context.Context, uid ids.ID) ([]ids.ID, error) {
		servers, err := s.Store.ServersForUser(ctx, uid)
		if err != nil {
			return nil, err
		}
		out := []ids.ID{}
		for _, srv := range servers {
			ids_, err := s.Store.MemberIDs(ctx, srv.ID)
			if err != nil {
				return nil, err
			}
			out = append(out, ids_...)
		}
		return out, nil
	}
	hub.ExtraChannels = func(ctx context.Context, uid ids.ID) ([]ids.ID, error) { return s.Store.ChannelsForUser(ctx, uid) }
	hub.ReadyExtras = func(ctx context.Context, u *store.User, p *gateway.ReadyPayload) error {
		servers, err := s.Store.ServersForUser(ctx, u.ID)
		if err != nil {
			return err
		}
		seen := map[ids.ID]bool{u.ID: true}
		for _, usr := range p.Users {
			seen[usr.ID] = true
		}
		for _, srv := range servers {
			view, users, err := s.serverView(ctx, srv, u.ID)
			if err != nil {
				return err
			}
			p.Servers = append(p.Servers, view)
			for _, usr := range users {
				if !seen[usr.ID] {
					seen[usr.ID] = true
					p.Users = append(p.Users, usr)
					if hub.Online(usr.ID) {
						if full, err := s.Store.UserByID(ctx, usr.ID); err == nil {
							p.Presences = append(p.Presences, hub.PresenceOf(ctx, full))
						}
					}
				}
			}
		}
		return nil
	}
}
