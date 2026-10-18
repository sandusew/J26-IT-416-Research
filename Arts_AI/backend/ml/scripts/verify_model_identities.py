"""Inspect trusted local serving artifacts — do not infer architecture from filenames."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib

from arts_ai.common.hashing import file_sha256
from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths


def _cls(obj: Any) -> str:
    return f"{type(obj).__module__}.{type(obj).__name__}"


def _pipeline_steps(obj: Any) -> list[dict[str, str]]:
    if hasattr(obj, "steps"):
        return [{"name": n, "class": _cls(s)} for n, s in obj.steps]
    return [{"name": "estimator", "class": _cls(obj)}]


def _load_ptr(component: str, name: str) -> str | None:
    p = get_paths().artifact(component) / name
    return p.read_text(encoding="utf-8").strip() if p.exists() else None


def inspect_topic_nl() -> dict[str, Any]:
    run = _load_ptr("c4", "LATEST_TOPIC_SERVING.txt")
    path = get_paths().artifact("c4") / run / "topic_nl_classifier.joblib"
    bundle = joblib.load(path)
    model = bundle["model"] if isinstance(bundle, dict) else bundle
    classes = list(bundle.get("classes") or getattr(model.named_steps.get("clf"), "classes_", []))
    return {
        "component": "C4 topic classification (NL closed-set) — also exposed as chat topic hint; not C2",
        "run_id": run,
        "artifact_path": f"backend/ml/artifacts/c4/{run}/topic_nl_classifier.joblib",
        "sha256": file_sha256(path),
        "bundle_keys": sorted(bundle.keys()) if isinstance(bundle, dict) else None,
        "pipeline_steps": _pipeline_steps(model),
        "estimator_class": _cls(model.named_steps["clf"]) if hasattr(model, "named_steps") else _cls(model),
        "vectorizer_class": _cls(model.named_steps["tfidf"]) if hasattr(model, "named_steps") else None,
        "feature_preprocessing": {
            "input": "raw text string",
            "input_policy": bundle.get("input_policy") if isinstance(bundle, dict) else None,
            "vectorizer_params": {
                k: model.named_steps["tfidf"].get_params()[k]
                for k in ("ngram_range", "min_df", "max_df", "analyzer", "lowercase")
                if hasattr(model, "named_steps")
            },
        },
        "n_labels": len(classes),
        "label_vocabulary_sample": classes[:8],
        "training_provenance": "generated_content closed-set (source A→train, B→val/test); not teacher-reviewed syllabus",
        "evaluation_report": "backend/ml/artifacts/c4/"
        + str(run)
        + "/metrics.json (if present) / MODEL_STATUS NL metrics",
        "serving_endpoint": "POST /v1/topic/classify",
        "architecture_claim": (
            "sklearn Pipeline(TfidfVectorizer → LogisticRegression). "
            "NOT DistilBERT / transformers."
        ),
    }


def inspect_c3() -> dict[str, Any]:
    run = _load_ptr("c3", "LATEST_OULAD_RUN.txt")
    path = get_paths().artifact("c3") / run / "risk_pipeline.joblib"
    bundle = joblib.load(path)
    selected = bundle["selected"]
    model = bundle["models"][selected]
    return {
        "component": "C3 OULAD academic risk",
        "run_id": run,
        "artifact_path": f"backend/ml/artifacts/c3/{run}/risk_pipeline.joblib",
        "sha256": file_sha256(path),
        "pipeline_steps": _pipeline_steps(model),
        "estimator_class": _cls(model),
        "selected_model_key": selected,
        "feature_preprocessing": {
            "feature_cols": bundle.get("feature_cols"),
            "cutoff_days": bundle.get("cutoff_days"),
            "fillna_semantics": "zero activity → clicks/props=0, recency=cutoff+1 (training)",
        },
        "label_vocabulary": {"positive_class": bundle.get("positive_class"), "excluded": "Withdrawn"},
        "training_provenance": "authentic_public OULAD",
        "evaluation_report": "backend/ml/reports/c3_oulad_metrics.json",
        "serving_endpoint": "POST /v1/risk/predict",
    }


def inspect_ednet() -> dict[str, Any]:
    run = _load_ptr("c2", "LATEST_EDNET_RUN.txt")
    path = get_paths().artifact("c2") / run / "correctness_pipeline.joblib"
    bundle = joblib.load(path)
    model = bundle.get("model") or bundle.get("models", {}).get(bundle.get("selected")) or bundle
    if isinstance(model, dict):
        model = model.get("model") or next(iter(model.values()))
    return {
        "component": "C2 EdNet correctness v2",
        "run_id": run,
        "artifact_path": f"backend/ml/artifacts/c2/{run}/correctness_pipeline.joblib",
        "sha256": file_sha256(path) if path.exists() else None,
        "pipeline_steps": _pipeline_steps(model) if path.exists() else [],
        "estimator_class": _cls(model) if path.exists() else None,
        "feature_preprocessing": {"feature_cols": bundle.get("feature_cols") if isinstance(bundle, dict) else None},
        "training_provenance": "authentic_public EdNet KT1 subset",
        "evaluation_report": "backend/ml/reports/c2_ednet_metrics_V2.json",
        "serving_endpoint": "POST /v1/correctness/predict",
    }


def inspect_ranker() -> dict[str, Any]:
    run = _load_ptr("c2", "LATEST_RANK_RUN.txt")
    path = get_paths().artifact("c2") / run / "ranker_pointwise.joblib"
    bundle = joblib.load(path)
    model = bundle.get("model") if isinstance(bundle, dict) else bundle
    return {
        "component": "C2 Arts simulation ranker (opt-in)",
        "run_id": run,
        "artifact_path": f"backend/ml/artifacts/c2/{run}/ranker_pointwise.joblib",
        "sha256": file_sha256(path),
        "pipeline_steps": _pipeline_steps(model),
        "estimator_class": _cls(model),
        "feature_preprocessing": {
            "feature_cols": bundle.get("feature_cols") if isinstance(bundle, dict) else ["difficulty", "stu_open_rate"],
            "topic_vocabulary": "historical synthetic sub_*_tNN only — not canonical curriculum IDs",
        },
        "training_provenance": "synthetic_learner simulation",
        "evaluation_report": "backend/ml/reports/c2_ranking_REVISED.json",
        "serving_endpoint": "POST /v1/recommendations/score (Express opt-in trained_ranker)",
    }


def inspect_c1() -> dict[str, Any]:
    run = _load_ptr("c1", "LATEST_RUN.txt")
    path = get_paths().artifact("c1") / run / "kmeans_pipeline.joblib"
    bundle = joblib.load(path)
    model = bundle.get("pipeline") or bundle.get("model") or bundle
    return {
        "component": "C1 OULAD behaviour clustering",
        "run_id": run,
        "artifact_path": f"backend/ml/artifacts/c1/{run}/kmeans_pipeline.joblib",
        "sha256": file_sha256(path),
        "pipeline_steps": _pipeline_steps(model),
        "estimator_class": _cls(model),
        "feature_preprocessing": {"feature_cols": bundle.get("feature_cols") if isinstance(bundle, dict) else None},
        "training_provenance": "authentic_public OULAD",
        "serving_endpoint": "POST /v1/behaviour/cluster",
    }


def main() -> dict[str, Any]:
    report = {
        "generated_at_utc": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
        "method": "joblib.load of trusted LATEST_* serving pointers + training source cross-check",
        "models": [
            inspect_topic_nl(),
            inspect_c1(),
            inspect_ednet(),
            inspect_ranker(),
            inspect_c3(),
        ],
        "corrections": [
            {
                "was": "MODEL_GAP_TABLE claimed DistilBERT NL",
                "actual": "sklearn TfidfVectorizer + LogisticRegression Pipeline",
                "action": "documentation corrected; model not retrained",
            }
        ],
    }
    save_json(report, get_paths().reports / "model_identities_verified.json")
    docs = Path(__file__).resolve().parents[2] / "docs" / "MODEL_IDENTITIES.md"
    lines = [
        "# Verified model identities (from local artifacts)",
        "",
        f"Generated: {report['generated_at_utc']}",
        "",
        "Architecture claims below come from `joblib.load` of serving pointers, not filenames.",
        "",
    ]
    for m in report["models"]:
        lines.append(f"## {m['component']}")
        lines.append("")
        lines.append(f"- **run_id:** `{m.get('run_id')}`")
        lines.append(f"- **path:** `{m.get('artifact_path')}`")
        lines.append(f"- **sha256:** `{m.get('sha256')}`")
        lines.append(f"- **estimator:** `{m.get('estimator_class')}`")
        lines.append(f"- **steps:** `{m.get('pipeline_steps')}`")
        lines.append(f"- **endpoint:** `{m.get('serving_endpoint')}`")
        if m.get("architecture_claim"):
            lines.append(f"- **architecture:** {m['architecture_claim']}")
        lines.append("")
    docs.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"wrote": "backend/ml/reports/model_identities_verified.json", "n": len(report["models"])}, indent=2))
    return report


if __name__ == "__main__":
    main()
