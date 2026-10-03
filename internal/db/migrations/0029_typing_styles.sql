-- How someone's "is typing…" looks to everyone else (internal/api/
-- typing_style.go): up to three emoji, how they move, and the words that
-- follow the name, as JSON the server writes one way. Empty is the plain
-- "is typing…". Public like the rest of a profile, and sent with it.
ALTER TABLE users ADD COLUMN typing_style TEXT NOT NULL DEFAULT '';
