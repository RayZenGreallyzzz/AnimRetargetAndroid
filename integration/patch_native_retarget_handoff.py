#!/usr/bin/env python3
"""Patch only the extracted native Retarget copy inside unified Forge.

The original AnimRetarget source archive is left unchanged. Only private
app-owned GLB files can be passed; no file:// URI or SAF round-trip.
"""
from __future__ import annotations
import sys
from pathlib import Path

def once(text: str, before: str, after: str) -> str:
    if text.count(before) != 1:
        raise ValueError(f"Expected one native anchor, got {text.count(before)}: {before[:70]!r}")
    return text.replace(before, after, 1)

def patch_main(source: str) -> str:
    if "loadPhoenixWorkspaceInput()" in source:
        raise ValueError("Native Retarget was already patched")
    source = once(source, """        buildUi()
        loadCustomMaps()
    }
""", """        buildUi()
        loadCustomMaps()
        if (savedInstanceState == null) loadPhoenixWorkspaceInput()
    }
""")
    location = "    // ---------------- UI ----------------"
    helper = """    // Only read from this APK's private workspace; reject path traversal.
    private fun loadPhoenixWorkspaceInput() {
        val name = intent?.getStringExtra("phoenix_shared_glb_name") ?: return
        if (name.isEmpty() || name.contains('/') || name.contains('\\\\') ||
            !name.endsWith(".glb", ignoreCase = true)) {
            toast("Phoenix: недопустимое имя общего GLB")
            return
        }
        try {
            val workspace = File(filesDir, "phoenix_workspace").canonicalFile
            val model = File(workspace, name).canonicalFile
            if (model.parentFile != workspace || !model.isFile ||
                model.length() == 0L || model.length() > 140L * 1024L * 1024L) {
                toast("Phoenix: файл персонажа не найден или слишком большой")
                return
            }
            loadCharacter(null, model)
        } catch (e: Exception) {
            toast("Phoenix: не удалось открыть персонажа: ${e.message}")
        }
    }

"""
    source = once(source, location, helper + location)
    start = source.index("    private fun loadCharacter(uri: Uri) {")
    stop = source.index("    private fun addAnims(uri: Uri)", start)
    block = source[start:stop]
    block = once(block, "    private fun loadCharacter(uri: Uri) {",
                 "    private fun loadCharacter(uri: Uri?, workspaceFile: File? = null) {")
    block = once(block, "                val name = uriName(uri)",
                 "                val name = workspaceFile?.name ?: uriName(requireNotNull(uri))")
    block = once(block, "                val bytes = withContext(Dispatchers.IO) { readUri(uri) }",
                 "                val bytes = withContext(Dispatchers.IO) { workspaceFile?.readBytes() ?: readUri(requireNotNull(uri)) }")
    return source[:start]+block+source[stop:]

def patch_project(root: Path) -> Path:
    files = list((root/"app/src/main").rglob("MainActivity.kt"))
    if len(files) != 1:
        raise ValueError(f"Expected one native MainActivity.kt, got {len(files)}")
    path = files[0]
    path.write_text(patch_main(path.read_text(encoding="utf-8")), encoding="utf-8")
    return path

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: patch_native_retarget_handoff.py <extracted-app-root>")
    print(f"Patched native Retarget GLB handoff: {patch_project(Path(sys.argv[1]))}")
