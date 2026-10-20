"""OULAD behavioural K-Means clustering pipeline."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from arts_ai.common.config import load_yaml_config
from arts_ai.common.hashing import file_sha256, dataframe_hash
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import RunManifest, write_manifest, save_json
from arts_ai.common.paths import get_paths
from arts_ai.datasets.oulad import load_oulad
from arts_ai.features.oulad_behaviour import build_behaviour_features

logger = get_logger("arts_ai.c1")


def train_behaviour_clustering(config_name: str = "c1_behaviour.yaml") -> dict[str, Any]:
    cfg = load_yaml_config(config_name)
    seed = int(cfg.get("seed", 42))
    cutoff = int(cfg.get("observation_cutoff_days", 13))
    run_id = f"c1_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    art_dir = get_paths().artifact("c1") / run_id
    art_dir.mkdir(parents=True, exist_ok=True)

    tables = load_oulad(["studentInfo.csv", "studentVle.csv", "vle.csv"])
    feat_df = build_behaviour_features(
        tables["studentInfo"],
        tables["studentVle"],
        tables["vle"],
        cutoff_days=cutoff,
    )
    feature_cols = feat_df.attrs["feature_cols"]

    # Eligible cohort: not insufficient_data; withdrawals kept as separate label but
    # clustering fit on students with observed activity
    eligible = feat_df.loc[~feat_df["insufficient_data"]].copy()
    late = feat_df.loc[feat_df["late_registration"]].copy()
    withdrawn = feat_df.loc[feat_df["is_withdrawn"]].copy()
    no_act = feat_df.loc[feat_df["no_observed_activity"]].copy()

    # Student-level split to avoid leakage
    ids = eligible["id_student"].astype(str).unique()
    id_train, id_temp = train_test_split(ids, test_size=0.4, random_state=seed)
    id_val, id_test = train_test_split(id_temp, test_size=0.5, random_state=seed)

    def subset(id_list):
        return eligible[eligible["id_student"].astype(str).isin(id_list)]

    train_df, val_df, test_df = subset(id_train), subset(id_val), subset(id_test)
    split_manifest = {
        "train_ids": list(map(str, id_train)),
        "validation_ids": list(map(str, id_val)),
        "test_ids": list(map(str, id_test)),
        "n_train": len(train_df),
        "n_val": len(val_df),
        "n_test": len(test_df),
        "cutoff_days": cutoff,
        "note": "Course-relative days 0..cutoff; distinct from days after application registration",
    }
    split_path = art_dir / "split_manifest.json"
    save_json(split_manifest, split_path)

    X_train = train_df[feature_cols].to_numpy(dtype=float)
    X_val = val_df[feature_cols].to_numpy(dtype=float)
    X_test = test_df[feature_cols].to_numpy(dtype=float)

    k_range = cfg["kmeans"]["k_range"]
    selection_rows = []
    best_k, best_score, best_pipe = None, -1.0, None
    for k in k_range:
        pipe = Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "kmeans",
                    KMeans(
                        n_clusters=k,
                        n_init=cfg["kmeans"]["n_init"],
                        max_iter=cfg["kmeans"]["max_iter"],
                        random_state=seed,
                    ),
                ),
            ]
        )
        pipe.fit(X_train)
        labels_val = pipe.predict(X_val)
        # Silhouette on validation
        if len(np.unique(labels_val)) > 1 and len(X_val) > k:
            sil = float(silhouette_score(pipe.named_steps["scaler"].transform(X_val), labels_val))
        else:
            sil = float("nan")
        selection_rows.append({"k": k, "silhouette_val": sil})
        if sil == sil and sil > best_score:  # not NaN
            best_score, best_k, best_pipe = sil, k, pipe

    if best_pipe is None:
        # Fallback
        best_k = k_range[0]
        best_pipe = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("kmeans", KMeans(n_clusters=best_k, n_init=10, random_state=seed)),
            ]
        )
        best_pipe.fit(X_train)
        best_score = float("nan")

    # Freeze selection; evaluate on test
    labels_test = best_pipe.predict(X_test)
    X_test_s = best_pipe.named_steps["scaler"].transform(X_test)
    sil_test = (
        float(silhouette_score(X_test_s, labels_test))
        if len(np.unique(labels_test)) > 1
        else float("nan")
    )
    sil_train = float(
        silhouette_score(
            best_pipe.named_steps["scaler"].transform(X_train),
            best_pipe.predict(X_train),
        )
    )

    # Cluster sizes & profiles on train
    train_labels = best_pipe.predict(X_train)
    train_profile = train_df[feature_cols].copy()
    train_profile["cluster"] = train_labels
    profiles = train_profile.groupby("cluster")[feature_cols].mean()
    sizes = pd.Series(train_labels).value_counts().sort_index()

    # Stability: refit with different seed, compare ARI on val
    from sklearn.metrics import adjusted_rand_score

    pipe2 = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "kmeans",
                KMeans(
                    n_clusters=best_k,
                    n_init=cfg["kmeans"]["n_init"],
                    max_iter=cfg["kmeans"]["max_iter"],
                    random_state=seed + 7,
                ),
            ),
        ]
    )
    pipe2.fit(X_train)
    stability_ari = float(adjusted_rand_score(best_pipe.predict(X_val), pipe2.predict(X_val)))

    # Plots
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    sel_df = pd.DataFrame(selection_rows)
    axes[0].plot(sel_df["k"], sel_df["silhouette_val"], marker="o")
    axes[0].set_title("Validation silhouette vs K")
    axes[0].set_xlabel("K")
    axes[0].set_ylabel("Silhouette")
    sizes.plot(kind="bar", ax=axes[1], title="Train cluster sizes")
    fig.tight_layout()
    chart_path = art_dir / "cluster_selection.png"
    fig.savefig(chart_path, dpi=120)
    plt.close(fig)

    fig2, ax2 = plt.subplots(figsize=(8, 4))
    sns.heatmap(profiles, annot=True, fmt=".2f", ax=ax2)
    ax2.set_title("Cluster mean profiles (train)")
    fig2.tight_layout()
    profile_chart = art_dir / "cluster_profiles.png"
    fig2.savefig(profile_chart, dpi=120)
    plt.close(fig2)

    model_path = art_dir / "kmeans_pipeline.joblib"
    joblib.dump(
        {
            "pipeline": best_pipe,
            "feature_cols": feature_cols,
            "k": best_k,
            "cutoff_days": cutoff,
            "run_id": run_id,
        },
        model_path,
    )

    # Also write "latest" pointer without silently deleting prior runs
    latest = get_paths().artifact("c1") / "LATEST_RUN.txt"
    latest.write_text(run_id, encoding="utf-8")

    metrics = {
        "selected_k": best_k,
        "silhouette_train": sil_train,
        "silhouette_val": best_score,
        "silhouette_test": sil_test,
        "stability_ari_val": stability_ari,
        "cluster_sizes_train": sizes.to_dict(),
        "k_selection": selection_rows,
        "cohort": {
            "n_all": len(feat_df),
            "n_eligible_activity": len(eligible),
            "n_late_registration": len(late),
            "n_withdrawn": int(feat_df["is_withdrawn"].sum()),
            "n_no_activity": len(no_act),
        },
        "note": "Clustering — do not report classification accuracy",
    }
    save_json(metrics, art_dir / "metrics.json")
    profiles.to_csv(art_dir / "cluster_profiles.csv")

    # Model card
    card = {
        "model_name": "OULAD behavioural K-Means",
        "data_category": "authentic_public",
        "dataset": "OULAD",
        "observation_cutoff_days": cutoff,
        "features": feature_cols,
        "excluded": ["identifiers", "final_result", "future clicks beyond cutoff"],
        "selection": "max validation silhouette over k_range",
        "limitations": [
            "UK OU distance-learning behaviour; not assumed to transfer to Sri Lankan A/L Arts",
            "Clicks are not study minutes/mastery/attention",
        ],
        "metrics": metrics,
    }
    card_path = art_dir / "model_card.json"
    save_json(card, card_path)

    # Dependency versions
    import sklearn
    import sklearn as sk

    deps = {
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit-learn": sk.__version__,
    }

    manifest = RunManifest(
        run_id=run_id,
        component="c1",
        task="oulad_behavioural_clustering",
        config_name=config_name,
        config=cfg,
        data_hashes={"features": dataframe_hash(eligible[feature_cols])},
        sample_counts={
            "train": len(train_df),
            "validation": len(val_df),
            "test": len(test_df),
        },
        feature_schema=feature_cols,
        split_manifest_path=str(split_path),
        seeds={"split": seed, "kmeans": seed},
        hyperparameters={"k": best_k, "k_range": k_range},
        dependency_versions=deps,
        metrics=metrics,
        artifact_paths={
            "model": str(model_path),
            "chart": str(chart_path),
            "profiles": str(profile_chart),
        },
        artifact_hashes={"model": file_sha256(model_path)},
        model_card_path=str(card_path),
    )
    write_manifest(manifest, art_dir / "run_manifest.json")
    # Copy summary to reports
    reports = get_paths().reports
    save_json(metrics, reports / "c1_behaviour_metrics.json")
    logger.info("C1 complete run_id=%s k=%s sil_test=%.4f", run_id, best_k, sil_test)
    return {"run_id": run_id, "metrics": metrics, "artifact_dir": str(art_dir)}
