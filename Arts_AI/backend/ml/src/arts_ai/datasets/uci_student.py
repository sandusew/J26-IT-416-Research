"""UCI Student Performance dataset download/load."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import DatasetManifest, write_manifest
from arts_ai.common.paths import get_paths
from arts_ai.datasets.download_utils import archive_uncompressed_size, download_file, extract_archive

logger = get_logger("arts_ai.datasets.uci_student")

# Primary (legacy ML repo) + UCI static mirror candidates
UCI_URLS = [
    "https://archive.ics.uci.edu/ml/machine-learning-databases/00320/student.zip",
    "https://archive.ics.uci.edu/static/public/320/student.zip",
]
UCI_URL = UCI_URLS[0]


def download_uci_student(force: bool = False) -> dict[str, Any]:
    paths = get_paths()
    raw = paths.public_raw / "uci_student"
    processed = paths.public_processed / "uci_student"
    raw.mkdir(parents=True, exist_ok=True)
    processed.mkdir(parents=True, exist_ok=True)
    archive = raw / "student.zip"
    extract_dir = raw / "extracted"
    status: dict[str, Any] = {"dataset": "uci_student_performance", "status": "ok", "errors": []}

    marker = extract_dir / ".extracted_ok"
    if marker.exists() and not force and (extract_dir / "student-mat.csv").exists():
        status["cached"] = True
        status["local_path"] = str(extract_dir)
        return status

    last_err: Exception | None = None
    used_url = UCI_URL
    for url in UCI_URLS:
        try:
            used_url = url
            download_file(url, archive)
            extract_archive(archive, extract_dir)
            # Nested folder possible
            for name in ("student-mat.csv", "student-por.csv"):
                found = list(extract_dir.rglob(name))
                if found and found[0].parent != extract_dir:
                    (extract_dir / name).write_bytes(found[0].read_bytes())
            marker.write_text("ok", encoding="utf-8")
            last_err = None
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
            status["errors"].append(f"{url}: {e}")
            if archive.exists():
                archive.unlink()
    if last_err is not None:
        status["status"] = "failed"
        (processed / "download_failure.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
        return status

    counts = {}
    for name in ("student-mat.csv", "student-por.csv"):
        p = extract_dir / name
        if p.exists():
            counts[name] = len(pd.read_csv(p, sep=";"))

    manifest = DatasetManifest(
        dataset_id="uci_student_performance",
        name="UCI Student Performance",
        data_category="authentic_public",
        source_url=used_url,
        license="CC BY 4.0 (UCI)",
        local_path=str(extract_dir),
        checksum_sha256=file_sha256(archive),
        archive_size_bytes=archive.stat().st_size,
        extracted_size_bytes=archive_uncompressed_size(archive),
        record_counts=counts,
        domain="secondary_education_portugal",
        intended_use="Optional separate C3 benchmark; no weekly event histories",
        notes="Does not contain detailed weekly VLE-style event histories.",
    )
    write_manifest(manifest, processed / "dataset_manifest.json")
    status["local_path"] = str(extract_dir)
    status["manifest"] = str(processed / "dataset_manifest.json")
    (processed / "download_status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
    return status


def load_uci_student(course: str = "mat") -> pd.DataFrame:
    paths = get_paths()
    extract_dir = paths.public_raw / "uci_student" / "extracted"
    name = "student-mat.csv" if course == "mat" else "student-por.csv"
    path = extract_dir / name
    if not path.exists():
        matches = list(extract_dir.rglob(name))
        if not matches:
            raise FileNotFoundError("UCI student data missing; run download_uci_student()")
        path = matches[0]
    return pd.read_csv(path, sep=";")
