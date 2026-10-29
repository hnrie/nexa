"""Host scheduling arithmetic and reboot guard, without reboot privileges."""
import importlib.util
from pathlib import Path
import json
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("schedule", ROOT / "deploy/maintenance-schedule.py")
schedule = importlib.util.module_from_spec(spec)
spec.loader.exec_module(schedule)


class MaintenanceTests(unittest.TestCase):
    def test_boot_and_skipped_reboot_deadlines(self):
        self.assertEqual(schedule.deadline("boot", 1_000_000, 3600), 1_169_200_000)
        self.assertEqual(schedule.deadline("next", 1_000_000, 3600), 1_172_800_000)
        with self.assertRaises(ValueError):
            schedule.deadline("invalid", 0, 0)

    def test_publisher_writes_readable_atomic_json(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory, "schedule.json")
            subprocess.run(["python3", str(ROOT / "deploy/maintenance-schedule.py"), "next", str(target)], check=True)
            self.assertGreater(json.loads(target.read_text())["reboot_at"], 0)
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)
            self.assertFalse(target.with_suffix(".tmp").exists())

    def test_reboot_guard_dry_run_idle_and_busy(self):
        with tempfile.TemporaryDirectory() as directory:
            for busy in (False, True):
                for name, code in {"systemctl": 0 if busy else 1, "pgrep": 1, "logger": 0}.items():
                    p = Path(directory, name)
                    p.write_text(f"#!/bin/sh\nexit {code}\n")
                    p.chmod(0o755)
                result = subprocess.run(["/bin/bash", str(ROOT / "deploy/safe-maintenance-reboot.sh")], env={**os.environ, "PATH": directory, "DRY_RUN": "1"}, capture_output=True, text=True)
                self.assertEqual(result.returncode, 2 if busy else 0)
                self.assertIn("would wait" if busy else "would reboot", result.stdout)


if __name__ == "__main__":
    unittest.main()
