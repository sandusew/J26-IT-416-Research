"""Attempt legitimate EdNet KT1 + Contents download with size checks and resume.

Full KT1 extraction (~780k tiny CSVs) is avoided by default: we selectively extract
a hardware-appropriate pool of student files, then build the leakage-safe subset.
"""

from __future__ import annotations

import json
import random
import shutil
import zipfile
from pathlib import Path

from arts_ai.common.logging_utils import get_logger
from arts_ai.common.paths import get_paths
from arts_ai.datasets.download_utils import (
    archive_uncompressed_size,
    disk_free_bytes,
    download_file,
    extract_archive,
)
from arts_ai.datasets.ednet import download_ednet_subset

logger = get_logger("arts_ai.ednet_download")

CONTENTS_URLS = [
    "http://base.ustc.edu.cn/data/EdNet/EdNet-Contents.zip",
]
KT1_URLS = [
    "http://base.ustc.edu.cn/data/EdNet/EdNet-KT1.zip",
]
KT1_EXPECTED_MB = 1200
CONTENTS_EXPECTED_MB = 1
# Selective extract pool (hardware-appropriate; raise for larger experiments)
SELECTIVE_CSV_POOL = int(__import__("os").environ.get("EDNET_CSV_POOL", "8000"))
MAX_STUDENTS = int(__import__("os").environ.get("EDNET_MAX_STUDENTS", "600"))


def _extract_kt1_subset(kt1_zip: Path, kt1_dir: Path, *, pool: int, seed: int = 42) -> dict:
    """Extract a random pool of user CSVs from the archive (not the full ~5.6GB tree)."""
    kt1_dir.mkdir(parents=True, exist_ok=True)
    existing = list(kt1_dir.glob("u*.csv"))
    if len(existing) >= pool:
        return {"mode": "reuse_existing", "csv_files": len(existing)}

    with zipfile.ZipFile(kt1_zip) as zf:
        members = [n for n in zf.namelist() if n.lower().endswith(".csv") and "/u" in n.replace("\\", "/").lower()]
        if not members:
            members = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        rng = random.Random(seed)
        if len(members) > pool:
            chosen = rng.sample(members, pool)
        else:
            chosen = members
        n = 0
        for m in chosen:
            name = Path(m).name
            target = kt1_dir / name
            if target.exists():
                continue
            with zf.open(m) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            n += 1
        return {
            "mode": "selective_extract",
            "members_in_archive": len(members),
            "requested_pool": pool,
            "extracted_this_run": n,
            "csv_files_on_disk": len(list(kt1_dir.glob("*.csv"))),
            "note": "Full archive retained; only a hardware-appropriate CSV pool extracted",
        }


def main() -> dict:
    paths = get_paths()
    raw = paths.public_raw / "ednet"
    raw.mkdir(parents=True, exist_ok=True)
    status: dict = {"steps": {}, "errors": []}
    free = disk_free_bytes(raw)
    status["disk_free_bytes"] = free
    # Selective extract needs far less than full 5.6GB
    needed = int((KT1_EXPECTED_MB + CONTENTS_EXPECTED_MB) * (1 << 20) + 0.5 * (1 << 30))
    status["estimated_need_bytes"] = needed
    if free < needed:
        status["status"] = "blocked_disk"
        status["errors"].append(
            f"Insufficient disk: free={free/1e9:.2f}GB need≈{needed/1e9:.2f}GB"
        )
        _write(status)
        return status

    # Contents first (small)
    contents_zip = raw / "EdNet-Contents.zip"
    contents_dir = raw / "contents"
    try:
        if not contents_zip.exists() or contents_zip.stat().st_size < 1000:
            for url in CONTENTS_URLS:
                try:
                    download_file(url, contents_zip)
                    status["steps"]["contents_download"] = {
                        "ok": True,
                        "url": url,
                        "bytes": contents_zip.stat().st_size,
                    }
                    break
                except Exception as e:  # noqa: BLE001
                    status["errors"].append(f"contents {url}: {e}")
            else:
                raise RuntimeError("all contents URLs failed")
        else:
            status["steps"]["contents_download"] = {
                "ok": True,
                "reused": True,
                "bytes": contents_zip.stat().st_size,
            }
        if not any(contents_dir.rglob("questions.csv")):
            extract_archive(contents_zip, contents_dir)
        status["steps"]["contents_extract"] = {
            "ok": True,
            "uncompressed": archive_uncompressed_size(contents_zip),
            "questions_csv": next((str(p) for p in contents_dir.rglob("questions.csv")), None),
        }
    except Exception as e:  # noqa: BLE001
        status["status"] = "contents_failed"
        status["errors"].append(str(e))
        status["manual_action"] = (
            "Download Contents from https://bit.ly/ednet-content or "
            "http://base.ustc.edu.cn/data/EdNet/EdNet-Contents.zip into "
            f"{contents_zip} and extract to {contents_dir}"
        )
        _write(status)
        return status

    # KT1 large
    kt1_zip = raw / "EdNet-KT1.zip"
    kt1_dir = raw / "kt1"
    try:
        if not kt1_zip.exists() or kt1_zip.stat().st_size < 1_000_000_000:
            for url in KT1_URLS:
                try:
                    logger.info("Downloading KT1 from %s (resumable .part supported)", url)
                    download_file(url, kt1_zip, timeout=300)
                    status["steps"]["kt1_download"] = {
                        "ok": True,
                        "url": url,
                        "bytes": kt1_zip.stat().st_size,
                    }
                    break
                except Exception as e:  # noqa: BLE001
                    status["errors"].append(f"kt1 {url}: {e}")
            else:
                raise RuntimeError("all KT1 URLs failed")
        else:
            status["steps"]["kt1_download"] = {
                "ok": True,
                "reused": True,
                "bytes": kt1_zip.stat().st_size,
            }
        status["steps"]["kt1_archive"] = {
            "archive_bytes": kt1_zip.stat().st_size,
            "uncompressed_bytes": archive_uncompressed_size(kt1_zip),
        }
        logger.info(
            "Selectively extracting up to %s CSVs from KT1 (avoid full ~5.6GB extract)",
            SELECTIVE_CSV_POOL,
        )
        status["steps"]["kt1_extract"] = _extract_kt1_subset(
            kt1_zip, kt1_dir, pool=SELECTIVE_CSV_POOL, seed=42
        )
    except Exception as e:  # noqa: BLE001
        status["status"] = "kt1_failed"
        status["errors"].append(str(e))
        status["manual_action"] = (
            "Download KT1 from https://bit.ly/ednet_kt1 (official GitHub link) or "
            "http://base.ustc.edu.cn/data/EdNet/EdNet-KT1.zip (~1.2GB). "
            f"Place archive at {kt1_zip}. Re-run this script for selective extract to {kt1_dir}/"
        )
        _write(status)
        return status

    # Build subset + correctness
    subset = download_ednet_subset(max_students=MAX_STUDENTS, min_interactions=50, seed=42)
    status["subset"] = subset
    status["status"] = subset.get("status", "ok")
    _write(status)
    return status


def _write(status: dict) -> None:
    out = get_paths().public_processed / "ednet" / "acquisition_status.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(status, indent=2, default=str), encoding="utf-8")
    logger.info("Wrote %s status=%s", out, status.get("status"))


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
