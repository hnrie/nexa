-- How someone's display name is drawn (internal/api/name_style.go): a font,
-- an effect and its colours, as JSON the server writes one way. Empty is the
-- app's own font in the usual colour. Public like the rest of a profile.
ALTER TABLE users ADD COLUMN name_style TEXT NOT NULL DEFAULT '';
