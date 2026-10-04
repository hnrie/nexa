#!/usr/bin/env bash
# Backs up everything in data/ that a restore needs, and says what it wrote or
# why it could not:
#   - the database: a consistent copy taken with SQLite's online backup, safe
#     while chatd is running, checked before it counts;
#   - server.secret: the key every two-factor secret is sealed with. A restore
#     without it locks every account that has two-factor sign-in on out for
#     good, backup codes included — it is the one file here nothing can rebuild;
#   - everything else in data/: the uploaded files (less media/tmp, uploads
#     still arriving, and media/variants, the resized copies chatd makes again
#     on demand), the desktop app's downloads, and the game and music pictures.
#
#   bash backup.sh                     backup/chat-STAMP.db, secret-STAMP, files-STAMP.tgz
#   BACKUP_DIR=/mnt/other bash backup.sh
#
# Only the newest backup is kept: once a new one has been written in full,
# every older one in the backup folder is deleted, and a run that fails part
# way deletes nothing. backup/ is on the same disk as the live data, so it
# covers a bad deploy or a mistake, not a dead disk: copy it somewhere else too.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
umask 077

die() { echo "backup: $*" >&2; exit 1; }

# The same settings chatd reads: the environment first, then chatd.env.
env_get() {
  local k="$1" d="$2" v="${!1:-}"
  if [ -z "$v" ] && [ -f chatd.env ]; then
    v="$(grep -E "^${k}=" chatd.env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  fi
  echo "${v:-$d}"
}
DATA_DIR="$(env_get DATA_DIR ./data)"
DATABASE_URL="$(env_get DATABASE_URL '')"
BACKUP_DIR="${BACKUP_DIR:-backup}"

[ -z "$DATABASE_URL" ] || die "DATABASE_URL is set, so the database lives in Postgres; back that up with pg_dump. This script copies SQLite only."
command -v sqlite3 >/dev/null || die "sqlite3 not found"
command -v tar >/dev/null || die "tar not found"
# sqlite3 would create an empty database at a wrong path and back that up
[ -f "$DATA_DIR/chat.db" ] || die "no database at $DATA_DIR/chat.db"
[ -f "$DATA_DIR/server.secret" ] || die "no $DATA_DIR/server.secret next to the database; a backup without it could not restore two-factor sign-in"
[ -d "$DATA_DIR/media" ] || die "no $DATA_DIR/media"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
db="$BACKUP_DIR/chat-$stamp.db"
secret="$BACKUP_DIR/secret-$stamp"
files="$BACKUP_DIR/files-$stamp.tgz"
for f in "$db" "$secret" "$files"; do
  [ ! -e "$f" ] || die "$f exists already; run again in a second"
done
# A backup that stops half way, for whatever reason, leaves nothing behind
# that looks like one.
complete=0
trap '[ "$complete" = 1 ] || rm -f "$db" "$secret" "$files"' EXIT

sqlite3 "$DATA_DIR/chat.db" ".backup '$db'"
check="$(sqlite3 "$db" 'PRAGMA quick_check;')"
[ "$check" = ok ] || die "the copy of the database failed its check: $check"

cp "$DATA_DIR/server.secret" "$secret"
cmp -s "$DATA_DIR/server.secret" "$secret" || die "the copy of server.secret does not match the original"

# The database and the secret are copied above, the live files of the database
# could be torn mid-write, and media/tmp and media/variants are not needed to
# restore (uploads still arriving, and resized copies chatd makes again).
set +e
tar czf "$files" -C "$DATA_DIR" \
  --exclude=./chat.db --exclude=./chat.db-wal --exclude=./chat.db-shm --exclude=./server.secret \
  --exclude=./media/tmp --exclude=./media/variants .
status=$?
set -e
if [ "$status" -ne 0 ]; then
  # GNU tar says 1 when a file changed while it was read, which is an upload
  # arriving during the backup: that file is not one the database copy knows.
  if [ "$status" -eq 1 ] && tar --version 2>/dev/null | grep -q 'GNU tar'; then
    echo "backup: note: files changed while being copied (uploads arriving); the copy is still whole" >&2
  else
    die "tar failed (status $status); nothing was kept from this run"
  fi
fi
gzip -t "$files" || die "the archive of data/ does not read back"
complete=1

# Only now that a whole backup exists: every older one goes, so the backup
# folder only ever holds the newest. media-*.tgz is what the uploads archive
# was called before it held the rest of data/ too. Anything not named like a
# backup this script writes is left alone.
for old in "$BACKUP_DIR"/chat-[0-9]*.db "$BACKUP_DIR"/secret-[0-9]* "$BACKUP_DIR"/files-[0-9]*.tgz "$BACKUP_DIR"/media-[0-9]*.tgz; do
  [ -f "$old" ] || continue
  case "$old" in "$db" | "$secret" | "$files") continue ;; esac
  rm -f -- "$old"
done

echo "backup written:"
du -h "$db" "$secret" "$files"
echo "older backups in $BACKUP_DIR/ were deleted. It is on the same disk as the data: copy it somewhere else too."
