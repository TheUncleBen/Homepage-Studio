#!/usr/bin/env python3
"""Create reproducible corresponding-source archives from one clean build commit.

No image build or publication. The two archive hashes belong in the candidate
manifest before acceptance; official promotion must reproduce those hashes.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

from importlib.util import module_from_spec, spec_from_file_location


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def compress(raw):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, filename="", mode="wb", mtime=0) as stream:
        stream.write(raw)
    return output.getvalue()


def archive_tree(source, prefix):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as output:
        for item in sorted(source.rglob("*")):
            if item.is_symlink() or not (item.is_file() or item.is_dir()):
                raise ValueError("Corresponding source contains a link or special file")
            info = output.gettarinfo(str(item), arcname=prefix + "/" + item.relative_to(source).as_posix())
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            info.pax_headers = {}
            info.mode = 0o755 if item.is_dir() or item.stat().st_mode & 0o111 else 0o644
            if item.is_file():
                with item.open("rb") as stream:
                    output.addfile(info, stream)
            else:
                output.addfile(info)
    return compress(raw.getvalue())


def pack(root, commit, destination, archive=None):
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or commit == "0" * 40:
        raise ValueError("An exact source commit is required")
    if git(root, "rev-parse", "HEAD").decode().strip() != commit or git(root, "status", "--porcelain", "--untracked-files=no").strip():
        raise ValueError("Corresponding source must be prepared from the clean accepted commit")
    if destination.exists() or destination.is_symlink():
        raise ValueError("Source archive output already exists")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="studio-corresponding-source-", dir=destination.parent) as directory:
        temporary = Path(directory)
        # Load the pinned preparation code from the exact source checkout.
        module_spec = spec_from_file_location("studio_source_prepare", root / "scripts/prepare-homepage.py")
        module = module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        native = temporary / "homepage"
        module.prepare(root, native, archive)
        files = {
            "studio-source.tar.gz": compress(git(root, "archive", "--format=tar", "--prefix=studio/", commit)),
            "homepage-source.tar.gz": archive_tree(native, "homepage"),
        }
        destination.mkdir()
        try:
            for name, contents in files.items():
                with (destination / name).open("xb") as stream:
                    stream.write(contents)
        except Exception:
            for item in destination.iterdir():
                item.unlink()
            destination.rmdir()
            raise
    return {name: hashlib.sha256(contents).hexdigest() for name, contents in files.items()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--upstream-archive", type=Path)
    args = parser.parse_args()
    print(json.dumps(pack(args.source.resolve(), args.commit, args.output.absolute(), args.upstream_archive), sort_keys=True))
