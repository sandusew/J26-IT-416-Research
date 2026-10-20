"""Evidence-based C4 topic classifier diagnosis. Does not overwrite old runs."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.pipeline import Pipeline

from arts_ai.common.paths import get_paths


def build_examples(docs: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, d in docs.iterrows():
        text = str(d["text"])
        variants = [
            (f"{d['document_id']}_v0", text, "v0_original"),
            (
                f"{d['document_id']}_v1",
                f"Review notes (generated): {text} Practice questions emphasise the learning objective.",
                "v1_prefix_suffix_same_body",
            ),
        ]
        for doc_id, variant_text, variant_kind in variants:
            parts = [
                p.strip()
                for p in variant_text.replace(". ", ".\n").split("\n")
                if len(p.strip()) > 20
            ]
            for i, p in enumerate(parts):
                rows.append(
                    {
                        "text": p,
                        "topic_id": d["topic_id"],
                        "subject_id": d["subject_id"],
                        "source_document_id": d["document_id"],
                        "document_id": doc_id,
                        "variant_kind": variant_kind,
                        "part_idx": i,
                        "origin": "generated",
                        "review_status": d.get("review_status", "unreviewed"),
                    }
                )
    return pd.DataFrame(rows)


def main() -> None:
    paths = get_paths()
    out = paths.reports / "audit"
    out.mkdir(parents=True, exist_ok=True)

    root = sorted(
        [d for d in paths.synthetic.iterdir() if (d / "knowledge_documents.csv").exists()]
    )[-1]
    docs = pd.read_csv(root / "knowledge_documents.csv")
    data = build_examples(docs)

    # Near-duplicate structure
    data["norm"] = (
        data["text"]
        .str.replace(r"topic \d+", "topic N", regex=True)
        .str.replace(r"concept-\d+", "concept-X", regex=True)
        .str.replace(r"History|Geography|Economics|Political Science|Sinhala Literature", "SUBJ", regex=True)
    )
    span = data.groupby("norm")["topic_id"].nunique()
    shared = data[data["norm"].isin(span[span > 5].index)]

    # Old split
    test_mask = data["document_id"].astype(str).str.endswith("_v1")
    train_old, test_old = data.loc[~test_mask], data.loc[test_mask]

    pipe = Pipeline(
        [
            ("tfidf", TfidfVectorizer(max_features=5000, ngram_range=(1, 2))),
            ("clf", LogisticRegression(max_iter=400, random_state=42)),
        ]
    )
    pipe.fit(train_old["text"], train_old["topic_id"])
    pred = pipe.predict(test_old["text"])
    classes = sorted(data["topic_id"].unique())
    cm = confusion_matrix(test_old["topic_id"], pred, labels=classes)

    # Trace examples: generic vs distinctive
    distinctive = ~test_old["norm"].isin(span[span > 5].index)
    generic = test_old["norm"].isin(span[span > 5].index)
    acc_dist = float(accuracy_score(test_old.loc[distinctive, "topic_id"], pred[distinctive.values])) if distinctive.any() else None
    acc_gen = float(accuracy_score(test_old.loc[generic, "topic_id"], pred[generic.values])) if generic.any() else None

    # Majority baseline on test
    maj = train_old["topic_id"].mode().iloc[0]
    maj_acc = float((test_old["topic_id"] == maj).mean())

    # Lexical baseline: predict topic if concept-N appears
    def lexical_predict(text: str) -> str | None:
        import re

        m = re.search(r"concept-(\d+)-", text)
        if not m:
            return None
        # map concept index + subject from text — incomplete; use concept only across subjects fails
        idx = int(m.group(1))
        # find topics ending with t{idx:02d}
        cands = [t for t in classes if t.endswith(f"_t{idx:02d}")]
        return cands[0] if len(cands) == 1 else (cands[0] if cands else None)

    lex_pred = []
    lex_true = []
    for _, row in test_old.iterrows():
        lp = lexical_predict(row["text"])
        if lp is not None:
            lex_pred.append(lp)
            lex_true.append(row["topic_id"])
    lex_acc = float(accuracy_score(lex_true, lex_pred)) if lex_true else None

    # Sample traces
    traces = []
    for i in list(np.where(generic.values)[0][:3]) + list(np.where(distinctive.values)[0][:3]):
        if i >= len(test_old):
            continue
        row = test_old.iloc[i]
        traces.append(
            {
                "text": row["text"][:160],
                "true": row["topic_id"],
                "pred": str(pred[i]),
                "correct": bool(pred[i] == row["topic_id"]),
                "is_generic_template": bool(generic.iloc[i]),
                "source_document_id": row["source_document_id"],
                "variant_kind": row["variant_kind"],
            }
        )

    report = {
        "root_cause_hypothesis_tested": [
            "v0/v1 are near-identical variants of the SAME source body (prefix/suffix only)",
            "Sentence splitting creates many cross-topic generic template lines",
            "Closed-set topic classification on generic lines is underdetermined",
        ],
        "n_docs": int(len(docs)),
        "n_examples": int(len(data)),
        "n_topics": int(data["topic_id"].nunique()),
        "n_train_old": int(len(train_old)),
        "n_test_old": int(len(test_old)),
        "train_topics": int(train_old["topic_id"].nunique()),
        "test_topics": int(test_old["topic_id"].nunique()),
        "topics_in_both": int(len(set(train_old["topic_id"]) & set(test_old["topic_id"]))),
        "unique_raw_texts": int(data["text"].nunique()),
        "unique_normalized_templates": int(data["norm"].nunique()),
        "norms_spanning_gt5_topics": int((span > 5).sum()),
        "examples_on_shared_norms": int(len(shared)),
        "fraction_test_generic": float(generic.mean()),
        "old_split_accuracy": float(accuracy_score(test_old["topic_id"], pred)),
        "old_split_macro_f1": float(f1_score(test_old["topic_id"], pred, average="macro")),
        "accuracy_on_distinctive_test_lines": acc_dist,
        "accuracy_on_generic_test_lines": acc_gen,
        "majority_baseline_accuracy": maj_acc,
        "majority_class": maj,
        "lexical_concept_baseline_accuracy": lex_acc,
        "lexical_n_scored": len(lex_true),
        "model_classes_": list(pipe.named_steps["clf"].classes_),
        "n_model_classes": int(len(pipe.named_steps["clf"].classes_)),
        "confusion_matrix_shape": list(cm.shape),
        "traces": traces,
        "chat_endpoint_behaviour": {
            "mode": "extractive_with_template",
            "description": "Returns retrieved passages joined with a template preamble; does not call a generative LLM",
            "citations": "chunk source_reference, review_status, data_origin included",
            "insufficient_evidence": "when retrieval empty or below min_similarity with dense index",
        },
    }
    (out / "c4_topic_diagnosis.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    np.save(out / "c4_old_confusion_matrix.npy", cm)
    print(json.dumps({k: v for k, v in report.items() if k != "traces"}, indent=2))
    print("TRACES", json.dumps(traces, indent=2))


if __name__ == "__main__":
    main()
