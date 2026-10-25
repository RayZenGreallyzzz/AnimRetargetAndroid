#!/usr/bin/env python3
"""v1.1.4: restore dark theme, preserve GLB and make BVH root mapping safe.

This script applies AFTER retarget_math_hotfix.py and bvh_integrated_fix.py
to the original AnimRetargetAndroid source archive. Never uses RetargetApp.
"""
from pathlib import Path
import sys

base = Path(sys.argv[1] if len(sys.argv)>1 else "AnimRetargetAndroid")
src = base / "app/src/main/java/com/animretarget/app"

def exactly(src_text: str, old: str, new: str, label: str) -> str:
    count=src_text.count(old)
    if count != 1:
        raise ValueError(f"Version mismatch: {label}; expected 1 match, saw {count}")
    return src_text.replace(old,new,1)

# Original DayNight theme appears white when device uses light appearance.
theme=base / "app/src/main/res/values/themes.xml"
s=theme.read_text(encoding="utf-8")
s=exactly(s,"Theme.Material3.DayNight.NoActionBar", "Theme.Material3.Dark.NoActionBar","dark theme")
s=exactly(s,'<item name="android:statusBarColor">@android:color/black</item>',
'''<item name="android:statusBarColor">#101318</item>
        <item name="android:navigationBarColor">#101318</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:windowBackground">#101318</item>''',"system bars")
theme.write_text(s,encoding="utf-8")

ui=src/"MainActivity.kt"
s=ui.read_text(encoding="utf-8")
s=exactly(s,"import androidx.appcompat.app.AppCompatActivity", 
          "import androidx.appcompat.app.AppCompatActivity\nimport androidx.appcompat.app.AppCompatDelegate","appcompat import")
s=exactly(s,
'''    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)''',
'''    override fun onCreate(savedInstanceState: Bundle?) {
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)
        super.onCreate(savedInstanceState)''',"force dark mode")
if not ("Glb.parse" in s and "Pipeline.convertGlb" in s and "2. Анимации" in s):
    raise ValueError("Original UI or GLB import/export missing: refusing to continue")
ui.write_text(s,encoding="utf-8")

# Retarget fixes: zero-motion input leaves ALL target bind rotations untouched,
# and the 'align rest' toggle selects only coordinate-system alignment.
p=src/"Retarget.kt"
s=p.read_text(encoding="utf-8")
s=exactly(s,"val align = computeAlign(target, source)",
          "val align = if (alignRest) computeAlign(target, source) else Q.ID","align toggle")
st=s.index('        // поправка позы покоя (A-pose -> T-pose и т.п.)')
en=s.index('        val res = AnimResult(',st)
s=s[:st]+s[en:]
s=exactly(s,"world = if (alignRest) delta * tj.restWorldRot else sR[s]",
          "world = (delta * tj.restWorldRot).norm()","pose-safe world delta")
s=exactly(s,"world = if (tj.parent >= 0) tR[tj.parent] * tj.restLocalRot else tj.restWorldRot",
          "world = if (tj.parent >= 0) (tR[tj.parent] * tj.restLocalRot).norm() else tj.restWorldRot",
          "unmapped bones follow parent")
s=exactly(s,
'''        val rootS = map.getOrElse(rootT) { -1 }
        val sourceRootBaseline = if (rootS >= 0)
            (clip.pos[rootS]?.firstOrNull() ?: source.joints[rootS].restWorldPos) else V3()''',
'''        // Character GLB may have an unmapped wrapper root above Hips.
        // Translation is taken from the animated root of the BVH/FBX source.
        val sourceRoot = source.rootIndices.firstOrNull() ?: -1
        val sourceRootTrack = if (sourceRoot >= 0) clip.pos[sourceRoot] else null
        val sourceRootBaseline = sourceRootTrack?.firstOrNull()
        val targetRootRest = target.joints[rootT].restWorldPos''',
"extra target root")
s=exactly(s,
'''                    if (t == rootT && s >= 0 && rootMotion && clip.pos[s] != null) {
                        wp = tj.restWorldPos + (sP[s] - align.rot(sourceRootBaseline)) * scale
                        res.rootMotion = true
                        res.animated[t] = true
                    }''',
'''                    if (t == rootT && rootMotion &&
                        sourceRoot >= 0 && sourceRootTrack != null && sourceRootBaseline != null) {
                        // Subtract frame-zero root pose to avoid adding absolute BVH hip height.
                        wp = targetRootRest + (sP[sourceRoot] - align.rot(sourceRootBaseline)) * scale
                        res.rootMotion = true
                        res.animated[t] = true
                    }''',
"BVH root motion baseline")
p.write_text(s,encoding="utf-8")

# Positional matching at 35% character height may map unrelated joints.
# Retain exact-name mapping and highly conservative local matching;
# unmatched joints remain attached to their animated parents instead.
p=src/"Mapper.kt"
s=p.read_text(encoding="utf-8")
s=exactly(s,
'''        val threshold = target.height * 0.35f''',
'''        // Avoid attaching a hand to a nearby leg; use manual matching if names differ.
        val threshold = target.height * 0.025f''',
"conservative proximity")
p.write_text(s,encoding="utf-8")

p=base/"app/build.gradle.kts"
s=p.read_text(encoding="utf-8")
s=exactly(s,'versionCode = 4','versionCode = 6',"versionCode")
s=exactly(s,'versionName = "1.1.3-glb-bvh-test"',
          'versionName = "1.1.4-dark-bvh-test"',"versionName")
p.write_text(s,encoding="utf-8")

for required in ("Glb.kt","Json.kt","Pipeline.kt","SkeletonView.kt","PreviewActivity.kt"):
    if not (src/required).is_file():
        raise ValueError(f"Original GLB-capable application missing: {required}")
print("v1.1.4: Original UI + GLB retained, forced dark theme, parent-safe BVH rotations and hips")
