package store

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"time"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// What a member of a note may do. The numbers are stored, and a higher one
// includes the ones below it.
const (
	NoteViewer = 1
	NoteEditor = 2
	NoteOwner  = 3
)

// How much one account and one note may hold. A note's head and body are
// ciphertext, so the server can only bound their size.
const (
	MaxNotesPerUser  = 2000
	MaxNoteMembers   = 50
	MaxNoteInvites   = 50
	MaxNoteLinks     = 10
	MaxNoteFiles     = 500
	MaxNoteHeadBytes = 24 << 10
	MaxNoteBodyBytes = 3 << 20
	MaxNoteKeyBytes  = 512
	// MaxNoteVersions is how many earlier states of a note are kept; past
	// that the oldest go.
	MaxNoteVersions = 100
)

// When an earlier state of a note is set aside (see SaveNote). Variables so
// that a test can shorten them; nothing else changes them.
var (
	// NoteQuiet is how long a note must have gone unsaved for the next save
	// to count as writing starting again.
	NoteQuiet = 5 * time.Minute
	// NoteSnapshotEvery is how often a state is set aside while the writing
	// never pauses that long.
	NoteSnapshotEvery = 10 * time.Minute
)

// ErrStale is a save made from a version of the note that is no longer the
// newest: someone else saved in between, and the two have to be put together.
var ErrStale = errors.New("stale version")

// Note is a note as one of its members sees it: the sealed head and body, and
// that member's own role and copy of the key.
type Note struct {
	ID      ids.ID `json:"id"`
	OwnerID ids.ID `json:"owner_id"`
	Head    string `json:"head"`
	// Body is left out of lists: it is fetched when the note is opened.
	Body      string  `json:"body,omitempty"`
	Version   int64   `json:"version"`
	EditedBy  *ids.ID `json:"edited_by"`
	CreatedAt int64   `json:"created_at"`
	UpdatedAt int64   `json:"updated_at"`
	Role      int     `json:"role"`
	KeySealed string  `json:"key_sealed"`
	// KeyEpoch counts the note's keys: KeySealed is the key of this epoch.
	KeyEpoch int `json:"key_epoch"`
	// Members is how many people the note is shared with, its owner included.
	Members int `json:"members"`
	// NeedsRekey says someone who held the note's key is no longer in it (a
	// member taken out, a link removed, an invitation taken back): the owner's
	// app gives the note a new key the next time it sees this.
	NeedsRekey bool `json:"needs_rekey,omitempty"`
}

// NoteVersion is an earlier state of a note, sealed as it was.
type NoteVersion struct {
	ID      ids.ID `json:"id"`
	NoteID  ids.ID `json:"note_id"`
	Version int64  `json:"version"`
	Head    string `json:"head"`
	// Body is left out of the list of versions.
	Body     string  `json:"body,omitempty"`
	KeyEpoch int     `json:"key_epoch"`
	EditedBy *ids.ID `json:"edited_by"`
	SavedAt  int64   `json:"saved_at"`
}

// NoteKey is one of a note's earlier keys, sealed with the key after it.
type NoteKey struct {
	Epoch   int    `json:"epoch"`
	Wrapped string `json:"wrapped"`
}

// NoteMember is one person a note is shared with.
type NoteMember struct {
	UserID    ids.ID  `json:"user_id"`
	Role      int     `json:"role"`
	AddedBy   *ids.ID `json:"added_by"`
	CreatedAt int64   `json:"created_at"`
}

// NoteInvite is an invitation to a note that has not been answered yet.
type NoteInvite struct {
	ID        ids.ID `json:"id"`
	NoteID    ids.ID `json:"note_id"`
	FromID    ids.ID `json:"from_id"`
	ToID      ids.ID `json:"to_id"`
	Role      int    `json:"role"`
	KeySealed string `json:"key_sealed,omitempty"`
	CreatedAt int64  `json:"created_at"`
	// Head is the note's sealed head, for the person invited: with the key in
	// the invitation they can read what they are being invited to.
	Head string `json:"head,omitempty"`
}

// NoteLink is a share link to a note.
type NoteLink struct {
	ID         ids.ID  `json:"id"`
	NoteID     ids.ID  `json:"note_id"`
	TokenHash  string  `json:"-"`
	Role       int     `json:"role"`
	KeyWrapped string  `json:"key_wrapped"`
	LinkSealed string  `json:"link_sealed"`
	CreatedBy  *ids.ID `json:"created_by"`
	Uses       int     `json:"uses"`
	CreatedAt  int64   `json:"created_at"`
}

