#!/usr/bin/env python3
"""Exercise the actual built standalone renderer with isolated synthetic files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


EMPTY = {
    "services.yaml": "[]\n", "widgets.yaml": "[]\n", "bookmarks.yaml": "[]\n",
    "settings.yaml": "{}\n", "docker.yaml": "{}\n", "kubernetes.yaml": "{}\n",
    "proxmox.yaml": "{}\n", "custom.css": "", "custom.js": "",
}


def request(origin, path):
    try:
        with urllib.request.urlopen(origin + path, timeout=5) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def check(source, expected_status, populated):
    files = dict(EMPTY)
    if populated:
        files.update({
            "widgets.yaml": json.dumps([{"search": {"provider": "duckduckgo", "target": "_blank"}}, {"greeting": {"text": "Persisted greeting"}}]),
            "services.yaml": json.dumps([{"Media": [{"Library": {"href": "https://example.test/", "widget": {"type": "sonarr", "url": "http://fixture.invalid", "key": "fictional-service-secret"}}}]}]),
            "bookmarks.yaml": json.dumps([{"Links": [{"Docs": [{"href": "https://docs.example.test/"}]}]}]),
            "settings.yaml": json.dumps({"title": "Persisted Studio", "providers": {"weatherapi": "fictional-provider-secret"}}),
        })
    with tempfile.TemporaryDirectory(prefix="homepage-studio-native-ssr-") as directory:
        root = Path(directory)
        config = root / "config"
        config.mkdir()
        for name, contents in files.items():
            (config / name).write_text(contents)
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        env = dict(os.environ, NODE_ENV="production", HOSTNAME="127.0.0.1", PORT=str(port), HOMEPAGE_ALLOWED_HOSTS=f"127.0.0.1:{port}", HOMEPAGE_CONFIG_DIR=str(config), LOG_TARGETS="stdout")
        with (root / "renderer.log").open("w+") as log:
            process = subprocess.Popen(["node", str(source / ".next/standalone/server.js")], cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 20
                while True:
                    if process.poll() is not None:
                        raise RuntimeError("Standalone renderer exited before readiness")
                    try:
                        health, _ = request(origin, "/api/studio/health")
                        if health == 200:
                            break
                    except (OSError, urllib.error.URLError):
                        pass
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Standalone renderer did not become ready")
                    time.sleep(0.1)
                status, html = request(origin, "/")
                if status != expected_status:
                    raise AssertionError(f"GET / returned {status}; expected {expected_status}")
                data_status, body = request(origin, "/api/studio/data")
                if data_status != 200:
                    raise AssertionError(f"Native render data returned {data_status}")
                data = json.loads(body)
                expected_types = ["search", "greeting"] if populated else []
                if [widget["type"] for widget in data["widgets"]] != expected_types:
                    raise AssertionError("Native widget data did not preserve the fixture configuration")
                if "fictional-provider-secret" in html + body or "fictional-service-secret" in html + body:
                    raise AssertionError("A fictional private value crossed the native SSR/render-data boundary")
                if expected_status == 200:
                    if 'class="studio-app"' not in html:
                        raise AssertionError("GET / did not render the actual Studio main page")
                    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html)
                    if not match:
                        raise AssertionError("Next SSR page data was missing")
                    props = json.loads(match.group(1))["props"]["pageProps"]
                    if [widget["type"] for widget in props["fallback"]["/api/widgets"]] != expected_types:
                        raise AssertionError("Native SSR widget fallback was lost")
                elif "Cannot convert undefined or null to object" not in (root / "renderer.log").read_text():
                    raise AssertionError("The expected baseline Quick Launch failure was not reproduced")
                for name, contents in files.items():
                    if (config / name).read_text() != contents:
                        raise AssertionError(f"Native startup modified the synthetic fixture: {name}")
                if sorted(path.name for path in config.iterdir()) != sorted(files):
                    raise AssertionError("Native startup installed unexpected sample configuration")
                return {"fixture": "populated-nine-files" if populated else "empty-nine-files", "status": status, "nativeDataStatus": data_status, "widgetTypes": expected_types, "filesUnchanged": True, "privateValuesAbsent": True}
            except Exception:
                log.flush()
                print((root / "renderer.log").read_text()[-6000:])
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--native-source", type=Path, required=True)
    parser.add_argument("--expect-status", type=int, default=200, choices=[200, 500])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    source = args.native_source.resolve()
    results = [check(source, args.expect_status, populated) for populated in [False, True]]
    payload = {"expectedStatus": args.expect_status, "standaloneServerSha256": hashlib.sha256((source / ".next/standalone/server.js").read_bytes()).hexdigest(), "pageBundleSha256": hashlib.sha256((source / ".next/server/pages/index.js").read_bytes()).hexdigest(), "results": results}
    encoded = json.dumps(payload, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded)
    print(encoded, end="")
