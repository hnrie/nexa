#!/usr/bin/env python3
"""A throwaway chatd with the Cloudflare SFU switched on.

Calls on it take the path they take in production, through Cloudflare's
Realtime SFU, instead of going peer to peer like the e2e suite's. The Android
1.0.2 crash only showed up this way: a debug build, or a call between two
browsers on this machine, was clean.

  tools/device/sfu_server.py        prints BASE, EMULATOR, PID and DIR, runs until ^C
  tools/device/sfu_server.py --reuse DIR --port 56309 [--chatd BIN] [--web DIST]
                                    the same server again, on a new build: its
                                    accounts, sessions and messages are kept, so
                                    a phone signed in to it stays signed in

The credentials are read from chatd.env and only handed to the child's
environment. The data directory is kept (DIR) so a crashed run can be read.
"""
import argparse
import os
import re
import subprocess
import sys
import time
import urllib.request
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

ap = argparse.ArgumentParser()
ap.add_argument("--reuse", help="an existing server directory (the DIR a first run printed)")
ap.add_argument("--port", type=int, help="with --reuse: the port it listened on")
ap.add_argument("--chatd", help="the binary to run (default bin/chatd)")
ap.add_argument("--web", help="the web build to serve (default web/dist)")
args = ap.parse_args()
if args.chatd:
    os.environ["E2E_CHATD"] = args.chatd
if args.web:
    os.environ["E2E_WEB_DIST"] = args.web

if args.reuse:
    if not args.port:
        raise SystemExit("--reuse needs --port")
    run_dir = Path(args.reuse)
    base = f"http://127.0.0.1:{args.port}"
    child_env = dict(
        os.environ, LISTEN=f"127.0.0.1:{args.port}", DATA_DIR=str(run_dir / "data"),
        WEB_DIST=os.environ.get("E2E_WEB_DIST") or str(ROOT / "web/dist"), PUBLIC_URL=base,
        LOG_LEVEL="warn", MAX_UPLOAD_BYTES=str(1 << 30), GUEST_LINKS_P2P="1",
    )
    log = open(run_dir / "chatd.log", "a")
    proc = subprocess.Popen([os.environ.get("E2E_CHATD") or str(ROOT / "bin/chatd")], env=child_env, stdout=log, stderr=subprocess.STDOUT, cwd=str(run_dir))
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/health", timeout=1)
            break
        except Exception:
            time.sleep(0.1)
    else:
        raise SystemExit("chatd did not start; see " + str(run_dir / "chatd.log"))
    print("BASE", base)
    print("EMULATOR", base.replace("127.0.0.1", "10.0.2.2"))
    print("PID", proc.pid)
    print("DIR", run_dir)
    sys.stdout.flush()
    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
    raise SystemExit(0)

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
