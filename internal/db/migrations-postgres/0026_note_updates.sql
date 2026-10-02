-- Notes written together, change by change. Each device keeps a note as a
-- CRDT, which puts everyone's edits together the same way on every device,
-- and sends each change the moment it is made, sealed with the note's key:
-- the server numbers it, keeps it here and passes it on to the note's other
-- members, and can read none of it. Every few seconds of writing a device
-- also saves the whole note (notes.body, as before), which holds every change
-- up to crdt_upto; the changes it holds are then let go from here, so this
-- table only ever has the latest few.
ALTER TABLE notes ADD COLUMN crdt_seq BIGINT NOT NULL DEFAULT 0;   -- the number the newest change was given
ALTER TABLE notes ADD COLUMN crdt_upto BIGINT NOT NULL DEFAULT 0;  -- the changes the saved note already holds

CREATE TABLE IF NOT EXISTS note_updates (
  note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  sealed TEXT NOT NULL,
  user_id BIGINT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (note_id, seq)
);
