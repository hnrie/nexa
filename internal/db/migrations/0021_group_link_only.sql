-- Whether friends may add an account to a group chat directly. With
-- group_link_only set it joins group chats only from an invite link someone
-- sends it, and friends see it as Link Only. Off (friends may add) by default.
ALTER TABLE users ADD COLUMN group_link_only INTEGER NOT NULL DEFAULT 0;
-- Who added this member to the group directly, for the note from Nexa that
-- only the member sees ("Sam added you to this group because you're friends").
-- Empty for whoever joined from a link, made the group or was in it before
-- this, and emptied again once the member dismisses the note.
ALTER TABLE dm_participants ADD COLUMN add_notice_by INTEGER;
