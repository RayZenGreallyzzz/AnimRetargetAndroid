import unittest
from integration.patch_character_handoff import patch_source, ANCHOR

class CharacterHandoffPatchTest(unittest.TestCase):
    def test_patch_requires_real_character_input_and_awaits_parse(self):
        result = patch_source("intro\n" + ANCHOR + "\noutro")
        self.assertIn("window.PhoenixCharacterImport=async file", result)
        self.assertIn("await loadBase(bytes,file.name)", result)
        self.assertIn("phoenix:character-import-ready", result)
        self.assertIn("return {name:state.baseName,bones:bones.length", result)
        self.assertNotIn(ANCHOR, result)

    def test_reject_unknown_character_source_to_avoid_silent_regression(self):
        with self.assertRaises(ValueError):
            patch_source("no real loadBase control")
        with self.assertRaises(ValueError):
            patch_source(ANCHOR + ANCHOR)

if __name__ == "__main__":
    unittest.main()
