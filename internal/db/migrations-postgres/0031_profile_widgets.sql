-- Profile widgets (internal/api/widgets.go): the games someone loves, plays
-- and wants to play, and cards they make themselves, shown on their profile
-- in the order they put them. JSON the server writes one way; empty is none.
-- Pictures a widget shows are public blobs of kind 'widget', each held by
-- one reference for as long as a widget names it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS widgets TEXT NOT NULL DEFAULT '';
