"""Diagnose why EdNet validation selected majority_baseline. Does not retrain."""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    f1_score,
    log_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)

from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths
from arts_ai.c2_recommendation.ednet_correctness import FEATURE_COLS, build_history_features
from arts_ai.datasets.ednet import load_ednet_subset


def _metrics(y, pred, proba) -> dict:
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
    try:
        out["log_loss"] = float(log_loss(y, np.clip(proba, 1e-6, 1 - 1e-6)))
    except ValueError:
        out["log_loss"] = None
    return out


def main() -> dict:
    paths = get_paths()
    run_id = (paths.artifact("c2") / "LATEST_EDNET_RUN.txt").read_text(encoding="utf-8").strip()
    art = paths.artifact("c2") / run_id
    bundle = joblib.load(art / "correctness_pipeline.joblib")
    split = json.loads((art / "split_manifest.json").read_text(encoding="utf-8"))

    raw = load_ednet_subset()
    # Correctness-join audit on raw subset
    join_audit = {
        "n_rows": int(len(raw)),
        "n_students": int(raw["student_id"].nunique()),
        "has_correct": "correct" in raw.columns,
        "correct_nulls": int(raw["correct"].isna().sum()) if "correct" in raw.columns else None,
        "correct_rate": float(raw["correct"].mean()) if "correct" in raw.columns else None,
        "unknown_answer_policy": (
            "Join Contents correct_answer to user_answer; unmatched question_id → None then "
            "dropped or coerced in earlier pipeline — current subset reports 0 nulls"
        ),
    }

    feat = build_history_features(raw)
    train_s, val_s, test_s = set(split["train_students"]), set(split["val_students"]), set(split["test_students"])
    train = feat[feat.student_id.isin(train_s)]
    val = feat[feat.student_id.isin(val_s)]
    test = feat[feat.student_id.isin(test_s)]

    baseline = bundle["baseline"]
    primary = bundle["primary"]
    selected = bundle["selected"]

    def pack(name, model, df):
        X, y = df[FEATURE_COLS], df["correct"].to_numpy()
        pred = model.predict(X)
        proba = model.predict_proba(X)[:, 1] if hasattr(model, "predict_proba") else pred.astype(float)
        return _metrics(y, pred, proba)

    # Trace: same question context, different histories → do predictions change?
    traces = []
    # Pick two students with different hist_accuracy at similar hist_count
    sample = val.copy()
    if len(sample) > 20:
        low = sample.nsmallest(5, "hist_accuracy").iloc[0]
        high = sample.nlargest(5, "hist_accuracy").iloc[0]
        for label, row in (("low_hist_acc", low), ("high_hist_acc", high)):
            X = pd.DataFrame([row[FEATURE_COLS]])
            traces.append(
                {
                    "label": label,
                    "student_id": str(row["student_id"]),
                    "features": {c: float(row[c]) for c in FEATURE_COLS},
                    "majority_pred": int(baseline.predict(X)[0]),
                    "majority_proba": float(baseline.predict_proba(X)[0, 1]),
                    "logreg_pred": int(primary.predict(X)[0]),
                    "logreg_proba": float(primary.predict_proba(X)[0, 1]),
                    "true": int(row["correct"]),
                }
            )

    report = {
        "diagnosed_run_id": run_id,
        "selection_rule_original": {
            "metric": "f1_positive on validation",
            "tie_break": "logistic_regression if val_f1 >= baseline_f1 else majority_baseline",
            "selected": selected,
            "why_majority_often_wins": (
                "Positive class ~65–67%. Majority always predicts correct=1, yielding high "
                "positive-F1 (~0.80) while ROC-AUC=0.5. Logistic may improve ROC-AUC slightly "
                "but lose on positive-F1 → selection prefers majority."
            ),
        },
        "join_audit": join_audit,
        "counts": {
            "train_students": len(train_s),
            "val_students": len(val_s),
            "test_students": len(test_s),
            "train_responses": int(len(train)),
            "val_responses": int(len(val)),
            "test_responses": int(len(test)),
            "class_balance": {
                "train_pos_rate": float(train["correct"].mean()),
                "val_pos_rate": float(val["correct"].mean()),
                "test_pos_rate": float(test["correct"].mean()),
            },
        },
        "validation_expanded": {
            "majority_baseline": pack("maj", baseline, val),
            "logistic_regression": pack("lr", primary, val),
        },
        "test_expanded_secondary": {
            "note": "Reported for diagnosis; do not use to change selection of this frozen run",
            "majority_baseline": pack("maj", baseline, test),
            "logistic_regression": pack("lr", primary, test),
        },
        "selected_behaviour": {
            "selected": selected,
            "always_predicts": "correct=1 (majority class)" if selected == "majority_baseline" else "logistic scores",
            "predictions_vary_with_history": selected != "majority_baseline",
        },
        "history_trace_examples": traces,
        "feature_leakage_notes": {
            "current_correct_in_features": False,
            "current_elapsed_in_features": False,
            "history_uses_prior_only": True,
            "solving_id_bundle_gap": (
                "Original builder updates history after every row chronologically; "
                "does not isolate same solving_id bundles (potential within-bundle leakage)."
            ),
            "question_difficulty": "Not in original FEATURE_COLS",
        },
    }
    out = paths.reports / "ednet_baseline_diagnosis.json"
    save_json(report, out)
    save_json(report, art / "baseline_diagnosis.json")
    print(json.dumps({"wrote": str(out), "selected": selected, "val_lr_roc": report["validation_expanded"]["logistic_regression"]["roc_auc"], "val_maj_f1": report["validation_expanded"]["majority_baseline"]["f1_positive"]}, indent=2))
    return report


if __name__ == "__main__":
    main()
