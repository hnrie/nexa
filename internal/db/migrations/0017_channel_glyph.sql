-- A server channel's own icon, drawn where its # or speaker would be: one of
-- the app's line icons ("icon:<name>"), an emoji ("emoji:<emoji>"), or one of
-- the server's custom emoji ("custom:<emoji id>"). Empty keeps the default.
ALTER TABLE channels ADD COLUMN glyph TEXT NOT NULL DEFAULT '';
