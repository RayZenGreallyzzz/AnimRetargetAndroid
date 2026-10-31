"""Prevent regression where a new APK silently omits the handoff validator."""
from pathlib import Path
import tempfile
import unittest
from integration.inject_shell import patch_html

ROOT=Path(__file__).resolve().parents[1]

class HandoffPackagingTest(unittest.TestCase):
    def test_validator_is_copied_before_shell_in_injected_html(self):
        with tempfile.TemporaryDirectory() as d:
            target=Path(d)/"create.html"
            target.write_text("<html><head></head><body></body></html>")
            for js in ("glb-guard.js","studio-shell.js","studio-sync.js"):
                patch_html(target,js)
            text=target.read_text()
            assert text.index("glb-guard.js")<text.index("studio-shell.js")<text.index("studio-sync.js")

    def test_integrated_shell_requires_validator_before_leaving_rig(self):
        shell=(ROOT/"web/studio-shell.js").read_text()
        self.assertIn("await verifyRigHandoff(next)",shell)
        self.assertIn("guard.requireCharacterReady(native,entry)",shell)
        self.assertLess(shell.index("await commitRigBeforeLeave(next)"),shell.index('call("openTool",next)'))
        self.assertIn('call("setActiveFile",beforeEntry.name',shell)

    def test_rig_is_not_destroyed_until_character_import_ack(self):
        native=(ROOT/"kotlin/StudioWebActivity.kt").read_text()
        sync=(ROOT/"web/studio-sync.js").read_text()
        self.assertIn('it != next && it != handoffRetained',native)
        self.assertIn('fun confirmEditorModelLoaded(editor: String, revision: Long)',native)
        self.assertIn('revision != activeRevision',native)
        self.assertIn('fun editorLoaded(tool: String, revision: Long)',native)
        self.assertIn('bridge.editorLoaded(tool,active.revision)',sync)

    def test_character_can_return_to_rig_on_failed_load(self):
        shell=(ROOT/"web/studio-shell.js").read_text()
        patch=(ROOT/"patch_character_handoff.py").read_text()
        self.assertIn('!window.PhoenixCharacterHasModel()',shell)
        self.assertIn('window.PhoenixCharacterHasModel=',patch)

    def test_full_apk_injector_bundles_guard(self):
        injection=(ROOT/"inject_shell.py").read_text()
        self.assertIn('target / "glb-guard.js"',injection)
        self.assertIn('patch_html(target / entrypoint, "glb-guard.js")',injection)

if __name__=="__main__":
    unittest.main()
