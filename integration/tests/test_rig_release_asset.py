"""No network required: exact Rig APK release asset selector."""
import unittest
import json
from integration.find_rig_release_asset import resolve, ASSET

class ReleaseArtifactTest(unittest.TestCase):
    def test_accept_exact_uploaded_file(self):
        raw = json.dumps({"assets":[{"name":ASSET,"id":102,"size":84054098,"state":"uploaded"}]})
        self.assertEqual(resolve(raw),102)

    def test_reject_wrong_release_asset(self):
        with self.assertRaisesRegex(ValueError,"Expected exactly one"):
            resolve(json.dumps({"assets":[{"name":"Rig-Animation-Studio-v7.5.apk","id":3,"size":80000000,"state":"uploaded"}]}))

    def test_reject_partial_or_tiny_file(self):
        for state,size in [("starter",84054098),("uploaded",120)]:
            with self.assertRaises(ValueError):
                resolve(json.dumps({"assets":[{"name":ASSET,"id":3,"size":size,"state":state}]}))

    def test_reject_no_assets(self):
        with self.assertRaisesRegex(ValueError,"no assets"):
            resolve("{}")

if __name__ == "__main__":
    unittest.main()
