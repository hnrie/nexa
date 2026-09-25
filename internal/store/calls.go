package store

import (
	"context"
	"encoding/json"

	"evilion.xyz/chat/internal/ids"
)

// SealCallSummary attaches the caller's encrypted account of how a call went
// (answered or not, for how long, who picked up) to the system_call line that
// started it. Only the line's author may, only once, and nothing else about
// the line changes: it is not marked edited and no time is kept, so the
// server holds no readable call record, only ciphertext the conversation's
// members can open. It reports ErrNotFound when there is no such line, or its
// summary was already written.
func (s *Store) SealCallSummary(ctx context.Context, msgID, author ids.ID, ciphertext json.RawMessage, keyConv ids.ID, keyEpoch int) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE messages SET ciphertext = ?, key_conv_id = ?, key_epoch = ? WHERE id = ? AND author_id = ? AND type = 'system_call' AND ciphertext IS NULL`,
		string(ciphertext), int64(keyConv), keyEpoch, int64(msgID), int64(author))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
