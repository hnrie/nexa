-- A friend request can carry a short note from whoever sent it ("Hi, it's Sam
-- from the climbing gym"). The sender's device seals it to the recipient's
-- identity key, so this holds only that sealed box (base64), and only on the
-- recipient's 'incoming' row. Anything that changes a pair's type (accepting,
-- blocking, sending again) empties it; a cancelled request takes its rows along.
ALTER TABLE relationships ADD COLUMN request_note TEXT NOT NULL DEFAULT '';
