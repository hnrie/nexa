#!/usr/bin/env python3
"""Publish the deadline used by the matching systemd reboot timer (no app secrets)."""
import json
import os
from pathlib import Path
import sys
import time


def deadline(mode, now, uptime):
    if mode not in ("boot", "next"):
        raise ValueError("expected boot or next")
    return round((now + 48 * 3600 - (uptime if mode == "boot" else 0)) * 1000)


def main():
    mode, target = sys.argv[1:]
    target = Path(target)
    # systemd's OnBootSec uses CLOCK_MONOTONIC unless WakeSystem is enabled.
    at = deadline(mode, time.time(), time.clock_gettime(time.CLOCK_MONOTONIC))
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps({"reboot_at": at}) + "\n")
    temporary.chmod(0o644)
    os.replace(temporary, target)


if __name__ == "__main__":
    main()
