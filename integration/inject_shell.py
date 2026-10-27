#!/usr/bin/env python3
"""Build a Rig-first, three-editor Android APK from LOCAL copies of three repositories.

Never modifies any original source repository. Called only in integration CI.
"""
from __future__ import annotations

import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", NS)
NAME = "{" + NS + "}name"
EXPORTED = "{" + NS + "}exported"
LABEL = "{" + NS + "}label"
MAIN = "android.intent.action.MAIN"
LAUNCHER = "android.intent.category.LAUNCHER"


def canonical_class(name: str, package: str) -> str:
    if name.startswith("."):
        return package + name
    if "." in name:
        return name
    return package + "." + name


def original_launcher(root: ET.Element) -> str:
    package = root.get("package") or "com.animretarget.app"
    app = root.find("application")
    if app is None:
        raise RuntimeError("No <application> in manifest")
    found: list[str] = []
    for activity in list(app.findall("activity")) + list(app.findall("activity-alias")):
        for intent in list(activity.findall("intent-filter")):
            actions = [a.get(NAME) for a in intent.findall("action")]
            categories = [a.get(NAME) for a in intent.findall("category")]
            if MAIN in actions and LAUNCHER in categories:
                name = activity.get(NAME)
                if not name:
                    raise RuntimeError("Main activity has no android:name")
                found.append(canonical_class(name, package))
                activity.remove(intent)
    if len(found) != 1:
        raise RuntimeError(f"Expected one native Retarget launcher, got {found}")
    return found[0]


def patch_html(path: Path, script: str = "studio-shell.js") -> None:
    html = path.read_text(encoding="utf-8")
    if script not in html:
        if "</head>" not in html:
            raise RuntimeError(f"Missing closing head: {path}")
        html = html.replace("</head>", f'<script src="./{script}"></script></head>', 1)
        path.write_text(html, encoding="utf-8")



def patch_branding(path: Path, editor: str) -> None:
    """Replace staged page brand only, keeping Rig v7.6 editor functionality."""
    import re
    html = path.read_text(encoding="utf-8")
    updated, count = re.subn(r"<title[^>]*>.*?</title>",
        "<title>Phoenix Character Forge — " +
        ("Rig 7.6" if editor == "rig" else "Оптимизация" if editor == "optimize" else "Character") + "</title>",
        html, count=1, flags=re.IGNORECASE | re.DOTALL)
    if count != 1:
        raise RuntimeError(f"Cannot set page title: {path}")
    if editor == "rig":
        # Keep the original chest guard label/version beneath the brand.
        updated = updated.replace("<strong>Rig Animation Studio</strong>",
            "<strong>Phoenix Character Forge</strong>", 1)
        updated = updated.replace('aria-label="Rig Animation Studio"',
            'aria-label="Phoenix Character Forge"', 1)
        if "v7.6" in html.lower() and "chest-guard-panel" not in html:
            raise RuntimeError("Supplied Rig v7.6 web build lacks its chest guard panel")
    path.write_text(updated, encoding="utf-8")


