#!/usr/bin/env python3
"""Synchronize the stable Homebrew catalog entry from a published GitHub release."""
import argparse
import json
import os
from pathlib import Path
import re
import urllib.request

REPO = "RF1705/youtube-webos-cobalt-adfree"
PACKAGE_ID = "youtube.leanback.v4"
TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
ASSET_RE = re.compile(r"^youtube\.leanback\.v4_(\d+\.\d+\.\d+)_arm\.ipk$")


def update(catalog, release):
    tag = release["tag_name"]
    match = TAG_RE.fullmatch(tag)
    if not match:
        raise ValueError(f"Not a stable release tag: {tag}")
    if release.get("draft") or release.get("prerelease"):
        raise ValueError("Release must be a published stable release")
    version = ".".join(match.groups())
    assets = [
        asset for asset in release.get("assets", [])
        if ASSET_RE.fullmatch(asset["name"])
        and ASSET_RE.fullmatch(asset["name"]).group(1) == version
    ]
    if len(assets) != 1:
        raise ValueError(f"Expected exactly one matching stable IPK for {tag}")
    asset = assets[0]
    digest = asset.get("digest") or ""
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("Release asset is missing a valid SHA-256 digest")
    if not isinstance(asset.get("size"), int) or asset["size"] <= 0:
        raise ValueError("Release asset has an invalid size")
    expected_url = (
        f"https://github.com/{REPO}/releases/download/{tag}/{asset['name']}"
    )
    if asset.get("browser_download_url") != expected_url:
        raise ValueError("Unexpected release asset URL")
    entries = [p for p in catalog["packages"] if p["id"] == PACKAGE_ID]
    if len(entries) != 1:
        raise ValueError("Expected exactly one stable catalog entry")
    manifest = entries[0]["manifest"]
    previous = manifest["version"]
    previous_match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", previous)
    if previous_match and tuple(map(int, previous_match.groups())) > tuple(map(int, match.groups())):
        raise ValueError(f"Refusing to downgrade {previous} to {version}")
    if manifest["id"] != PACKAGE_ID:
        raise ValueError("Stable package app ID mismatch")
    manifest["version"] = version
    manifest["ipkUrl"] = expected_url
    manifest["ipkHash"] = {"sha256": digest.removeprefix("sha256:")}
    manifest["ipkSize"] = asset["size"]
    return catalog


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--file", type=Path, default=Path("repo.json"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not TAG_RE.fullmatch(args.tag):
        parser.error("Expected vMAJOR.MINOR.PATCH (stable release)")
    token = os.getenv("GH_TOKEN")
    if not token:
        parser.error("GH_TOKEN is required")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/releases/tags/{args.tag}",
        headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        release = json.load(response)
    if not release.get("published_at"):
        raise ValueError("Release has not been published")
    original = args.file.read_text(encoding="utf-8")
    updated = json.dumps(update(json.loads(original), release), indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if original != updated:
            raise SystemExit("repo.json differs from the published stable release")
    else:
        args.file.write_text(updated, encoding="utf-8")
    print(f"Verified stable Homebrew catalog for {args.tag}")


if __name__ == "__main__":
    main()
