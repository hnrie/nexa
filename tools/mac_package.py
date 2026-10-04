#!/usr/bin/env python3
"""Packs the Mac apps electron-builder made on Linux into what is published.

  cd desktop && npx electron-builder --mac dir --x64 --arm64 --publish never
  python3 tools/mac_package.py [desktop/dist]

electron-builder's own Mac targets do not work here: its zip goes through 7z,
which follows the symlinks inside every .framework and breaks them, and its
disk image needs hdiutil. So for each dist/mac*/Nexa.app this:

- checks the app's ad hoc signature (desktop/sign-mac.cjs makes it as the app
  is packed) from the bytes, without trusting the tool that made it: every
  Mach-O's pages against its CodeDirectory, each bundle's Info.plist and seal
  against their slots, and every file, link and nested bundle against
  _CodeSignature/CodeResources. A bundle that fails is one macOS calls
  "damaged", so nothing is packed from it. The app must also be known by its
  bundle identifier rather than by the hash of the build, or macOS forgets
  what people allowed it (screen recording, the microphone) at every update;
- zips it with its symlinks kept (zip -y) for the updater, which unpacks it
  with ditto (desktop/src/main/update/mac.ts), and checks the unzipped copy;
- makes the disk image people download: an HFS+ volume holding the app and a
  link to /Applications (mkfs.hfsplus, mounted with sudo), compressed with
  libdmg-hfsplus's dmg (github.com/fanquake/libdmg-hfsplus), then decodes the
  image again and checks the app inside;
- and writes latest-mac.yml, which tools/publish_desktop.py publishes as
  latest-mac-2.yml.
"""
import argparse, base64, hashlib, os, plistlib, struct, subprocess, sys, tempfile, time, zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MACHO = (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe")
FAT = (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf")
CPU = {0x01000007: "x64", 0x0100000C: "arm64"}
LC_SEGMENT, LC_SEGMENT_64, LC_CODE_SIGNATURE = 0x1, 0x19, 0x1D
EMBEDDED_SIGNATURE, CODE_DIRECTORY = 0xFADE0CC0, 0xFADE0C02
# where a superblob keeps CodeDirectories: the first, and the alternates beside it
CD_SLOTS = {0, 0x1000, 0x1001, 0x1002, 0x1003, 0x1004}
LINKER_SIGNED = 0x20000
REQUIREMENTS, REQUIREMENT, DESIGNATED = 0xFADE0C01, 0xFADE0C00, 3
ALGO = {1: "sha1", 2: "sha256", 3: "sha256", 4: "sha384"}
SLOT_NAMES = {1: "Info.plist", 2: "requirements", 3: "sealed resources", 5: "entitlements", 7: "DER entitlements"}


class Damaged(Exception):
    """What macOS would find wrong with a bundle."""


def is_macho(path: Path) -> bool:
    if path.is_symlink() or not path.is_file():
        return False
    with path.open("rb") as f:
        head = f.read(8)
    # Java class files share the fat magic; a fat binary holds only a handful of slices
    return head[:4] in MACHO or (head[:4] in FAT and 0 < struct.unpack(">I", head[4:8])[0] < 20)


def slices(data: bytes):
    """The thin Mach-Os in a file, one for a thin binary."""
    if data[:4] not in FAT:
        yield data
        return
    wide = data[:4] == FAT[1]
    for i in range(struct.unpack(">I", data[4:8])[0]):
        if wide:
            _, _, off, size, _, _ = struct.unpack(">iiQQII", data[8 + i * 32 : 40 + i * 32])
        else:
            _, _, off, size, _ = struct.unpack(">iiIII", data[8 + i * 20 : 28 + i * 20])
        yield data[off : off + size]


def load_commands(s: bytes):
    header = 32 if s[:4] == MACHO[0] else 28
    at = header
    for _ in range(struct.unpack("<I", s[16:20])[0]):
        cmd, size = struct.unpack("<II", s[at : at + 8])
        yield cmd, s[at : at + size]
        at += size


def embedded_info_plist(s: bytes) -> bytes | None:
    """A Mach-O's own Info.plist (__TEXT,__info_plist), which a lone executable's signature may bind."""
    for cmd, body in load_commands(s):
        if cmd not in (LC_SEGMENT, LC_SEGMENT_64):
            continue
        wide = cmd == LC_SEGMENT_64
        nsects = struct.unpack("<I", body[64:68] if wide else body[48:52])[0]
        at = 72 if wide else 56
        for _ in range(nsects):
            sect, seg = body[at : at + 16].rstrip(b"\0"), body[at + 16 : at + 32].rstrip(b"\0")
            if wide:
                _, size, offset = struct.unpack("<QQI", body[at + 32 : at + 52])
            else:
                _, size, offset = struct.unpack("<III", body[at + 32 : at + 44])
            if seg == b"__TEXT" and sect == b"__info_plist":
                return s[offset : offset + size]
            at += 80 if wide else 68
    return None


def signature(path: Path, s: bytes) -> tuple[int, dict[int, bytes]]:
    """Where a slice's signature starts, and the blobs in it by slot."""
    sig = next((struct.unpack("<II", body[8:16]) for cmd, body in load_commands(s) if cmd == LC_CODE_SIGNATURE), None)
    if sig is None:
        raise Damaged(f"{path}: not signed")
    off, size = sig
    blob = s[off : off + size]
    magic, _, count = struct.unpack(">III", blob[:12])
    if magic != EMBEDDED_SIGNATURE:
        raise Damaged(f"{path}: no signature where the Mach-O says it is")
    blobs = {}
    for i in range(count):
        kind, at = struct.unpack(">II", blob[12 + i * 8 : 20 + i * 8])
        blobs[kind] = blob[at : at + struct.unpack(">I", blob[at + 4 : at + 8])[0]]
    return off, blobs


def designated_requirement(path: Path, s: bytes) -> bytes | None:
    """The compiled designated requirement a slice's signature names, if it names one."""
    reqs = signature(path, s)[1].get(2)
    if not reqs or struct.unpack(">I", reqs[:4])[0] != REQUIREMENTS:
        return None
    for i in range(struct.unpack(">I", reqs[8:12])[0]):
        kind, at = struct.unpack(">II", reqs[12 + i * 8 : 20 + i * 8])
        if kind == DESIGNATED:
            return reqs[at : at + struct.unpack(">I", reqs[at + 4 : at + 8])[0]]
    return None


def identifier_requirement(identifier: str) -> bytes:
    """`identifier "<id>"` compiled as a code requirement, as desktop/sign-mac.cjs signs the app with."""
    raw = identifier.encode()
    body = struct.pack(">III", 1, 2, len(raw)) + raw + bytes(-len(raw) % 4)
    return struct.pack(">II", REQUIREMENT, 8 + len(body)) + body


def check_macho(path: Path, info: bytes | None = None, resources: bytes | None = None) -> bytes:
    """Checks every slice's signature against the file; returns the cdhash of the first."""
    cdhash = b""
    for s in slices(path.read_bytes()):
        if s[:4] not in MACHO:
            raise Damaged(f"{path}: a slice that is not a Mach-O")
        off, blobs = signature(path, s)
        cds = [blobs[k] for k in sorted(blobs) if k in CD_SLOTS]
        if not cds:
            raise Damaged(f"{path}: no CodeDirectory")
        for cd in cds:
            magic, _, version, flags, hash_off, _, n_special, n_code, limit, hash_size, hash_type, _, page_log, _ = struct.unpack(">IIIIIIIIIBBBBI", cd[:44])
            if magic != CODE_DIRECTORY or hash_type not in ALGO:
                raise Damaged(f"{path}: a CodeDirectory that cannot be read")
            if flags & LINKER_SIGNED:
                raise Damaged(f"{path}: only the linker's stub signature")
            if version >= 0x20300 and struct.unpack(">Q", cd[56:64])[0]:
                limit = struct.unpack(">Q", cd[56:64])[0]
            if limit != off:
                raise Damaged(f"{path}: the signature covers {limit} bytes of code, not the {off} before it")
            digest = lambda b: hashlib.new(ALGO[hash_type], b).digest()[:hash_size]  # noqa: E731
            page = 1 << page_log if page_log else limit
            if n_code != -(-limit // page):
                raise Damaged(f"{path}: {n_code} page hashes for {limit} bytes")
            for i in range(n_code):
                if cd[hash_off + i * hash_size : hash_off + (i + 1) * hash_size] != digest(s[i * page : min(limit, (i + 1) * page)]):
                    raise Damaged(f"{path}: page {i} is not what was signed")
            plist = info if info is not None else embedded_info_plist(s)
            bound = {1: plist, 2: blobs.get(2), 3: resources, 5: blobs.get(5), 7: blobs.get(7)}
            for k, content in bound.items():
                slot = cd[hash_off - k * hash_size : hash_off - (k - 1) * hash_size] if k <= n_special else None
                if not slot or slot == bytes(hash_size):
                    # a bundle's own executable must bind its Info.plist and seal
                    if k in (1, 3) and (info if k == 1 else resources) is not None:
                        raise Damaged(f"{path}: the signature leaves out the bundle's {SLOT_NAMES[k]}")
                    continue
                if content is None:
                    raise Damaged(f"{path}: the signature binds {SLOT_NAMES[k]} that cannot be found")
                if slot != digest(content):
                    raise Damaged(f"{path}: its {SLOT_NAMES[k]} changed since it was signed")
        if not cdhash:
            first = struct.unpack(">B", cds[0][37:38])[0]
            cdhash = hashlib.new(ALGO[first], cds[0]).digest()[:20]
    return cdhash


def check_framework_shape(fw: Path) -> Path:
    """A framework's top level holds only Versions and links into Versions/Current; returns the version folder."""
    current = fw / "Versions" / "Current"
    if not current.is_symlink() or "/" in os.readlink(current):
        raise Damaged(f"{current}: not a link to a version beside it")
    version = fw / "Versions" / os.readlink(current)
    for entry in (fw / "Versions").iterdir():
        if entry.name not in ("Current", version.name):
            raise Damaged(f"{entry}: a framework holds one version")
    for entry in fw.iterdir():
        if entry.name != "Versions" and not (entry.is_symlink() and os.readlink(entry) == f"Versions/Current/{entry.name}"):
            raise Damaged(f"{entry}: a framework's top level holds only links into Versions/Current")
    return version


def check_bundle(bundle: Path, checked: set[Path]) -> bytes:
    """
    Checks an .app or .framework and everything nested in it; returns its
    executable's cdhash. The code it checks goes into `checked`.
    """
    if bundle.suffix == ".framework":
        root = check_framework_shape(bundle)
        info = root / "Resources" / "Info.plist"
        exe = root / plistlib.loads(info.read_bytes())["CFBundleExecutable"]
    else:
        root = bundle / "Contents"
        info = root / "Info.plist"
        exe = root / "MacOS" / plistlib.loads(info.read_bytes())["CFBundleExecutable"]
    if not os.access(exe, os.X_OK):
        raise Damaged(f"{exe}: not executable")
    seal = root / "_CodeSignature" / "CodeResources"
    if not seal.is_file():
        raise Damaged(f"{bundle}: not sealed (no _CodeSignature/CodeResources)")
    cdhash = check_macho(exe, info.read_bytes(), seal.read_bytes())
    checked.add(exe.resolve())
    sealed = plistlib.loads(seal.read_bytes()).get("files2", {})
    nested = set()
    for key, entry in sealed.items():
        target = root / key
        if "cdhash" in entry:
            if target.is_dir():
                nested.add(target)
                got = check_bundle(target, checked)
            else:
                if not os.access(target, os.X_OK):
                    raise Damaged(f"{target}: not executable")
                got = check_macho(target)
                checked.add(target.resolve())
            if got != entry["cdhash"]:
                raise Damaged(f"{target}: not the code {bundle.name} was sealed with")
        elif "symlink" in entry:
            if not target.is_symlink() or os.readlink(target) != entry["symlink"]:
                raise Damaged(f"{target}: not the link that was sealed")
        elif not target.is_file() or target.is_symlink():
            if not entry.get("optional"):
                raise Damaged(f"{target}: sealed, but missing")
        elif hashlib.sha256(target.read_bytes()).digest() != entry["hash2"]:
            raise Damaged(f"{target}: changed since it was sealed")
    # and nothing in the bundle is left out of the seal
    omitted = {exe, seal} | ({root / "Info.plist", root / "PkgInfo"} if bundle.suffix == ".app" else set())
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        links = [n for n in dirnames if (here / n).is_symlink()]
        dirnames[:] = [n for n in dirnames if (here / n) not in nested and (here / n) != seal.parent and n not in links]
        for name in filenames + links:
            p = here / name
            if p in omitted or name == ".DS_Store":
                continue
            if p.relative_to(root).as_posix() not in sealed:
                raise Damaged(f"{p}: in the bundle but not sealed")
    return cdhash


def check_app(app: Path) -> None:
    """
    The whole app: its seal, its nested bundles, every other Mach-O in it
    signed on its own, and the app known by its identifier. macOS keeps what a
    person allowed an app against its designated requirement, and an ad hoc
    signature's own is the hash of that one build, which every update changes.
    """
    checked: set[Path] = set()
    check_bundle(app, checked)
    info = plistlib.loads((app / "Contents" / "Info.plist").read_bytes())
    exe = app / "Contents" / "MacOS" / info["CFBundleExecutable"]
    want = identifier_requirement(info["CFBundleIdentifier"])
    for s in slices(exe.read_bytes()):
        if designated_requirement(exe, s) != want:
            raise Damaged(f"{exe}: not signed to be known by its identifier, so macOS would forget what people allowed it at every update")
    for dirpath, _, filenames in os.walk(app):
        for name in filenames:
            p = Path(dirpath) / name
            if p.resolve() not in checked and is_macho(p):
                check_macho(p)


def arch_of(app: Path) -> str:
    exe = app / "Contents" / "MacOS" / plistlib.loads((app / "Contents" / "Info.plist").read_bytes())["CFBundleExecutable"]
    data = exe.read_bytes()
    if data[:4] not in MACHO:
        raise SystemExit(f"{exe}: a universal binary; build x64 and arm64 apart")
    return CPU[struct.unpack("<I", data[4:8])[0]]


def sha512_b64(path: Path) -> str:
    h = hashlib.sha512()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode()


def zip_app(app: Path, out: Path) -> None:
    out.unlink(missing_ok=True)
    subprocess.run(["zip", "-q", "-y", "-r", "-9", str(out), app.name], cwd=app.parent, check=True)
    with tempfile.TemporaryDirectory(dir=out.parent) as tmp:
        subprocess.run(["unzip", "-q", str(out), "-d", tmp], check=True)
        check_app(Path(tmp) / app.name)


def udif_sha256(dmg: Path) -> tuple[str, int]:
    """Decodes a disk image made by libdmg-hfsplus back to the volume it holds; returns its sha256 and size."""
    data = dmg.read_bytes()
    koly = data[-512:]
    if koly[:4] != b"koly":
        raise SystemExit(f"{dmg}: no UDIF trailer")
    fork = struct.unpack(">Q", koly[24:32])[0]
    xml_off, xml_len = struct.unpack(">QQ", koly[216:232])
    tables = plistlib.loads(data[xml_off : xml_off + xml_len])["resource-fork"]["blkx"]
    h, at = hashlib.sha256(), 0
    for table in tables:
        mish = table["Data"]
        first, sectors, start = struct.unpack(">QQQ", mish[8:32])
        for i in range(struct.unpack(">I", mish[200:204])[0]):
            kind, _, sector, count, comp_off, comp_len = struct.unpack(">IIQQQQ", mish[204 + i * 40 : 244 + i * 40])
            if kind == 0xFFFFFFFF:
                break
            if kind == 0x7FFFFFFE:
                continue
            if first + sector != at:
                raise SystemExit(f"{dmg}: chunks out of order at sector {at}")
            chunk = data[fork + start + comp_off : fork + start + comp_off + comp_len]
            if kind == 0x80000005:
                chunk = zlib.decompress(chunk)
            elif kind in (0, 2):
                chunk = bytes(count * 512)
            elif kind != 1:
                raise SystemExit(f"{dmg}: a chunk of kind {kind:#x} this does not read")
            if len(chunk) != count * 512:
                raise SystemExit(f"{dmg}: a chunk of the wrong size at sector {at}")
            h.update(chunk)
            at += count
        # the trailer's own sector count is left at 0 by libdmg-hfsplus, so each table's is what counts
        if at != first + sectors:
            raise SystemExit(f"{dmg}: {at - first} sectors decoded of the {sectors} a table holds")
    return h.hexdigest(), at * 512


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def make_dmg(app: Path, out: Path, volume: str) -> None:
    used = sum(-(-p.stat().st_size // 4096) * 4096 for p in app.rglob("*") if p.is_file() and not p.is_symlink())
    with tempfile.TemporaryDirectory(dir=out.parent) as tmp:
        img, mnt = Path(tmp) / "volume.img", Path(tmp) / "mnt"
        mnt.mkdir()
        with img.open("wb") as f:
            f.truncate((int(used * 1.15) // (1 << 20) + 32) << 20)
        subprocess.run(["mkfs.hfsplus", "-v", volume, str(img)], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["sudo", "mount", "-t", "hfsplus", "-o", "loop,rw", str(img), str(mnt)], check=True)
        try:
            subprocess.run(["sudo", "cp", "-a", str(app), str(mnt)], check=True)
            subprocess.run(["sudo", "ln", "-s", "/Applications", str(mnt / "Applications")], check=True)
        finally:
            subprocess.run(["sudo", "umount", str(mnt)], check=True)
        out.unlink(missing_ok=True)
        subprocess.run([os.environ.get("DMG_TOOL", "dmg"), str(img), str(out)], check=True, stdout=subprocess.DEVNULL)
        # the image must decode to exactly this volume, and the app on it must still pass
        if udif_sha256(out) != (file_sha256(img), img.stat().st_size):
            raise SystemExit(f"{out}: does not decode to the volume it was made from")
        subprocess.run(["sudo", "mount", "-t", "hfsplus", "-o", "loop,ro", str(img), str(mnt)], check=True)
        try:
            check_app(mnt / app.name)
            if os.readlink(mnt / "Applications") != "/Applications":
                raise SystemExit(f"{out}: the link to Applications is wrong")
        finally:
            subprocess.run(["sudo", "umount", str(mnt)], check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist", nargs="?", default=str(ROOT / "desktop/dist"))
    args = ap.parse_args()
    dist = Path(args.dist).resolve()
    apps = sorted(p for d in dist.glob("mac*") if d.is_dir() for p in d.glob("*.app"))
    if not apps:
        print(f"no Mac apps in {dist}: run electron-builder --mac dir first", file=sys.stderr)
        return 1
    zips, version = {}, None
    for app in apps:
        v = plistlib.loads((app / "Contents" / "Info.plist").read_bytes())["CFBundleShortVersionString"]
        if version not in (None, v):
            print(f"{app}: version {v}, beside {version}", file=sys.stderr)
            return 1
        version, arch = v, arch_of(app)
        try:
            check_app(app)
        except Damaged as e:
            print(f"{app} would not open: {e}", file=sys.stderr)
            return 1
        print(f"  {app.relative_to(dist)}: {arch}, signature checked")
        z = dist / f"nexa-{v}-mac-{arch}.zip"
        zip_app(app, z)
        zips[arch] = z
        print(f"  {z.name} ({z.stat().st_size / 1048576:.1f} MB), unzipped and checked")
        d = dist / f"nexa-{v}-mac-{arch}.dmg"
        make_dmg(app, d, f"Nexa {v}")
        print(f"  {d.name} ({d.stat().st_size / 1048576:.1f} MB), decoded and checked")
    main_zip = zips.get("x64") or next(iter(zips.values()))
    lines = [f"version: {version}", "files:"]
    for z in zips.values():
        lines += [f"  - url: {z.name}", f"    sha512: {sha512_b64(z)}", f"    size: {z.stat().st_size}"]
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z"
    lines += [f"path: {main_zip.name}", f"sha512: {sha512_b64(main_zip)}", f"releaseDate: '{stamp}'"]
    (dist / "latest-mac.yml").write_text("\n".join(lines) + "\n")
    print(f"wrote latest-mac.yml for {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
