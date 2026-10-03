-- Server tags (internal/api/server_tags.go): a few letters, a badge and a
-- colour a server's admins choose, which its members can wear next to their
-- name everywhere. tag_text empty means the server has none. tag_roles is a
-- JSON list of the roles that may wear it, empty for everyone in the server;
-- tag_invite the code of the invite kept for joining from the tag, or empty.
ALTER TABLE servers ADD COLUMN tag_text TEXT NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN tag_badge TEXT NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN tag_color INTEGER;
ALTER TABLE servers ADD COLUMN tag_roles TEXT NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN tag_invite TEXT NOT NULL DEFAULT '';
-- The tag someone wears, copied from its server when they put it on, so a
-- profile is drawn from its own row wherever it goes. The server keeps the
-- copies in step: a new badge or colour reaches every wearer, and new letters,
-- leaving the server or the tag going away take it off them. tag_server_id is
-- not a foreign key: servers already point at users (owner_id), and a pointer
-- back would make the two a loop that no copy order satisfies (cmd/chatmigrate).
-- Deleting a server takes its tag off its wearers in the same transaction.
ALTER TABLE users ADD COLUMN tag_server_id INTEGER;
ALTER TABLE users ADD COLUMN tag_text TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN tag_badge TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN tag_color INTEGER;
CREATE INDEX IF NOT EXISTS users_tag_server ON users(tag_server_id);
