#!/usr/bin/env bash
# Makes a consistent backup of the chat database (safe under WAL) and media.
#   bash backup.sh            -> backup/chat-YYYYmmdd-HHMMSS.db + media tarball
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p backup
stamp="$(date +%Y%m%d-%H%M%S)"
command -v sqlite3 >/dev/null || { echo "sqlite3 not found" >&2; exit 1; }
sqlite3 data/chat.db ".backup 'backup/chat-$stamp.db'"
tar czf "backup/media-$stamp.tgz" -C data media 2>/dev/null || true
chmod 600 backup/chat-$stamp.db "backup/media-$stamp.tgz" 2>/dev/null || true
echo "backup/chat-$stamp.db and backup/media-$stamp.tgz written"
