"""EdNet correctness — revised experiment (new run IDs).

Preserves c2_ednet_20261013T121127_* (majority-selected on positive-F1).

A priori selection protocol for THIS experiment (chosen before test inspection):
  primary selection metric = validation ROC-AUC
  tie-break: if |auc_lr - auc_base| < 0.01, prefer majority (no forced learned win)
  secondary reporting: balanced_accuracy, macro-F1, PR-AUC, Brier

Feature rules:
  - history only from prior responses
  - within the same solving_id, do not update correctness/elapsed history until the bundle ends
  - question difficulty = train-only mean correctness (unseen → global train mean)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from arts_ai.common.config import load_yaml_config
from arts_ai.common.hashing import dataframe_hash, file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import RunManifest, save_json, write_manifest
from arts_ai.common.paths import get_paths
from arts_ai.datasets.ednet import load_ednet_subset

logger = get_logger("arts_ai.c2.ednet_v2")

FEATURE_COLS_V2 = [
    "hist_count",
    "hist_accuracy",
    "hist_accuracy_10",
    "hist_mean_elapsed",
    "hist_std_elapsed",
    "question_difficulty_train",
]

SELECTION_PROTOCOL = {
    "primary_metric": "roc_auc",
    "split": "validation",
    "tie_epsilon": 0.01,
    "tie_break": "prefer_majority_baseline",
    "rationale": (
        "Positive-F1 favors always-predict-1 under ~65% prevalence; "
        "ROC-AUC measures ranking/discrimination without that bias."
    ),
    "documented_before_test_inspection": True,
}


def build_history_features_v2(df: pd.DataFrame) -> pd.DataFrame:
    """Pre-answer features; freeze history updates within a solving_id bundle."""
    df = df.sort_values(["student_id", "timestamp"]).copy()
    if "correct" not in df.columns:
        raise ValueError("EdNet subset lacks 'correct' column")
    has_solving = "solving_id" in df.columns
    rows = []
    for sid, g in df.groupby("student_id", sort=False):
        g = g.reset_index(drop=True)
        correct_hist: list[int] = []
        elapsed_hist: list[float] = []
        pending_correct: list[int] = []
        pending_elapsed: list[float] = []
        prev_solving = None
        for i in range(len(g)):
            solving = g.loc[i, "solving_id"] if has_solving else None
            if has_solving and prev_solving is not None and solving != prev_solving:
                correct_hist.extend(pending_correct)
                elapsed_hist.extend(pending_elapsed)
                pending_correct, pending_elapsed = [], []
            if i >= 5 or len(correct_hist) >= 5:
                prev_c = correct_hist[-50:]
                prev_e = elapsed_hist[-50:]
                if len(prev_c) >= 1:
                    rows.append(
                        {
                            "student_id": sid,
                            "row_idx": i,
                            "question_id": g.loc[i, "question_id"],
                            "solving_id": solving,
                            "hist_count": len(prev_c),
                            "hist_accuracy": float(np.mean(prev_c)),
                            "hist_accuracy_10": float(np.mean(prev_c[-10:])),
                            "hist_mean_elapsed": float(np.mean(prev_e)) if prev_e else 0.0,
                            "hist_std_elapsed": float(np.std(prev_e)) if len(prev_e) > 1 else 0.0,
                            "correct": int(g.loc[i, "correct"]),
                        }
                    )
            # Defer feedback until solving bundle ends (or immediately if no solving_id)
            c_val = int(g.loc[i, "correct"])
            e_val = float(g.loc[i, "elapsed_time"]) if "elapsed_time" in g.columns else 0.0
            if has_solving:
                pending_correct.append(c_val)
                pending_elapsed.append(e_val)
                prev_solving = solving
            else:
                correct_hist.append(c_val)
                elapsed_hist.append(e_val)
        # flush
        correct_hist.extend(pending_correct)
        elapsed_hist.extend(pending_elapsed)
    return pd.DataFrame(rows)


def _eval(y, pred, proba) -> dict[str, Any]:
    out = {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "f1_positive": float(f1_score(y, pred, zero_division=0)),
        "positive_prevalence": float(np.mean(y)),
    }
    try:
        out["roc_auc"] = float(roc_auc_score(y, proba))
    except ValueError:
        out["roc_auc"] = None
    try:
        out["pr_auc"] = float(average_precision_score(y, proba))
    except ValueError:
        out["pr_auc"] = None
    try:
        out["brier"] = float(brier_score_loss(y, proba))
    except ValueError:
        out["brier"] = None
    return out


def train_ednet_correctness_v2(
    config_name: str = "c2_recommendation.yaml",
    *,
    update_latest_pointer: bool = False,
) -> dict[str, Any]:
    """New experiment. Does not overwrite prior majority-selected run unless pointer update requested."""
    cfg = load_yaml_config(config_name)
    seed = int(cfg.get("seed", 42))
    run_id = f"c2_ednet_v2_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    art_dir = get_paths().artifact("c2") / run_id
    art_dir.mkdir(parents=True, exist_ok=True)

    raw = load_ednet_subset()
    feat = build_history_features_v2(raw)
    students = feat["student_id"].unique()
    s_train, s_temp = train_test_split(students, test_size=0.35, random_state=seed)
    s_val, s_test = train_test_split(s_temp, test_size=0.5, random_state=seed)

    train_df = feat[feat.student_id.isin(s_train)].copy()
    val_df = feat[feat.student_id.isin(s_val)].copy()
    test_df = feat[feat.student_id.isin(s_test)].copy()

    # Train-only question difficulty
    q_diff = train_df.groupby("question_id")["correct"].mean()
    global_diff = float(train_df["correct"].mean())
    for d in (train_df, val_df, test_df):
        d["question_difficulty_train"] = d["question_id"].map(q_diff).fillna(global_diff)

    save_json(
        {
            "train_students": list(map(str, s_train)),
            "val_students": list(map(str, s_val)),
            "test_students": list(map(str, s_test)),
            "n_train_questions_with_difficulty": int(q_diff.shape[0]),
            "unseen_question_fill": global_diff,
        },
        art_dir / "split_manifest.json",
    )

    X_train, y_train = train_df[FEATURE_COLS_V2], train_df["correct"]
    X_val, y_val = val_df[FEATURE_COLS_V2], val_df["correct"]
    X_test, y_test = test_df[FEATURE_COLS_V2], test_df["correct"]

    baseline = DummyClassifier(strategy="most_frequent")
    baseline.fit(X_train, y_train)
    primary = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(max_iter=600, random_state=seed, class_weight="balanced")),
        ]
    )
    primary.fit(X_train, y_train)

    def eval_model(model, X, y):
        pred = model.predict(X)
        proba = model.predict_proba(X)[:, 1]
        return _eval(y.to_numpy(), pred, proba)

    val_base = eval_model(baseline, X_val, y_val)
    val_pri = eval_model(primary, X_val, y_val)
    eps = SELECTION_PROTOCOL["tie_epsilon"]
    auc_b, auc_p = val_base.get("roc_auc") or 0.5, val_pri.get("roc_auc") or 0.5
    if auc_p > auc_b + eps:
        selected = "logistic_regression"
        chosen = primary
    else:
        selected = "majority_baseline"
        chosen = baseline

    metrics = {
        "experiment": "ednet_correctness_v2_rocauc_selection",
        "selection_protocol": SELECTION_PROTOCOL,
        "preserved_prior_run": "c2_ednet_20261013T121127_34960c38",
        "test_set_status": "new student split from same subset CSV — not retuned on inspected prior test",
        "data_reuse": "Same ednet_kt1_subset.csv unless a larger subset was rebuilt beforehand",
        "validation": {"majority_baseline": val_base, "logistic_regression": val_pri},
        "test": {
            "majority_baseline": eval_model(baseline, X_test, y_test),
            "logistic_regression": eval_model(primary, X_test, y_test),
        },
        "selected_on_val": selected,
        "selected_test": eval_model(chosen, X_test, y_test),
        "sample_counts": {
            "train_students": int(len(s_train)),
            "val_students": int(len(s_val)),
            "test_students": int(len(s_test)),
            "train": int(len(train_df)),
            "validation": int(len(val_df)),
            "test": int(len(test_df)),
        },
    }

    # History sensitivity traces
    traces = []
    if len(val_df) > 10:
        low = val_df.nsmallest(3, "hist_accuracy").iloc[0]
        high = val_df.nlargest(3, "hist_accuracy").iloc[0]
        for label, row in (("low_hist_acc", low), ("high_hist_acc", high)):
            X = pd.DataFrame([row[FEATURE_COLS_V2]])
            traces.append(
                {
                    "label": label,
                    "features": {c: float(row[c]) for c in FEATURE_COLS_V2},
                    "logreg_proba": float(primary.predict_proba(X)[0, 1]),
                    "majority_proba": float(baseline.predict_proba(X)[0, 1]),
                }
            )
    metrics["history_sensitivity_traces"] = traces

    model_path = art_dir / "correctness_pipeline.joblib"
    joblib.dump(
        {
            "model": chosen,
            "baseline": baseline,
            "primary": primary,
            "feature_cols": FEATURE_COLS_V2,
            "selected": selected,
            "run_id": run_id,
            "selection_protocol": SELECTION_PROTOCOL,
            "question_difficulty_map": q_diff.to_dict(),
            "global_difficulty": global_diff,
            "history_construction": "solving_id-aware; train-only question difficulty",
        },
        model_path,
    )
    save_json(metrics, art_dir / "metrics.json")
    save_json(metrics, get_paths().reports / "c2_ednet_metrics_V2.json")
    write_manifest(
        RunManifest(
            run_id=run_id,
            component="c2",
            task="ednet_next_answer_correctness_v2",
            config_name=config_name,
            data_hashes={"features": dataframe_hash(train_df[FEATURE_COLS_V2 + ["correct"]])},
            sample_counts=metrics["sample_counts"],
            feature_schema=FEATURE_COLS_V2,
            seeds={"split": seed},
            metrics=metrics,
            artifact_paths={"model": str(model_path)},
            artifact_hashes={"model": file_sha256(model_path)},
            notes="ROC-AUC selection; prior F1-selected majority run preserved",
        ),
        art_dir / "run_manifest.json",
    )
    (get_paths().artifact("c2") / "LATEST_EDNET_V2_RUN.txt").write_text(run_id, encoding="utf-8")
    if update_latest_pointer and selected == "logistic_regression":
        (get_paths().artifact("c2") / "LATEST_EDNET_RUN.txt").write_text(run_id, encoding="utf-8")
        metrics["latest_pointer_updated"] = True
    else:
        metrics["latest_pointer_updated"] = False
        metrics["serving_note"] = (
            "Inference LATEST_EDNET_RUN unchanged unless learned model clearly wins on val ROC-AUC "
            "and update_latest_pointer=True"
        )
    logger.info("EdNet v2 selected=%s val_auc_lr=%.3f", selected, auc_p)
    return {"run_id": run_id, "status": "completed", "metrics": metrics, "artifact_dir": str(art_dir)}
