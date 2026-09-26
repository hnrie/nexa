-- Who may start a direct message now defaults to friends and people who share
-- a server with you ('friends_servers') instead of anyone. An account that
-- picked Everyone cannot be told apart from one that never changed the old
-- default, so both move; anyone can pick Everyone again in Settings.
-- The column's own default stays as it was (SQLite cannot change one in
-- place): every account is created with the value written out, by
-- store.CreateUser.
UPDATE users SET dm_privacy = 'friends_servers' WHERE dm_privacy = 'everyone';
