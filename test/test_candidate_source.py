import gzip
import hashlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("candidate_source", ROOT / "scripts/pack-candidate-source.py")
PACKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKER)


class CorrespondingSourceTests(unittest.TestCase):
    def test_tree_archive_is_reproducible_and_preserves_source_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "src").mkdir()
            (source / "src/example.txt").write_text("synthetic source\n")
            (source / "build.sh").write_text("#!/bin/sh\nexit 0\n")
            (source / "build.sh").chmod(0o755)
            first = PACKER.archive_tree(source, "homepage")
            (source / "src/example.txt").touch()
            second = PACKER.archive_tree(source, "homepage")
            self.assertEqual(first, second)
            self.assertEqual(first[9], 255, "gzip OS byte must not vary across host/Python versions")
            with tarfile.open(fileobj=io.BytesIO(first), mode="r:gz") as archive:
                self.assertEqual(archive.getmember("homepage/build.sh").mode, 0o755)
                self.assertEqual(archive.getmember("homepage/src/example.txt").mtime, 0)
                self.assertEqual(archive.extractfile("homepage/src/example.txt").read(), b"synthetic source\n")

    def test_tree_archive_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "outside-link").symlink_to("/etc/passwd")
            with self.assertRaisesRegex(ValueError, "link"):
                PACKER.archive_tree(source, "homepage")

    def test_packer_requires_exact_clean_commit_and_excludes_untracked_files(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source"
            source.mkdir()
            subprocess.run(["git", "init", "--quiet", str(source)], check=True)
            (source / "scripts").mkdir()
            # Synthetic preparer; this tests bundling, not native source correctness.
            (source / "scripts/prepare-homepage.py").write_text('def prepare(root, target, archive):\n    target.mkdir()\n    (target / "LICENSE").write_text("synthetic license")\n')
            (source / "LICENSE").write_text("synthetic license")
            subprocess.run(["git", "-C", str(source), "add", "."], check=True)
            subprocess.run(["git", "-C", str(source), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "Synthetic source"], check=True)
            commit = PACKER.git(source, "rev-parse", "HEAD").decode().strip()
            (source / "runtime-secret-example").write_text("must not be archived")
            first = PACKER.pack(source, commit, base / "first")
            second = PACKER.pack(source, commit, base / "second")
            self.assertEqual(first, second)
            for name, digest in first.items():
                self.assertEqual(hashlib.sha256((base / "first" / name).read_bytes()).hexdigest(), digest)
            with tarfile.open(base / "first/studio-source.tar.gz", "r:gz") as archive:
                self.assertNotIn("studio/runtime-secret-example", archive.getnames())
            with self.assertRaisesRegex(ValueError, "already exists"):
                PACKER.pack(source, commit, base / "first")
            (source / "LICENSE").write_text("changed tracked source")
            with self.assertRaisesRegex(ValueError, "clean accepted commit"):
                PACKER.pack(source, commit, base / "third")


if __name__ == "__main__":
    unittest.main()