// noteCols reads a note for the member the query is joined to (m).
const noteCols = `n.id, n.owner_id, n.head, n.version, n.edited_by, n.created_at, n.updated_at, m.role, m.key_sealed, n.key_epoch,
	(SELECT count(*) FROM note_members c WHERE c.note_id = n.id), n.needs_rekey`

func scanNote(r rowScanner, body *string) (*Note, error) {
	var n Note
	var edited sql.NullInt64
	var rekey int
	dest := []any{&n.ID, &n.OwnerID, &n.Head, &n.Version, &edited, &n.CreatedAt, &n.UpdatedAt, &n.Role, &n.KeySealed, &n.KeyEpoch, &n.Members, &rekey}
	if body != nil {
		dest = append(dest, body)
	}
	if err := r.Scan(dest...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	n.EditedBy = idPtr(edited)
	n.NeedsRekey = rekey != 0
	return &n, nil
}

// noteKeyHeldOutside is run when someone who held a note's key leaves it.
// The note is marked, and stays marked until its owner's app has given it a
// new key: the owner may not be around when it happens.
const noteKeyHeldOutside = `UPDATE notes SET needs_rekey = 1 WHERE id = ?`

// CreateNote stores a new note with its owner as its first member. keySealed
// is the note's key sealed to the owner. ErrTooMany once the owner has as
// many notes as an account can.
func (s *Store) CreateNote(ctx context.Context, n *Note, keySealed string) error {
	if n.ID.IsZero() {
		n.ID = ids.New()
	}
	now := nowMs()
	n.CreatedAt, n.UpdatedAt, n.Version, n.Role, n.KeySealed, n.Members = now, now, 1, NoteOwner, keySealed, 1
	owner := n.OwnerID
	n.EditedBy = &owner
	return s.Tx(ctx, func(tx *db.Tx) error {
		// counted and then added to, so the account is this transaction's alone
		if err := tx.Serialise(ctx, "notes", int64(n.OwnerID)); err != nil {
			return err
		}
		var have int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM notes WHERE owner_id = ?`, int64(n.OwnerID)).Scan(&have); err != nil {
			return err
		}
		if have >= MaxNotesPerUser {
			return ErrTooMany
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO notes (id, owner_id, head, body, version, edited_by, created_at, updated_at) VALUES (?,?,?,?,1,?,?,?)`,
			int64(n.ID), int64(n.OwnerID), n.Head, n.Body, int64(n.OwnerID), now, now); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO note_members (note_id, user_id, role, key_sealed, added_by, created_at) VALUES (?,?,?,?,?,?)`,
			int64(n.ID), int64(n.OwnerID), NoteOwner, keySealed, int64(n.OwnerID), now)
		return err
	})
}

// NotesFor lists the notes an account is a member of, newest change first,
// without their bodies.
func (s *Store) NotesFor(ctx context.Context, uid ids.ID) ([]*Note, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+noteCols+` FROM notes n JOIN note_members m ON m.note_id = n.id AND m.user_id = ? ORDER BY n.updated_at DESC, n.id DESC`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Note{}
	for rows.Next() {
		n, err := scanNote(rows, nil)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// NoteFor loads a note, body and all, for one of its members. ErrNotFound for
// a note that is not there and for one this account is no member of: the two
// look the same from outside.
func (s *Store) NoteFor(ctx context.Context, id, uid ids.ID) (*Note, error) {
	var body string
	n, err := scanNote(s.db.R.QueryRowContext(ctx, `SELECT `+noteCols+`, n.body FROM notes n JOIN note_members m ON m.note_id = n.id AND m.user_id = ? WHERE n.id = ?`, int64(uid), int64(id)), &body)
	if err != nil {
		return nil, err
	}
	n.Body = body
	return n, nil
}

// NoteRole is an account's role in a note, or ErrNotFound.
func (s *Store) NoteRole(ctx context.Context, id, uid ids.ID) (int, error) {
	var role int
	err := s.db.R.QueryRowContext(ctx, `SELECT role FROM note_members WHERE note_id = ? AND user_id = ?`, int64(id), int64(uid)).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return role, err
}

// NoteMemberIDs lists everyone a note is shared with.
func (s *Store) NoteMemberIDs(ctx context.Context, id ids.ID) ([]ids.ID, error) {
	return s.idList(ctx, `SELECT user_id FROM note_members WHERE note_id = ? ORDER BY created_at, user_id`, int64(id))
}

// NoteMembers lists a note's members, its owner first, then by when they joined.
func (s *Store) NoteMembers(ctx context.Context, id ids.ID) ([]NoteMember, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT user_id, role, added_by, created_at FROM note_members WHERE note_id = ? ORDER BY role DESC, created_at, user_id`, int64(id))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []NoteMember{}
	for rows.Next() {
		var m NoteMember
		var by sql.NullInt64
		if err := rows.Scan(&m.UserID, &m.Role, &by, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.AddedBy = idPtr(by)
		out = append(out, m)
	}
	return out, rows.Err()
}

// SaveNote stores a new head and body, made from the version `base`, by a
// member who may edit. ErrStale when the note has moved on since; ErrNotFound
// for someone who may not edit it. files is every file the note now holds:
// the note takes a reference on each it did not hold before and gives back
// the ones it let go. A file may be added by whoever uploaded it; one the
// note already holds stays whoever saves.
//
// The state being replaced is set aside as a version when writing starts
// again after a pause (NoteQuiet), every so often while it goes on
// (NoteSnapshotEvery), and whenever `keep` asks for it, which the app does
// before putting an old version back.
func (s *Store) SaveNote(ctx context.Context, id, uid ids.ID, base int64, head, body string, files []ids.ID, keep bool) (version, updatedAt int64, err error) {
	err = s.Tx(ctx, func(tx *db.Tx) error {
		if err := tx.Serialise(ctx, "note", int64(id)); err != nil {
			return err
		}
		var was struct {
			version, updated, created, lastKept int64
			epoch, role                         int
			head, body                          string
			editedBy                            sql.NullInt64
		}
		err := tx.QueryRowContext(ctx, `SELECT n.version, m.role, n.head, n.body, n.key_epoch, n.edited_by, n.updated_at, n.created_at,
			(SELECT coalesce(max(v.created_at), 0) FROM note_versions v WHERE v.note_id = n.id)
			FROM notes n JOIN note_members m ON m.note_id = n.id AND m.user_id = ? WHERE n.id = ?`, int64(uid), int64(id)).
			Scan(&was.version, &was.role, &was.head, &was.body, &was.epoch, &was.editedBy, &was.updated, &was.created, &was.lastKept)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && was.role < NoteEditor) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if was.version != base {
			version = was.version
			return ErrStale
		}
		now := nowMs()
		since := was.lastKept
		if since == 0 {
			since = was.created
		}
		if keep || now-was.updated >= NoteQuiet.Milliseconds() || now-since >= NoteSnapshotEvery.Milliseconds() {
			if err := keepNoteVersionTx(ctx, tx, id, was.version, was.head, was.body, was.epoch, was.editedBy, was.updated, now); err != nil {
				return err
			}
		}
		if err := syncNoteFiles(ctx, tx, id, uid, files); err != nil {
			return err
		}
		version, updatedAt = was.version+1, now
		_, err = tx.ExecContext(ctx, `UPDATE notes SET head = ?, body = ?, version = ?, edited_by = ?, updated_at = ? WHERE id = ?`, head, body, version, int64(uid), updatedAt, int64(id))
		return err
	})
	return version, updatedAt, err
}

// keepNoteVersionTx sets a state of a note aside, with a reference on each
// file the note holds at that moment, and lets the oldest states go once
// there are more than MaxNoteVersions.
func keepNoteVersionTx(ctx context.Context, tx *db.Tx, id ids.ID, version int64, head, body string, epoch int, editedBy sql.NullInt64, savedAt, now int64) error {
	vid := ids.New()
	if _, err := tx.ExecContext(ctx, `INSERT INTO note_versions (id, note_id, version, head, body, key_epoch, edited_by, saved_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
		int64(vid), int64(id), version, head, body, epoch, editedBy, savedAt, now); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO note_version_files (version_id, blob_id) SELECT ?, blob_id FROM note_files WHERE note_id = ?`, int64(vid), int64(id)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = ref_count + 1 WHERE id IN (SELECT blob_id FROM note_files WHERE note_id = ?)`, int64(id)); err != nil {
		return err
	}
	// everything past the newest MaxNoteVersions; the limit is only there
	// because one database will not take an offset without one
	old, err := txIDs(ctx, tx, `SELECT id FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT 1000 OFFSET ?`, int64(id), MaxNoteVersions)
	if err != nil {
		return err
	}
	for _, gone := range old {
		if err := releaseBlobRefs(ctx, tx, `SELECT blob_id FROM note_version_files WHERE version_id = ?`, int64(gone)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM note_version_files WHERE version_id = ?`, int64(gone)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM note_versions WHERE id = ?`, int64(gone)); err != nil {
			return err
		}
	}
	return nil
}

// NoteVersions lists a note's earlier states, newest first, without their bodies.
func (s *Store) NoteVersions(ctx context.Context, noteID ids.ID) ([]*NoteVersion, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT id, note_id, version, head, key_epoch, edited_by, saved_at FROM note_versions WHERE note_id = ? ORDER BY id DESC`, int64(noteID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*NoteVersion{}
	for rows.Next() {
		var v NoteVersion
		var by sql.NullInt64
		if err := rows.Scan(&v.ID, &v.NoteID, &v.Version, &v.Head, &v.KeyEpoch, &by, &v.SavedAt); err != nil {
			return nil, err
		}
		v.EditedBy = idPtr(by)
		out = append(out, &v)
	}
	return out, rows.Err()
}

// NoteVersionByID loads one earlier state of a note, body and all.
func (s *Store) NoteVersionByID(ctx context.Context, noteID, id ids.ID) (*NoteVersion, error) {
	var v NoteVersion
	var by sql.NullInt64
	err := s.db.R.QueryRowContext(ctx, `SELECT id, note_id, version, head, body, key_epoch, edited_by, saved_at FROM note_versions WHERE id = ? AND note_id = ?`, int64(id), int64(noteID)).
		Scan(&v.ID, &v.NoteID, &v.Version, &v.Head, &v.Body, &v.KeyEpoch, &by, &v.SavedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	v.EditedBy = idPtr(by)
	return &v, nil
}

// NoteKeys lists a note's earlier keys, each sealed with the one after it.
func (s *Store) NoteKeys(ctx context.Context, noteID ids.ID) ([]NoteKey, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT epoch, wrapped FROM note_keys WHERE note_id = ? ORDER BY epoch`, int64(noteID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []NoteKey{}
	for rows.Next() {
		var k NoteKey
		if err := rows.Scan(&k.Epoch, &k.Wrapped); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

// NoteFilesError is a save naming files the note cannot take: gone, not an
// attachment, or somebody else's. It names them, so the app can leave them
// out and save the rest.
type NoteFilesError struct{ Files []ids.ID }

func (e *NoteFilesError) Error() string { return "note: files it cannot hold" }

// Is makes it read as ErrNotFound to whoever only asks that.
func (e *NoteFilesError) Is(target error) bool { return target == ErrNotFound }

// syncNoteFiles makes a note's files exactly `files`.
func syncNoteFiles(ctx context.Context, tx *db.Tx, id, uid ids.ID, files []ids.ID) error {
	want := map[int64]bool{}
	for _, f := range files {
		want[int64(f)] = true
	}
	if len(want) > MaxNoteFiles {
		return ErrTooMany
	}
	have := map[int64]bool{}
	rows, err := tx.QueryContext(ctx, `SELECT blob_id FROM note_files WHERE note_id = ?`, int64(id))
	if err != nil {
		return err
	}
	for rows.Next() {
		var b int64
		if err := rows.Scan(&b); err != nil {
			rows.Close()
			return err
		}
		have[b] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	now := nowMs()
	var missing []ids.ID
	for b := range want {
		if have[b] {
			continue
		}
		// Only a file this person uploaded, and only an attachment: a note
		// cannot be made to hold on to somebody else's file or a profile
		// picture. A file one of the note's earlier states holds is the note's
		// already, which is what lets anyone who may edit put that state back.
		var owner sql.NullInt64
		var kind string
		var held int
		err := tx.QueryRowContext(ctx, `SELECT owner_id, kind,
			(SELECT count(*) FROM note_version_files f JOIN note_versions v ON v.id = f.version_id WHERE f.blob_id = blobs.id AND v.note_id = ?)
			FROM blobs WHERE id = ?`, int64(id), b).Scan(&owner, &kind, &held)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && (kind != "attachment" || (held == 0 && (!owner.Valid || owner.Int64 != int64(uid))))) {
			missing = append(missing, ids.ID(b))
			continue
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO note_files (note_id, blob_id, added_by, created_at) VALUES (?,?,?,?)`, int64(id), b, int64(uid), now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ?`, b); err != nil {
			return err
		}
	}
	if len(missing) > 0 {
		// the transaction is rolled back with it: nothing above is kept
		sort.Slice(missing, func(i, j int) bool { return missing[i] < missing[j] })
		return &NoteFilesError{Files: missing}
	}
	for b := range have {
		if want[b] {
			continue
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM note_files WHERE note_id = ? AND blob_id = ?`, int64(id), b); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - 1")+` WHERE id = ?`, b); err != nil {
			return err
		}
	}
	return nil
}

// DeleteNote removes a note with everything that hangs off it, gives back its
// files' references, and returns who it was shared with.
func (s *Store) DeleteNote(ctx context.Context, id ids.ID) ([]ids.ID, error) {
	var members []ids.ID
	err := s.Tx(ctx, func(tx *db.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT user_id FROM note_members WHERE note_id = ?`, int64(id))
		if err != nil {
			return err
		}
		for rows.Next() {
			var u ids.ID
			if err := rows.Scan(&u); err != nil {
				rows.Close()
				return err
			}
			members = append(members, u)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		return deleteNotesTx(ctx, tx, `id = ?`, int64(id))
	})
	return members, err
}

// deleteNotesTx deletes the notes `where` picks, releasing their files first.
func deleteNotesTx(ctx context.Context, tx *db.Tx, where string, args ...any) error {
	if err := releaseBlobRefs(ctx, tx, `SELECT blob_id FROM note_files WHERE note_id IN (SELECT id FROM notes WHERE `+where+`)`, args...); err != nil {
		return err
	}
	// and the files its earlier states were holding on to
	if err := releaseBlobRefs(ctx, tx, `SELECT f.blob_id FROM note_version_files f JOIN note_versions v ON v.id = f.version_id WHERE v.note_id IN (SELECT id FROM notes WHERE `+where+`)`, args...); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM note_version_files WHERE version_id IN (SELECT v.id FROM note_versions v WHERE v.note_id IN (SELECT id FROM notes WHERE `+where+`))`, args...); err != nil {
		return err
	}
	// spelled out rather than left to the foreign keys, which a database
	// opened without them enforced would skip
	for _, table := range []string{"note_versions", "note_keys", "note_files", "note_links", "note_invites", "note_members"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE note_id IN (SELECT id FROM notes WHERE `+where+`)`, args...); err != nil {
			return err
		}
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM notes WHERE `+where, args...)
	return err
}

// addNoteMemberTx makes uid a member with at least `role`. Someone who is one
// already keeps their copy of the key and the higher of the two roles.
func addNoteMemberTx(ctx context.Context, tx *db.Tx, id, uid ids.ID, role int, keySealed string, by ids.ID) error {
	var have int
	err := tx.QueryRowContext(ctx, `SELECT role FROM note_members WHERE note_id = ? AND user_id = ?`, int64(id), int64(uid)).Scan(&have)
	if err == nil {
		if role > have {
			_, err = tx.ExecContext(ctx, `UPDATE note_members SET role = ? WHERE note_id = ? AND user_id = ?`, role, int64(id), int64(uid))
		}
		return err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM note_members WHERE note_id = ?`, int64(id)).Scan(&count); err != nil {
		return err
	}
	if count >= MaxNoteMembers {
		return ErrTooMany
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO note_members (note_id, user_id, role, key_sealed, added_by, created_at) VALUES (?,?,?,?,?,?)`,
		int64(id), int64(uid), role, keySealed, int64(by), nowMs())
	return err
}

// SetNoteMemberRole changes what a member may do. The owner's role is not one
// that can be given or taken this way.
func (s *Store) SetNoteMemberRole(ctx context.Context, id, uid ids.ID, role int) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE note_members SET role = ? WHERE note_id = ? AND user_id = ? AND role != ?`, role, int64(id), int64(uid), NoteOwner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RemoveNoteMember takes someone out of a note: removed by its owner, or
// leaving. The owner cannot be removed; a note with no owner is deleted instead.
func (s *Store) RemoveNoteMember(ctx context.Context, id, uid ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM note_members WHERE note_id = ? AND user_id = ? AND role != ?`, int64(id), int64(uid), NoteOwner)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		_, err = tx.ExecContext(ctx, noteKeyHeldOutside, int64(id))
		return err
	})
}

