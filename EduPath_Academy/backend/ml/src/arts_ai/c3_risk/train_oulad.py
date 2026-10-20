"""OULAD primary authentic-data academic risk experiment."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.calibration import calibration_curve
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    confusion_matrix,
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
from arts_ai.datasets.oulad import load_oulad
from arts_ai.features.oulad_risk import build_risk_features

logger = get_logger("arts_ai.c3.oulad")


def _metrics(y_true, y_pred, y_proba) -> dict[str, Any]:
    out: dict[str, Any] = {
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "confusion_matrix": confusion_matrix(y_true, y_pred).tolist(),
        "support": {
            "positive": int((y_true == 1).sum()),
            "negative": int((y_true == 0).sum()),
        },
    }
    try:
        out["roc_auc"] = float(roc_auc_score(y_true, y_proba))
    except ValueError:
        out["roc_auc"] = None
    try:
        out["pr_auc"] = float(average_precision_score(y_true, y_proba))
    except ValueError:
        out["pr_auc"] = None
    return out


def train_oulad_risk(config_name: str = "c3_risk.yaml") -> dict[str, Any]:
    cfg = load_yaml_config(config_name)
    seed = int(cfg.get("seed", 42))
    ocfg = cfg["oulad_primary"]
    cutoff = int(ocfg.get("observation_cutoff_days", 13))
    run_id = f"c3_oulad_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    art_dir = get_paths().artifact("c3") / run_id
    art_dir.mkdir(parents=True, exist_ok=True)

    tables = load_oulad(["studentInfo.csv", "studentVle.csv", "vle.csv"])
    feat = build_risk_features(
        tables["studentInfo"],
        tables["studentVle"],
        tables["vle"],
        cutoff_days=cutoff,
    )
    feature_cols = list(feat.attrs["feature_cols"])

    # Target: Fail vs Pass/Distinction; Withdrawn excluded
    pop = feat[feat["final_result"].isin(["Fail", "Pass", "Distinction"])].copy()
    pop["y"] = (pop["final_result"] == "Fail").astype(int)
    # Drop insufficient activity optionally still keep with zeros — keep all remaining enrolled
    n_withdrawn_excluded = int((feat["final_result"] == "Withdrawn").sum())

    ids = pop["id_student"].astype(str).unique()
    id_train, id_temp = train_test_split(ids, test_size=0.4, random_state=seed)
    id_val, id_test = train_test_split(id_temp, test_size=0.5, random_state=seed)

    def take(id_list):
        return pop[pop["id_student"].astype(str).isin(id_list)]

    train_df, val_df, test_df = take(id_train), take(id_val), take(id_test)
    save_json(
        {
            "train": list(map(str, id_train)),
            "validation": list(map(str, id_val)),
            "test": list(map(str, id_test)),
            "target": "Fail vs Pass/Distinction",
            "positive_class": "Fail",
            "excluded": "Withdrawn",
            "observation_cutoff_days": cutoff,
            "population_limitation": ocfg.get("population_limitation"),
        },
        art_dir / "split_manifest.json",
    )

    X_train = train_df[feature_cols].fillna(0).to_numpy(dtype=float)
    y_train = train_df["y"].to_numpy()
    X_val = val_df[feature_cols].fillna(0).to_numpy(dtype=float)
    y_val = val_df["y"].to_numpy()
    X_test = test_df[feature_cols].fillna(0).to_numpy(dtype=float)
    y_test = test_df["y"].to_numpy()

    models: dict[str, Any] = {}
    models["dummy_stratified"] = DummyClassifier(strategy="stratified", random_state=seed)
    models["logistic_regression"] = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(max_iter=500, random_state=seed, n_jobs=2)),
        ]
    )
    # Tree-based: LightGBM if available else sklearn HistGradientBoosting
    try:
        import lightgbm as lgb

        models["lightgbm"] = lgb.LGBMClassifier(
            n_estimators=100,
            learning_rate=0.05,
            num_leaves=31,
            random_state=seed,
            n_jobs=2,
            verbose=-1,
        )
        tree_name = "lightgbm"
    except Exception:  # noqa: BLE001
        from sklearn.ensemble import HistGradientBoostingClassifier

        models["hist_gradient_boosting"] = HistGradientBoostingClassifier(random_state=seed)
        tree_name = "hist_gradient_boosting"

    for m in models.values():
        m.fit(X_train, y_train)

    # Select on validation F1
    val_scores = {}
    for name, m in models.items():
        pred = m.predict(X_val)
        proba = m.predict_proba(X_val)[:, 1]
        val_scores[name] = _metrics(y_val, pred, proba)
    selected = max(val_scores.keys(), key=lambda n: val_scores[n]["f1"])

    test_scores = {}
    for name, m in models.items():
        pred = m.predict(X_test)
        proba = m.predict_proba(X_test)[:, 1]
        test_scores[name] = _metrics(y_test, pred, proba)

    # Calibration plot for selected model
    sel = models[selected]
    proba_test = sel.predict_proba(X_test)[:, 1]
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    cm = np.array(test_scores[selected]["confusion_matrix"])
    sns.heatmap(cm, annot=True, fmt="d", ax=axes[0], cmap="Blues")
    axes[0].set_title(f"Confusion matrix ({selected})")
    axes[0].set_xlabel("Predicted")
    axes[0].set_ylabel("Actual")
    try:
        frac_pos, mean_pred = calibration_curve(y_test, proba_test, n_bins=8, strategy="quantile")
        axes[1].plot(mean_pred, frac_pos, marker="o", label="model")
        axes[1].plot([0, 1], [0, 1], "--", label="perfect")
        axes[1].set_title("Reliability diagram")
        axes[1].legend()
    except ValueError:
        axes[1].text(0.1, 0.5, "Calibration undefined for this split")
    fig.tight_layout()
    chart = art_dir / "oulad_risk.png"
    fig.savefig(chart, dpi=120)
    plt.close(fig)

    policy_bands = ocfg.get("policy_bands", {})
    # Document policy bands separately — NOT ground truth
    band_counts = {
        "high": int((proba_test >= policy_bands.get("high", 0.6)).sum()),
        "medium": int(
            (
                (proba_test >= policy_bands.get("medium", 0.35))
                & (proba_test < policy_bands.get("high", 0.6))
            ).sum()
        ),
        "low": int((proba_test < policy_bands.get("medium", 0.35)).sum()),
    }

    metrics = {
        "data_category": "authentic_public",
        "target": "Fail vs Pass/Distinction",
        "positive_class": "Fail",
        "observation_cutoff_days": cutoff,
        "n_withdrawn_excluded": n_withdrawn_excluded,
        "population_limitation": ocfg.get("population_limitation"),
        "validation": val_scores,
        "test": test_scores,
        "selected_on_validation_f1": selected,
        "policy_bands": policy_bands,
        "policy_band_counts_test_selected": band_counts,
        "policy_band_note": "High/Medium/Low are policy thresholds on predicted probability, NOT ground-truth labels",
        "tree_model": tree_name,
    }

    model_path = art_dir / "risk_pipeline.joblib"
    joblib.dump(
        {
            "models": models,
            "selected": selected,
            "feature_cols": feature_cols,
            "cutoff_days": cutoff,
            "positive_class": "Fail",
            "run_id": run_id,
            "policy_bands": policy_bands,
        },
        model_path,
    )
    (get_paths().artifact("c3") / "LATEST_OULAD_RUN.txt").write_text(run_id, encoding="utf-8")
    save_json(metrics, art_dir / "metrics.json")
    save_json(metrics, get_paths().reports / "c3_oulad_metrics.json")
    save_json(
        {
            "model_name": "OULAD academic risk classifier",
            "data_category": "authentic_public",
            "metrics": metrics,
            "limitations": [
                "Withdrawn excluded",
                "Cutoff day 13 course-relative",
                "Not Sri Lankan A/L Arts population",
            ],
        },
        art_dir / "model_card.json",
    )

    manifest = RunManifest(
        run_id=run_id,
        component="c3",
        task="oulad_academic_risk",
        config_name=config_name,
        data_hashes={"features": dataframe_hash(pop[feature_cols])},
        sample_counts={"train": len(train_df), "validation": len(val_df), "test": len(test_df)},
        feature_schema=feature_cols,
        seeds={"split": seed},
        metrics=metrics,
        artifact_paths={"model": str(model_path), "chart": str(chart)},
        artifact_hashes={"model": file_sha256(model_path)},
        model_card_path=str(art_dir / "model_card.json"),
    )
    write_manifest(manifest, art_dir / "run_manifest.json")
    logger.info(
        "OULAD risk done selected=%s test_f1=%.4f",
        selected,
        test_scores[selected]["f1"],
    )
    return {"run_id": run_id, "status": "completed", "metrics": metrics, "artifact_dir": str(art_dir)}
