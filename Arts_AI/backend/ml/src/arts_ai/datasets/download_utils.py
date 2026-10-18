"""Resumable downloads, archive validation and caching."""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Iterable

import requests
from tqdm import tqdm

from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger

logger = get_logger("arts_ai.datasets")


def download_file(
    url: str,
    dest: Path,
    *,
    expected_sha256: str | None = None,
    chunk_size: int = 1 << 20,
    timeout: int = 120,
    max_retries: int = 3,
) -> Path:
    """Download with resume support via HTTP Range when possible."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")

    if dest.exists() and expected_sha256:
        digest = file_sha256(dest)
        if digest == expected_sha256:
            logger.info("Cached hit (checksum OK): %s", dest)
            return dest
        logger.warning("Checksum mismatch for %s; re-downloading", dest)

    if dest.exists() and not expected_sha256:
        logger.info("Cached file present: %s", dest)
        return dest

    headers: dict[str, str] = {}
    mode = "wb"
    resume_from = 0
    if part.exists():
        resume_from = part.stat().st_size
        headers["Range"] = f"bytes={resume_from}-"
        mode = "ab"
        logger.info("Resuming download from byte %s", resume_from)

    last_err: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            with requests.get(url, stream=True, headers=headers, timeout=timeout) as r:
                if r.status_code == 416:
                    # Already complete
                    part.replace(dest)
                    return dest
                r.raise_for_status()
                total = r.headers.get("Content-Length")
                total_i = int(total) + resume_from if total else None
                with part.open(mode) as f, tqdm(
                    total=total_i,
                    initial=resume_from,
                    unit="B",
                    unit_scale=True,
                    desc=dest.name,
                ) as bar:
                    for chunk in r.iter_content(chunk_size=chunk_size):
                        if chunk:
                            f.write(chunk)
                            bar.update(len(chunk))
            part.replace(dest)
            if expected_sha256:
                digest = file_sha256(dest)
                if digest != expected_sha256:
                    raise ValueError(f"SHA256 mismatch for {dest}: got {digest}")
            logger.info("Downloaded %s (%s bytes)", dest, dest.stat().st_size)
            return dest
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning("Download attempt %s failed: %s", attempt, e)
            headers = {}
            mode = "wb"
            resume_from = 0
            if part.exists():
                part.unlink()
    raise RuntimeError(f"Failed to download {url}") from last_err


def archive_uncompressed_size(path: Path) -> int:
    path = Path(path)
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            return sum(i.file_size for i in zf.infolist())
    return path.stat().st_size


def extract_archive(archive: Path, dest_dir: Path, *, members: Iterable[str] | None = None) -> Path:
    archive = Path(archive)
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    uncompressed = archive_uncompressed_size(archive)
    free = dest_dir.stat().st_size  # placeholder; real free space checked by caller preferably
    logger.info(
        "Extracting %s (archive=%s bytes, uncompressed~=%s bytes) -> %s",
        archive.name,
        archive.stat().st_size,
        uncompressed,
        dest_dir,
    )
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as zf:
            if members:
                for m in members:
                    zf.extract(m, dest_dir)
            else:
                zf.extractall(dest_dir)
    else:
        raise ValueError(f"Unsupported archive format: {archive}")
    return dest_dir


def disk_free_bytes(path: Path) -> int:
    import shutil

    return shutil.disk_usage(path).free


def validate_or_cache(
    url: str,
    dest: Path,
    *,
    min_free_multiplier: float = 2.5,
    expected_archive_mb: float | None = None,
) -> Path:
    dest = Path(dest)
    free = disk_free_bytes(dest.parent if dest.parent.exists() else Path("."))
    if expected_archive_mb is not None:
        needed = expected_archive_mb * (1 << 20) * min_free_multiplier
        if free < needed:
            raise OSError(
                f"Insufficient disk: free={free/1e9:.2f}GB, "
                f"need≈{needed/1e9:.2f}GB for archive ~{expected_archive_mb}MB"
            )
    return download_file(url, dest)
