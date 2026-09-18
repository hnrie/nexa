#!/usr/bin/env python3
"""A throwaway chatd with the Cloudflare SFU switched on.

Calls on it take the path they take in production, through Cloudflare's
Realtime SFU, instead of going peer to peer like the e2e suite's. The Android
1.0.2 crash only showed up this way: a debug build, or a call between two
browsers on this machine, was clean.

  tools/device/sfu_server.py        prints BASE, EMULATOR, PID and DIR, runs until ^C

The credentials are read from chatd.env and only handed to the child's
environment. The data directory is kept (DIR) so a crashed run can be read.
"""
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

env = {}
for line in (ROOT / "chatd.env").read_text().splitlines():
    m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
    if m and m.group(2):
        env[m.group(1)] = m.group(2)

missing = [k for k in ("REALTIME_APP_ID", "REALTIME_APP_SECRET") if k not in env]
if missing:
    raise SystemExit(f"no SFU credentials in chatd.env: {missing}")
for k in ("REALTIME_APP_ID", "REALTIME_APP_SECRET", "TURN_KEY_ID", "TURN_API_TOKEN"):
    if k in env:
        os.environ[k] = env[k]
# the app's own STUN default, not the "none" the e2e suite uses for two local browsers
os.environ["STUN_URLS"] = env.get("STUN_URLS", "stun:stun.cloudflare.com:3478")

from e2e import Server  # noqa: E402

srv = Server(keep=True)
print("BASE", srv.base)
print("EMULATOR", srv.base.replace("127.0.0.1", "10.0.2.2"))
print("PID", srv.proc.pid)
print("DIR", srv.dir)
sys.stdout.flush()
try:
    while srv.proc.poll() is None:
        time.sleep(5)
    print("chatd exited with", srv.proc.returncode, "; see", srv.dir / "chatd.log")
except KeyboardInterrupt:
    pass
finally:
    srv.stop()
