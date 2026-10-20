"""Arts simulation track: prerequisite-aware baseline + lightweight candidate scorer."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split

from arts_ai.common.config import load_yaml_config
from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import RunManifest, save_json, write_manifest
from arts_ai.common.paths import get_paths

logger = get_logger("arts_ai.c2.arts")


def _load_synthetic(scenario_glob: str | None = None) -> Path:
    root = get_paths().synthetic
    dirs = sorted([p for p in root.iterdir() if p.is_dir() and (p / "dataset_manifest.json").exists()])
    if not dirs:
        raise FileNotFoundError("No synthetic Arts dataset; run generate_synthetic_arts() first")
    return dirs[-1]


def prerequisite_aware_rank(
    student_id: str,
    subject_id: str,
    topics: pd.DataFrame,
    prereqs: pd.DataFrame,
    resources: pd.DataFrame,
    attempts: pd.DataFrame,
    candidate_size: int = 20,
) -> pd.DataFrame:
    """Baseline: prefer next topic whose prerequisites appear practised; never reuse EdNet IDs."""
    sub_topics = topics[topics["subject_id"] == subject_id].copy()
    stu_att = attempts[attempts["student_id"] == student_id]
    # Mastery proxy from attempts on questions linked to topics
    q_topic = None
    # attempts have question_id; need questions table — score by resource topic attempts if joined
    practised = set()
    if "question_id" in stu_att.columns and not stu_att.empty:
        # topic encoded in question_id as {topic}_qN
        practised = set(stu_att["question_id"].astype(str).str.rsplit("_q", n=1).str[0])

    scores = []
    for _, topic in sub_topics.iterrows():
        tid = topic["topic_id"]
        pre = prereqs.loc[prereqs["topic_id"] == tid, "prerequisite_topic_id"].tolist()
        prereq_ok = all(p in practised for p in pre) if pre else True
        already = tid in practised
        base = 1.0 if prereq_ok and not already else (0.3 if prereq_ok else 0.05)
        if already:
            base *= 0.2
        res = resources[resources["topic_id"] == tid]
        for _, r in res.iterrows():
            scores.append(
                {
                    "student_id": student_id,
                    "resource_id": r["resource_id"],
                    "topic_id": tid,
                    "score": base * (1.0 - float(r["difficulty"]) * 0.2),
                    "policy": "prerequisite_aware",
                }
            )
    out = pd.DataFrame(scores)
    if out.empty:
        return out
    out = out.sort_values("score", ascending=False).head(candidate_size)
    out["rank"] = range(1, len(out) + 1)
    return out


def train_arts_recommendation(config_name: str = "c2_recommendation.yaml") -> dict[str, Any]:
    cfg = load_yaml_config(config_name)
    seed = int(cfg.get("seed", 42))
    run_id = f"c2_arts_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    art_dir = get_paths().artifact("c2") / run_id
    art_dir.mkdir(parents=True, exist_ok=True)

    data_dir = _load_synthetic()
    students = pd.read_csv(data_dir / "students.csv")
    topics = pd.read_csv(data_dir / "topics.csv")
    prereqs = pd.read_csv(data_dir / "topic_prerequisites.csv")
    resources = pd.read_csv(data_dir / "resources.csv")
    attempts = pd.read_csv(data_dir / "question_attempts.csv")
    rec_logs = pd.read_csv(data_dir / "recommendation_logs.csv")
    subjects = pd.read_csv(data_dir / "subjects.csv")

    # Declared relevance: opened_at not null within simulation
    rec_logs = rec_logs.copy()
    rec_logs["relevant"] = rec_logs["opened_at"].notna().astype(int)

    # Hold out by simulated learners (split_membership)
    train_students = students.loc[students["split_membership"] == "train", "student_id"]
    val_students = students.loc[students["split_membership"] == "validation", "student_id"]
    test_students = students.loc[students["split_membership"] == "test", "student_id"]

    # Build candidate-scoring dataset from recommendation logs + simple features
    def build_xy(sids):
        logs = rec_logs[rec_logs["student_id"].isin(sids)].copy()
        if logs.empty:
            return pd.DataFrame(), np.array([])
        # Features: rank position noise, score from policy, student scenario encoded
        stu = students.set_index("student_id")
        logs["scenario"] = logs["student_id"].map(stu["scenario_id"])
        scen_dummies = pd.get_dummies(logs["scenario"], prefix="scen")
        res = resources.set_index("resource_id")
        logs["difficulty"] = logs["resource_id"].map(res["difficulty"])
        X = pd.concat(
            [
                logs[["score", "rank", "difficulty"]].fillna(0),
                scen_dummies,
            ],
            axis=1,
        )
        y = logs["relevant"].to_numpy()
        return X, y

    X_train, y_train = build_xy(train_students)
    X_val, y_val = build_xy(val_students)
    X_test, y_test = build_xy(test_students)

    # Lightweight model — LogisticRegression as CPU-friendly scorer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    # Align columns
    all_cols = sorted(set(X_train.columns) | set(X_val.columns) | set(X_test.columns))

    def align(X):
        if isinstance(X, pd.DataFrame):
            for c in all_cols:
                if c not in X.columns:
                    X[c] = 0
            return X[all_cols]
        return X

    X_train, X_val, X_test = align(X_train), align(X_val), align(X_test)

    baseline_ap = float(y_test.mean()) if len(y_test) else 0.0  # random relevance rate

    model = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(max_iter=400, random_state=seed)),
        ]
    )
    if len(X_train) and y_train.sum() > 0 and (len(y_train) - y_train.sum()) > 0:
        model.fit(X_train, y_train)
        trained = True
    else:
        trained = False

    def ranking_metrics(X, y, sids_logs):
        if not trained or len(X) == 0:
            return {"ap": None, "roc_auc": None, "n": 0}
        proba = model.predict_proba(X)[:, 1]
        out = {"n": int(len(y)), "relevance_rate": float(y.mean())}
        try:
            out["ap"] = float(average_precision_score(y, proba))
        except ValueError:
            out["ap"] = None
        try:
            out["roc_auc"] = float(roc_auc_score(y, proba))
        except ValueError:
            out["roc_auc"] = None
        return out

    # Scenario variations on test (predeclared)
    scenario_metrics = {}
    test_logs = rec_logs[rec_logs["student_id"].isin(test_students)]
    for scen in cfg.get("arts_simulation_track", {}).get("scenario_variations", []):
        sids = students.loc[
            (students["split_membership"] == "test") & (students["scenario_id"] == scen),
            "student_id",
        ]
        Xs, ys = build_xy(sids)
        Xs = align(Xs) if len(Xs) else Xs
        scenario_metrics[scen] = ranking_metrics(Xs, ys, None)

    metrics = {
        "data_category": "synthetic_learner",
        "subjects_provisional": True,
        "candidate_set_size": cfg.get("arts_simulation_track", {}).get("candidate_set_size", 20),
        "relevance_definition": cfg.get("arts_simulation_track", {}).get("relevance_definition"),
        "outcome_definition": cfg.get("arts_simulation_track", {}).get("outcome_definition"),
        "baseline_random_relevance_rate_test": baseline_ap,
        "prerequisite_policy": "implemented",
        "scoring_model_trained": trained,
        "validation": ranking_metrics(X_val, y_val, None),
        "test": ranking_metrics(X_test, y_test, None),
        "scenario_variations_test": scenario_metrics,
        "note": (
            "Results measure ranking under simulation assumptions only. "
            "Not real student recommendation effectiveness."
        ),
    }

    # Example prerequisite recommendations for one test student
    examples = []
    for sid in list(test_students)[:3]:
        sub_id = subjects.iloc[0]["subject_id"]
        examples.append(
            prerequisite_aware_rank(
                sid, sub_id, topics, prereqs, resources, attempts
            ).to_dict(orient="records")
        )

    fig, ax = plt.subplots()
    vals = [
        metrics["test"].get("ap") or 0,
        metrics["baseline_random_relevance_rate_test"] or 0,
    ]
    ax.bar(["model_AP", "relevance_rate_baseline"], vals)
    ax.set_title("Simulated recommendation AP (test)")
    fig.tight_layout()
    chart = art_dir / "arts_recommend.png"
    fig.savefig(chart, dpi=120)
    plt.close(fig)

    model_path = art_dir / "arts_candidate_scorer.joblib"
    joblib.dump(
        {
            "model": model if trained else None,
            "feature_cols": all_cols,
            "run_id": run_id,
            "data_dir": str(data_dir),
            "policy": "prerequisite_aware",
        },
        model_path,
    )
    (get_paths().artifact("c2") / "LATEST_ARTS_RUN.txt").write_text(run_id, encoding="utf-8")
    save_json(metrics, art_dir / "metrics.json")
    save_json(metrics, get_paths().reports / "c2_arts_metrics.json")
    save_json({"examples": examples}, art_dir / "policy_examples.json")
    save_json(
        {
            "model_name": "Arts simulated candidate scorer",
            "data_category": "synthetic_learner",
            "provisional_catalogue": True,
            "metrics": metrics,
        },
        art_dir / "model_card.json",
    )

    manifest = RunManifest(
        run_id=run_id,
        component="c2",
        task="arts_simulated_recommendation",
        config_name=config_name,
        sample_counts={
            "train_rows": int(len(X_train)),
            "val_rows": int(len(X_val)),
            "test_rows": int(len(X_test)),
        },
        feature_schema=all_cols,
        seeds={"split": seed},
        metrics=metrics,
        artifact_paths={"model": str(model_path), "chart": str(chart)},
        artifact_hashes={"model": file_sha256(model_path)},
        model_card_path=str(art_dir / "model_card.json"),
        notes="SYNTHETIC evaluation only",
    )
    write_manifest(manifest, art_dir / "run_manifest.json")
    logger.info("Arts recommendation simulation complete trained=%s", trained)
    return {"run_id": run_id, "status": "completed", "metrics": metrics, "artifact_dir": str(art_dir)}
