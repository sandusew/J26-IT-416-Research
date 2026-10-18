"""EdNet KT1 deterministic student-level subset download/load.

EdNet full KT1 is very large. We download or synthesize a *documented* subset
strategy: prefer fetching sample files from the official repo if available;
otherwise record failure and do not silently replace with synthetic data for
the public-track experiment.
"""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from arts_ai.common.hashing import file_sha256, dataframe_hash
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import DatasetManifest, write_manifest
from arts_ai.common.paths import get_paths

logger = get_logger("arts_ai.datasets.ednet")

# Public sample / documentation endpoints (GitHub raw). Full KT1 requires
# academic-form download from Riiid; we attempt documented sample paths first.
EDNET_REPO = "https://github.com/riiid/ednet"
EDNET_SAMPLE_CANDIDATES = [
    # Small public sample CSVs sometimes mirrored in community forks — official
    # full KT1 is behind form. We try raw sample paths and record outcomes.
    "https://raw.githubusercontent.com/riiid/ednet/master/README.md",
]


def _dirs() -> tuple[Path, Path]:
    paths = get_paths()
    raw = paths.public_raw / "ednet"
    processed = paths.public_processed / "ednet"
    raw.mkdir(parents=True, exist_ok=True)
    processed.mkdir(parents=True, exist_ok=True)
    return raw, processed


def _stable_student_sample(student_ids: list[str], n: int, seed: int = 42) -> list[str]:
    scored = sorted(
        student_ids,
        key=lambda s: hashlib.sha256(f"{seed}:{s}".encode()).hexdigest(),
    )
    return scored[:n]


