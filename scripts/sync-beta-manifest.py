#!/usr/bin/env python3
"""Synchronize the Homebrew Channel beta entry from a published GitHub release."""
import argparse
import json
import os
from pathlib import Path
import re
import urllib.request

REPO = "RF1705/youtube-webos-cobalt-adfree"
PACKAGE = "youtube.leanback.v4"
BETA_ID = "youtube.leanback.v4.beta"
TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)-beta$")
ASSET_RE = re.compile(r"^youtube\.leanback\.v4_(\d+\.\d+\.\d+)_arm\.ipk$")


def update(repo_json, release):
    tag = release["tag_name"]
    match = TAG_RE.fullmatch(tag)
    if not match:
        raise ValueError(f"Not a beta release tag: {tag}")
    version = ".".join(match.groups())
    assets = [a for a in release.get("assets", []) if ASSET_RE.fullmatch(a["name"])]
    assets = [a for a in assets if ASSET_RE.fullmatch(a["name"]).group(1) == version]
    if len(assets) != 1:
        raise ValueError(f"Expected exactly one matching IPK asset for {tag}")
    asset = assets[0]
    digest = asset.get("digest") or ""
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("GitHub asset has no validated SHA-256 digest")
    if not isinstance(asset.get("size"), int) or asset["size"] <= 0:
        raise ValueError("Invalid release asset size")
    entries = [p for p in repo_json["packages"] if p["id"] == BETA_ID]
    if len(entries) != 1:
        raise ValueError("Expected exactly one beta catalog entry")
    manifest = entries[0]["manifest"]
    current = TAG_RE.fullmatch("v" + manifest["version"])
    if current and tuple(map(int, current.groups())) > tuple(map(int, match.groups())):
        raise ValueError(f"Refusing to downgrade {manifest['version']} to {tag}")
    manifest["version"] = version + "-beta"
    manifest["ipkUrl"] = asset["browser_download_url"]
    manifest["ipkHash"] = {"sha256": digest.removeprefix("sha256:")}
    manifest["ipkSize"] = asset["size"]
    return repo_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--file", type=Path, default=Path("repo.json"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not TAG_RE.fullmatch(args.tag):
        parser.error("Expected vMAJOR.MINOR.PATCH-beta")
    token = os.getenv("GH_TOKEN")
    if not token:
        parser.error("GH_TOKEN is required")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/releases/tags/{args.tag}",
        headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        release = json.load(response)
    if release.get("draft") or not release.get("prerelease"):
        raise ValueError("Release must be a published prerelease")
    original = json.loads(args.file.read_text(encoding="utf-8"))
    result = update(original, release)
    updated = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if args.file.read_text(encoding="utf-8") != updated:
            raise SystemExit("repo.json differs from published beta release")
    else:
        args.file.write_text(updated, encoding="utf-8")
    print(f"Verified Homebrew catalog for {args.tag}")


if __name__ == "__main__":
    main()
