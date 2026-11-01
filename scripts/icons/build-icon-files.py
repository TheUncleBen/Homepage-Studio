# Builds Studio's offline copies of the built-in logos (owner choice, 1 Nov
# 2026: "Small offline copies"), so dashboards show logos without reaching a
# CDN. From a checkout of Dashboard Icons (Apache-2.0) at the commit pinned in
# build-icon-index.py, run after that script:
#   git clone --filter=blob:none --sparse https://github.com/homarr-labs/dashboard-icons.git di
#   git -C di checkout <ICONS_COMMIT> && git -C di sparse-checkout set webp
#   python3 -I scripts/icons/build-icon-files.py di
# It writes homepage/public/studio-icons/webp/<name>.webp for every logo in
# the index and every light version, at most 128 px on the long side (Studio
# shows logos at 48 px or less, so this covers 2x screens). Needs Pillow.
import json
import os
import re
import sys

from PIL import Image

SIZE = 128
QUALITY = 82
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,99}$")

source = sys.argv[1]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
public = os.path.join(root, "homepage", "public", "studio-icons")
with open(os.path.join(public, "index.json"), encoding="utf-8") as handle:
    names = {entry[0] for entry in json.load(handle)["icons"]}
with open(os.path.join(root, "homepage", "src", "components", "studio", "icon-variants.mjs"), encoding="utf-8") as handle:
    names |= set(re.findall(r':\s*"([^"]+)"', handle.read()))

out_dir = os.path.join(public, "webp")
os.makedirs(out_dir, exist_ok=True)
for existing in os.listdir(out_dir):
    if existing.endswith(".webp"):
        os.remove(os.path.join(out_dir, existing))

missing = []
total = 0
for name in sorted(names):
    if not NAME.match(name):
        continue
    path = os.path.join(source, "webp", name + ".webp")
    if not os.path.isfile(path) or os.path.islink(path):
        missing.append(name)
        continue
    with Image.open(path) as image:
        if image.format != "WEBP":
            missing.append(name)
            continue
        image = image.convert("RGBA")
        image.thumbnail((SIZE, SIZE), Image.LANCZOS)
        target = os.path.join(out_dir, name + ".webp")
        image.save(target, "WEBP", quality=QUALITY, method=6)
        total += os.path.getsize(target)

print(f"{len(names) - len(missing)} logos, {total / 1024 / 1024:.1f} MiB; missing: {', '.join(missing) or 'none'}")