// CreateNoteInvite stores an invitation, replacing an unanswered one to the
// same person. ErrAlreadyExists when they are a member already, ErrTooMany
// when the note is full or has as many invitations waiting as it can.
func (s *Store) CreateNoteInvite(ctx context.Context, inv *NoteInvite) error {
	if inv.ID.IsZero() {
		inv.ID = ids.New()
	}
	inv.CreatedAt = nowMs()
	return s.Tx(ctx, func(tx *db.Tx) error {
		if err := tx.Serialise(ctx, "note", int64(inv.NoteID)); err != nil {
			return err
		}
		var members, invites, already int
		if err := tx.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM note_members WHERE note_id = ?), (SELECT count(*) FROM note_invites WHERE note_id = ? AND to_id != ?), (SELECT count(*) FROM note_members WHERE note_id = ? AND user_id = ?)`,
			int64(inv.NoteID), int64(inv.NoteID), int64(inv.ToID), int64(inv.NoteID), int64(inv.ToID)).Scan(&members, &invites, &already); err != nil {
			return err
		}
		if already > 0 {
			return ErrAlreadyExists
		}
		if members >= MaxNoteMembers || invites >= MaxNoteInvites {
			return ErrTooMany
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM note_invites WHERE note_id = ? AND to_id = ?`, int64(inv.NoteID), int64(inv.ToID)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO note_invites (id, note_id, from_id, to_id, role, key_sealed, created_at) VALUES (?,?,?,?,?,?,?)`,
			int64(inv.ID), int64(inv.NoteID), int64(inv.FromID), int64(inv.ToID), inv.Role, inv.KeySealed, inv.CreatedAt)
		return err
	})
}

const noteInviteCols = `i.id, i.note_id, i.from_id, i.to_id, i.role, i.key_sealed, i.created_at`

func scanNoteInvite(r rowScanner, head *string) (*NoteInvite, error) {
	var i NoteInvite
	dest := []any{&i.ID, &i.NoteID, &i.FromID, &i.ToID, &i.Role, &i.KeySealed, &i.CreatedAt}
	if head != nil {
		dest = append(dest, head)
	}
	if err := r.Scan(dest...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &i, nil
}

// NoteInviteByID loads one invitation, with the note's head.
func (s *Store) NoteInviteByID(ctx context.Context, id ids.ID) (*NoteInvite, error) {
	var head string
	i, err := scanNoteInvite(s.db.R.QueryRowContext(ctx, `SELECT `+noteInviteCols+`, n.head FROM note_invites i JOIN notes n ON n.id = i.note_id WHERE i.id = ?`, int64(id)), &head)
	if err != nil {
		return nil, err
	}
	i.Head = head
	return i, nil
}

func (s *Store) queryNoteInvites(ctx context.Context, q string, args ...any) ([]*NoteInvite, error) {
	rows, err := s.db.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*NoteInvite{}
	for rows.Next() {
		var head string
		i, err := scanNoteInvite(rows, &head)
		if err != nil {
			return nil, err
		}
		i.Head = head
		out = append(out, i)
	}
	return out, rows.Err()
}

// NoteInvitesTo lists the invitations waiting for an account, newest first.
func (s *Store) NoteInvitesTo(ctx context.Context, uid ids.ID) ([]*NoteInvite, error) {
	return s.queryNoteInvites(ctx, `SELECT `+noteInviteCols+`, n.head FROM note_invites i JOIN notes n ON n.id = i.note_id WHERE i.to_id = ? ORDER BY i.id DESC`, int64(uid))
}

// NoteInvitesOf lists the invitations a note has out, oldest first.
func (s *Store) NoteInvitesOf(ctx context.Context, noteID ids.ID) ([]*NoteInvite, error) {
	return s.queryNoteInvites(ctx, `SELECT `+noteInviteCols+`, '' FROM note_invites i WHERE i.note_id = ? ORDER BY i.id`, int64(noteID))
}

// DeleteNoteInvite withdraws or declines an invitation.
func (s *Store) DeleteNoteInvite(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		// the invitation carried the key to the person invited
		if _, err := tx.ExecContext(ctx, `UPDATE notes SET needs_rekey = 1 WHERE id = (SELECT note_id FROM note_invites WHERE id = ?)`, int64(id)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM note_invites WHERE id = ?`, int64(id))
		return err
	})
}

