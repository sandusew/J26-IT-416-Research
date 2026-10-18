"""Per-query ranking evaluation for Arts simulation recommendations.

Preserves original pooled-binary AP experiment as historical evidence.
This module adds a revised protocol: identical candidate sets, random /
prerequisite-aware / learned rankers, with MAP / NDCG / MRR.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from arts_ai.common.config import load_yaml_config
from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import RunManifest, save_json, write_manifest
from arts_ai.common.paths import get_paths
from arts_ai.c2_recommendation.arts_recommend import _load_synthetic, prerequisite_aware_rank

logger = get_logger("arts_ai.c2.ranking")


def _dcg(rels: np.ndarray, k: int) -> float:
    rels = np.asarray(rels[:k], dtype=float)
    if rels.size == 0:
        return 0.0
    gains = (2**rels - 1) / np.log2(np.arange(2, rels.size + 2))
    return float(gains.sum())


def ndcg_at_k(y_true: np.ndarray, y_score: np.ndarray, k: int = 10) -> float:
    order = np.argsort(-y_score)
    ideal = np.sort(y_true)[::-1]
    dcg = _dcg(y_true[order], k)
    idcg = _dcg(ideal, k)
    return float(dcg / idcg) if idcg > 0 else 0.0


def average_precision_query(y_true: np.ndarray, y_score: np.ndarray) -> float:
    order = np.argsort(-y_score)
    y = y_true[order]
    if y.sum() == 0:
        return 0.0
    hits = 0.0
    s = 0.0
    for i, rel in enumerate(y, start=1):
        if rel > 0:
            hits += 1
            s += hits / i
    return float(s / y.sum())


def mrr_query(y_true: np.ndarray, y_score: np.ndarray) -> float:
    order = np.argsort(-y_score)
    for i, idx in enumerate(order, start=1):
        if y_true[idx] > 0:
            return 1.0 / i
    return 0.0


def evaluate_rankers(
    config_name: str = "c2_recommendation.yaml",
    seed: int = 42,
    k: int = 10,
) -> dict[str, Any]:
    cfg = load_yaml_config(config_name)
    run_id = f"c2_rank_rev_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
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

    rec_logs = rec_logs.copy()
    # Relevance: opened within simulation (explicit)
    rec_logs["relevant"] = rec_logs["opened_at"].notna().astype(int)
    relevance_def = "opened_at is not null (simulated engagement)"

    train_s = set(students.loc[students.split_membership == "train", "student_id"])
    val_s = set(students.loc[students.split_membership == "validation", "student_id"])
    test_s = set(students.loc[students.split_membership == "test", "student_id"])

    # Train lightweight pointwise model on train logs ONLY (observable features)
    train_logs = rec_logs[rec_logs.student_id.isin(train_s)].copy()
    res = resources.set_index("resource_id")
    train_logs["difficulty"] = train_logs["resource_id"].map(res["difficulty"]).fillna(0.5)
    # Exclude simulator policy score/rank from features to avoid circularity with prerequisite baseline
    # Use only difficulty + prior student open-rate (computed from train only)
    open_rate = train_logs.groupby("student_id")["relevant"].mean()
    train_logs["stu_open_rate"] = train_logs["student_id"].map(open_rate).fillna(train_logs["relevant"].mean())
    feat_cols = ["difficulty", "stu_open_rate"]
    model = Pipeline(
        [("scaler", StandardScaler()), ("clf", LogisticRegression(max_iter=400, random_state=seed))]
    )
    if train_logs["relevant"].nunique() > 1:
        model.fit(train_logs[feat_cols], train_logs["relevant"])
        trained = True
    else:
        trained = False

    global_open = float(train_logs["relevant"].mean()) if len(train_logs) else 0.5

    def score_learned(cands: pd.DataFrame, student_id: str) -> np.ndarray:
        if not trained or cands.empty:
            return np.zeros(len(cands))
        d = cands.copy()
        d["difficulty"] = d["resource_id"].map(res["difficulty"]).fillna(0.5)
        d["stu_open_rate"] = open_rate.get(student_id, global_open)
        return model.predict_proba(d[feat_cols])[:, 1]

    def build_queries(student_ids: set[str]) -> list[dict[str, Any]]:
        """One query per recommendation_id: candidate set = resources in same subject as recommended item."""
        logs = rec_logs[rec_logs.student_id.isin(student_ids)]
        queries = []
        for _, row in logs.iterrows():
            rid = row["resource_id"]
            if rid not in res.index:
                continue
            topic_id = res.loc[rid, "topic_id"]
            subject_id = topics.loc[topics.topic_id == topic_id, "subject_id"]
            if subject_id.empty:
                continue
            subject_id = subject_id.iloc[0]
            # Candidate set: all resources in subject (fixed, identical across rankers)
            topic_ids = topics.loc[topics.subject_id == subject_id, "topic_id"]
            cands = resources[resources.topic_id.isin(topic_ids)].copy()
            if cands.empty:
                continue
            # Labels: recommended resource relevant if opened; other cands 0 unless also in student's opened set
            opened = set(
                logs.loc[
                    (logs.student_id == row["student_id"]) & (logs.opened_at.notna()),
                    "resource_id",
                ]
            )
            y = cands["resource_id"].isin(opened).astype(int).to_numpy()
            # Ensure at least the logged item label matches row relevance
            # (if opened, that resource is 1)
            queries.append(
                {
                    "recommendation_id": row["recommendation_id"],
                    "student_id": row["student_id"],
                    "subject_id": subject_id,
                    "candidates": cands.reset_index(drop=True),
                    "y_true": y,
                    "logged_relevant": int(row["relevant"]),
                }
            )
        return queries

    def eval_queries(queries: list[dict[str, Any]], split_name: str) -> dict[str, Any]:
        rng = np.random.default_rng(seed)
        metrics = {
            "random": {"ndcg": [], "map": [], "mrr": [], "student_id": []},
            "prerequisite_aware": {"ndcg": [], "map": [], "mrr": [], "student_id": []},
            "learned": {"ndcg": [], "map": [], "mrr": [], "student_id": []},
        }
        n_used = 0
        n_zero_rel = 0
        label_prev = []
        cand_sizes = []
        n_rel_per_q = []
        for q in queries:
            cands = q["candidates"]
            y = q["y_true"]
            cand_sizes.append(int(len(cands)))
            n_rel_per_q.append(int(y.sum()))
            if y.sum() == 0:
                n_zero_rel += 1
                continue  # skip queries with no relevant item in candidate set
            n_used += 1
            label_prev.append(float(y.mean()))

            # Random scores
            s_rand = rng.random(len(cands))
            # Prerequisite policy scores on same candidate IDs
            pr = prerequisite_aware_rank(
                q["student_id"],
                q["subject_id"],
                topics,
                prereqs,
                resources,
                attempts,
                candidate_size=len(cands),
            )
            score_map = dict(zip(pr["resource_id"], pr["score"])) if len(pr) else {}
            s_pre = cands["resource_id"].map(lambda r: float(score_map.get(r, 0.0))).to_numpy()
            s_learn = score_learned(cands, q["student_id"])

            for name, scores in (
                ("random", s_rand),
                ("prerequisite_aware", s_pre),
                ("learned", s_learn),
            ):
                metrics[name]["ndcg"].append(ndcg_at_k(y, scores, k=k))
                metrics[name]["map"].append(average_precision_query(y, scores))
                metrics[name]["mrr"].append(mrr_query(y, scores))
                metrics[name]["student_id"].append(q["student_id"])

        def _student_bootstrap(metric_list: list[float], student_ids: list[str], n_boot: int = 200):
            """Resample whole students (queries grouped by student)."""
            if not metric_list:
                return {"mean": None, "ci95": [None, None], "n_students": 0}
            by_stu: dict[str, list[float]] = {}
            for m, s in zip(metric_list, student_ids):
                by_stu.setdefault(s, []).append(m)
            stu_keys = list(by_stu.keys())
            means = []
            boot_rng = np.random.default_rng(seed + 7)
            for _ in range(n_boot):
                sample = boot_rng.choice(stu_keys, size=len(stu_keys), replace=True)
                vals = [float(np.mean(by_stu[s])) for s in sample]
                means.append(float(np.mean(vals)))
            lo, hi = float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))
            return {
                "mean": float(np.mean(metric_list)),
                "ci95": [lo, hi],
                "n_students": len(stu_keys),
                "queries_per_student_mean": float(
                    np.mean([len(v) for v in by_stu.values()])
                ),
            }

        out = {
            "n_queries_total": len(queries),
            "n_queries_with_relevance": n_used,
            "n_queries_zero_relevance_excluded": n_zero_rel,
            "zero_relevance_handling": "excluded_from_ranking_metrics",
            "candidates_per_query": {
                "mean": float(np.mean(cand_sizes)) if cand_sizes else None,
                "min": int(min(cand_sizes)) if cand_sizes else None,
                "max": int(max(cand_sizes)) if cand_sizes else None,
            },
            "relevant_items_per_query": {
                "mean": float(np.mean(n_rel_per_q)) if n_rel_per_q else None,
                "min": int(min(n_rel_per_q)) if n_rel_per_q else None,
                "max": int(max(n_rel_per_q)) if n_rel_per_q else None,
                "among_used_mean": float(np.mean(label_prev)) * (
                    float(np.mean(cand_sizes)) if cand_sizes and label_prev else 0.0
                )
                if label_prev
                else None,
            },
            "filtering_exclusions": {
                "missing_resource_in_catalogue": "skipped in build_queries",
                "empty_subject_candidate_set": "skipped in build_queries",
                "zero_relevant_in_candidates": n_zero_rel,
            },
            "mean_label_prevalence_in_candidate_sets": float(np.mean(label_prev)) if label_prev else None,
            "k": k,
            "relevance_definition": relevance_def,
            "split_name": split_name,
        }
        for name, vals in metrics.items():
            out[name] = {
                "NDCG@{k}".format(k=k): float(np.mean(vals["ndcg"])) if vals["ndcg"] else None,
                "MAP": float(np.mean(vals["map"])) if vals["map"] else None,
                "MRR": float(np.mean(vals["mrr"])) if vals["mrr"] else None,
                "bootstrap_student_grouped": {
                    "NDCG": _student_bootstrap(vals["ndcg"], vals["student_id"]),
                    "MAP": _student_bootstrap(vals["map"], vals["student_id"]),
                    "MRR": _student_bootstrap(vals["mrr"], vals["student_id"]),
                },
            }
        return out

    val_q = build_queries(val_s)
    test_q = build_queries(test_s)
    # Model selection: pick best MAP on validation among rankers (learned vs prereq; random is baseline)
    val_res = eval_queries(val_q, "validation")
    selected = max(
        ("prerequisite_aware", "learned"),
        key=lambda n: (val_res.get(n, {}) or {}).get("MAP") or -1,
    )
    test_res = eval_queries(test_q, "test")

    # Pooled binary diagnostics (NOT primary ranking metric) — investigate ROC-AUC
    test_logs = rec_logs[rec_logs.student_id.isin(test_s)].copy()
    test_logs["difficulty"] = test_logs["resource_id"].map(res["difficulty"]).fillna(0.5)
    test_logs["stu_open_rate"] = test_logs["student_id"].map(open_rate).fillna(global_open)
    pooled = {"note": "Pooled pointwise metrics are secondary; prevalence is not a ranking baseline"}
    if trained and len(test_logs) and test_logs["relevant"].nunique() > 1:
        from sklearn.metrics import average_precision_score, roc_auc_score

        proba = model.predict_proba(test_logs[feat_cols])[:, 1]
        y = test_logs["relevant"].to_numpy()
        pooled.update(
            {
                "label_prevalence": float(y.mean()),
                "pointwise_AP": float(average_precision_score(y, proba)),
                "pointwise_ROC_AUC": float(roc_auc_score(y, proba)),
                "pointwise_ROC_AUC_flipped": float(roc_auc_score(y, 1 - proba)),
                "spearman_difficulty_vs_label": float(
                    pd.Series(test_logs["difficulty"]).corr(pd.Series(y), method="spearman")
                ),
                "interpretation": (
                    "ROC-AUC near 0.5 means weak discrimination; "
                    "do not flip scores post-hoc based on test. "
                    "Original pooled AP≈prevalence indicated scores were uninformative relative to prevalence."
                ),
            }
        )

    # Backup original report once
    reports = get_paths().reports
    orig = reports / "c2_arts_metrics.json"
    audit = reports / "audit"
    audit.mkdir(parents=True, exist_ok=True)
    if orig.exists() and not (audit / "c2_arts_metrics_ORIGINAL.json").exists():
        # Prefer first-pipeline artifact metrics
        first = get_paths().artifact("c2") / "c2_arts_20261013T025936_8b27814f" / "metrics.json"
        src = first if first.exists() else orig
        (audit / "c2_arts_metrics_ORIGINAL.json").write_text(src.read_text(encoding="utf-8"), encoding="utf-8")

    result = {
        "experiment": "revised_per_query_ranking",
        "data_category": "synthetic_learner",
        "original_pooled_binary_preserved": {
            "run": "c2_arts_20261013T025936_8b27814f",
            "test_ap": 0.6719270222486738,
            "test_relevance_prevalence": 0.6939163498098859,
            "test_roc_auc": 0.47725119827561757,
            "note": "Prevalence was mislabelled as baseline_random in docs; it is label rate, not a ranker",
        },
        "feature_schema_learned": feat_cols,
        "selected_on_val_MAP": selected,
        "validation": val_res,
        "test": test_res,
        "pooled_pointwise_secondary": pooled,
        "test_set_status": "revised protocol on same simulated test students — not an untouched new population",
        "simulation_only": True,
    }
    save_json(result, art_dir / "metrics.json")
    save_json(result, reports / "c2_ranking_REVISED.json")
    model_path = art_dir / "ranker_pointwise.joblib"
    joblib.dump({"model": model if trained else None, "feature_cols": feat_cols, "run_id": run_id}, model_path)
    write_manifest(
        RunManifest(
            run_id=run_id,
            component="c2",
            task="arts_per_query_ranking_revised",
            config_name=config_name,
            metrics=result,
            artifact_paths={"model": str(model_path)},
            artifact_hashes={"model": file_sha256(model_path)},
            notes="Simulation-only ranking protocol revision",
        ),
        art_dir / "run_manifest.json",
    )
    (get_paths().artifact("c2") / "LATEST_RANK_RUN.txt").write_text(run_id, encoding="utf-8")
    logger.info("Ranking revised selected=%s test=%s", selected, test_res.get(selected))
    return {"run_id": run_id, "status": "completed", "metrics": result, "artifact_dir": str(art_dir)}
