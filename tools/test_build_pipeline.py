"""Exercise make build in isolation, without pulling or deploying real artifacts."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent


class BuildPipelineTests(unittest.TestCase):
    def run_build(self, service="loaded", fail="", test=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copy(ROOT / "Makefile", root / "Makefile")
            for name in ("bin", "web", "commands"):
                (root / name).mkdir()
            (root / "bin/chatd").write_text("old server")
            command = root / "commands/stub"
            command.write_text('''#!/bin/sh
name=${0##*/}
case "$name" in
git) case "$1" in describe) echo test-version; exit 0;; esac; event=pull;;
go) case "$1" in
    build) event=server;;
    vet) event=vet;;
    test) event=test-go;;
    esac;;
systemctl) case "$1" in
    show) echo "$SERVICE_STATE"; exit 0;;
    restart) event=restart;;
    is-active) event=active;;
    esac;;
sudo) exec "$@";;
npm) event="npm-$1";;
python3) case "$1" in
    *android*) event=android;;
    *desktop*) event=desktop;;
    esac;;
esac
echo "$event" >> "$EVENT_LOG"
[ "$FAIL_EVENT" != "$event" ] || exit 1
if [ "$event" = server ]; then echo new-server > bin/chatd.next; fi
''')
            command.chmod(0o755)
            for name in ("git", "go", "systemctl", "sudo", "npm", "python3"):
                (root / "commands" / name).symlink_to(command)
            log = root / "events"
            env = dict(os.environ, EVENT_LOG=str(log), SERVICE_STATE=service,
                       FAIL_EVENT=fail, PATH=str(root / "commands") + os.pathsep + os.environ["PATH"])
            # NODE_BIN is first on PATH in the Makefile and passes to sub-makes.
            result = subprocess.run(
                [shutil.which("make"), "-j8", "build", f"NODE_BIN={root / 'commands'}",
                 f"TEST={int(test)}"], cwd=root, env=env, capture_output=True, text=True)
            events = log.read_text().splitlines() if log.exists() else []
            previous = (root / "bin/chatd.prev")
            if "server" in events and fail != "server":
                self.assertEqual(previous.read_text(), "old server")
            return result, events

    def test_server_active_before_clients_even_with_parallel_make(self):
        result, events = self.run_build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(events, ["pull", "server", "restart", "active",
                                  "npm-ci", "npm-run", "android", "desktop"])

    def test_skip_missing_service_or_unavailable_systemd(self):
        for state in ("not-found", ""):
            with self.subTest(state=state):
                result, events = self.run_build(service=state)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(events, ["pull", "server", "npm-ci", "npm-run",
                                          "android", "desktop"])

    def test_failures_stop_later_steps(self):
        sequence = ["pull", "server", "restart", "active", "npm-ci", "npm-run",
                    "android", "desktop"]
        for fail in sequence:
            with self.subTest(fail=fail):
                result, events = self.run_build(fail=fail)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(events, sequence[:sequence.index(fail) + 1], result.stdout + result.stderr)

    def test_optional_tests_finish_before_server(self):
        result, events = self.run_build(test=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(events[0], "pull")
        self.assertLess(events.index("test-go"), events.index("server"))
        self.assertLess(events.index("npm-test"), events.index("server"))
        self.assertEqual(events.count("npm-run"), 2)  # typecheck and build
        self.assertEqual(events[-6:], ["restart", "active", "npm-ci", "npm-run",
                                      "android", "desktop"])


if __name__ == "__main__":
    unittest.main()
