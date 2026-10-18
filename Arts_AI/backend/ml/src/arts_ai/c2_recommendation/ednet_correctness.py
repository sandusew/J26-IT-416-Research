"""Public-data track: next-answer correctness on EdNet history."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from arts_ai.common.config import load_yaml_config
from arts_ai.common.hashing import file_sha256, dataframe_hash
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import RunManifest, save_json, write_manifest
from arts_ai.common.paths import get_paths
from arts_ai.datasets.ednet import load_ednet_subset

logger = get_logger("arts_ai.c2.ednet")


def build_history_features(df: pd.DataFrame) -> pd.DataFrame:
    """Features using only information available BEFORE each response.

    Forbids target correctness and target duration as inputs.
    """
    df = df.sort_values(["student_id", "timestamp"]).copy()
    if "correct" not in df.columns:
        # Some EdNet dumps need answer key; if missing, cannot train authentically
        raise ValueError(
            "EdNet subset lacks 'correct' column; provide labelled KT1 interactions"
        )

    rows = []
    for sid, g in df.groupby("student_id", sort=False):
        g = g.reset_index(drop=True)
        correct_hist = []
        elapsed_hist = []
        for i in range(len(g)):
            if i < 5:
                continue  # need min history
            # Pre-answer features only
            prev_correct = correct_hist[-50:]
            prev_elapsed = elapsed_hist[-50:]
            rows.append(
                {
                    "student_id": sid,
                    "row_idx": i,
                    "question_id": g.loc[i, "question_id"],
                    "hist_count": len(prev_correct),
                    "hist_accuracy": float(np.mean(prev_correct)) if prev_correct else 0.5,
                    "hist_accuracy_10": float(np.mean(prev_correct[-10:])) if prev_correct else 0.5,
                    "hist_mean_elapsed": float(np.mean(prev_elapsed)) if prev_elapsed else 0.0,
                    "hist_std_elapsed": float(np.std(prev_elapsed)) if len(prev_elapsed) > 1 else 0.0,
                    "correct": int(g.loc[i, "correct"]),
                    # NOTE: do NOT include g.loc[i, "elapsed_time"] or current correctness as features
                }
            )
            correct_hist.append(int(g.loc[i, "correct"]))
            if "elapsed_time" in g.columns:
                elapsed_hist.append(float(g.loc[i, "elapsed_time"]))
            else:
                elapsed_hist.append(0.0)
    return pd.DataFrame(rows)


FEATURE_COLS = [
    "hist_count",
    "hist_accuracy",
    "hist_accuracy_10",
    "hist_mean_elapsed",
    "hist_std_elapsed",
]


def train_ednet_correctness(config_name: str = "c2_recommendation.yaml") -> dict[str, Any]:
    cfg = load_yaml_config(config_name)
    seed = int(cfg.get("seed", 42))
    run_id = f"c2_ednet_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    art_dir = get_paths().artifact("c2") / run_id
    art_dir.mkdir(parents=True, exist_ok=True)

    try:
        raw = load_ednet_subset()
    except FileNotFoundError as e:
        result = {
            "run_id": run_id,
            "status": "blocked",
            "reason": str(e),
            "data_category": "authentic_public",
            "note": (
                "Authentic EdNet KT1 not available. Public-track experiment NOT completed. "
                "Synthetic replacements were NOT used."
            ),
        }
        save_json(result, art_dir / "blocked.json")
        save_json(result, get_paths().reports / "c2_ednet_blocked.json")
        (get_paths().artifact("c2") / "LATEST_EDNET_RUN.txt").write_text(run_id, encoding="utf-8")
        logger.warning("EdNet training blocked: %s", e)
        return result

    feat = build_history_features(raw)
    # Student-level split
    students = feat["student_id"].unique()
    s_train, s_temp = train_test_split(students, test_size=0.35, random_state=seed)
    s_val, s_test = train_test_split(s_temp, test_size=0.5, random_state=seed)

    def take(sids):
        return feat[feat["student_id"].isin(sids)]

    train_df, val_df, test_df = take(s_train), take(s_val), take(s_test)
    save_json(
        {
            "train_students": list(map(str, s_train)),
            "val_students": list(map(str, s_val)),
            "test_students": list(map(str, s_test)),
        },
        art_dir / "split_manifest.json",
    )

    X_train, y_train = train_df[FEATURE_COLS], train_df["correct"]
    X_val, y_val = val_df[FEATURE_COLS], val_df["correct"]
    X_test, y_test = test_df[FEATURE_COLS], test_df["correct"]

    baseline = DummyClassifier(strategy="most_frequent")
    baseline.fit(X_train, y_train)

    primary = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "clf",
                LogisticRegression(max_iter=500, random_state=seed, n_jobs=2),
            ),
        ]
    )
    primary.fit(X_train, y_train)

    # Select on validation (compare F1)
    def eval_model(model, X, y):
        pred = model.predict(X)
        proba = model.predict_proba(X)[:, 1] if hasattr(model, "predict_proba") else pred
        out = {
            "accuracy": float(accuracy_score(y, pred)),
            "precision": float(precision_score(y, pred, zero_division=0)),
            "recall": float(recall_score(y, pred, zero_division=0)),
            "f1": float(f1_score(y, pred, zero_division=0)),
        }
        try:
            out["roc_auc"] = float(roc_auc_score(y, proba))
        except ValueError:
            out["roc_auc"] = None
        return out

    val_base = eval_model(baseline, X_val, y_val)
    val_pri = eval_model(primary, X_val, y_val)
    selected = "logistic_regression" if val_pri["f1"] >= val_base["f1"] else "majority_baseline"
    chosen = primary if selected == "logistic_regression" else baseline

    test_metrics = {
        "baseline_majority": eval_model(baseline, X_test, y_test),
        "logistic_regression": eval_model(primary, X_test, y_test),
        "selected_on_val": selected,
        "selected_test": eval_model(chosen, X_test, y_test),
    }

    fig, ax = plt.subplots()
    ax.bar(
        ["baseline_acc", "logreg_acc", "baseline_f1", "logreg_f1"],
        [
            test_metrics["baseline_majority"]["accuracy"],
            test_metrics["logistic_regression"]["accuracy"],
            test_metrics["baseline_majority"]["f1"],
            test_metrics["logistic_regression"]["f1"],
        ],
    )
    ax.set_title("EdNet next-answer correctness (test)")
    ax.set_ylim(0, 1)
    fig.tight_layout()
    chart = art_dir / "ednet_correctness.png"
    fig.savefig(chart, dpi=120)
    plt.close(fig)

    model_path = art_dir / "correctness_pipeline.joblib"
    joblib.dump(
        {
            "model": chosen,
            "baseline": baseline,
            "primary": primary,
            "feature_cols": FEATURE_COLS,
            "selected": selected,
            "run_id": run_id,
            "history_construction": "rolling pre-response aggregates; no target leak",
        },
        model_path,
    )
    (get_paths().artifact("c2") / "LATEST_EDNET_RUN.txt").write_text(run_id, encoding="utf-8")

    card = {
        "task": "next_answer_correctness",
        "data_category": "authentic_public",
        "dataset": "EdNet KT1 subset",
        "note": "Correctness prediction accuracy is NOT recommendation effectiveness",
        "metrics": test_metrics,
    }
    save_json(card, art_dir / "model_card.json")
    save_json(test_metrics, art_dir / "metrics.json")
    save_json(test_metrics, get_paths().reports / "c2_ednet_metrics.json")

    manifest = RunManifest(
        run_id=run_id,
        component="c2",
        task="ednet_next_answer_correctness",
        config_name=config_name,
        data_hashes={"features": dataframe_hash(feat[FEATURE_COLS + ["correct"]])},
        sample_counts={"train": len(train_df), "validation": len(val_df), "test": len(test_df)},
        feature_schema=FEATURE_COLS,
        seeds={"split": seed},
        metrics=test_metrics,
        artifact_paths={"model": str(model_path), "chart": str(chart)},
        artifact_hashes={"model": file_sha256(model_path)},
        model_card_path=str(art_dir / "model_card.json"),
    )
    write_manifest(manifest, art_dir / "run_manifest.json")
    logger.info("EdNet correctness done selected=%s test=%s", selected, test_metrics["selected_test"])
    return {"run_id": run_id, "status": "completed", "metrics": test_metrics, "artifact_dir": str(art_dir)}
