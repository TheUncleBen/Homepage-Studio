#!/usr/bin/env python3
"""Validate exact Docker inputs and package one reproducible corresponding source.

The controlled Homepage fork and its license are tracked in the same commit as
Studio. No upstream download, generated overlay or second archive is involved.
"""
import argparse
import fnmatch
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def compress(raw):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, filename="", mode="wb", mtime=0) as stream:
        stream.write(raw)
    return output.getvalue()


def docker_inputs(root):
    """Fail closed on unsupported COPY syntax instead of skipping new inputs."""
    contents = (root / "Dockerfile").read_text()
    sources = set()
    for line in re.sub(r"\\\s*\n", " ", contents).splitlines():
        match = re.match(r"\s*(COPY|ADD)\s+(.+)$", line, re.IGNORECASE)
        if not match:
            continue
        if match[1].upper() == "ADD":
            raise ValueError("Use explicit local COPY inputs; ADD is not supported by the source guard")
        value = match[2]
        flags = []
        while value.startswith("--"):
            flag, separator, value = value.partition(" ")
            if not separator:
                raise ValueError("Invalid Docker COPY instruction")
            flags.append(flag)
            value = value.lstrip()
        if any(flag.startswith("--from=") for flag in flags):
            continue
        if any(not flag.startswith(("--chown=", "--chmod=")) for flag in flags):
            raise ValueError("Unsupported Docker COPY flag in source guard")
        parts = json.loads(value) if value.startswith("[") else shlex.split(value)
        if not isinstance(parts, list) or len(parts) < 2:
            raise ValueError("Invalid Docker COPY sources")
        for item in parts[:-1]:
            source = PurePosixPath(item)
            if source.is_absolute() or ".." in source.parts or re.search(r"[$*?\[]", item):
                raise ValueError("Docker inputs must use explicit repository-relative paths")
            normalized = source.as_posix()
            if not (root / normalized).exists():
                raise ValueError(f"Docker input is missing: {normalized}")
            sources.add(normalized)
    if not sources:
        raise ValueError("No Docker source inputs found")
    return sorted(sources)


def ignored_by_docker(root, relative):
    # Our committed ignore file deliberately uses only positive glob rules.
    # Refuse a later negation rather than incorrectly approving build inputs.
    rules = (root / ".dockerignore").read_text().splitlines()
    prefixes = ["/".join(relative.split("/")[:index]) for index in range(1, len(relative.split("/")) + 1)]
    for raw in rules:
        rule = raw.strip()
        if not rule or rule.startswith("#") or rule == ".":
            continue
        if rule.startswith("!") or "\\" in rule:
            raise ValueError("Unsupported Docker ignore rule; review the corresponding-source guard")
        rule = rule.strip("/")
        # Docker's unqualified patterns match root entries; explicit ** rules
        # below cover generated directories at any depth.
        candidates = prefixes if "/" in rule else prefixes[:1]
        patterns = [rule, rule[3:]] if rule.startswith("**/") else [rule]
        if any(fnmatch.fnmatchcase(candidate, pattern) for candidate in candidates for pattern in patterns):
            return True
    return False


def validate_source(root, commit):
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or commit == "0" * 40:
        raise ValueError("An exact source commit is required")
    if git(root, "rev-parse", "HEAD").decode().strip() != commit or git(root, "status", "--porcelain", "--untracked-files=no").strip():
        raise ValueError("Corresponding source must be prepared from the clean accepted commit")
    if set(filter(None, git(root, "ls-files", "-z", "--", "Dockerfile", ".dockerignore").decode().split("\0"))) != {"Dockerfile", ".dockerignore"}:
        raise ValueError("Dockerfile and Docker exclusions must belong to the accepted source commit")
    inputs = docker_inputs(root)
    # No --exclude-standard: ignored local source can change the Docker build
    # just as easily as visibly untracked source. Only actual Docker exclusions
    # are allowed within the copied subtrees.
    untracked = git(root, "ls-files", "--others", "-z", "--", *inputs).decode().split("\0")
    for item in filter(None, untracked):
        if not ignored_by_docker(root, item):
            raise ValueError(f"Untracked Docker input would change accepted source: {item}")
    tracked = git(root, "ls-files", "--stage", "-z", "--", *inputs).decode().split("\0")
    for item in filter(None, tracked):
        metadata, name = item.split("\t", 1)
        if metadata.split()[0] == "120000" and not ignored_by_docker(root, name):
            raise ValueError(f"Docker source inputs must not be symlinks: {name}")
    generated = re.compile(r"^homepage/(?:.*\/)?(?:node_modules|\.next|\.pnpm-store)(?:/|$)|^homepage/(?:next-env\.d\.ts|[^/]+\.tsbuildinfo)$")
    for name in filter(None, git(root, "ls-files", "-z", "--", "homepage").decode().split("\0")):
        if generated.search(name):
            raise ValueError(f"Generated native build output must not enter corresponding source: {name}")
    return {"sourceCommit": commit, "dockerInputs": inputs}


def pack(root, commit, destination):
    validate_source(root, commit)
    if destination.exists() or destination.is_symlink():
        raise ValueError("Source archive output already exists")
    contents = compress(git(root, "archive", "--format=tar", "--prefix=studio/", commit))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.mkdir()
    output = destination / "studio-source.tar.gz"
    try:
        with output.open("xb") as stream:
            stream.write(contents)
    except Exception:
        output.unlink(missing_ok=True)
        destination.rmdir()
        raise
    return {output.name: hashlib.sha256(contents).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--output", type=Path)
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = validate_source(args.source.resolve(), args.commit) if args.check else pack(args.source.resolve(), args.commit, args.output.absolute())
    print(json.dumps(result, sort_keys=True))
