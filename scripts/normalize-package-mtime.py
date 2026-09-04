#!/usr/bin/env python3
"""Normalize package-tree timestamps before ares-package creates the IPK."""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def set_mtime(path: Path, timestamp: int) -> None:
    os.utime(path, (timestamp, timestamp), follow_symlinks=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package_dir", type=Path)
    parser.add_argument("--mtime", type=int, required=True)
    args = parser.parse_args()

    package_dir = args.package_dir.resolve()
    if not package_dir.is_dir():
        parser.error(f"Package directory does not exist: {package_dir}")

    # Set children first and directories last so traversing the tree does not
    # leave directory mtimes newer than their contents.
    paths = sorted(package_dir.rglob("*"), key=lambda path: len(path.parts), reverse=True)
    for path in paths:
        set_mtime(path, args.mtime)
    set_mtime(package_dir, args.mtime)


if __name__ == "__main__":
    main()
