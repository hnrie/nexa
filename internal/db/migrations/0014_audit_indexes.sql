-- Indexes for the lookups that went through whole tables: the hourly sweep of
-- deleted accounts and the purge behind it ask "does this account still own
-- anything here" of a dozen tables, and every blob the garbage collector
-- removes makes the database check each table that could point at it.
CREATE INDEX IF NOT EXISTS reactions_user ON reactions(user_id);
CREATE INDEX IF NOT EXISTS pins_message ON pins(message_id);
CREATE INDEX IF NOT EXISTS sticker_installs_pack ON sticker_installs(pack_id);
CREATE INDEX IF NOT EXISTS recent_stickers_sticker ON recent_stickers(sticker_id);
CREATE INDEX IF NOT EXISTS invites_inviter ON invites(inviter_id);
CREATE INDEX IF NOT EXISTS guest_links_creator ON guest_links(creator_id);
CREATE INDEX IF NOT EXISTS poll_votes_user ON poll_votes(user_id);
CREATE INDEX IF NOT EXISTS bans_user ON bans(user_id);
CREATE INDEX IF NOT EXISTS channel_overwrites_target ON channel_overwrites(target_id);
CREATE INDEX IF NOT EXISTS channels_owner ON channels(owner_id);
CREATE INDEX IF NOT EXISTS attachments_channel ON attachments(channel_id);
CREATE INDEX IF NOT EXISTS uploads_user ON uploads(user_id);
CREATE INDEX IF NOT EXISTS blobs_owner ON blobs(owner_id);
CREATE INDEX IF NOT EXISTS users_avatar ON users(avatar_id);
CREATE INDEX IF NOT EXISTS users_banner ON users(banner_id);
CREATE INDEX IF NOT EXISTS servers_icon ON servers(icon_id);
CREATE INDEX IF NOT EXISTS servers_banner ON servers(banner_id);
CREATE INDEX IF NOT EXISTS server_members_avatar ON server_members(avatar_id);
CREATE INDEX IF NOT EXISTS roles_icon ON roles(icon_id);
CREATE INDEX IF NOT EXISTS channels_icon ON channels(icon_id);
CREATE INDEX IF NOT EXISTS emojis_blob ON emojis(blob_id);
CREATE INDEX IF NOT EXISTS stickers_blob ON stickers(blob_id);

-- A member's permission overwrites used to outlive their membership, waiting
-- to let them back into private channels if they ever returned. Leaving now
-- takes them along; these are the ones left from before.
DELETE FROM channel_overwrites WHERE target_type = 'member' AND NOT EXISTS (
  SELECT 1 FROM channels c JOIN server_members m ON m.server_id = c.server_id
  WHERE c.id = channel_overwrites.channel_id AND m.user_id = channel_overwrites.target_id
);
