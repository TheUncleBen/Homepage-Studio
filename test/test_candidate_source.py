import hashlib
import importlib.util
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
    def source(self, directory):
        source = Path(directory) / "source"
        source.mkdir()
        subprocess.run(["git", "init", "--quiet", str(source)], check=True)
        for name in ["homepage/src/utils/config/reader.js", "server/index.mjs", "public/studio.js", "third-party/NOTICE", "scripts/runtime.mjs"]:
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("// accepted source\n")
        (source / "homepage/LICENSE").write_text("Synthetic native GPL fixture\n")
        (source / "LICENSE").write_text("Synthetic Studio license fixture\n")
        (source / "scripts/runtime.mjs").chmod(0o755)
        (source / "Dockerfile").write_text("FROM scratch\nCOPY homepage/ /app/homepage/\nCOPY --chown=1000:1000 server public third-party scripts /app/\nCOPY LICENSE /app/LICENSE\n")
        (source / ".gitignore").write_text("ignored-local.js\nnode_modules/\n.next/\n/homepage/config/\n/homepage/next-env.d.ts\n/homepage/*.tsbuildinfo\n")
        (source / ".dockerignore").write_text("**/node_modules\n**/.next\n/homepage/config\n**/next-env.d.ts\n**/*.tsbuildinfo\n")
        self.commit(source)
        return source, PACKER.git(source, "rev-parse", "HEAD").decode().strip()

    def commit(self, source):
        subprocess.run(["git", "-C", str(source), "add", "."], check=True)
        subprocess.run(["git", "-C", str(source), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "Synthetic source"], check=True)

    def test_untracked_and_ignored_files_under_every_docker_copied_tree_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source, commit = self.source(directory)
            for tree in ["homepage/src/utils/config", "server", "public", "third-party", "scripts"]:
                for name in ["untracked-local.js", "ignored-local.js"]:
                    with self.subTest(tree=tree, name=name):
                        local = source / tree / name
                        local.write_text("// must not enter the build\n")
                        self.assertEqual(PACKER.git(source, "status", "--porcelain", "--untracked-files=no").strip(), b"")
                        with self.assertRaisesRegex(ValueError, "Untracked Docker input"):
                            PACKER.pack(source, commit, Path(directory) / "rejected")
                        self.assertFalse((Path(directory) / "rejected").exists())
                        local.unlink()

    def test_single_archive_is_reproducible_complete_and_preserves_executable_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            source, commit = self.source(directory)
            (source / "runtime-secret-example").write_text("outside Docker inputs and Git\n")
            first = PACKER.pack(source, commit, Path(directory) / "first")
            second = PACKER.pack(source, commit, Path(directory) / "second")
            self.assertEqual(first, second)
            self.assertEqual(list(first), ["studio-source.tar.gz"])
            archive_path = Path(directory) / "first/studio-source.tar.gz"
            self.assertEqual(hashlib.sha256(archive_path.read_bytes()).hexdigest(), first[archive_path.name])
            self.assertEqual(archive_path.read_bytes()[9], 255)
            with tarfile.open(archive_path, "r:gz") as archive:
                self.assertEqual(archive.extractfile("studio/homepage/LICENSE").read(), b"Synthetic native GPL fixture\n")
                self.assertIn("studio/homepage/src/utils/config/reader.js", archive.getnames())
                self.assertEqual(archive.getmember("studio/scripts/runtime.mjs").mode, 0o775)
                self.assertNotIn("studio/runtime-secret-example", archive.getnames())
            with self.assertRaisesRegex(ValueError, "already exists"):
                PACKER.pack(source, commit, Path(directory) / "first")

    def test_actual_docker_exclusions_allow_local_dependencies_and_build_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            source, commit = self.source(directory)
            for name in ["homepage/node_modules/local/index.js", "homepage/.next/server.js", "homepage/config/settings.yaml", "homepage/next-env.d.ts", "homepage/tsconfig.tsbuildinfo"]:
                target = source / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("generated locally, excluded from Docker input\n")
            self.assertEqual(PACKER.validate_source(source, commit)["sourceCommit"], commit)
            output = Path(directory) / "source-output"
            PACKER.pack(source, commit, output)
            with tarfile.open(output / "studio-source.tar.gz", "r:gz") as archive:
                self.assertFalse(any("node_modules" in name or ".next/" in name or "/homepage/config/" in name for name in archive.getnames()))

    def test_exact_clean_identity_and_external_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            source, commit = self.source(directory)
            with self.assertRaisesRegex(ValueError, "exact source commit"):
                PACKER.validate_source(source, "main")
            with self.assertRaisesRegex(ValueError, "clean accepted commit"):
                PACKER.validate_source(source, "f" * 40)
            (source / "LICENSE").write_text("changed tracked source")
            with self.assertRaisesRegex(ValueError, "clean accepted commit"):
                PACKER.validate_source(source, commit)
            PACKER.git(source, "checkout", "--", "LICENSE")
            (source / "homepage/outside-link").symlink_to("/etc/passwd")
            self.commit(source)
            commit = PACKER.git(source, "rev-parse", "HEAD").decode().strip()
            with self.assertRaisesRegex(ValueError, "symlinks"):
                PACKER.validate_source(source, commit)


if __name__ == "__main__":
    unittest.main()
