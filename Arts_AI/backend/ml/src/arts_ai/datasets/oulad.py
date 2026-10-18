"""OULAD download and load helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import DatasetManifest, write_manifest
from arts_ai.common.paths import get_paths
from arts_ai.datasets.download_utils import (
    archive_uncompressed_size,
    disk_free_bytes,
    download_file,
    extract_archive,
)

logger = get_logger("arts_ai.datasets.oulad")

# UCI mirror — publicly documented Open University Learning Analytics Dataset
OULAD_UCI_URL = (
    "https://archive.ics.uci.edu/static/public/349/open+university+learning+analytics+dataset.zip"
)
OULAD_TABLES = [
    "studentInfo.csv",
    "studentRegistration.csv",
    "courses.csv",
    "assessments.csv",
    "studentAssessment.csv",
    "vle.csv",
    "studentVle.csv",
]


def _oulad_dirs() -> tuple[Path, Path]:
    paths = get_paths()
    raw = paths.public_raw / "oulad"
    processed = paths.public_processed / "oulad"
    raw.mkdir(parents=True, exist_ok=True)
    processed.mkdir(parents=True, exist_ok=True)
    return raw, processed


def download_oulad(force: bool = False) -> dict[str, Any]:
    """Download and extract OULAD; write dataset manifest with checksums."""
    raw, processed = _oulad_dirs()
    archive = raw / "oulad.zip"
    extract_dir = raw / "extracted"
    status: dict[str, Any] = {"dataset": "oulad", "status": "ok", "errors": []}

    marker = extract_dir / ".extracted_ok"
    if marker.exists() and not force and all((extract_dir / t).exists() for t in OULAD_TABLES):
        logger.info("OULAD already extracted at %s", extract_dir)
        status["local_path"] = str(extract_dir)
        status["cached"] = True
        return status

    free = disk_free_bytes(raw)
    # OULAD zip historically ~170–200MB compressed, ~400MB+ extracted
    if free < 2 * (1 << 30):
        status["status"] = "failed"
        status["errors"].append(f"Insufficient disk free={free/1e9:.2f}GB")
        _write_failure(status)
        return status

    try:
        download_file(OULAD_UCI_URL, archive)
    except Exception as e:  # noqa: BLE001
        status["status"] = "failed"
        status["errors"].append(f"primary mirror failed: {e}")
        # Attempt Open University analyse portal as secondary note (may require browser)
        status["errors"].append(
            "Secondary Open University portal may require interactive download; recorded failure."
        )
        _write_failure(status)
        return status

    archive_size = archive.stat().st_size
    uncompressed = archive_uncompressed_size(archive)
    if disk_free_bytes(raw) < uncompressed * 1.2:
        status["status"] = "failed"
        status["errors"].append(
            f"Not enough space to extract: need≈{uncompressed/1e9:.2f}GB"
        )
        _write_failure(status)
        return status

    if extract_dir.exists() and force:
        import shutil

        shutil.rmtree(extract_dir)
    extract_archive(archive, extract_dir)

    # OULAD zip may nest files one level deep
    nested = list(extract_dir.rglob("studentInfo.csv"))
    if nested and nested[0].parent != extract_dir:
        data_root = nested[0].parent
    else:
        data_root = extract_dir

    # Flatten copy pointers via symlink-like copies of paths in manifest
    for table in OULAD_TABLES:
        found = list(extract_dir.rglob(table))
        if not found:
            status["errors"].append(f"missing table {table}")
        else:
            target = extract_dir / table
            if found[0] != target:
                target.write_bytes(found[0].read_bytes())

    if status["errors"]:
        status["status"] = "partial"

    counts = {}
    for table in OULAD_TABLES:
        p = extract_dir / table
        if p.exists():
            counts[table] = sum(1 for _ in p.open("r", encoding="utf-8", errors="replace")) - 1

    digest = file_sha256(archive)
    manifest = DatasetManifest(
        dataset_id="oulad",
        name="Open University Learning Analytics Dataset",
        data_category="authentic_public",
        source_url=OULAD_UCI_URL,
        license="CC BY 4.0 (per UCI / Open University documentation)",
        local_path=str(extract_dir),
        checksum_sha256=digest,
        archive_size_bytes=archive_size,
        extracted_size_bytes=uncompressed,
        record_counts=counts,
        domain="higher_education_distance_learning_uk",
        intended_use="C1 behavioural clustering; C3 academic risk (authentic public)",
        notes="Course day cutoff uses date relative to course presentation, not registration date alone.",
    )
    write_manifest(manifest, processed / "dataset_manifest.json")
    marker.write_text("ok", encoding="utf-8")
    status["local_path"] = str(extract_dir)
    status["manifest"] = str(processed / "dataset_manifest.json")
    status["archive_size_bytes"] = archive_size
    status["extracted_size_bytes"] = uncompressed
    status["checksum_sha256"] = digest
    _write_status(status)
    return status


def _write_failure(status: dict[str, Any]) -> None:
    _, processed = _oulad_dirs()
    _write_status(status)
    fail_path = processed / "download_failure.json"
    fail_path.write_text(json.dumps(status, indent=2), encoding="utf-8")


def _write_status(status: dict[str, Any]) -> None:
    _, processed = _oulad_dirs()
    (processed / "download_status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")


def load_oulad(tables: list[str] | None = None) -> dict[str, pd.DataFrame]:
    raw, _ = _oulad_dirs()
    extract_dir = raw / "extracted"
    tables = tables or OULAD_TABLES
    out: dict[str, pd.DataFrame] = {}
    for t in tables:
        path = extract_dir / t
        if not path.exists():
            matches = list(extract_dir.rglob(t))
            if not matches:
                raise FileNotFoundError(f"OULAD table missing: {t}. Run download_oulad() first.")
            path = matches[0]
        out[t.replace(".csv", "")] = pd.read_csv(path)
    return out
