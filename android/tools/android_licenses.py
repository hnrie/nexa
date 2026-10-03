#!/usr/bin/env python3
"""Writes android/app/src/main/assets/licenses.json: every library the
Android app ships, with its licence, for Settings, Licences.

    cd android && ./gradlew :app:dependencies --configuration debugRuntimeClasspath -q > /tmp/deps.txt
    python3 tools/android_licenses.py /tmp/deps.txt

The runtime classpath is read from Gradle's dependency report (debug's, less
the debug-only tooling, since a release build refuses to configure without
its keystore); each library's licence comes from its POM in Gradle's cache,
or its parent's. The server's libraries and the licence texts are taken from
the web's own catalogue (web/src/data/licenses.json, tools/licenses.py), and
the fonts and artwork the app bundles are listed by hand below.
"""
import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
WEB = os.path.join(ROOT, "web", "src", "data", "licenses.json")
OUT = os.path.join(ROOT, "android", "app", "src", "main", "assets", "licenses.json")
CACHE = os.path.expanduser("~/.gradle/caches/modules-2/files-2.1")

# only in a debug build: Android Studio's previews
DEBUG_ONLY = re.compile(r"^androidx\.compose\.ui:ui-tooling(-android|-data|-data-android)?$")

SPDX = [
    (re.compile(r"apache", re.I), "Apache-2.0"),
    (re.compile(r"\bmit\b|bouncy castle", re.I), "MIT"),
    (re.compile(r"bsd.?3|bsd 3|new bsd|revised bsd|modified bsd", re.I), "BSD-3-Clause"),
    (re.compile(r"bsd.?2|simplified bsd|freebsd", re.I), "BSD-2-Clause"),
    (re.compile(r"\bbsd\b", re.I), "BSD-3-Clause"),
    (re.compile(r"\bisc\b", re.I), "ISC"),
    (re.compile(r"eclipse public license.*2", re.I), "EPL-2.0"),
    (re.compile(r"\bgpl\b.*classpath", re.I), "GPL-2.0-with-classpath-exception"),
]

# What the app bundles that no Gradle library brings: its fonts and artwork.
ASSETS = [
    {"name": "Wix Madefor Text and Display", "version": "1.0", "license": "OFL-1.1", "url": "https://github.com/wix-incubator/wixmadefor", "copyright": "Copyright 2022 The Wix Madefor Project Authors"},
    {"name": "JetBrains Mono", "version": "2.304", "license": "OFL-1.1", "url": "https://github.com/JetBrains/JetBrainsMono", "copyright": "Copyright 2020 The JetBrains Mono Project Authors"},
    {"name": "Onest", "version": "1.0", "license": "OFL-1.1", "url": "https://github.com/simpals/onest", "copyright": "Copyright 2023 The Onest Project Authors"},
    {"name": "Mona Sans", "version": "2.0", "license": "OFL-1.1", "url": "https://github.com/github/mona-sans", "copyright": "Copyright 2023 GitHub, Inc."},
    {"name": "Lucide", "version": "0.460", "license": "ISC", "url": "https://github.com/lucide-icons/lucide", "copyright": "Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022."},
]


def spdx(name, url):
    text = f"{name or ''} {url or ''}"
    for pattern, ident in SPDX:
        if pattern.search(text):
            return ident
    return "Unknown"


def pom_path(group, artifact, version):
    hits = glob.glob(os.path.join(CACHE, group, artifact, version, "*", f"{artifact}-{version}.pom"))
    return hits[0] if hits else None


def strip_ns(root):
    for el in root.iter():
        if "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def read_pom(group, artifact, version, depth=0):
    """(licence names and urls, project url) from a POM, following its parent for what it leaves out."""
    path = pom_path(group, artifact, version)
    if not path or depth > 5:
        return [], None
    try:
        root = strip_ns(ET.parse(path).getroot())
    except ET.ParseError:
        return [], None
    lic = [(l.findtext("name"), l.findtext("url")) for l in root.findall("./licenses/license")]
    url = root.findtext("url") or root.findtext("./scm/url")
    parent = root.find("parent")
    if (not lic or not url) and parent is not None:
        plic, purl = read_pom(parent.findtext("groupId"), parent.findtext("artifactId"), parent.findtext("version"), depth + 1)
        lic = lic or plic
        url = url or purl
    return lic, url


LINE = re.compile(r"--- ([\w.\-]+):([\w.\-]+)(?::([\w.\-+]+))?(?: -> ([\w.\-+]+))?( \((?:\*|c|n)\))?\s*$")


def main():
    text = open(sys.argv[1]).read() if len(sys.argv) > 1 else sys.stdin.read()
    coords = {}
    for line in text.splitlines():
        m = LINE.search(line)
        if not m or (m.group(5) and "(c)" in m.group(5)):
            continue
        group, artifact = m.group(1), m.group(2)
        version = m.group(4) or m.group(3)
        if not version or artifact.endswith("-bom"):
            continue
        name = f"{group}:{artifact}"
        if DEBUG_ONLY.match(name):
            continue
        coords[name] = version
    web = json.load(open(WEB))
    packages = []
    for name, version in sorted(coords.items()):
        group, artifact = name.split(":")
        lic, url = read_pom(group, artifact, version)
        ident = spdx(*lic[0]) if lic else "Unknown"
        packages.append({"part": "android", "name": name, "version": version, "license": ident, "url": url or ""})
    packages += [p for p in web["packages"] if p["part"] == "server"]
    packages += [dict(a, part="assets") for a in ASSETS]
    packages += [p for p in web["packages"] if p["part"] == "assets" and (p["name"] == "Twemoji" or rnnoise_bundled())]
    used = {p["license"] for p in packages}
    licenses = {k: v for k, v in web["licenses"].items() if k in used}
    missing = sorted(used - set(licenses) - {"Unknown"})
    if missing:
        print("no licence text for:", ", ".join(missing), file=sys.stderr)
    out = {"parts": ["android", "server", "assets"], "self": web.get("self"), "licenses": licenses, "packages": packages}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    unknown = [p["name"] for p in packages if p["license"] == "Unknown"]
    print(f"{len(packages)} packages written ({len(coords)} from Gradle); unknown licence: {', '.join(unknown) or 'none'}")


def rnnoise_bundled():
    """RNNoise comes with the call engine's native code, when it is there."""
    cpp = os.path.join(ROOT, "android", "app", "src", "main", "cpp")
    return any("rnnoise" in n.lower() for _, dirs, files in os.walk(cpp) for n in dirs + files)


if __name__ == "__main__":
    main()
