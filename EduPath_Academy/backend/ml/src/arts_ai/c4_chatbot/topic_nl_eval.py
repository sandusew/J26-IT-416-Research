"""Natural-language topic evaluation WITHOUT artificial class-identifier shortcuts.

Preserves the generated-marker closed-set result (acc=1.0) as a *sanity check only*.
This module builds diverse NL questions grounded in educational passages, strips
document tokens / topic IDs / template IDs / filenames from model input, and runs
closed-set classification + separate unseen-topic detection.

All examples are labelled generated / unreviewed unless a human has reviewed them.
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
from sklearn.pipeline import Pipeline

from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import RunManifest, save_json, write_manifest
from arts_ai.common.paths import get_paths
from arts_ai.c4_chatbot.topic_classifier import _TOPIC_FACTS, _majority_predict

logger = get_logger("arts_ai.c4.topic_nl")

# Patterns that leak class identity into the text (exclude from model input).
_SHORTCUT_PATTERNS = [
    re.compile(r"\[GENERATED-AWAITING-REVIEW\]\s*", re.I),
    re.compile(r"Document token:\s*\S+", re.I),
    re.compile(r"Mnemonic:\s*\S+", re.I),
    re.compile(r"Key term family:\s*[^\.]+", re.I),
    re.compile(r"\bsub_[a-z0-9_]+_t\d+\b", re.I),
    re.compile(r"\bsub-[a-z0-9-]+-primer\b", re.I),
    re.compile(r"\b[a-z]+_[a-z_]+_\d+_alt\b", re.I),
    re.compile(r"\btemplate[_-]?id[=:]\S+", re.I),
    re.compile(r"\bdoc_[a-z0-9_]+\.(?:txt|md|csv)\b", re.I),
    re.compile(r"Study guide \(generated,\s*[AB]\):\s*", re.I),
    re.compile(r"Alternate primer for\s+", re.I),
]


def strip_label_shortcuts(text: str) -> str:
    """Remove artificial identifiers while keeping meaningful subject terminology."""
    out = str(text)
    for pat in _SHORTCUT_PATTERNS:
        out = pat.sub(" ", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out


def _passage_body(subject_name: str, topic_idx: int, variant: str) -> str:
    """Educational passage grounded in topic facts — no topic_id / document tokens."""
    facts = _TOPIC_FACTS[topic_idx % 8]
    if variant == "A":
        return (
            f"In {subject_name}, students examine {facts[0]} alongside {facts[1]}. "
            f"A careful reading compares {facts[2]} with {facts[3]}, asking how evidence "
            f"is selected and how conclusions are justified. Worked examples show why "
            f"{facts[2]} can reshape an interpretation even when the same sources are available."
        )
    if variant == "B":
        return (
            f"This {subject_name} unit turns next to {facts[2]} and {facts[3]}. "
            f"Learners contrast earlier attention to {facts[0]} with newer questions about "
            f"{facts[1]}, using short case notes rather than memorised labels. "
            f"The emphasis is on explaining mechanisms, not naming a template code."
        )
    # paraphrase / question forms
    return (
        f"How do {facts[0]} and {facts[1]} interact in {subject_name}? "
        f"Discuss whether {facts[2]} or {facts[3]} offers the stronger organising idea, "
        f"and support the claim with reasons drawn from the unit reading."
    )


_QUESTION_TEMPLATES = [
    "Summarise the main idea of the following passage in one sentence:\n{passage}",
    "What educational focus does this passage emphasise?\n{passage}",
    "Based only on this reading, which themes should a learner practise next?\n{passage}",
    "Explain the relationship described here without inventing outside facts:\n{passage}",
    "Identify the central analytical problem raised below:\n{passage}",
]


def build_nl_examples(docs: pd.DataFrame, seed: int = 42) -> pd.DataFrame:
    """Diverse NL questions grounded in passages; group key = source_document_id."""
    rows = []
    rng = np.random.default_rng(seed)
    for _, d in docs.iterrows():
        topic_id = str(d["topic_id"])
        m = re.search(r"_t(\d+)$", topic_id)
        topic_idx = int(m.group(1)) if m else 0
        subject_name = str(d.get("subject_id", "subject")).replace("sub_", "").replace("_", " ")
        for src_tag in ("A", "B"):
            passage = _passage_body(subject_name, topic_idx, src_tag)
            source_id = f"{d['document_id']}_nl_{src_tag}"
            # Passage itself + several question phrasings (same group)
            texts = [passage]
            tmpl_order = list(range(len(_QUESTION_TEMPLATES)))
            rng.shuffle(tmpl_order)
            for ti in tmpl_order[:3]:
                texts.append(_QUESTION_TEMPLATES[ti].format(passage=passage))
            # One cross-phrasing paraphrase of the passage
            texts.append(_passage_body(subject_name, topic_idx, "Q"))
            for j, text in enumerate(texts):
                clean = strip_label_shortcuts(text)
                rows.append(
                    {
                        "text": clean,
                        "text_raw_generated": text,
                        "topic_id": topic_id,
                        "subject_id": d["subject_id"],
                        "source_document_id": source_id,
                        "example_id": f"{source_id}_e{j}",
                        "origin": "generated",
                        "review_status": "unreviewed",
                        "data_origin": "generated_content",
                        "shortcut_audit": {
                            "had_document_token": bool(
                                re.search(r"primer|sub_[a-z]+_t\d+", text, re.I)
                            ),
                            "input_uses_stripped_text": True,
                        },
                    }
                )
    return pd.DataFrame(rows)


def _lexical_subject_baseline(texts: pd.Series, train_y: pd.Series, train_text: pd.Series) -> np.ndarray:
    """Lexical overlap baseline using subject words — not topic_id tokens."""
    # Map each class to concatenated training text tokens
    class_tokens: dict[str, set[str]] = {}
    for label, t in zip(train_y, train_text):
        toks = set(re.findall(r"[a-z]{3,}", str(t).lower()))
        class_tokens.setdefault(str(label), set()).update(toks)
    classes = list(class_tokens.keys())
    out = []
    for t in texts:
        q = set(re.findall(r"[a-z]{3,}", str(t).lower()))
        best, best_s = classes[0], -1.0
        for c in classes:
            inter = len(q & class_tokens[c])
            if inter > best_s:
                best_s, best = inter, c
        out.append(best)
    return np.array(out)


def audit_shortcut_leakage(texts: pd.Series) -> dict[str, Any]:
    hits = 0
    examples = []
    for t in texts:
        s = str(t)
        if re.search(r"sub_[a-z0-9_]+_t\d+|sub-[a-z0-9-]+-primer|Document token", s, re.I):
            hits += 1
            if len(examples) < 5:
                examples.append(s[:160])
    return {
        "n_texts": int(len(texts)),
        "n_with_forbidden_shortcuts": hits,
        "fraction": float(hits / max(len(texts), 1)),
        "sample_hits": examples,
        "pass": hits == 0,
    }


def run_nl_topic_evaluation(
    *,
    holdout_unseen_topics: int = 5,
    seed: int = 42,
) -> dict[str, Any]:
    """Train/eval NL closed-set + unseen detection; new run_id; preserve marker sanity."""
    run_id = f"c4_topic_nl_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    art_dir = get_paths().artifact("c4") / run_id
    art_dir.mkdir(parents=True, exist_ok=True)

    root = get_paths().synthetic
    dirs = sorted([p for p in root.iterdir() if p.is_dir() and (p / "knowledge_documents.csv").exists()])
    if not dirs:
        return {"run_id": run_id, "status": "blocked", "reason": "no knowledge docs"}
    docs = pd.read_csv(dirs[-1] / "knowledge_documents.csv")
    # Prefer baseline catalogue if present
    for d in dirs:
        if "baseline" in d.name:
            docs = pd.read_csv(d / "knowledge_documents.csv")
            break

    data = build_nl_examples(docs, seed=seed)
    shortcut_audit = audit_shortcut_leakage(data["text"])

    topics = sorted(data["topic_id"].unique())
    rng = np.random.default_rng(seed)
    unseen_topics = set(
        rng.choice(topics, size=min(holdout_unseen_topics, max(len(topics) // 4, 1)), replace=False)
    )
    closed = data[~data["topic_id"].isin(unseen_topics)].copy()
    unseen_df = data[data["topic_id"].isin(unseen_topics)].copy()

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

    classes = sorted(train["topic_id"].unique())
    val = val[val["topic_id"].isin(classes)]
    test = test[test["topic_id"].isin(classes)]

    # Model input: stripped text only (no hyphenated topic markers required)
    pipe = Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    max_features=8000,
                    ngram_range=(1, 2),
                    min_df=1,
                    token_pattern=r"(?u)\b\w+\b",
                ),
            ),
            ("clf", LogisticRegression(max_iter=800, random_state=seed, class_weight="balanced")),
        ]
    )
    pipe.fit(train["text"], train["topic_id"])

    def eval_split(df: pd.DataFrame) -> dict[str, Any]:
        if df.empty:
            return {"n": 0}
        pred = pipe.predict(df["text"])
        maj = _majority_predict(train["topic_id"], len(df))
        lex = _lexical_subject_baseline(df["text"], train["topic_id"], train["text"])
        cm = confusion_matrix(df["topic_id"], pred, labels=classes)
        # Representative errors
        errors = []
        for true, p, txt, eid in zip(df["topic_id"], pred, df["text"], df["example_id"]):
            if true != p and len(errors) < 12:
                errors.append(
                    {
                        "example_id": eid,
                        "true": true,
                        "pred": p,
                        "text_excerpt": str(txt)[:220],
                    }
                )
        return {
            "n": int(len(df)),
            "n_topics": int(df["topic_id"].nunique()),
            "accuracy": float(accuracy_score(df["topic_id"], pred)),
            "macro_f1": float(f1_score(df["topic_id"], pred, average="macro", zero_division=0)),
            "majority_accuracy": float(accuracy_score(df["topic_id"], maj)),
            "lexical_overlap_accuracy": float(accuracy_score(df["topic_id"], lex)),
            "confusion_matrix": cm.tolist(),
            "classification_report": classification_report(
                df["topic_id"], pred, labels=classes, zero_division=0, output_dict=True
            ),
            "representative_errors": errors,
        }

    val_metrics = eval_split(val)
    # Model selection: already a single LR; use val accuracy as selection score (documented)
    test_metrics = eval_split(test)

    # Unseen-topic detection threshold on validation mix
    def max_proba(texts):
        return pipe.predict_proba(texts).max(axis=1)

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
        "note": "Separate task from closed-set topic classification",
    }

    # Marker sanity pointer (do not retrain; document prior result)
    marker_sanity = {
        "role": "generated_marker_sanity_check_only",
        "not_natural_language_eval": True,
        "reference_run": "c4_topic_rev_20261013T100629_127fbaec",
        "reported_closed_set_accuracy": 1.0,
        "caveat": "Uses distinctive document tokens / subject-qualified markers; not NL evaluation",
    }

    metrics = {
        "experiment": "c4_natural_language_topic_eval",
        "data_category": "generated_content",
        "origin": "generated",
        "review_status": "unreviewed",
        "shortcut_audit": shortcut_audit,
        "marker_sanity_preserved": marker_sanity,
        "split": (
            "source A→train, B→val/test by topic partition; "
            "paraphrases/questions share source_document_id; unseen topics held out"
        ),
        "test_set_status": "new NL experiment test — not retuned on inspected marker test set",
        "evaluation_data_reuse": (
            "Same synthetic knowledge_documents catalogue as prior C4 runs; "
            "example texts and split keys are newly generated for NL protocol"
        ),
        "validation": val_metrics,
        "test_closed_set": test_metrics,
        "unseen_topic_detection": unseen_metrics,
        "model_classes": classes,
        "n_train": int(len(train)),
        "n_val": int(len(val)),
        "n_test": int(len(test)),
        "note": (
            "Subject terminology retained where educationally meaningful. "
            "Artificial topic/template/filename shortcuts excluded from model input."
        ),
    }

    model_path = art_dir / "topic_nl_classifier.joblib"
    joblib.dump(
        {
            "model": pipe,
            "run_id": run_id,
            "classes": classes,
            "unseen_threshold": best_thr,
            "task": "closed_set_topic_classification_nl",
            "input_policy": "strip_label_shortcuts",
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
    data[["example_id", "topic_id", "source_document_id", "text", "review_status", "origin"]].to_csv(
        art_dir / "nl_examples.csv", index=False
    )
    reports = get_paths().reports
    save_json(metrics, reports / "c4_topic_nl_metrics.json")
    (get_paths().artifact("c4") / "LATEST_TOPIC_NL_RUN.txt").write_text(run_id, encoding="utf-8")
    write_manifest(
        RunManifest(
            run_id=run_id,
            component="c4",
            task="topic_classifier_natural_language",
            config_name="c4_chatbot.yaml",
            sample_counts={"train": len(train), "validation": len(val), "test": len(test)},
            metrics=metrics,
            artifact_paths={"model": str(model_path)},
            artifact_hashes={"model": file_sha256(model_path)},
            notes="NL eval without marker shortcuts; marker 100% retained as sanity only",
        ),
        art_dir / "run_manifest.json",
    )
    logger.info(
        "NL topic clf val_acc=%.3f test_acc=%.3f shortcut_pass=%s",
        val_metrics.get("accuracy", -1),
        test_metrics.get("accuracy", -1),
        shortcut_audit.get("pass"),
    )
    return {"run_id": run_id, "status": "completed", "metrics": metrics, "artifact_dir": str(art_dir)}


if __name__ == "__main__":
    print(run_nl_topic_evaluation())