// AcceptNoteInvite makes the person invited a member, with the key the
// invitation carried, and removes the invitation.
func (s *Store) AcceptNoteInvite(ctx context.Context, id, uid ids.ID) (*NoteInvite, error) {
	var inv *NoteInvite
	err := s.Tx(ctx, func(tx *db.Tx) error {
		var err error
		inv, err = scanNoteInvite(tx.QueryRowContext(ctx, `SELECT `+noteInviteCols+` FROM note_invites i WHERE i.id = ? AND i.to_id = ?`, int64(id), int64(uid)), nil)
		if err != nil {
			return err
		}
		if err := tx.Serialise(ctx, "note", int64(inv.NoteID)); err != nil {
			return err
		}
		if err := addNoteMemberTx(ctx, tx, inv.NoteID, uid, inv.Role, inv.KeySealed, inv.FromID); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM note_invites WHERE id = ?`, int64(id))
		return err
	})
	return inv, err
}

const noteLinkCols = `id, note_id, token_hash, role, key_wrapped, link_sealed, created_by, uses, created_at`

func scanNoteLink(r rowScanner) (*NoteLink, error) {
	var l NoteLink
	var by sql.NullInt64
	if err := r.Scan(&l.ID, &l.NoteID, &l.TokenHash, &l.Role, &l.KeyWrapped, &l.LinkSealed, &by, &l.Uses, &l.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	l.CreatedBy = idPtr(by)
	return &l, nil
}

// CreateNoteLink stores a share link. ErrTooMany once the note has as many as
// it can, ErrAlreadyExists for a token that is taken.
func (s *Store) CreateNoteLink(ctx context.Context, l *NoteLink) error {
	if l.ID.IsZero() {
		l.ID = ids.New()
	}
	l.CreatedAt = nowMs()
	return s.Tx(ctx, func(tx *db.Tx) error {
		if err := tx.Serialise(ctx, "note", int64(l.NoteID)); err != nil {
			return err
		}
		var have, taken int
		if err := tx.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM note_links WHERE note_id = ?), (SELECT count(*) FROM note_links WHERE token_hash = ?)`, int64(l.NoteID), l.TokenHash).Scan(&have, &taken); err != nil {
			return err
		}
		if taken > 0 {
			return ErrAlreadyExists
		}
		if have >= MaxNoteLinks {
			return ErrTooMany
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO note_links (`+noteLinkCols+`) VALUES (?,?,?,?,?,?,?,0,?)`,
			int64(l.ID), int64(l.NoteID), l.TokenHash, l.Role, l.KeyWrapped, l.LinkSealed, nullID(l.CreatedBy), l.CreatedAt)
		return err
	})
}

// NoteLinks lists a note's share links, oldest first.
func (s *Store) NoteLinks(ctx context.Context, noteID ids.ID) ([]*NoteLink, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+noteLinkCols+` FROM note_links WHERE note_id = ? ORDER BY id`, int64(noteID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*NoteLink{}
	for rows.Next() {
		l, err := scanNoteLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// NoteLinkByHash finds a share link by the hash of its token.
func (s *Store) NoteLinkByHash(ctx context.Context, hash string) (*NoteLink, error) {
	return scanNoteLink(s.db.R.QueryRowContext(ctx, `SELECT `+noteLinkCols+` FROM note_links WHERE token_hash = ?`, hash))
}

// DeleteNoteLink revokes a share link of a note.
func (s *Store) DeleteNoteLink(ctx context.Context, noteID, id ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM note_links WHERE id = ? AND note_id = ?`, int64(id), int64(noteID))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		// whoever holds the link holds a way to the key
		_, err = tx.ExecContext(ctx, noteKeyHeldOutside, int64(noteID))
		return err
	})
}

