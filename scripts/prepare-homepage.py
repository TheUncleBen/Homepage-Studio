#!/usr/bin/env python3
"""Prepare the exact upstream tree plus reviewed Studio overlay for build.

Downloads only public pinned source. Refuses an existing target, malformed
archive paths/links, source hash changes, or an unexpected preinstall hook.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unpack_verified(archive, destination, pin):
    if digest(archive) != pin["archiveSha256"]:
        raise ValueError("Homepage source archive does not match upstream.lock.json")
    prefix = "homepage-" + pin["commit"]
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            parts = Path(member.name).parts
            if not parts or parts[0] != prefix or Path(member.name).is_absolute() or ".." in parts:
                raise ValueError("Source archive contains an unsafe or unexpected path")
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise ValueError("Source archive contains a link or special file")
        tar.extractall(destination, filter="data")
    return destination / prefix


def apply_dependency_patches(package, lock_text, patches):
    """Apply explicitly reviewed direct-dependency changes, never resolve anew."""
    for patch in patches:
        name = patch["name"]
        if package.get("dependencies", {}).get(name) != patch["fromSpecifier"]:
            raise ValueError("Security patch dependency declaration changed")
        package["dependencies"][name] = patch["toVersion"]
        replacements = [
            (f'      {name}:\n        specifier: {patch["fromSpecifier"]}\n        version: {patch["fromVersion"]}(', f'      {name}:\n        specifier: {patch["toVersion"]}\n        version: {patch["toVersion"]}(', 1),
            (f'  {name}@{patch["fromVersion"]}:', f'  {name}@{patch["toVersion"]}:', 1),
            (f'  {name}@{patch["fromVersion"]}(', f'  {name}@{patch["toVersion"]}(', 1),
            (patch["fromIntegrity"], patch["toIntegrity"], 1),
        ]
        for before, after, expected_count in replacements:
            if lock_text.count(before) != expected_count:
                raise ValueError("Security patch lockfile anchor changed")
            lock_text = lock_text.replace(before, after)
    return lock_text


def prepare(root, target, archive=None, apply_overlay=True):
    lock = json.loads((root / "upstream.lock.json").read_text())
    pin = lock["homepage"]
    if target.exists() or target.is_symlink():
        raise ValueError("Build destination already exists; use a new empty destination")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="homepage-source-", dir=target.parent) as directory:
        temp = Path(directory)
        source_archive = archive or temp / "source.tar.gz"
        if archive is None:
            with urllib.request.urlopen(pin["archiveUrl"], timeout=60) as response, source_archive.open("wb") as output:
                shutil.copyfileobj(response, output)
        source = unpack_verified(source_archive, temp, pin)
        for name, key in [("package.json", "packageSha256"), ("pnpm-lock.yaml", "lockfileSha256")]:
            if digest(source / name) != pin[key]:
                raise ValueError("Pinned " + name + " has unexpected content")
        package = json.loads((source / "package.json").read_text())
        if package.get("scripts", {}).get("preinstall") != "npx only-allow pnpm":
            raise ValueError("Upstream package-manager guard changed; review the preparation transform")
        # Avoid executing an unlocked npx download merely to enforce a package manager.
        del package["scripts"]["preinstall"]
        package["packageManager"] = "pnpm@" + lock["pnpmVersion"]
        dependency_patches = lock.get("dependencyPatches", [])
        lock_text = apply_dependency_patches(package, (source / "pnpm-lock.yaml").read_text(), dependency_patches)
        (source / "package.json").write_text(json.dumps(package, indent=2) + "\n")
        (source / "pnpm-lock.yaml").write_text(lock_text)
        config = source / "config"
        config.mkdir(exist_ok=True)
        defaults = {"services.yaml": "[]\n", "widgets.yaml": "[]\n", "bookmarks.yaml": "[]\n", "settings.yaml": "{}\n", "docker.yaml": "{}\n", "kubernetes.yaml": "{}\n", "proxmox.yaml": "{}\n", "custom.css": "", "custom.js": ""}
        for name, text in defaults.items():
            (config / name).write_text(text)
        if apply_overlay:
            overlay = root / "overlay"
            if not overlay.is_dir() or overlay.is_symlink():
                raise ValueError("Reviewed native overlay is missing")
            patcher = root / "scripts/apply-homepage-overlay.mjs"
            if not patcher.is_file() or patcher.is_symlink():
                raise ValueError("Exact-source native overlay transform is missing")
            # Validate the original page and its composition tests before replacing
            # them. The final transform still checks each remaining source anchor.
            subprocess.run(["node", str(patcher), str(source), "--verify-baseline"], check=True)
            for item in overlay.rglob("*"):
                if item.is_symlink():
                    raise ValueError("Native overlay must not contain symlinks")
                if item.is_file():
                    output = source / item.relative_to(overlay)
                    output.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(item, output)
            subprocess.run(["node", str(patcher), str(source)], check=True)
        for name, key in [("package.json", "runtimePackageSha256"), ("pnpm-lock.yaml", "runtimeLockfileSha256")]:
            if key in pin and digest(source / name) != pin[key]:
                raise ValueError("Prepared " + name + " differs from the reviewed runtime dependency lock")
        manifest = {
            "upstreamCommit": pin["commit"],
            "upstreamVersion": pin["version"],
            "sourceArchiveSha256": pin["archiveSha256"],
            "pnpmVersion": lock["pnpmVersion"],
            "overlayApplied": apply_overlay,
            "packageManagerGuardRemoved": True,
            "runtimePackageSha256": digest(source / "package.json"),
            "runtimeLockfileSha256": digest(source / "pnpm-lock.yaml"),
            "dependencyPatches": [{"name": patch["name"], "fromVersion": patch["fromVersion"], "toVersion": patch["toVersion"], "advisories": patch["advisories"]} for patch in dependency_patches],
        }
        (source / "studio-source.json").write_text(json.dumps(manifest, indent=2) + "\n")
        source.rename(target)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--target", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--without-overlay", action="store_true", help="Prepare only pinned upstream for inspection; never use as a Studio image")
    args = parser.parse_args()
    root = args.root.resolve()
    # Preserve a final symlink long enough for prepare() to reject it.
    target = (args.target or root / ".build/homepage").absolute()
    result = prepare(root, target, args.archive.resolve() if args.archive else None, not args.without_overlay)
    print(json.dumps({"destination": str(target), **result}, indent=2))
