-- A finished upload remembers the blob it became, so asking to finish it a
-- second time (the reply to the first was lost) gives the same answer rather
-- than throwing the whole transfer away.
ALTER TABLE uploads ADD COLUMN blob_id INTEGER;
