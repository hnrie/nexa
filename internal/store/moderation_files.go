package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// CaseBlobKind is the kind of blob a case thread's files are stored as. It is
// not a public kind, so /media/{kind}/{id} never serves one: only the case's
// member and the staff can fetch them, through /media/cases/{id}.
const CaseBlobKind = "case"

// MaxCaseFiles is how many files one line of a case's thread carries.
const MaxCaseFiles = 4

// ErrCaseClosed means a case's thread was written in after it was closed.
// Once staff close a case nobody writes in it until staff open it again.
var ErrCaseClosed = errors.New("case closed")

// ErrCaseFile means a file named for a line is not one its writer uploaded for
// a case and has not sent with anything yet.
var ErrCaseFile = errors.New("case file")

// CaseFile is a picture or recording sent in a case's thread.
type CaseFile struct {
	MessageID ids.ID `json:"-"`
	BlobID    ids.ID `json:"id"`
	Name      string `json:"name"`
	Mime      string `json:"mime"`
	Size      int64  `json:"size"`
	Width     *int   `json:"width"`
	Height    *int   `json:"height"`
}

// attachCaseFilesTx takes the files a new line names: each must be a case
// file its writer uploaded and has not sent before. Their details come from
// the blobs themselves, never from what the writer said about them.
func attachCaseFilesTx(ctx context.Context, tx *db.Tx, m *ModMessage, files []CaseFile) error {
	if len(files) > MaxCaseFiles {
		return ErrCaseFile
	}
	m.Files = nil
	for i, f := range files {
		res, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ? AND kind = ? AND owner_id = ? AND ref_count = 0`,
			int64(f.BlobID), CaseBlobKind, int64(m.AuthorID))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrCaseFile
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO mod_message_files (message_id, case_id, blob_id, position, name) VALUES (?,?,?,?,?)`,
			int64(m.ID), int64(m.CaseID), int64(f.BlobID), i, f.Name); err != nil {
			if db.IsUniqueViolation(err) {
				return ErrCaseFile
			}
			return err
		}
		got := CaseFile{MessageID: m.ID, BlobID: f.BlobID, Name: f.Name}
		var w, h sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT mime, size, width, height FROM blobs WHERE id = ?`, int64(f.BlobID)).Scan(&got.Mime, &got.Size, &w, &h); err != nil {
			return err
		}
		got.Width, got.Height = intPtr(w), intPtr(h)
		m.Files = append(m.Files, got)
	}
	return nil
}

// withCaseFiles fills in the files of the lines given, which may come from
// several cases.
func (s *Store) withCaseFiles(ctx context.Context, msgs []*ModMessage) error {
	if len(msgs) == 0 {
		return nil
	}
	byID := make(map[ids.ID]*ModMessage, len(msgs))
	list := make([]ids.ID, 0, len(msgs))
	for _, m := range msgs {
		if m.Kind == ModMsgSystem {
			continue
		}
		byID[m.ID] = m
		list = append(list, m.ID)
	}
	for start := 0; start < len(list); start += 200 {
		chunk := list[start:min(start+200, len(list))]
		rows, err := s.db.R.QueryContext(ctx, `SELECT f.message_id, f.blob_id, f.name, b.mime, b.size, b.width, b.height
			FROM mod_message_files f JOIN blobs b ON b.id = f.blob_id
			WHERE f.message_id IN (`+placeholders(len(chunk))+`) ORDER BY f.message_id, f.position`, idArgs(chunk)...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var f CaseFile
			var w, h sql.NullInt64
			if err := rows.Scan(&f.MessageID, &f.BlobID, &f.Name, &f.Mime, &f.Size, &w, &h); err != nil {
				rows.Close()
				return err
			}
			f.Width, f.Height = intPtr(w), intPtr(h)
			if m := byID[f.MessageID]; m != nil {
				m.Files = append(m.Files, f)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}
	return nil
}

// CaseFileOwner says whose case a thread file belongs to, and whether it has
// been sent: the member the case is about, or, before it is sent, whoever
// uploaded it. Anything that is not a case file is not found.
func (s *Store) CaseFileOwner(ctx context.Context, blobID ids.ID) (member ids.ID, sent bool, err error) {
	var who sql.NullInt64
	err = s.db.R.QueryRowContext(ctx, `SELECT c.user_id FROM mod_message_files f JOIN mod_cases c ON c.id = f.case_id WHERE f.blob_id = ?`, int64(blobID)).Scan(&who)
	if err == nil && who.Valid {
		return ids.ID(who.Int64), true, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, false, err
	}
	var up sql.NullInt64
	err = s.db.R.QueryRowContext(ctx, `SELECT owner_id FROM blobs WHERE id = ? AND kind = ?`, int64(blobID), CaseBlobKind).Scan(&up)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !up.Valid) {
		return 0, false, ErrNotFound
	}
	if err != nil {
		return 0, false, err
	}
	return ids.ID(up.Int64), false, nil
}
