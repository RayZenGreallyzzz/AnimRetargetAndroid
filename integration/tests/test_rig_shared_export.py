"""Ensure the exact Rig 7.6 staging patch routes GLB to Forge storage."""
import tempfile
import unittest
from pathlib import Path
from integration.patch_rig_shared_export import MARKER,PATCH,patch_rig_export

class RigSharedExportTests(unittest.TestCase):
    def test_glb_save_delegates_to_shared_workspace_only_in_staged_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'original';staged=Path(tmp)/'staged'
            (src/'assets').mkdir(parents=True)
            (staged/'assets').mkdir(parents=True)
            original='var Ff=class e{async save(t,n){'+MARKER+'await native(t,n)}}'
            (src/'assets/rig.js').write_text(original)
            (staged/'assets/rig.js').write_text(original)
            output=patch_rig_export(staged)
            self.assertIn('PhoenixSuite.saveBlob(t,n)',output.read_text())
            self.assertIn('if(e.is_android())',output.read_text())
            self.assertIn('\\.glb$',output.read_text())
            self.assertEqual((src/'assets/rig.js').read_text(),original)
            self.assertEqual(output.read_text().count('PhoenixSuite.saveBlob'),1)

    def test_refuses_silent_nonmatching_rig_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'assets').mkdir()
            (root/'assets/rig.js').write_text('unrelated original exporter')
            with self.assertRaisesRegex(RuntimeError,'exactly one'):
                patch_rig_export(root)

    def test_refuses_multiple_export_implementations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'assets').mkdir()
            (root/'assets/rig.js').write_text(MARKER+MARKER)
            with self.assertRaisesRegex(RuntimeError,'Ambiguous'):
                patch_rig_export(root)