def download_ednet_subset(
    max_students: int = 200,
    min_interactions: int = 50,
    seed: int = 42,
    local_kt1_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Build a deterministic EdNet KT1 subset if raw KT1 is available locally or downloadable.

    If the full dataset cannot be acquired (common without Riiid form access),
    status=failed is recorded and the public EdNet experiment must not be claimed complete.
    """
    raw, processed = _dirs()
    status: dict[str, Any] = {
        "dataset": "ednet_kt1_subset",
        "status": "ok",
        "errors": [],
        "source_url": EDNET_REPO,
        "max_students": max_students,
        "min_interactions": min_interactions,
        "seed": seed,
    }

    # Capture README for license/schema audit even if KT1 unavailable
    readme_path = raw / "README_ednet.md"
    try:
        r = requests.get(EDNET_SAMPLE_CANDIDATES[0], timeout=60)
        if r.ok:
            readme_path.write_text(r.text, encoding="utf-8")
            status["readme_cached"] = str(readme_path)
    except Exception as e:  # noqa: BLE001
        status["errors"].append(f"readme fetch failed: {e}")

    kt1_source: Path | None = None
    if local_kt1_dir:
        p = Path(local_kt1_dir)
        if p.exists():
            kt1_source = p

    # Look for previously placed KT1 csvs under raw/kt1
    candidate = raw / "kt1"
    if kt1_source is None and candidate.exists():
        kt1_source = candidate

    # Contents metadata (small) — needed to derive correctness from user_answer
    contents_dir = raw / "contents"
    contents_dir.mkdir(parents=True, exist_ok=True)
    status["contents_layout"] = str(contents_dir)
    status["access_instructions"] = str(Path(__file__).with_name("ednet_access.md"))

    if kt1_source is None:
        status["status"] = "failed"
        status["errors"].append(
            "EdNet KT1 not present locally. Official links (do not bypass controls): "
            "https://github.com/riiid/ednet (bit.ly/ednet_kt1), contents bit.ly/ednet-content. "
            "Place user CSVs under data/public/raw/ednet/kt1/ and Contents under "
            "data/public/raw/ednet/contents/. See ednet_access.md. "
            "Public-track experiment incomplete until authentic KT1(+contents) available. "
            "Synthetic data MUST NOT replace it."
        )
        # Create a tiny schema-compatible placeholder file documenting expected columns
        schema_doc = {
            "expected_columns": [
                "timestamp",
                "solving_id",
                "question_id",
                "user_answer",
                "elapsed_time",
            ],
            "student_file_pattern": "u{user_id}.csv",
            "note": "No authentic EdNet rows present in this workspace yet.",
        }
        (processed / "ednet_unavailable.json").write_text(
            json.dumps({**status, **schema_doc}, indent=2), encoding="utf-8"
        )
        (processed / "download_status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
        return status

    # Load student files
    files = sorted(kt1_source.glob("*.csv"))
    if not files:
        status["status"] = "failed"
        status["errors"].append(f"No CSV files in {kt1_source}")
        (processed / "download_status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
        return status

    eligible: list[tuple[str, Path, int]] = []
    for f in files:
        # Count lines cheaply
        n = sum(1 for _ in f.open("r", encoding="utf-8", errors="replace")) - 1
        if n >= min_interactions:
            sid = f.stem
            eligible.append((sid, f, n))

    selected_ids = _stable_student_sample([e[0] for e in eligible], max_students, seed)
    selected = {e[0]: e for e in eligible if e[0] in set(selected_ids)}

    rows = []
    for sid, fpath, _ in selected.values():
        df = pd.read_csv(fpath)
        df["student_id"] = sid
        rows.append(df)
    subset = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()

    # Derive correctness from Contents metadata when available
    questions_path = None
    for cand in (
        contents_dir / "questions.csv",
        contents_dir / "Contents" / "questions.csv",
        *contents_dir.rglob("questions.csv"),
    ):
        if Path(cand).exists():
            questions_path = Path(cand)
            break
    if questions_path is not None and "user_answer" in subset.columns:
        qmeta = pd.read_csv(questions_path)
        # Common EdNet content schemas use question_id + correct_answer / answer
        ans_col = next(
            (c for c in ("correct_answer", "answer", "correct") if c in qmeta.columns),
            None,
        )
        id_col = "question_id" if "question_id" in qmeta.columns else None
        if ans_col and id_col:
            qmap = qmeta.set_index(id_col)[ans_col].to_dict()
            subset["correct"] = subset.apply(
                lambda r: int(str(r["user_answer"]).strip().lower() == str(qmap.get(r["question_id"], "")).strip().lower())
                if r["question_id"] in qmap
                else None,
                axis=1,
            )
            status["correctness_derived_from"] = str(questions_path)
        else:
            status["errors"].append(
                f"Contents questions file found but missing expected columns at {questions_path}"
            )
    else:
        status["errors"].append(
            "Contents/questions.csv not found — place EdNet Contents under raw/ednet/contents/ "
            "to derive correctness labels"
        )

    out_csv = processed / "ednet_kt1_subset.csv"
    subset.to_csv(out_csv, index=False)

    # Archive size: sum of selected source files; extracted = same for CSV subset
    archive_size = sum(selected[s][1].stat().st_size for s in selected)
    extracted_size = out_csv.stat().st_size

    manifest = DatasetManifest(
        dataset_id="ednet_kt1_subset",
        name="EdNet KT1 student-level subset",
        data_category="authentic_public",
        source_url=EDNET_REPO,
        license="CC BY-NC-SA 4.0 (EdNet)",
        local_path=str(out_csv),
        checksum_sha256=file_sha256(out_csv),
        archive_size_bytes=archive_size,
        extracted_size_bytes=extracted_size,
        selected_sample_size=len(selected),
        record_counts={
            "students": len(selected),
            "interactions": len(subset),
            "eligible_students": len(eligible),
        },
        filters={
            "max_students": max_students,
            "min_interactions": min_interactions,
            "seed": seed,
            "selection": "stable_sha256_order",
        },
        domain="online_learning_platform",
        intended_use="C2 next-answer correctness (public track)",
        notes=(
            f"Complete histories retained for {len(selected)} selected students. "
            "Archive size = sum of selected source files; extracted size = subset CSV."
        ),
        seed=seed,
    )
    write_manifest(manifest, processed / "dataset_manifest.json")
    status["local_path"] = str(out_csv)
    status["selected_students"] = len(selected)
    status["interactions"] = len(subset)
    status["content_hash"] = dataframe_hash(subset)
    (processed / "download_status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
    return status


def load_ednet_subset() -> pd.DataFrame:
    _, processed = _dirs()
    path = processed / "ednet_kt1_subset.csv"
    if not path.exists():
        raise FileNotFoundError(
            "EdNet subset missing. Acquire authentic KT1 and run download_ednet_subset()."
        )
    return pd.read_csv(path)


def build_ednet_public_sample_from_generator_for_schema_tests_only(
    n_students: int = 30,
    seed: int = 0,
) -> Path:
    """NOT for claiming EdNet public experiment.

    Creates a clearly labelled *synthetic* interaction table matching EdNet-like
    columns for unit tests / API smoke only. Manifest marks data_category=synthetic.
    """
    import numpy as np

    raw, processed = _dirs()
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n_students):
        sid = f"synth_u{i:04d}"
        n = int(rng.integers(60, 200))
        t0 = 1_600_000_000_000
        for j in range(n):
            rows.append(
                {
                    "timestamp": t0 + j * 60_000,
                    "solving_id": j,
                    "question_id": int(rng.integers(1, 500)),
                    "user_answer": int(rng.integers(1, 5)),
                    "elapsed_time": int(rng.integers(5_000, 60_000)),
                    "correct": int(rng.random() > 0.4),
                    "student_id": sid,
                }
            )
    df = pd.DataFrame(rows)
    out = processed / "ednet_LIKE_synthetic_SMOKE_ONLY.csv"
    df.to_csv(out, index=False)
    manifest = DatasetManifest(
        dataset_id="ednet_like_synthetic_smoke",
        name="EdNet-like SYNTHETIC smoke table (NOT EdNet)",
        data_category="synthetic_learner",
        source_url=None,
        license="synthetic demonstration fixture",
        local_path=str(out),
        checksum_sha256=file_sha256(out),
        selected_sample_size=n_students,
        record_counts={"students": n_students, "interactions": len(df)},
        generator_version="0.1.0",
        seed=seed,
        scenario_id="ednet_like_smoke",
        intended_use="Unit/smoke tests only — must NOT replace authentic EdNet experiment",
        notes="SYNTHETIC. Do not report as EdNet public-data results.",
    )
    write_manifest(manifest, processed / "synthetic_smoke_manifest.json")
    return out