// JoinNoteLink makes uid a member of the note a link leads to, with the role
// the link gives and the key sealed to them. It reports whether they are new.
func (s *Store) JoinNoteLink(ctx context.Context, hash string, uid ids.ID, keySealed string) (link *NoteLink, joined bool, err error) {
	err = s.Tx(ctx, func(tx *db.Tx) error {
		var err error
		link, err = scanNoteLink(tx.QueryRowContext(ctx, `SELECT `+noteLinkCols+` FROM note_links WHERE token_hash = ?`, hash))
		if err != nil {
			return err
		}
		if err := tx.Serialise(ctx, "note", int64(link.NoteID)); err != nil {
			return err
		}
		var was int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM note_members WHERE note_id = ? AND user_id = ?`, int64(link.NoteID), int64(uid)).Scan(&was); err != nil {
			return err
		}
		by := uid
		if link.CreatedBy != nil {
			by = *link.CreatedBy
		}
		if err := addNoteMemberTx(ctx, tx, link.NoteID, uid, link.Role, keySealed, by); err != nil {
			return err
		}
		joined = was == 0
		if !joined {
			return nil
		}
		// an invitation to someone who came in by the link has been answered
		if _, err := tx.ExecContext(ctx, `DELETE FROM note_invites WHERE note_id = ? AND to_id = ?`, int64(link.NoteID), int64(uid)); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE note_links SET uses = uses + 1 WHERE id = ?`, int64(link.ID))
		return err
	})
	return link, joined, err
}

