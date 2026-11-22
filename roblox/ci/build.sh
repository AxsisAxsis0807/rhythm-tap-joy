#!/usr/bin/env bash
set -euo pipefail

download_release() {
  local repository=$1 tag=$2 asset=$3 destination=$4 metadata digest
  mkdir -p "$destination"
  metadata=$(curl -qfsS --max-time 30 "https://api.github.com/repos/$repository/releases/tags/$tag")
  digest=$(jq -er --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest | select(test("^sha256:[a-f0-9]{64}$"))' <<<"$metadata")
  curl -qfsSL --proto '=https' --max-time 90 \
    "https://github.com/$repository/releases/download/$tag/$asset" -o "$destination/release.zip"
  printf '%s  %s\n' "${digest#sha256:}" "$destination/release.zip" | sha256sum --check --status
  unzip -q "$destination/release.zip" -d "$destination"
}

tools_dir=$(mktemp -d)
trap 'rm -rf -- "$tools_dir"' EXIT
download_release rojo-rbx/rojo v7.6.1 rojo-7.6.1-linux-x86_64.zip "$tools_dir/rojo"
download_release luau-lang/luau 0.744 luau-ubuntu.zip "$tools_dir/luau"

for source in roblox/src/*.luau roblox/tests/*.luau; do
  "$tools_dir/luau/luau-compile" "$source" >/dev/null
done
"$tools_dir/luau/luau-analyze" roblox/src/InputState.luau roblox/src/Practice.luau roblox/tests/practice.test.luau
"$tools_dir/luau/luau" roblox/tests/practice.test.luau
"$tools_dir/rojo/rojo" --version
"$tools_dir/rojo/rojo" build roblox/default.project.json --output roblox/PulseLane.rbxlx
python3 - <<'PY'
from pathlib import Path
from xml.etree import ElementTree

place = Path("roblox/PulseLane.rbxlx")
assert 0 < place.stat().st_size <= 100 * 1024 * 1024
root = ElementTree.parse(place).getroot()
assert root.tag == "roblox"
assert len(root.findall(".//Item[@class='LocalScript']")) == 1
assert len(root.findall(".//Item[@class='ModuleScript']")) == 3
PY
