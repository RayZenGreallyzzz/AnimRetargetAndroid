#!/usr/bin/env python3
"""Extract a verified Rig Studio 7.6 web build from the exact user-supplied APK.

Only the APK's assets/public tree is extracted. The original APK and other
GitHub repositories remain unmodified.
"""
import hashlib
import shutil
import sys
import zipfile
from pathlib import Path

SHA256 = "3e36c900a2746dd3cc4b2a71e8a295d6ec72dfcee892940910e3cc1c6fbc6243"

def extract(apk: Path, dest: Path):
    with apk.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != SHA256:
        raise RuntimeError(f"Wrong Rig Studio APK. Expected v7.6 SHA256 {SHA256}, received {digest}")
    dest.mkdir(parents=True, exist_ok=True)
    total = count = 0
    with zipfile.ZipFile(apk) as archive:
        for entry in archive.infolist():
            if entry.is_dir() or not entry.filename.startswith("assets/public/"):
                continue
            relative = Path(entry.filename.removeprefix("assets/public/"))
            if not relative.parts or relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError(f"Unsafe APK path: {entry.filename}")
            total += entry.file_size
            if entry.file_size > 120 * 1024 * 1024 or total > 360 * 1024 * 1024:
                raise RuntimeError("Oversized archive entry")
            target = dest / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, 65536)
            count += 1
    create = dest / "create.html"
    if not create.is_file() or "chest-guard-panel" not in create.read_text(encoding="utf-8"):
        raise RuntimeError("Missing v7.6 Woman / Chest Guard controls")
    if not (dest / "index.html").is_file():
        raise RuntimeError("Missing Rig Studio entrypoint")
    print(f"Extracted verified v7.6 Rig Studio: {count} resources, {total/1048576:.1f} MiB uncompressed")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_rig_v76.py <rig-v7.6.apk> <dist-path>")
    extract(Path(sys.argv[1]), Path(sys.argv[2]))
