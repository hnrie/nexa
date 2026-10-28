ALTER TABLE servers ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0;
CREATE INDEX channels_server_nsfw ON channels(server_id, nsfw);
