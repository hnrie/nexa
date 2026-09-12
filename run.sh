#!/usr/bin/env bash
# Starts chatd from the repo directory. launchd runs this; it also works by hand.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[ -x bin/chatd ] || { echo "bin/chatd missing — run: make build" >&2; exit 1; }
exec ./bin/chatd -env chatd.env
