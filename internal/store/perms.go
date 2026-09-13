package store

import (
	"context"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
)

func toPermRoles(roles []*Role) []perms.Role {
	out := make([]perms.Role, len(roles))
	for i, r := range roles {
		out[i] = perms.Role{ID: r.ID, Position: r.Position, Permissions: r.Permissions}
	}
	return out
}

func toPermOverwrites(list []Overwrite) []perms.Overwrite {
	out := make([]perms.Overwrite, len(list))
	for i, ow := range list {
		out[i] = perms.Overwrite{TargetID: ow.TargetID, Kind: ow.TargetType, Allow: ow.Allow, Deny: ow.Deny}
	}
	return out
}

func toPermMember(m *Member, now int64) perms.Member {
	return perms.Member{UserID: m.UserID, RoleIDs: m.RoleIDs, TimedOut: m.TimeoutUntil != nil && *m.TimeoutUntil > now}
}

// IsInstanceAdmin reports whether an account runs this instance. In any server
// it is a member of, such an account holds every permission its owner does.
func (s *Store) IsInstanceAdmin(ctx context.Context, uid ids.ID) bool {
	var flags int64
	if err := s.db.R.QueryRowContext(ctx, `SELECT flags FROM users WHERE id = ?`, int64(uid)).Scan(&flags); err != nil {
		return false
	}
	return flags&FlagAdmin != 0 && flags&(FlagDisabled|FlagDeleted) == 0
}

