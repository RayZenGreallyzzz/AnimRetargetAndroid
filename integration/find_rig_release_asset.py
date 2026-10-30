#!/usr/bin/env python3
"""Resolve an exact release asset in the CURRENT GitHub repository.

Never use an unverified download URL as a fallback. The extracted APK's
SHA-256 is independently verified by extract_rig_v76.py.
"""
import json
import sys
from pathlib import Path

ASSET = "Rig-Animation-Studio-v7.6-Chest-Guard-test.apk"
# Android/Chrome appends ".1" if the same download already exists.
# The user's actual uploaded release asset uses this filename.
ALLOWED_ASSETS = {ASSET, "Rig-Animation-Studio-v7.6-Chest-Guard-test.1.apk"}
EXACT_SHA256 = "3e36c900a2746dd3cc4b2a71e8a295d6ec72dfcee892940910e3cc1c6fbc6243"
EXACT_SIZE = 84054098
RELEASE_NAME = "phoenix-rig-v7.6-input"

def resolve(contents):
    data = json.loads(contents)
    if isinstance(data, list):
        matching = [
            item for item in data
            if item.get("name") == RELEASE_NAME
            and (item.get("draft") is True
                 or item.get("tag_name") == RELEASE_NAME)
        ]
        if len(matching) != 1:
            raise ValueError(
                f"Expected exactly one GitHub Release or private draft named {RELEASE_NAME}, found {len(matching)}"
            )
        data = matching[0]
    if not isinstance(data, dict):
        raise ValueError("Invalid release data structure")
    assets = data.get("assets")
    if not isinstance(assets, list):
        raise ValueError("Release JSON has no assets array. Create/publish the pinned Rig v7.6 release first.")
    matches = [a for a in assets if a.get("name") in ALLOWED_ASSETS and a.get("state") == "uploaded"]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one uploaded original Rig v7.6 asset ({sorted(ALLOWED_ASSETS)}), found {len(matches)}")
    asset = matches[0]
    asset_id = asset.get("id")
    if not isinstance(asset_id, int) or asset_id <= 0:
        raise ValueError("Release asset has no valid numeric ID")
    if asset.get("size") != EXACT_SIZE:
        raise ValueError(f"Release APK has wrong size: expected {EXACT_SIZE} bytes")
    digest = asset.get("digest")
    if digest and digest != "sha256:" + EXACT_SHA256:
        raise ValueError("Release APK digest is not the original v7.6 file")
    return asset_id

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: find_rig_release_asset.py release.json")
    try:
        print(resolve(Path(sys.argv[1]).read_text(encoding="utf-8")))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("Error: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
