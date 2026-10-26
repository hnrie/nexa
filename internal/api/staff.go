package api

import (
	"context"
	"net/http"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/store"
)

// Nexa's staff come in four ranks, each holding everything the ranks below it
// hold:
//
//   - Mod: the moderation panel's people, cases and log, and mutes and bans of
//     at most a week (modMaxDuration). A mod lifts only the cases they opened.
//   - Admin: the rest of the panel (every other action, permanent bans,
//     servers, expressions, apps, bug reports, alt accounts, announcements),
//     but not disabling sign-in or deleting accounts, and no rights in other
//     people's servers.
//   - Developer: what Nexa admins have always had (store.FlagAdmin): every
//     right in every server they are in, disabling sign-in, deleting
//     accounts, and the instance's own settings, stats and crash reports.
//   - Owner: the oldest Developer. Only the owner gives and takes ranks, and
//     disables the sign-in of staff.
//
// A rank is a public flag bit, so every app can draw it. Staff of any rank
// cannot be moderated until the owner takes their rank away.
type staffRank int

const (
	rankNone staffRank = iota
	rankMod
	rankAdmin
	rankDeveloper
	rankOwner
)

// modMaxDuration is the longest mute or ban a mod can give.
const modMaxDuration = int64(7 * 24 * time.Hour / time.Millisecond)

// rankNames are the ranks as the API spells them; "" is no rank.
var rankNames = map[staffRank]string{rankNone: "", rankMod: "mod", rankAdmin: "admin", rankDeveloper: "developer", rankOwner: "owner"}

// rankBits is the flag bit each grantable rank is stored as. The owner is
// not granted: it is the oldest Developer.
var rankBits = map[staffRank]int64{rankMod: store.FlagStaffMod, rankAdmin: store.FlagStaffAdmin, rankDeveloper: store.FlagAdmin}

// rankFromFlags reads a rank from an account's flags, given whether it is the
// owner's account.
func rankFromFlags(flags int64, owner bool) staffRank {
	switch {
	case flags&store.FlagAdmin != 0 && owner:
		return rankOwner
	case flags&store.FlagAdmin != 0:
		return rankDeveloper
	case flags&store.FlagStaffAdmin != 0:
		return rankAdmin
	case flags&store.FlagStaffMod != 0:
		return rankMod
	}
	return rankNone
}

// rankOf is u's rank. Only a Developer needs the owner looked up; a lookup
// that fails leaves them a Developer, never the owner.
func (s *Server) rankOf(ctx context.Context, u *store.User) staffRank {
	owner := false
	if u.Flags&store.FlagAdmin != 0 {
		id, err := s.Store.InstanceOwnerID(ctx)
		owner = err == nil && id == u.ID
	}
	return rankFromFlags(u.Flags, owner)
}

// staffRankError is the refusal for someone below the rank a thing needs.
func staffRankError(need staffRank) *Error {
	switch need {
	case rankOwner:
		return E(http.StatusForbidden, "owner_only", "Only the owner of Nexa can do that.")
	case rankDeveloper:
		return E(http.StatusForbidden, "developer_only", "Only Nexa developers and the owner can do that.")
	case rankAdmin:
		return E(http.StatusForbidden, "staff_admin_only", "Only Nexa admins and above can do that.")
	}
	return E(http.StatusForbidden, "admin_only", "Only Nexa staff can do that.")
}

// staff gates a handler behind a staff rank.
func (s *Server) staff(need staffRank, h http.HandlerFunc) http.Handler {
	return s.authed(func(w http.ResponseWriter, r *http.Request) {
		// someone with no rank at all is told what they always were
		if rank := s.rankOf(r.Context(), auth.UserFrom(r.Context())); rank < need {
			if rank == rankNone {
				need = rankNone
			}
			WriteError(w, staffRankError(need))
			return
		}
		h(w, r)
	})
}

// staffBits are the flags of the staff who are at least need (Owner counts
// as Developer here, as they share the bit).
func staffBits(need staffRank) int64 {
	var bits int64
	for r, b := range rankBits {
		if r >= need {
			bits |= b
		}
	}
	return bits
}