// instanceAdmins is IsInstanceAdmin for everyone at once.
func (s *Store) instanceAdmins(ctx context.Context) (map[ids.ID]bool, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT id FROM users WHERE flags & ? != 0 AND flags & ? = 0`, FlagAdmin, FlagDisabled|FlagDeleted)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[ids.ID]bool{}
	for rows.Next() {
		var id ids.ID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// ServerPerms resolves a user's server-level permissions (0 for non-members).
func (s *Store) ServerPerms(ctx context.Context, serverID, uid ids.ID) (perms.Perm, error) {
	srv, err := s.ServerByID(ctx, serverID)
	if err != nil {
		return 0, err
	}
	m, err := s.Member(ctx, serverID, uid)
	if err != nil {
		if err == ErrNotFound {
			return 0, nil
		}
		return 0, err
	}
	roles, err := s.Roles(ctx, serverID)
	if err != nil {
		return 0, err
	}
	return perms.Base(serverID, toPermRoles(roles), toPermMember(m, nowMs()), srv.OwnerID == uid || s.IsInstanceAdmin(ctx, uid)), nil
}

// MembersWithPerm lists the members whose server-level permissions include need.
func (s *Store) MembersWithPerm(ctx context.Context, serverID ids.ID, need perms.Perm) ([]ids.ID, error) {
	srv, err := s.ServerByID(ctx, serverID)
	if err != nil {
		return nil, err
	}
	roles, err := s.Roles(ctx, serverID)
	if err != nil {
		return nil, err
	}
	members, err := s.allMembers(ctx, serverID)
	if err != nil {
		return nil, err
	}
	admins, err := s.instanceAdmins(ctx)
	if err != nil {
		return nil, err
	}
	pr, now := toPermRoles(roles), nowMs()
	out := []ids.ID{}
	for _, m := range members {
		if perms.Base(serverID, pr, toPermMember(m, now), srv.OwnerID == m.UserID || admins[m.UserID]).Has(need) {
			out = append(out, m.UserID)
		}
	}
	return out, nil
}

// ChannelPerms resolves a user's permissions in a channel. DM participants get
// every text permission; non-participants and non-members get 0.
func (s *Store) ChannelPerms(ctx context.Context, channelID, uid ids.ID) (perms.Perm, *Channel, error) {
	ch, err := s.ChannelByID(ctx, channelID)
	if err != nil {
		return 0, nil, err
	}
	if ch.ServerID == nil {
		for _, id := range ch.Recipients {
			if id == uid {
				return perms.All, ch, nil
			}
		}
		return 0, ch, nil
	}
	srv, err := s.ServerByID(ctx, *ch.ServerID)
	if err != nil {
		return 0, ch, err
	}
	m, err := s.Member(ctx, *ch.ServerID, uid)
	if err != nil {
		if err == ErrNotFound {
			return 0, ch, nil
		}
		return 0, ch, err
	}
	roles, err := s.Roles(ctx, *ch.ServerID)
	if err != nil {
		return 0, ch, err
	}
	ows, err := s.Overwrites(ctx, channelID)
	if err != nil {
		return 0, ch, err
	}
	return perms.Compute(*ch.ServerID, toPermRoles(roles), toPermMember(m, nowMs()), srv.OwnerID == uid || s.IsInstanceAdmin(ctx, uid), toPermOverwrites(ows)), ch, nil
}

// ChannelViewers lists the members who can view a server channel.
func (s *Store) ChannelViewers(ctx context.Context, channelID ids.ID) ([]ids.ID, error) {
	ch, err := s.ChannelByID(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if ch.ServerID == nil {
		return ch.Recipients, nil
	}
	return s.channelViewers(ctx, *ch.ServerID, channelID)
}

func (s *Store) channelViewers(ctx context.Context, serverID, channelID ids.ID) ([]ids.ID, error) {
	srv, err := s.ServerByID(ctx, serverID)
	if err != nil {
		return nil, err
	}
	roles, err := s.Roles(ctx, serverID)
	if err != nil {
		return nil, err
	}
	ows, err := s.Overwrites(ctx, channelID)
	if err != nil {
		return nil, err
	}
	members, err := s.allMembers(ctx, serverID)
	if err != nil {
		return nil, err
	}
	admins, err := s.instanceAdmins(ctx)
	if err != nil {
		return nil, err
	}
	pr, po := toPermRoles(roles), toPermOverwrites(ows)
	now := nowMs()
	out := []ids.ID{}
	for _, m := range members {
		if perms.Compute(serverID, pr, toPermMember(m, now), srv.OwnerID == m.UserID || admins[m.UserID], po).Has(perms.ViewChannel) {
			out = append(out, m.UserID)
		}
	}
	return out, nil
}

// allMembers loads every membership with roles (pages of 1000).
func (s *Store) allMembers(ctx context.Context, serverID ids.ID) ([]*Member, error) {
	var out []*Member
	var after ids.ID
	for {
		page, err := s.Members(ctx, serverID, after, 1000, "")
		if err != nil {
			return nil, err
		}
		out = append(out, page...)
		if len(page) < 1000 {
			return out, nil
		}
		after = page[len(page)-1].UserID
	}
}

// ChannelsForUser lists every server channel the user can view.
func (s *Store) ChannelsForUser(ctx context.Context, uid ids.ID) ([]ids.ID, error) {
	servers, err := s.ServersForUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := []ids.ID{}
	now := nowMs()
	admin := s.IsInstanceAdmin(ctx, uid)
	for _, srv := range servers {
		m, err := s.Member(ctx, srv.ID, uid)
		if err != nil {
			continue
		}
		roles, err := s.Roles(ctx, srv.ID)
		if err != nil {
			return nil, err
		}
		chans, err := s.ServerChannels(ctx, srv.ID)
		if err != nil {
			return nil, err
		}
		ows, err := s.OverwritesForServer(ctx, srv.ID)
		if err != nil {
			return nil, err
		}
		pr, pm := toPermRoles(roles), toPermMember(m, now)
		for _, ch := range chans {
			if ch.Type == "category" {
				continue
			}
			if perms.Compute(srv.ID, pr, pm, srv.OwnerID == uid || admin, toPermOverwrites(ows[ch.ID])).Has(perms.ViewChannel) {
				out = append(out, ch.ID)
			}
		}
	}
	return out, nil
}

// ViewableServerChannels is ChannelsForUser restricted to one server.
func (s *Store) ViewableServerChannels(ctx context.Context, serverID, uid ids.ID) (map[ids.ID]perms.Perm, error) {
	srv, err := s.ServerByID(ctx, serverID)
	if err != nil {
		return nil, err
	}
	m, err := s.Member(ctx, serverID, uid)
	if err != nil {
		return nil, err
	}
	roles, err := s.Roles(ctx, serverID)
	if err != nil {
		return nil, err
	}
	chans, err := s.ServerChannels(ctx, serverID)
	if err != nil {
		return nil, err
	}
	ows, err := s.OverwritesForServer(ctx, serverID)
	if err != nil {
		return nil, err
	}
	pr, pm := toPermRoles(roles), toPermMember(m, nowMs())
	privileged := srv.OwnerID == uid || s.IsInstanceAdmin(ctx, uid)
	out := map[ids.ID]perms.Perm{}
	for _, ch := range chans {
		p := perms.Compute(serverID, pr, pm, privileged, toPermOverwrites(ows[ch.ID]))
		if p.Has(perms.ViewChannel) {
			out[ch.ID] = p
		}
	}
	return out, nil
}
