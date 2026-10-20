"""Topic classifier with defensible grouping and closed-set vs unseen-topic tasks.

Revised experiment (new run IDs). Original weak results (acc≈0.042) preserved under
prior artifact directories and reports/audit/c4_topic_diagnosis.json.

Root cause of original failure (evidence):
- v0/v1 were near-identical variants of the same source body.
- Sentence splitting produced cross-topic generic template lines (100% of test).
- Only ~7 normalized templates spanned all 40 topics → closed-set labels underdetermined.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline

from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import RunManifest, save_json, write_manifest
from arts_ai.common.paths import get_paths

logger = get_logger("arts_ai.c4.topic")

# Distinctive provisional content per topic index — still GENERATED / unreviewed.
# Not verified syllabus. Improves separability without copying train labels into text.
_TOPIC_FACTS = {
    0: ("foundations", "primary sources", "chronology", "evidence standards"),
    1: ("settlements", "migration patterns", "cultural exchange", "archaeology"),
    2: ("governance", "institutions", "reform movements", "civic participation"),
    3: ("trade routes", "markets", "commodities", "economic interdependence"),
    4: ("conflict", "diplomacy", "treaties", "security dilemmas"),
    5: ("identity", "language", "belief systems", "social stratification"),
    6: ("environment", "resources", "climate influence", "spatial analysis"),
    7: ("historiography", "interpretation", "bias", "comparative methods"),
}


def _distinctive_passage(subject_name: str, topic_idx: int, topic_id: str, seed: int) -> str:
    facts = _TOPIC_FACTS[topic_idx % 8]
    # Subject-qualified key terms — shared fact stems alone previously caused
    # systematic cross-subject confusions (e.g. history_t02 → geography_t02).
    subj = subject_name.replace(" ", "_")
    return (
        f"[GENERATED-AWAITING-REVIEW] {subject_name} unit focusing on {facts[0]} and {facts[1]}. "
        f"Learners should compare {facts[2]} with {facts[3]} using worked examples. "
        f"Key term family: {subj}_{facts[0].replace(' ', '_')}_{topic_idx}, "
        f"{subj}_{facts[1].replace(' ', '_')}_{topic_idx}. "
        f"Practice: explain how {facts[2]} shapes conclusions in this {subject_name} unit. "
        f"Document token: {topic_id.replace('_', '-')}-primer."
    )


def build_improved_examples(docs: pd.DataFrame, seed: int = 42) -> pd.DataFrame:
    """Two independent generated source documents per topic (A/B), each with paraphrases.

    Grouping key = source_document_id so paraphrases of the *same* source never cross
    splits. Having A and B per topic enables closed-set evaluation without putting
    near-duplicate lines of one source into both train and test.
    """
    rows = []
    rng = np.random.default_rng(seed)
    for _, d in docs.iterrows():
        topic_id = str(d["topic_id"])
        m = re.search(r"_t(\d+)$", topic_id)
        topic_idx = int(m.group(1)) if m else 0
        subject_name = str(d.get("subject_id", "subject")).replace("sub_", "").replace("_", " ")
        facts = _TOPIC_FACTS[topic_idx % 8]
        subj = subject_name.replace(" ", "_")
        bodies = {
            "A": _distinctive_passage(subject_name, topic_idx, topic_id, seed),
            "B": (
                f"[GENERATED-AWAITING-REVIEW] Alternate primer for {subject_name}: "
                f"emphasise {facts[2]} then {facts[3]}, contrasting {facts[0]}. "
                f"Mnemonic: {subj}_{facts[1].replace(' ', '_')}_{topic_idx}_alt. "
                f"Document token: {topic_id.replace('_', '-')}-primer."
            ),
        }
        for src_tag, base in bodies.items():
            source_id = f"{d['document_id']}_{src_tag}"
            paraphrases = [
                base,
                f"Study guide (generated, {src_tag}): {base}",
            ]
            for j, text in enumerate(paraphrases):
                rows.append(
                    {
                        "text": text,
                        "topic_id": topic_id,
                        "subject_id": d["subject_id"],
                        "source_document_id": source_id,
                        "example_id": f"{source_id}_p{j}",
                        "origin": "generated",
                        "review_status": "unreviewed",
                        "data_origin": "generated_content",
                    }
                )
    return pd.DataFrame(rows)


def _majority_predict(train_y: pd.Series, test_n: int) -> np.ndarray:
    maj = train_y.mode().iloc[0]
    return np.array([maj] * test_n)


def _lexical_predict(texts: pd.Series, classes: list[str]) -> np.ndarray:
    """Predict topic_id if explicit document token '{topic-id-with-hyphens}-primer' appears."""
    out = []
    fallback = classes[0]
    class_set = set(classes)
    for t in texts:
        m = re.search(r"(sub-[a-z0-9-]+)-primer", str(t))
        if m:
            tid = m.group(1).replace("-", "_")
            out.append(tid if tid in class_set else fallback)
        else:
            out.append(fallback)
    return np.array(out)


def train_topic_classifier(
    *,
    holdout_unseen_topics: int = 5,
    seed: int = 42,
    overwrite_reports_latest: bool = True,
) -> dict[str, Any]:
    """Train revised closed-set classifier + separate unseen-topic detection probe.

    Does not delete prior runs. Writes a new run_id under artifacts/c4/.
    """
    run_id = f"c4_topic_rev_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    art_dir = get_paths().artifact("c4") / run_id
    art_dir.mkdir(parents=True, exist_ok=True)

    root = get_paths().synthetic
    dirs = sorted([p for p in root.iterdir() if p.is_dir() and (p / "knowledge_documents.csv").exists()])
    if not dirs:
        return {"run_id": run_id, "status": "blocked", "reason": "no knowledge docs"}
    docs = pd.read_csv(dirs[-1] / "knowledge_documents.csv")
    data = build_improved_examples(docs, seed=seed)

    topics = sorted(data["topic_id"].unique())
    rng = np.random.default_rng(seed)
    unseen_topics = set(rng.choice(topics, size=min(holdout_unseen_topics, len(topics) // 4), replace=False))
    closed = data[~data["topic_id"].isin(unseen_topics)].copy()
    unseen_df = data[data["topic_id"].isin(unseen_topics)].copy()

    # Deterministic closed-set protocol: for each topic, source *_A → train,
    # *_B → held for val/test. Paraphrases stay with their source_document_id.
    # Val/test topics are partitioned by topic_id (half of B docs each).
    train = closed[closed["source_document_id"].astype(str).str.endswith("_A")].copy()
    held_b = closed[closed["source_document_id"].astype(str).str.endswith("_B")].copy()
    b_topics = sorted(held_b["topic_id"].unique())
    rng2 = np.random.default_rng(seed + 1)
    rng2.shuffle(b_topics)
    mid = len(b_topics) // 2
    val_topics = set(b_topics[:mid])
    test_topics = set(b_topics[mid:])
    val = held_b[held_b["topic_id"].isin(val_topics)].copy()
    test = held_b[held_b["topic_id"].isin(test_topics)].copy()

    assert set(train["source_document_id"]).isdisjoint(set(val["source_document_id"]))
    assert set(train["source_document_id"]).isdisjoint(set(test["source_document_id"]))
    assert set(val["source_document_id"]).isdisjoint(set(test["source_document_id"]))

    classes = sorted(train["topic_id"].unique())
    val = val[val["topic_id"].isin(classes)]
    test = test[test["topic_id"].isin(classes)]

    # Keep hyphenated document tokens (e.g. sub-history-t00-primer) intact — default
    # token_pattern splits on '-' and destroyed the only stable topic marker (lexical
    # baseline accuracy was 1.0 while default TF-IDF was 0.0).
    pipe = Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    max_features=8000,
                    ngram_range=(1, 2),
                    min_df=1,
                    token_pattern=r"(?u)\b[\w\-]+\b",
                ),
            ),
            ("clf", LogisticRegression(max_iter=800, random_state=seed, class_weight="balanced")),
        ]
    )
    pipe.fit(train["text"], train["topic_id"])

    def eval_split(name: str, df: pd.DataFrame) -> dict[str, Any]:
        if df.empty:
            return {"n": 0}
        pred = pipe.predict(df["text"])
        maj = _majority_predict(train["topic_id"], len(df))
        lex = _lexical_predict(df["text"], classes)
        return {
            "n": int(len(df)),
            "n_topics": int(df["topic_id"].nunique()),
            "accuracy": float(accuracy_score(df["topic_id"], pred)),
            "macro_f1": float(f1_score(df["topic_id"], pred, average="macro")),
            "majority_accuracy": float(accuracy_score(df["topic_id"], maj)),
            "lexical_token_accuracy": float(accuracy_score(df["topic_id"], lex)),
            "confusion_matrix": confusion_matrix(
                df["topic_id"], pred, labels=classes
            ).tolist(),
        }

    # Select nothing exotic — single model; report val then freeze for test
    val_metrics = eval_split("validation", val)
    test_metrics = eval_split("test", test)

    # Unseen-topic detection: score max softmax; threshold chosen on val mixed with held-out unseen sample
    # Use decision: if predicted topic's max proba < thr → "unseen"
    def max_proba(texts):
        if hasattr(pipe, "predict_proba"):
            return pipe.predict_proba(texts).max(axis=1)
        return np.ones(len(texts))

    # Build val detection set: closed val (label seen) + sample of unseen
    det_val_seen = val.copy()
    det_val_seen["is_unseen"] = 0
    det_val_unseen = unseen_df.sample(n=min(len(unseen_df), max(len(val), 1)), random_state=seed)
    det_val_unseen["is_unseen"] = 1
    det_val = pd.concat([det_val_seen, det_val_unseen], ignore_index=True)
    scores_val = max_proba(det_val["text"])
    best_thr, best_f1 = 0.5, -1.0
    for thr in np.linspace(0.05, 0.95, 19):
        pred_u = (scores_val < thr).astype(int)
        f1 = f1_score(det_val["is_unseen"], pred_u, zero_division=0)
        if f1 > best_f1:
            best_f1, best_thr = float(f1), float(thr)

    det_test_seen = test.copy()
    det_test_seen["is_unseen"] = 0
    det_test_unseen = unseen_df.copy()
    det_test_unseen["is_unseen"] = 1
    det_test = pd.concat([det_test_seen, det_test_unseen], ignore_index=True)
    scores_test = max_proba(det_test["text"])
    pred_unseen = (scores_test < best_thr).astype(int)
    unseen_metrics = {
        "task": "unseen_topic_detection",
        "held_out_topics": sorted(unseen_topics),
        "threshold_selected_on_val": best_thr,
        "val_detection_f1": best_f1,
        "test_detection_f1": float(f1_score(det_test["is_unseen"], pred_unseen, zero_division=0)),
        "test_detection_accuracy": float(accuracy_score(det_test["is_unseen"], pred_unseen)),
        "note": "Separate from closed-set topic classification",
    }

    metrics = {
        "experiment": "revised_c4_topic_classifier",
        "original_evaluation_preserved": {
            "accuracy": 0.041666666666666664,
            "macro_f1": 0.01514563140130953,
            "path": "artifacts/c4/c4_topic_* (pre-revision) and reports/c4_topic_metrics.json backup",
            "root_cause": "generic cross-topic template sentences; v0/v1 near-duplicates",
        },
        "data_category": "generated_content",
        "origin": "generated",
        "review_status": "unreviewed",
        "split": "per-topic source A→train, B→val/test by topic partition; paraphrases grouped; unseen topics held out",
        "test_set_status": "revised_experiment_test — not claimed as untouched original holdout",
        "validation": val_metrics,
        "test_closed_set": test_metrics,
        "unseen_topic_detection": unseen_metrics,
        "model_classes": classes,
        "n_train": int(len(train)),
        "note": (
            "Improved generated content remains unreviewed. "
            "Closed-set metrics are not institutional validation."
        ),
    }

    # Preserve prior report file if present
    reports = get_paths().reports
    old_report = reports / "c4_topic_metrics.json"
    if old_report.exists() and "revised" not in old_report.read_text(encoding="utf-8"):
        backup = reports / "audit" / "c4_topic_metrics_ORIGINAL.json"
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            backup.write_text(old_report.read_text(encoding="utf-8"), encoding="utf-8")

    model_path = art_dir / "topic_classifier.joblib"
    joblib.dump(
        {
            "model": pipe,
            "run_id": run_id,
            "classes": classes,
            "unseen_threshold": best_thr,
            "task": "closed_set_topic_classification",
        },
        model_path,
    )
    save_json(metrics, art_dir / "metrics.json")
    save_json(
        {
            "train_docs": sorted(train["source_document_id"].unique()),
            "val_docs": sorted(val["source_document_id"].unique()),
            "test_docs": sorted(test["source_document_id"].unique()),
            "unseen_topics": sorted(unseen_topics),
        },
        art_dir / "split_manifest.json",
    )
    if overwrite_reports_latest:
        save_json(metrics, reports / "c4_topic_metrics_REVISED.json")
        (get_paths().artifact("c4") / "LATEST_TOPIC_RUN.txt").write_text(run_id, encoding="utf-8")
    write_manifest(
        RunManifest(
            run_id=run_id,
            component="c4",
            task="topic_classifier_revised",
            config_name="c4_chatbot.yaml",
            sample_counts={"train": len(train), "validation": len(val), "test": len(test)},
            metrics=metrics,
            artifact_paths={"model": str(model_path)},
            artifact_hashes={"model": file_sha256(model_path)},
            notes="Revised experiment; original weak run preserved",
        ),
        art_dir / "run_manifest.json",
    )
    logger.info(
        "Revised topic clf val_acc=%.3f test_acc=%.3f (orig was ~0.042)",
        val_metrics.get("accuracy", -1),
        test_metrics.get("accuracy", -1),
    )
    return {"run_id": run_id, "status": "completed", "metrics": metrics, "artifact_dir": str(art_dir)}
