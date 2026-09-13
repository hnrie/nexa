-- A subchat holds the same people as the conversation it sits in. Until now,
-- leaving or being removed from a group kept people in its subchats, and
-- deleting a conversation left its subchats behind with no parent.

-- Whoever is no longer in the parent leaves its subchats, and the people who
-- stay rotate those keys the next time one of them is online.
INSERT INTO key_flags (conv_id, needs_rotation, needs_own_key, updated_at)
  SELECT DISTINCT p.channel_id, 1, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM dm_participants p JOIN channels c ON c.id = p.channel_id
  WHERE c.type = 'subchat' AND c.parent_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dm_participants pp WHERE pp.channel_id = c.parent_id AND pp.user_id = p.user_id)
  ON CONFLICT(conv_id) DO UPDATE SET needs_rotation = 1, updated_at = excluded.updated_at;

DELETE FROM dm_participants
  WHERE channel_id IN (SELECT id FROM channels WHERE type = 'subchat' AND parent_id IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM channels c JOIN dm_participants pp ON pp.channel_id = c.parent_id
      WHERE c.id = dm_participants.channel_id AND pp.user_id = dm_participants.user_id
    );

-- Subchats whose conversation was deleted go too, the way deleting one does.
UPDATE blobs SET ref_count = max(0, ref_count - 1)
  WHERE id IN (SELECT a.blob_id FROM attachments a JOIN channels c ON c.id = a.channel_id WHERE c.type = 'subchat' AND c.parent_id IS NULL);
DELETE FROM key_grants WHERE conv_id IN (SELECT id FROM channels WHERE type = 'subchat' AND parent_id IS NULL);
DELETE FROM key_epochs WHERE conv_id IN (SELECT id FROM channels WHERE type = 'subchat' AND parent_id IS NULL);
DELETE FROM key_flags WHERE conv_id IN (SELECT id FROM channels WHERE type = 'subchat' AND parent_id IS NULL);
DELETE FROM channels WHERE type = 'subchat' AND parent_id IS NULL;
