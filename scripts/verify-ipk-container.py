#!/usr/bin/env python3
"""Verify the outer IPK container without rewriting the ares-package output."""

from __future__ import annotations

import argparse
import io
from pathlib import Path
import tarfile


AR_MAGIC = b"!<arch>\n"
AR_HEADER_SIZE = 60
EXPECTED_MEMBERS = ("debian-binary", "control.tar.gz", "data.tar.gz")


def parse_decimal(field: bytes, label: str) -> int:
    try:
        return int(field.decode("ascii").strip())
    except ValueError as error:
        raise ValueError(f"Invalid {label} field: {field!r}") from error


def read_members(package: Path) -> dict[str, tuple[int, bytes]]:
    contents = package.read_bytes()
    if not contents.startswith(AR_MAGIC):
        raise ValueError("Missing ar archive magic")

    offset = len(AR_MAGIC)
    members: dict[str, tuple[int, bytes]] = {}
    order: list[str] = []

    while offset < len(contents):
        header = contents[offset : offset + AR_HEADER_SIZE]
        if len(header) != AR_HEADER_SIZE or header[58:60] != b"`\n":
            raise ValueError(f"Invalid ar member header at byte {offset}")

        raw_name = header[0:16].decode("ascii").rstrip()
        if raw_name.endswith("/"):
            raise ValueError(f"GNU ar member name is not webOS-compatible: {raw_name}")
        name = raw_name
        mtime = parse_decimal(header[16:28], "mtime")
        size = parse_decimal(header[48:58], "size")
        if mtime <= 0:
            raise ValueError(f"IPK member {name} has an invalid epoch timestamp")

        data_start = offset + AR_HEADER_SIZE
        data_end = data_start + size
        if data_end > len(contents):
            raise ValueError(f"IPK member {name} extends beyond the archive")

        order.append(name)
        members[name] = (mtime, contents[data_start:data_end])
        offset = data_end + (size % 2)

    if tuple(order) != EXPECTED_MEMBERS:
        raise ValueError(
            f"Unexpected IPK members: {order}; expected {list(EXPECTED_MEMBERS)}"
        )
    return members


def verify_tar(name: str, contents: bytes) -> None:
    try:
        with tarfile.open(fileobj=io.BytesIO(contents), mode="r:gz") as archive:
            archive.getmembers()
    except (tarfile.TarError, OSError) as error:
        raise ValueError(f"Invalid {name}: {error}") from error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ipk", type=Path)
    args = parser.parse_args()

    if not args.ipk.is_file():
        parser.error(f"IPK does not exist: {args.ipk}")

    try:
        members = read_members(args.ipk)
        if members["debian-binary"][1] != b"2.0\n":
            raise ValueError("debian-binary does not contain the IPK format version")
        verify_tar("control.tar.gz", members["control.tar.gz"][1])
        verify_tar("data.tar.gz", members["data.tar.gz"][1])
    except ValueError as error:
        parser.error(str(error))

    print(f"Valid webOS IPK container: {args.ipk}")


if __name__ == "__main__":
    main()
