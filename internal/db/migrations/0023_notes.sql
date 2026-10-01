-- Notes: documents people keep for themselves and write with others.
--
-- A note is end-to-end encrypted like a message. It has a key of its own,
-- made on the device that creates it; `head` (the title and the first lines,
-- for the list) and `body` (the note and what its files are) are sealed with
-- that key, and the key is sealed to each person who may read the note
-- (note_members.key_sealed). The server keeps who may read and write, and
-- which version a save was made from; it never sees a word of a note.
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  head TEXT NOT NULL,
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,       -- counts saves; a save names the version it was made from
  key_epoch INTEGER NOT NULL DEFAULT 0,     -- counts the note's keys; it gets a new one when someone is taken out of it
  edited_by INTEGER,                        -- who saved last
  needs_rekey INTEGER NOT NULL DEFAULT 0,    -- someone who held the key is out of the note: its owner's app gives it a new one
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notes_owner ON notes(owner_id);

CREATE TABLE note_members (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role INTEGER NOT NULL,                    -- 1 reads, 2 edits, 3 owns
  key_sealed TEXT NOT NULL,                 -- the note's key, sealed to this account's public key
  added_by INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, user_id)
);
CREATE INDEX note_members_user ON note_members(user_id);

-- An invitation to a note waits here until the person asked accepts or
-- declines. It already carries the note's key, sealed to them, so accepting
-- needs nobody else to be online.
CREATE TABLE note_invites (
  id INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role INTEGER NOT NULL,
  key_sealed TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (note_id, to_id)
);
CREATE INDEX note_invites_to ON note_invites(to_id);

-- A share link. The link is "/note/{token}#{key}": the server knows the token
-- by its hash and never sees the part after the #, which is what opens
-- key_wrapped into the note's key. link_sealed is the whole link under the
-- note's key, so the note's owner can copy it again from any device.
CREATE TABLE note_links (
  id INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role INTEGER NOT NULL,                    -- what joining through it gives: 1 reads, 2 edits
  key_wrapped TEXT NOT NULL,
  link_sealed TEXT NOT NULL,
  created_by INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX note_links_note ON note_links(note_id);

-- The files a note holds: each is a reference on its blob, given back when
-- the note lets the file go or is deleted.
CREATE TABLE note_files (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  blob_id INTEGER NOT NULL REFERENCES blobs(id) ON DELETE CASCADE,
  added_by INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, blob_id)
);
CREATE INDEX note_files_blob ON note_files(blob_id);

-- Earlier states of a note, to look back through and to restore. One is kept
-- when writing starts again after a pause, and every few minutes while it
-- goes on, so the history is a note's drafts rather than its every keystroke.
-- Each is sealed as the note was at the time (key_epoch says with which key).
CREATE TABLE note_versions (
  id INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,                 -- the version number this state had
  head TEXT NOT NULL,
  body TEXT NOT NULL,
  key_epoch INTEGER NOT NULL,
  edited_by INTEGER,                        -- who saved it
  saved_at INTEGER NOT NULL,                -- when it was saved
  created_at INTEGER NOT NULL               -- when it was set aside
);
CREATE INDEX note_versions_note ON note_versions(note_id, id);

-- The files an earlier state showed. Each is a reference on its blob, so a
-- picture taken out of the note since is still there when the state is
-- looked at or restored.
CREATE TABLE note_version_files (
  version_id INTEGER NOT NULL REFERENCES note_versions(id) ON DELETE CASCADE,
  blob_id INTEGER NOT NULL REFERENCES blobs(id) ON DELETE CASCADE,
  PRIMARY KEY (version_id, blob_id)
);
CREATE INDEX note_version_files_blob ON note_version_files(blob_id);

-- A note's earlier keys, each sealed with the key that replaced it, so that
-- whoever holds the note's key now can open the states sealed before it
-- changed. Someone taken out of the note holds the older keys already and
-- none of the newer ones.
CREATE TABLE note_keys (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,                   -- the key this row holds
  wrapped TEXT NOT NULL,                    -- sealed with the key of epoch + 1
  PRIMARY KEY (note_id, epoch)
);
