#!/usr/bin/env python3
"""Resolve an exact release asset in the CURRENT GitHub repository.

Never use an unverified download URL as a fallback. The extracted APK's
SHA-256 is independently verified by extract_rig_v76.py.
"""
import json
import sys
from pathlib import Path

ASSET = "Rig-Animation-Studio-v7.6-Chest-Guard-test.apk"

def resolve(contents):
    data = json.loads(contents)
    assets = data.get("assets")
    if not isinstance(assets, list):
        raise ValueError("Release JSON has no assets array. Create/publish the pinned Rig v7.6 release first.")
    matches = [a for a in assets if a.get("name") == ASSET and a.get("state") == "uploaded"]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one uploaded release asset named {ASSET}, found {len(matches)}")
    asset = matches[0]
    asset_id = asset.get("id")
    if not isinstance(asset_id, int) or asset_id <= 0:
        raise ValueError("Release asset has no valid numeric ID")
    if asset.get("size", 0) < 1000000:
        raise ValueError("Release APK asset is unexpectedly small")
    return asset_id

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: find_rig_release_asset.py release.json")
    try:
        print(resolve(Path(sys.argv[1]).read_text(encoding="utf-8")))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("Error: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
