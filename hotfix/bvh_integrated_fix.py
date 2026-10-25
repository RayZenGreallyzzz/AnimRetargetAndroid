#!/usr/bin/env python3
"""Integrate BVH retarget corrections into the ORIGINAL GLB-capable app.
Never replace MainActivity, Glb.kt, Json.kt, UI resources or AndroidManifest.
The older retarget_math_hotfix.py runs before this patch.
"""
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "AnimRetargetAndroid")
src = root / "app/src/main/java/com/animretarget/app"
p = src / "Retarget.kt"
s = p.read_text(encoding="utf-8")
def replace_once(old, new):
    global s
    if s.count(old) != 1:
        raise ValueError(f"Retarget.kt changed: expected exactly one match for {old[:64]!r}, got {s.count(old)}")
    s = s.replace(old, new, 1)

# The source bind pose must map to the target bind pose. The old 'corr'
# pre-rotated even a zero-motion pose, twisting shoulders and elbows.
replace_once(
    "                    world = delta * corr[t] * tj.restWorldRot\n                    res.animated[t] = true\n                } else {\n                    world = tj.restWorldRot\n                }",
    "                    // Use the world-space rotation delta about the target's own bind pose.\n"
    "                    world = if (alignRest) delta * tj.restWorldRot else sR[s]\n"
    "                    res.animated[t] = true\n"
    "                } else {\n"
    "                    // Unmapped fingers, ornaments and extra bones follow animated parent.\n"
    "                    world = if (tj.parent >= 0) tR[tj.parent] * tj.restLocalRot else tj.restWorldRot\n"
    "                }"
)
# BVH hips' first frame contains its absolute mocap height. Without subtracting
# that first-frame baseline, the character starts floating above the ground.
replace_once(
    "        val rootT = target.rootIndices[0]\n\n        for (f in 0 until nF) {",
    "        val rootT = target.rootIndices[0]\n"
    "        val rootS = map.getOrElse(rootT) { -1 }\n"
    "        val sourceRootBaseline = if (rootS >= 0)\n"
    "            (clip.pos[rootS]?.firstOrNull() ?: source.joints[rootS].restWorldPos) else V3()\n\n"
    "        for (f in 0 until nF) {"
)
replace_once(
    "                        wp = tj.restWorldPos + (sP[s] - sAlignedPos[s]) * scale",
    "                        wp = tj.restWorldPos + (sP[s] - align.rot(sourceRootBaseline)) * scale"
)
p.write_text(s, encoding="utf-8")

# Explicitly stop if GLB or the existing original UI are missing.
for required in ("Glb.kt", "Json.kt", "MainActivity.kt", "Pipeline.kt", "Bvh.kt"):
    if not (src / required).is_file():
        raise ValueError("Original GLB-capable project missing: " + required)
ui = (src / "MainActivity.kt").read_text(encoding="utf-8")
if "Glb.parse" not in ui or "Pipeline.convertGlb" not in ui:
    raise ValueError("Refusing to package: original GLB import or export was lost")

p = root / "app/build.gradle.kts"
s = p.read_text(encoding="utf-8")
s = s.replace('versionCode = 3', 'versionCode = 4')
s = s.replace('versionName = "1.1.1-test"', 'versionName = "1.1.3-glb-bvh-test"')
if 'versionName = "1.1.3-glb-bvh-test"' not in s:
    raise ValueError("Version bump failed")
p.write_text(s, encoding="utf-8")
print("Original UI + GLB retained; BVH rest/root/follower corrections applied")
