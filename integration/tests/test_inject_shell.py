"""Smoke tests for the generated APK staging tree. No Android SDK required."""
from __future__ import annotations
import tempfile
import unittest
from pathlib import Path
from integration.inject_shell import integrate, patch_branding, NS

MANIFEST = f'''<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="{NS}" package="com.animretarget.app">
  <application android:label="Anim Retarget">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter><action android:name="android.intent.action.MAIN"/>
      <category android:name="android.intent.category.LAUNCHER"/></intent-filter>
    </activity>
  </application>
</manifest>'''

class MergeSmokeTests(unittest.TestCase):
    def test_three_editors_preserve_source_copies(self):
        import xml.etree.ElementTree as ET
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);native=base/"AnimRetargetAndroid"
            manifest=native/"app/src/main/AndroidManifest.xml"
            manifest.parent.mkdir(parents=True)
            manifest.write_text(MANIFEST,encoding="utf-8")
            gradle=native/"app/build.gradle.kts"
            gradle.write_text('plugins { id("com.android.application") }\n',encoding="utf-8")
            rig=base/"rig"; character=base/"character"
            rig.mkdir();character.mkdir()
            (rig/"create.html").write_text('<html><head><title>Rig Animation Studio</title></head>'
                '<body><div id="ras-branding" aria-label="Rig Animation Studio">'
                '<span class="ras-brand-copy"><strong>Rig Animation Studio</strong>'
                '<small>v7.6 TEST · Защита груди</small></span></div>'
                '<section id="chest-guard-panel">Chest guard controls</section>'
                '</body></html>', encoding="utf-8")
            (rig/"assets").mkdir()
            (rig/"assets/game.js").write_text("const rig = true;")
            (character/"index.html").write_text("<html><head><title>Character Studio</title></head><body>Character Studio</body></html>")
            original=(rig/"create.html").read_bytes()
            integrate(native,rig,character,Path(__file__).resolve().parents[1])
            root=ET.parse(manifest).getroot()
            app=root.find("application")
            nsname="{"+NS+"}name"
            activities=app.findall("activity")
            current=next(x for x in activities if x.get(nsname)=="com.animretarget.app.StudioWebActivity")
            self.assertIsNotNone(current.find("intent-filter"))
            old=next(x for x in activities if x.get(nsname)==".MainActivity")
            self.assertIsNone(old.find("intent-filter"))
            assets=native/"app/src/main/assets/studio"
            self.assertIn("studio-shell.js",(assets/"rig/create.html").read_text())
            self.assertIn("studio-shell.js",(assets/"character/index.html").read_text())
            self.assertIn("studio-sync.js",(assets/"rig/create.html").read_text())
            self.assertIn("studio-sync.js",(assets/"character/index.html").read_text())
            self.assertIn("<title>Phoenix Character Forge — Rig 7.6</title>",
                          (assets/"rig/create.html").read_text())
            self.assertIn("<strong>Phoenix Character Forge</strong>",
                          (assets/"rig/create.html").read_text())
            self.assertIn("chest-guard-panel",(assets/"rig/create.html").read_text())
            self.assertIn("<title>Phoenix Character Forge — Character</title>",
                          (assets/"character/index.html").read_text())
            self.assertTrue((assets/"rig/studio-sync.js").stat().st_size > 100)
            self.assertTrue((assets/"character/studio-sync.js").stat().st_size > 100)
            self.assertEqual((assets/"rig/assets/game.js").read_text(),"const rig = true;")
            output=native/"app/src/main/java/com/animretarget/app/StudioWebActivity.kt"
            self.assertIn("com.animretarget.app.MainActivity",output.read_text())
            self.assertIn("PhoenixWorkspaceBridge",output.read_text())
            self.assertIn("getActiveFileJson",output.read_text())
            self.assertIn("markActive",output.read_text())
            self.assertIn("phoenix:activated",output.read_text())
            self.assertEqual((rig/"create.html").read_bytes(),original)
            self.assertIn('applicationIdSuffix = ".suite"', gradle.read_text())
            self.assertEqual(app.get("{"+NS+"}label"),"Phoenix Character Forge")
            self.assertEqual(current.get("{"+NS+"}label"),"Phoenix Character Forge")

    def test_reject_incomplete_v76_chest_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            page=Path(tmp)/"create.html"
            page.write_text(
                "<html><head><title>Rig Animation Studio</title></head>"
                "<body><small>v7.6 TEST · Защита груди</small></body></html>",
                encoding="utf-8")
            before=page.read_bytes()
            with self.assertRaisesRegex(RuntimeError, "chest guard"):
                patch_branding(page, "rig")
            self.assertEqual(page.read_bytes(),before)

if __name__=="__main__":
    unittest.main()
