import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("prepare_homepage", ROOT / "scripts/prepare-homepage.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SourcePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="studio-source-test-")
        self.root = Path(self.temporary.name)
        self.commit = "a" * 40
        self.prefix = "homepage-" + self.commit
        self.package = json.dumps({"name": "homepage", "scripts": {"preinstall": "npx only-allow pnpm"}}).encode()
        self.lockfile = b"lockfileVersion: '9.0'\n"

    def tearDown(self):
        self.temporary.cleanup()

    def archive(self, extra=None):
        archive = self.root / "source.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for name, value in [(self.prefix + "/package.json", self.package), (self.prefix + "/pnpm-lock.yaml", self.lockfile)]:
                item = tarfile.TarInfo(name)
                item.size = len(value)
                tar.addfile(item, io.BytesIO(value))
            if extra:
                tar.addfile(extra)
        pin = {"version": "2.6.0", "commit": self.commit, "archiveSha256": MODULE.digest(archive), "packageSha256": hashlib.sha256(self.package).hexdigest(), "lockfileSha256": hashlib.sha256(self.lockfile).hexdigest()}
        (self.root / "upstream.lock.json").write_text(json.dumps({"homepage": pin, "pnpmVersion": "10.34.7"}))
        return archive, pin

    def test_verified_source_retains_lock_and_gets_empty_build_config(self):
        archive, _ = self.archive()
        target = self.root / "prepared"
        manifest = MODULE.prepare(self.root, target, archive, False)
        self.assertEqual((target / "pnpm-lock.yaml").read_bytes(), self.lockfile)
        package = json.loads((target / "package.json").read_text())
        self.assertNotIn("preinstall", package["scripts"])
        self.assertEqual(package["packageManager"], "pnpm@10.34.7")
        self.assertFalse(manifest["overlayApplied"])
        self.assertEqual(len(list((target / "config").iterdir())), 9)
        self.assertEqual((target / "config/services.yaml").read_text(), "[]\n")
        self.assertEqual((target / "config/custom.js").read_text(), "")

    def test_archive_hash_mismatch_does_not_create_a_destination(self):
        archive, pin = self.archive()
        archive.write_bytes(archive.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "does not match"):
            MODULE.unpack_verified(archive, self.root / "out", pin)
        self.assertFalse((self.root / "out").exists())

    def test_archive_paths_links_and_special_files_are_rejected(self):
        cases = [tarfile.TarInfo("../escape"), tarfile.TarInfo("/absolute"), tarfile.TarInfo("wrong-prefix/file")]
        link = tarfile.TarInfo(self.prefix + "/link")
        link.type = tarfile.SYMTYPE
        link.linkname = "../../escape"
        cases.append(link)
        hardlink = tarfile.TarInfo(self.prefix + "/hardlink")
        hardlink.type = tarfile.LNKTYPE
        hardlink.linkname = self.prefix + "/package.json"
        cases.append(hardlink)
        fifo = tarfile.TarInfo(self.prefix + "/pipe")
        fifo.type = tarfile.FIFOTYPE
        cases.append(fifo)
        for extra in cases:
            with self.subTest(name=extra.name, type=extra.type):
                archive, pin = self.archive(extra)
                with self.assertRaises(ValueError):
                    MODULE.unpack_verified(archive, self.root / "out", pin)
                self.assertFalse((self.root / "out").exists())

    def test_existing_build_destination_is_preserved(self):
        archive, _ = self.archive()
        target = self.root / "prepared"
        target.mkdir()
        (target / "keep").write_text("existing")
        with self.assertRaisesRegex(ValueError, "already exists"):
            MODULE.prepare(self.root, target, archive, False)
        self.assertEqual((target / "keep").read_text(), "existing")

    def test_cli_refuses_a_symlink_destination_before_resolving_it(self):
        archive, _ = self.archive()
        target = self.root / "link"
        actual = self.root / "should-not-be-created"
        target.symlink_to(actual, target_is_directory=True)
        result = subprocess.run([sys.executable, str(ROOT / "scripts/prepare-homepage.py"), "--root", str(self.root), "--target", str(target), "--archive", str(archive), "--without-overlay"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("already exists", result.stderr)
        self.assertFalse(actual.exists())

    def test_security_lock_transform_changes_only_recorded_dependency_anchors(self):
        package = {"dependencies": {"follow-redirects": "^1.16.0", "unrelated": "1.0.0"}}
        text = "      follow-redirects:\n        specifier: ^1.16.0\n        version: 1.16.0(debug@4.4.3)\n  follow-redirects@1.16.0:\n    resolution: {integrity: old-integrity}\n  follow-redirects@1.16.0(debug@4.4.3):\n    optionalDependencies: {}\n  unrelated@1.0.0: {}\n"
        patch = {"name": "follow-redirects", "fromSpecifier": "^1.16.0", "fromVersion": "1.16.0", "toVersion": "1.16.1", "fromIntegrity": "old-integrity", "toIntegrity": "new-integrity"}
        result = MODULE.apply_dependency_patches(package, text, [patch])
        self.assertEqual(package["dependencies"], {"follow-redirects": "1.16.1", "unrelated": "1.0.0"})
        self.assertIn("  unrelated@1.0.0: {}\n", result)
        self.assertNotIn("1.16.0", result)
        self.assertNotIn("old-integrity", result)
        with self.assertRaisesRegex(ValueError, "declaration changed"):
            MODULE.apply_dependency_patches(package, result, [patch])
        with self.assertRaisesRegex(ValueError, "anchor changed"):
            MODULE.apply_dependency_patches({"dependencies": {"follow-redirects": "^1.16.0"}}, text.replace("old-integrity", "unexpected-integrity"), [patch])

    def test_changed_package_manager_guard_fails_closed(self):
        self.package = b'{"scripts":{"preinstall":"changed-command"}}'
        archive, _ = self.archive()
        with self.assertRaisesRegex(ValueError, "guard changed"):
            MODULE.prepare(self.root, self.root / "prepared", archive, False)
        self.assertFalse((self.root / "prepared").exists())

    def test_missing_or_symlinked_overlay_cannot_produce_a_studio_source(self):
        archive, _ = self.archive()
        target = self.root / "prepared"
        with self.assertRaisesRegex(ValueError, "overlay is missing"):
            MODULE.prepare(self.root, target, archive)
        actual = self.root / "actual-overlay"
        actual.mkdir()
        (self.root / "overlay").symlink_to(actual, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "overlay is missing"):
            MODULE.prepare(self.root, target, archive)
        self.assertFalse(target.exists())

    def test_original_source_is_verified_before_overlay_replacement(self):
        archive, _ = self.archive()
        overlay = self.root / "overlay"
        overlay.mkdir()
        (overlay / "panel.txt").write_text("reviewed overlay")
        scripts = self.root / "scripts"
        scripts.mkdir()
        (scripts / "apply-homepage-overlay.mjs").write_text('''
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const source = process.argv[2];
if (process.argv[3] === "--verify-baseline") {
  if (existsSync(join(source, "panel.txt"))) throw Error("Original source was already replaced");
  writeFileSync(join(source, "baseline-verified.txt"), "verified");
} else {
  if (readFileSync(join(source, "baseline-verified.txt"), "utf8") !== "verified") throw Error("Baseline was not verified");
  if (readFileSync(join(source, "panel.txt"), "utf8") !== "reviewed overlay") throw Error("Overlay is missing");
  writeFileSync(join(source, "transform-applied.txt"), "applied");
}
''')
        target = self.root / "prepared"
        result = MODULE.prepare(self.root, target, archive)
        self.assertTrue(result["overlayApplied"])
        self.assertEqual((target / "transform-applied.txt").read_text(), "applied")

    def test_failed_original_source_verification_cannot_create_a_studio_source(self):
        archive, _ = self.archive()
        (self.root / "overlay").mkdir()
        scripts = self.root / "scripts"
        scripts.mkdir()
        (scripts / "apply-homepage-overlay.mjs").write_text('if (process.argv[3] === "--verify-baseline") process.exit(9);\n')
        target = self.root / "prepared"
        with self.assertRaises(subprocess.CalledProcessError):
            MODULE.prepare(self.root, target, archive)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
