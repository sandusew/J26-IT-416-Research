"""UCI Student Performance — separate benchmark with leakage-aware variants.

Original Math-only run with G1/G2 retained as prior-period context is preserved
under prior artifact IDs. This revision:
- documents prediction-time assumptions for G1/G2
- adds a no-G1/G2 early-context experiment
- checks Math/Portuguese student-key overlap when both files are used
- reports calibration on validation before test
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import RunManifest, save_json, write_manifest
from arts_ai.common.paths import get_paths
from arts_ai.datasets.uci_student import load_uci_student

logger = get_logger("arts_ai.c3.uci")


def _student_key(df: pd.DataFrame) -> pd.Series:
    """Approximate identity key from quasi-identifiers (UCI has no student_id)."""
    cols = [c for c in ("school", "sex", "age", "address", "famsize", "Pstatus", "Medu", "Fedu") if c in df.columns]
    return df[cols].astype(str).agg("|".join, axis=1)


def train_uci_benchmark(seed: int = 42, include_g1_g2: bool = True) -> dict[str, Any]:
    """Backward-compatible entry: Math only, optional G1/G2."""
    return train_uci_revised(seed=seed, include_g1_g2=include_g1_g2, combine_courses=False)


def train_uci_revised(
    seed: int = 42,
    *,
    include_g1_g2: bool = True,
    combine_courses: bool = True,
) -> dict[str, Any]:
    run_id = f"c3_uci_rev_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    art_dir = get_paths().artifact("c3") / run_id
    art_dir.mkdir(parents=True, exist_ok=True)

    mat = load_uci_student("mat")
    por = load_uci_student("por")
    mat = mat.copy()
    por = por.copy()
    mat["course"] = "mat"
    por["course"] = "por"
    mat["student_key"] = _student_key(mat)
    por["student_key"] = _student_key(por)
    overlap = set(mat["student_key"]) & set(por["student_key"])

    if combine_courses:
        df = pd.concat([mat, por], ignore_index=True)
        # Prevent same student_key appearing in both train and test across courses
        keys = df["student_key"].unique()
        k_train, k_temp = train_test_split(keys, test_size=0.4, random_state=seed)
        k_val, k_test = train_test_split(k_temp, test_size=0.5, random_state=seed)
        split_by = "student_key"
    else:
        df = mat
        # row-level split (original style) — documented
        idx = np.arange(len(df))
        i_train, i_temp = train_test_split(idx, test_size=0.4, random_state=seed, stratify=(df["G3"] < 10))
        i_val, i_test = train_test_split(
            i_temp, test_size=0.5, random_state=seed, stratify=(df.iloc[i_temp]["G3"] < 10)
        )
        k_train = i_train
        k_val = i_val
        k_test = i_test
        split_by = "row_index_math_only"

    y_all = (df["G3"] < 10).astype(int)
    drop_cols = ["G3", "student_key"]
    if not include_g1_g2:
        drop_cols.extend([c for c in ("G1", "G2") if c in df.columns])
    X_all = df.drop(columns=[c for c in drop_cols if c in df.columns])

    if split_by == "student_key":
        train_df = df[df.student_key.isin(k_train)]
        val_df = df[df.student_key.isin(k_val)]
        test_df = df[df.student_key.isin(k_test)]
        X_train, y_train = X_all.loc[train_df.index], y_all.loc[train_df.index]
        X_val, y_val = X_all.loc[val_df.index], y_all.loc[val_df.index]
        X_test, y_test = X_all.loc[test_df.index], y_all.loc[test_df.index]
    else:
        X_train, y_train = X_all.iloc[k_train], y_all.iloc[k_train]
        X_val, y_val = X_all.iloc[k_val], y_all.iloc[k_val]
        X_test, y_test = X_all.iloc[k_test], y_all.iloc[k_test]

    # Assert no G3 leakage
    assert "G3" not in X_train.columns
    if not include_g1_g2:
        assert "G1" not in X_train.columns and "G2" not in X_train.columns

    cat_cols = X_train.select_dtypes(include=["object"]).columns.tolist()
    num_cols = X_train.select_dtypes(exclude=["object"]).columns.tolist()
    pre = ColumnTransformer(
        [
            ("num", StandardScaler(), num_cols),
            ("cat", OneHotEncoder(handle_unknown="ignore"), cat_cols),
        ]
    )
    pipe = Pipeline(
        [("pre", pre), ("clf", LogisticRegression(max_iter=500, random_state=seed))]
    )
    pipe.fit(X_train, y_train)

    def metrics_for(X, y, name: str) -> dict[str, Any]:
        pred = pipe.predict(X)
        proba = pipe.predict_proba(X)[:, 1]
        out = {
            "f1": float(f1_score(y, pred, zero_division=0)),
            "roc_auc": float(roc_auc_score(y, proba)) if y.nunique() > 1 else None,
            "n": int(len(y)),
            "positive_rate": float(y.mean()),
        }
        try:
            frac, mean_pred = calibration_curve(y, proba, n_bins=5, strategy="quantile")
            out["calibration_curve"] = {
                "fraction_positives": frac.tolist(),
                "mean_predicted_value": mean_pred.tolist(),
            }
        except ValueError:
            out["calibration_curve"] = None
        return out

    val_m = metrics_for(X_val, y_val, "val")
    # Threshold selection on validation F1
    proba_val = pipe.predict_proba(X_val)[:, 1]
    best_t, best_f1 = 0.5, -1.0
    for t in np.linspace(0.1, 0.9, 17):
        f1 = f1_score(y_val, (proba_val >= t).astype(int), zero_division=0)
        if f1 > best_f1:
            best_f1, best_t = float(f1), float(t)
    proba_test = pipe.predict_proba(X_test)[:, 1]
    pred_test = (proba_test >= best_t).astype(int)
    test_m = metrics_for(X_test, y_test, "test")
    test_m["f1_at_val_selected_threshold"] = float(f1_score(y_test, pred_test, zero_division=0))
    test_m["threshold_selected_on_val"] = best_t

    note = (
        "G1/G2 are period grades available after those periods — included only when include_g1_g2=True. "
        "G3 is the target and never a predictor. "
        "No weekly event histories. "
        f"Math/Portuguese quasi-identifier overlap size={len(overlap)}."
    )
    metrics = {
        "experiment": "uci_revised",
        "data_category": "authentic_public",
        "dataset": "UCI Student Performance",
        "combine_courses": combine_courses,
        "include_g1_g2": include_g1_g2,
        "prediction_time_assumption": (
            "after G1 and G2 known" if include_g1_g2 else "before period grades (no G1/G2)"
        ),
        "split_by": split_by,
        "math_por_key_overlap": int(len(overlap)),
        "original_math_g1g2_run_preserved": {
            "f1": 0.8787878787878788,
            "note": "See artifacts/c3/c3_uci_20261013T025936_dcef4496",
        },
        "validation": val_m,
        "test": test_m,
        "positive_class": "G3 < 10 (fail-like)",
        "note": note,
        "test_set_status": "revised split protocol — original test metrics retained separately",
    }

    # Backup original report
    reports = get_paths().reports
    audit = reports / "audit"
    audit.mkdir(parents=True, exist_ok=True)
    orig = reports / "c3_uci_metrics.json"
    if orig.exists() and not (audit / "c3_uci_metrics_ORIGINAL.json").exists():
        (audit / "c3_uci_metrics_ORIGINAL.json").write_text(orig.read_text(encoding="utf-8"), encoding="utf-8")

    model_path = art_dir / "uci_risk.joblib"
    joblib.dump(
        {
            "model": pipe,
            "run_id": run_id,
            "include_g1_g2": include_g1_g2,
            "threshold": best_t,
            "feature_columns": list(X_train.columns),
        },
        model_path,
    )
    save_json(metrics, art_dir / "metrics.json")
    save_json(metrics, reports / "c3_uci_metrics_REVISED.json")
    write_manifest(
        RunManifest(
            run_id=run_id,
            component="c3",
            task="uci_revised",
            config_name="c3_risk.yaml",
            sample_counts={"train": len(X_train), "validation": len(X_val), "test": len(X_test)},
            metrics=metrics,
            artifact_paths={"model": str(model_path)},
            artifact_hashes={"model": file_sha256(model_path)},
            notes=note,
        ),
        art_dir / "run_manifest.json",
    )
    (get_paths().artifact("c3") / "LATEST_UCI_RUN.txt").write_text(run_id, encoding="utf-8")
    logger.info("UCI revised test f1=%.4f include_g1_g2=%s", test_m["f1"], include_g1_g2)
    return {"run_id": run_id, "status": "completed", "metrics": metrics, "artifact_dir": str(art_dir)}