def integrate(project: Path, rig_dist: Path, character_dist: Path, integration_root: Path, optimizer_dist: Path | None = None) -> None:
    app = project / "app"
    manifest_file = app / "src/main/AndroidManifest.xml"
    gradle_file = app / "build.gradle.kts"
    if not manifest_file.is_file() or not gradle_file.is_file():
        raise RuntimeError("Missing extracted native Anim Retarget app")
    if not (rig_dist / "create.html").is_file():
        raise RuntimeError("Rig Animation Studio: dist/create.html missing")
    if not (character_dist / "index.html").is_file():
        raise RuntimeError("Character Studio: dist/index.html missing")

    if optimizer_dist is not None and not (optimizer_dist / "index.html").is_file():
        raise RuntimeError("Optimizer build: dist/index.html missing")

    tree = ET.parse(manifest_file)
    root = tree.getroot()
    retarget = original_launcher(root)
    application = root.find("application")
    assert application is not None
    # Distinct Android icon/label: never silently overwrite an installed Anim Retarget.
    application.set(LABEL, "Phoenix Character Forge")
    if retarget == "com.animretarget.app.StudioWebActivity":
        raise RuntimeError("Refusing to integrate twice")
    if any(a.get(NAME) == "com.animretarget.app.StudioWebActivity"
           for a in application.findall("activity")):
        raise RuntimeError("StudioWebActivity already declared")

    entry = ET.SubElement(application, "activity", {
        NAME: "com.animretarget.app.StudioWebActivity",
        EXPORTED: "true",
        LABEL: "Phoenix Character Forge",
        "{" + NS + "}configChanges": "orientation|screenSize|keyboardHidden",
    })
    intent = ET.SubElement(entry, "intent-filter")
    ET.SubElement(intent, "action", {NAME: MAIN})
    ET.SubElement(intent, "category", {NAME: LAUNCHER})
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    tree.write(manifest_file, encoding="utf-8", xml_declaration=True)

    # Stage the original binary-built editors, then BRAND ONLY THE COPIES.
    # No original source file, rig weights, animations or chest-guard logic is changed.
    # Copy actual builds; browser is never pointed to live GitHub or web servers.
    dest = app / "src/main/assets/studio"
    staged = [("rig", rig_dist, "create.html"), ("character", character_dist, "index.html")]
    if optimizer_dist is not None:
        staged.append(("optimize", optimizer_dist, "index.html"))
    for name, source, entrypoint in staged:
        target = dest / name
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, target)
        patch_branding(target / entrypoint, name)
        patch_html(target / entrypoint, "studio-shell.js")
        patch_html(target / entrypoint, "studio-sync.js")
        shutil.copyfile(integration_root / "web/studio-shell.js",
                        target / "studio-shell.js")
        shutil.copyfile(integration_root / "web/studio-sync.js",
                        target / "studio-sync.js")

    # WebViewAssetLoader serves the web bundles from the packaged app.
    gradle = gradle_file.read_text(encoding="utf-8")
    if "androidx.webkit:webkit:" not in gradle:
        gradle += '\n// Secure offline HTML asset handling for Phoenix Studio.\ndependencies { implementation("androidx.webkit:webkit:1.11.0") }\n'
    # This APK is a NEW app, not an update to the user's original Retarget.
    # Preserve the package/namespace of every original Kotlin class.
    if 'applicationIdSuffix' not in gradle:
        gradle += '\n// Install independently of AnimRetargetAndroid.\nandroid { defaultConfig { applicationIdSuffix = ".suite" } }\n'
    gradle_file.write_text(gradle, encoding="utf-8")

    native = (integration_root / "kotlin/StudioWebActivity.kt").read_text(encoding="utf-8")
    native = native.replace("__NATIVE_RETARGET_ACTIVITY__", retarget)
    if "__NATIVE_RETARGET_ACTIVITY__" in native:
        raise RuntimeError("Failed to resolve Retarget activity")
    out = app / "src/main/java/com/animretarget/app/StudioWebActivity.kt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(native, encoding="utf-8")

    # Fail before Gradle rather than silently packaging a blank launcher.
    for required in (
        dest / "rig/create.html",
        dest / "rig/studio-shell.js",
        dest / "rig/studio-sync.js",
        dest / "character/index.html",
        dest / "character/studio-shell.js",
        dest / "character/studio-sync.js",
        *((dest / "optimize/index.html", dest / "optimize/studio-shell.js", dest / "optimize/studio-sync.js") if optimizer_dist is not None else ()),
        out,
    ):
        if not required.is_file() or required.stat().st_size < 50:
            raise RuntimeError(f"Integration output missing: {required}")
    print("Phoenix Character Forge staged. Native Retarget: " + retarget)
    print("Source copies unchanged. GLB workspace: app-private files/phoenix_workspace.")


if __name__ == "__main__":
    if len(sys.argv) not in (4, 5):
        raise SystemExit("Usage: inject_shell.py <native-app-root> <rig-dist> <character-dist> [optimizer-dist]")
    integrate(*[Path(x).resolve() for x in sys.argv[1:4]],
              Path(__file__).resolve().parent,
              Path(sys.argv[4]).resolve() if len(sys.argv) == 5 else None)