// NoteRekey is a note sealed again under a new key: its head and body, the
// new key for each of its members and each invitation, and its links wrapped
// again. Anything it leaves out is removed, since it could not be opened.
type NoteRekey struct {
	Head, Body string
	// PrevKey is the key being replaced, sealed with the new one: what lets
	// the note's members go on opening the versions sealed before the change.
	PrevKey string
	Members map[ids.ID]string
	Invites map[ids.ID]string
	Links   map[ids.ID][2]string // key_wrapped, link_sealed
}

// RekeyNote swaps a note over to a new key, by its owner, from the version
// `base`. Every member must be given the new key, or the swap is refused with
// ErrConflict: it would lock someone out of a note they are still in.
func (s *Store) RekeyNote(ctx context.Context, id, uid ids.ID, base int64, r NoteRekey) (version, updatedAt int64, err error) {
	err = s.Tx(ctx, func(tx *db.Tx) error {
		if err := tx.Serialise(ctx, "note", int64(id)); err != nil {
			return err
		}
		var current int64
		var role, epoch int
		err := tx.QueryRowContext(ctx, `SELECT n.version, m.role, n.key_epoch FROM notes n JOIN note_members m ON m.note_id = n.id AND m.user_id = ? WHERE n.id = ?`, int64(uid), int64(id)).Scan(&current, &role, &epoch)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && role != NoteOwner) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if current != base {
			version = current
			return ErrStale
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO note_keys (note_id, epoch, wrapped) VALUES (?,?,?)`, int64(id), epoch, r.PrevKey); err != nil {
			return err
		}
		members, err := txIDs(ctx, tx, `SELECT user_id FROM note_members WHERE note_id = ?`, int64(id))
		if err != nil {
			return err
		}
		if len(members) != len(r.Members) {
			return ErrConflict
		}
		for _, m := range members {
			key, ok := r.Members[m]
			if !ok || key == "" {
				return ErrConflict
			}
			if _, err := tx.ExecContext(ctx, `UPDATE note_members SET key_sealed = ? WHERE note_id = ? AND user_id = ?`, key, int64(id), int64(m)); err != nil {
				return err
			}
		}
		invites, err := txIDs(ctx, tx, `SELECT id FROM note_invites WHERE note_id = ?`, int64(id))
		if err != nil {
			return err
		}
		for _, inv := range invites {
			if key := r.Invites[inv]; key != "" {
				_, err = tx.ExecContext(ctx, `UPDATE note_invites SET key_sealed = ? WHERE id = ?`, key, int64(inv))
			} else {
				_, err = tx.ExecContext(ctx, `DELETE FROM note_invites WHERE id = ?`, int64(inv))
			}
			if err != nil {
				return err
			}
		}
		links, err := txIDs(ctx, tx, `SELECT id FROM note_links WHERE note_id = ?`, int64(id))
		if err != nil {
			return err
		}
		for _, l := range links {
			if w, ok := r.Links[l]; ok && w[0] != "" && w[1] != "" {
				_, err = tx.ExecContext(ctx, `UPDATE note_links SET key_wrapped = ?, link_sealed = ? WHERE id = ?`, w[0], w[1], int64(l))
			} else {
				_, err = tx.ExecContext(ctx, `DELETE FROM note_links WHERE id = ?`, int64(l))
			}
			if err != nil {
				return err
			}
		}
		version, updatedAt = current+1, nowMs()
		_, err = tx.ExecContext(ctx, `UPDATE notes SET head = ?, body = ?, version = ?, key_epoch = ?, needs_rekey = 0, edited_by = ?, updated_at = ? WHERE id = ?`, r.Head, r.Body, version, epoch+1, int64(uid), updatedAt, int64(id))
		return err
	})
	return version, updatedAt, err
}

func txIDs(ctx context.Context, tx *db.Tx, q string, args ...any) ([]ids.ID, error) {
	rows, err := tx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ids.ID
	for rows.Next() {
		var id ids.ID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// NoteFileReadable reports whether a blob is a file of a note that uid is a
// member of: what lets them download it.
func (s *Store) NoteFileReadable(ctx context.Context, blobID, uid ids.ID) (bool, error) {
	var now, before int
	// in the note as it is, or in one of its earlier states
	err := s.db.R.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM note_files f JOIN note_members m ON m.note_id = f.note_id WHERE f.blob_id = ? AND m.user_id = ?),
		(SELECT count(*) FROM note_version_files f JOIN note_versions v ON v.id = f.version_id JOIN note_members m ON m.note_id = v.note_id WHERE f.blob_id = ? AND m.user_id = ?)`,
		int64(blobID), int64(uid), int64(blobID), int64(uid)).Scan(&now, &before)
	return now+before > 0, err
}

// NoteFileIDs lists the blobs a note holds.
func (s *Store) NoteFileIDs(ctx context.Context, noteID ids.ID) ([]ids.ID, error) {
	return s.idList(ctx, `SELECT blob_id FROM note_files WHERE note_id = ? ORDER BY created_at, blob_id`, int64(noteID))
}

// NotesOwnedBy lists the notes an account owns, with who each is shared with
// counted in: what goes when the account does.
func (s *Store) NotesOwnedBy(ctx context.Context, uid ids.ID) ([]ids.ID, error) {
	return s.idList(ctx, `SELECT id FROM notes WHERE owner_id = ? ORDER BY id`, int64(uid))
}
