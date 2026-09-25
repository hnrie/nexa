-- The invite an account signed up with on an invite-only instance. Signing up
-- spends one use of it, so a one-use invite lets in one account however many
-- people see the code; the account's first join through that invite then
-- rides on the use its sign-up spent instead of needing a second.
ALTER TABLE users ADD COLUMN signup_invite TEXT;
