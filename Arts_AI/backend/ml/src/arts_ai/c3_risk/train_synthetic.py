"""Synthetic Arts risk model — evaluated separately under simulation assumptions."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import RunManifest, save_json, write_manifest
from arts_ai.common.paths import get_paths

logger = get_logger("arts_ai.c3.synth")


def train_synthetic_arts_risk() -> dict[str, Any]:
    run_id = f"c3_synth_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    art_dir = get_paths().artifact("c3") / run_id
    art_dir.mkdir(parents=True, exist_ok=True)

    root = get_paths().synthetic
    dirs = sorted([p for p in root.iterdir() if p.is_dir() and (p / "assessment_results.csv").exists()])
    if not dirs:
        return {"run_id": run_id, "status": "blocked", "reason": "synthetic data missing"}
    data_dir = dirs[-1]

    students = pd.read_csv(data_dir / "students.csv")
    events = pd.read_csv(data_dir / "learning_events.csv")
    results = pd.read_csv(data_dir / "assessment_results.csv")

    # Target: end assessment fail (first subject per student)
    end = results[results["assessment_id"].str.endswith("_end")].copy()
    end = end.sort_values("student_id").groupby("student_id").head(1)
    end["y"] = (end["result_status"] == "fail").astype(int)

    # Observable features only (no hidden proficiency)
    ev = events.groupby("student_id").agg(
        n_events=("event_id", "count"),
        mean_active_seconds=("active_seconds", "mean"),
        mean_progress=("progress_percent", "mean"),
    )
    feat = students.merge(ev, on="student_id", how="left").merge(
        end[["student_id", "y"]], on="student_id", how="inner"
    )
    feat[["n_events", "mean_active_seconds", "mean_progress"]] = feat[
        ["n_events", "mean_active_seconds", "mean_progress"]
    ].fillna(0)

    feature_cols = ["n_events", "mean_active_seconds", "mean_progress"]
    train = feat[feat["split_membership"] == "train"]
    val = feat[feat["split_membership"] == "validation"]
    test = feat[feat["split_membership"] == "test"]

    model = Pipeline(
        [("scaler", StandardScaler()), ("clf", LogisticRegression(max_iter=400))]
    )
    model.fit(train[feature_cols], train["y"])
    pred = model.predict(test[feature_cols])
    proba = model.predict_proba(test[feature_cols])[:, 1]
    metrics = {
        "data_category": "synthetic_learner",
        "f1": float(f1_score(test["y"], pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(test["y"], proba)) if test["y"].nunique() > 1 else None,
        "n_test": int(len(test)),
        "note": "Measures performance under simulation assumptions only; not real Arts risk validation",
    }
    model_path = art_dir / "synth_risk.joblib"
    joblib.dump({"model": model, "feature_cols": feature_cols, "run_id": run_id}, model_path)
    save_json(metrics, art_dir / "metrics.json")
    save_json(metrics, get_paths().reports / "c3_synth_metrics.json")
    write_manifest(
        RunManifest(
            run_id=run_id,
            component="c3",
            task="synthetic_arts_risk",
            config_name="c3_risk.yaml",
            sample_counts={"train": len(train), "validation": len(val), "test": len(test)},
            feature_schema=feature_cols,
            metrics=metrics,
            artifact_paths={"model": str(model_path)},
            artifact_hashes={"model": file_sha256(model_path)},
        ),
        art_dir / "run_manifest.json",
    )
    (get_paths().artifact("c3") / "LATEST_SYNTH_RUN.txt").write_text(run_id, encoding="utf-8")
    logger.info("Synthetic Arts risk f1=%.4f", metrics["f1"])
    return {"run_id": run_id, "status": "completed", "metrics": metrics, "artifact_dir": str(art_dir)}
