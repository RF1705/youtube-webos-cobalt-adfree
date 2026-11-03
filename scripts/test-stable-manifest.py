#!/usr/bin/env python3
"""Regression tests for stable release manifest updates (no network needed)."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "sync_stable_manifest", Path(__file__).with_name("sync-stable-manifest.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

DIGEST = "a" * 64
ASSET = "youtube.leanback.v4_2.0.0_arm.ipk"
URL = f"https://github.com/{module.REPO}/releases/download/v2.0.0/{ASSET}"


class StableManifestTest(unittest.TestCase):
    def setUp(self):
        self.catalog = {"packages": [
            {"id": "youtube.leanback.v4", "manifest": {"id": "youtube.leanback.v4", "version": "1.2.5"}},
            {"id": "youtube.leanback.v4.beta", "manifest": {"id": "youtube.leanback.v4.beta", "version": "2.0.7-beta"}}
        ]}
        self.release = {
            "tag_name": "v2.0.0", "draft": False, "prerelease": False,
            "assets": [{"name": ASSET, "size": 123456, "digest": "sha256:" + DIGEST, "browser_download_url": URL}]
        }

    def test_valid_update_leaves_beta_untouched(self):
        before_beta = copy.deepcopy(self.catalog["packages"][1])
        result = module.update(self.catalog, self.release)
        stable = result["packages"][0]["manifest"]
        self.assertEqual(stable["version"], "2.0.0")
        self.assertEqual(stable["ipkUrl"], URL)
        self.assertEqual(stable["ipkHash"], {"sha256": DIGEST})
        self.assertEqual(stable["ipkSize"], 123456)
        self.assertEqual(result["packages"][1], before_beta)

    def test_rejects_prerelease(self):
        self.release["prerelease"] = True
        with self.assertRaises(ValueError):
            module.update(self.catalog, self.release)

    def test_rejects_wrong_asset(self):
        self.release["assets"][0]["name"] = "youtube.leanback.v4_2.0.7_arm.ipk"
        with self.assertRaises(ValueError):
            module.update(self.catalog, self.release)

    def test_rejects_bad_digest(self):
        self.release["assets"][0]["digest"] = ""
        with self.assertRaises(ValueError):
            module.update(self.catalog, self.release)

    def test_rejects_downgrade(self):
        self.catalog["packages"][0]["manifest"]["version"] = "2.1.0"
        with self.assertRaises(ValueError):
            module.update(self.catalog, self.release)

    def test_rejects_mismatched_url(self):
        self.release["assets"][0]["browser_download_url"] = URL + "-wrong"
        with self.assertRaises(ValueError):
            module.update(self.catalog, self.release)


if __name__ == "__main__":
    unittest.main()
