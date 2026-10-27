import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import publish_desktop


class ReleaseAdmissionTest(unittest.TestCase):
    def test_signed_feeds_preserve_every_legacy_update_feed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            signer = root / "desktop/scripts/sign-release.mjs"
            signer.parent.mkdir(parents=True)
            shutil.copy2(publish_desktop.ROOT / "desktop/scripts/sign-release.mjs", signer)
            pinned = root / "desktop/src/main/update/releaseKey.ts"
            pinned.parent.mkdir(parents=True)
            key = root / "private-test-key.pem"
            # Ephemeral test identity: never sign fixtures with a release key.
            subprocess.run(["node", "-e", """
                const fs=require('node:fs'), c=require('node:crypto');
                const pair=c.generateKeyPairSync('ed25519');
                fs.writeFileSync(process.argv[1], pair.privateKey.export({type:'pkcs8',format:'pem'}), {mode:0o600});
                fs.writeFileSync(process.argv[2], pair.publicKey.export({type:'spki',format:'pem'}));
            """, str(key), str(pinned)], check=True)
            dist, target = root / "build", root / "published"
            dist.mkdir(); target.mkdir()
            (dist / "nexa-Setup-1.2.8-win-x64.exe").write_bytes(b"fixture")
            for source in publish_desktop.FEEDS:
                (dist / source).write_text("version: 1.2.8\n")
            for legacy in publish_desktop.LEGACY_FEEDS:
                (target / legacy).write_text("version: 1.2.7\n")
            with patch.object(publish_desktop, "ROOT", root), patch.dict(os.environ, {"NEXA_DESKTOP_SIGNING_KEY": str(key)}), patch("sys.argv", ["publish_desktop.py", str(dist), "--to", str(target)]), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(publish_desktop.main(), 0)
            self.assertEqual(json.loads((target / "manifest.json").read_text())["version"], "1.2.8")
            for legacy in publish_desktop.LEGACY_FEEDS:
                self.assertEqual((target / legacy).read_text(), "version: 1.2.7\n")
            for feed in publish_desktop.FEEDS.values():
                self.assertEqual((target / feed).read_text(), "version: 1.2.8\n")
                subprocess.run(["node", "-e", """
                    const fs=require('node:fs'), c=require('node:crypto');
                    const [pub,dir,feed]=process.argv.slice(1);
                    const body=fs.readFileSync(dir+'/'+feed);
                    const message=Buffer.concat([Buffer.from('nexa-desktop-update/v1\\0'+feed+'\\0'),body]);
                    if(!c.verify(null,message,c.createPublicKey(fs.readFileSync(pub)),Buffer.from(fs.readFileSync(dir+'/'+feed+'.sig','utf8').trim(),'base64'))) process.exit(1);
                """, str(pinned), str(target), feed], check=True)

    def test_failed_copy_preserves_the_previous_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / "source", root / "release.exe"
            source.write_bytes(b"new complete artifact")
            target.write_bytes(b"previous complete artifact")

            def interrupted_copy(src, dest):
                Path(dest).write_bytes(b"partial")
                raise OSError("simulated disk failure")

            with patch.object(publish_desktop.shutil, "copy2", interrupted_copy):
                with self.assertRaises(OSError):
                    publish_desktop.atomic_copy(source, target)
            self.assertEqual(target.read_bytes(), b"previous complete artifact")
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["release.exe", "source"])
            publish_desktop.atomic_copy(source, target)
            self.assertEqual(target.read_bytes(), source.read_bytes())

    def test_stale_platform_manifest_is_refused_before_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dist, target = root / "build", root / "published"
            dist.mkdir()
            (dist / "nexa-Setup-1.2.8-win-x64.exe").write_bytes(b"fixture")
            (dist / "latest.yml").write_text("version: 1.2.7\n")
            with patch("sys.argv", ["publish_desktop.py", str(dist), "--to", str(target)]), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(publish_desktop.main(), 1)
            self.assertFalse(target.exists())

    def test_missing_original_signing_key_refuses_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dist, target = root / "build", root / "published"
            dist.mkdir()
            (dist / "nexa-Setup-1.2.8-win-x64.exe").write_bytes(b"fixture")
            (dist / "latest.yml").write_text("version: 1.2.8\n")
            with patch("sys.argv", ["publish_desktop.py", str(dist), "--to", str(target)]), patch.dict("os.environ", {"NEXA_DESKTOP_SIGNING_KEY": str(root / "missing-key.pem")}):
                self.assertEqual(publish_desktop.main(), 1)
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
