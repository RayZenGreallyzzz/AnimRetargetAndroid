import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "patch_native_retarget_handoff.py"
spec=importlib.util.spec_from_file_location("retarget_patch",SCRIPT)
patch=importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)

SOURCE = """
class MainActivity {
    override fun onCreate(savedInstanceState: Bundle?) {
        buildUi()
        loadCustomMaps()
    }

    // ---------------- UI ----------------
    private fun loadCharacter(uri: Uri) {
        lifecycleScope.launch {
            try {
                val name = uriName(uri)
                val ext = name.substringAfterLast('.', "").lowercase()
                val bytes = withContext(Dispatchers.IO) { readUri(uri) }
            } catch (e: Exception) {
                toast("error")
            }
        }
    }
    private fun addAnims(uri: Uri) {}
}
"""

class RetargetPatchTests(unittest.TestCase):
    def test_native_parser_path_preserved_for_user_selected_uris(self):
        after = patch.patch_main(SOURCE)
        self.assertIn("loadCharacter(uri: Uri?, workspaceFile: File? = null)",after)
        self.assertIn("workspaceFile?.readBytes() ?: readUri(requireNotNull(uri))",after)
        self.assertIn("workspaceFile?.name ?: uriName(requireNotNull(uri))",after)
        self.assertIn('savedInstanceState == null) loadPhoenixWorkspaceInput()',after)
        self.assertIn('model.parentFile != workspace',after)
        self.assertIn('name.contains',after)
        self.assertIn('loadCharacter(null, model)',after)
    def test_fails_closed_on_changed_native_entrypoint(self):
        with self.assertRaises(ValueError):
            patch.patch_main(SOURCE.replace('loadCustomMaps()','unexpectedMethod()'))
    def test_refuses_double_injection(self):
        with self.assertRaises(ValueError):
            patch.patch_main(patch.patch_main(SOURCE))

if __name__ == "__main__":
    unittest.main()
