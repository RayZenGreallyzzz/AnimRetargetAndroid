"""Smoke tests for the generated APK staging tree. No Android SDK required."""
from __future__ import annotations
import tempfile
import unittest
from pathlib import Path
from integration.inject_shell import integrate, NS

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
            (rig/"create.html").write_text("<html><head></head><body>Rig Studio</body></html>")
            (rig/"assets").mkdir()
            (rig/"assets/game.js").write_text("const rig = true;")
            (character/"index.html").write_text("<html><head></head><body>Character Studio</body></html>")
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
            self.assertEqual((assets/"rig/assets/game.js").read_text(),"const rig = true;")
            output=native/"app/src/main/java/com/animretarget/app/StudioWebActivity.kt"
            self.assertIn("com.animretarget.app.MainActivity",output.read_text())
            self.assertIn("PhoenixWorkspaceBridge",output.read_text())
            self.assertEqual((rig/"create.html").read_bytes(),original)

if __name__=="__main__":
    unittest.main()
