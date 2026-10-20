"""End-to-end data prep + training pipeline (separate from API startup)."""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone
from pathlib import Path

from arts_ai.common.logging_utils import get_logger
from arts_ai.common.paths import get_paths

logger = get_logger("arts_ai.pipeline")


def main() -> None:
    paths = get_paths()
    paths.ensure()
    results: dict = {"started_at": datetime.now(timezone.utc).isoformat(), "steps": {}}

    def run(name, fn):
        logger.info("=== STEP %s ===", name)
        try:
            out = fn()
            results["steps"][name] = {"status": "ok", "result": _safe(out)}
        except Exception as e:  # noqa: BLE001
            logger.error("%s failed: %s", name, e)
            results["steps"][name] = {
                "status": "failed",
                "error": str(e),
                "traceback": traceback.format_exc(),
            }

    def _safe(obj):
        try:
            json.dumps(obj)
            return obj
        except TypeError:
            return str(obj)

    # Downloads
    from arts_ai.datasets.oulad import download_oulad
    from arts_ai.datasets.uci_student import download_uci_student
    from arts_ai.datasets.ednet import download_ednet_subset

    run("download_oulad", download_oulad)
    run("download_uci", download_uci_student)
    run("download_ednet", lambda: download_ednet_subset(max_students=200))

    # Synthetic
    from arts_ai.synthetic.generator import generate_synthetic_arts

    run("synthetic_arts", lambda: {
        "output_dir": str(generate_synthetic_arts().output_dir),
    })

    # Training — only if prerequisites met
    if results["steps"].get("download_oulad", {}).get("status") == "ok":
        from arts_ai.c1_behaviour.train import train_behaviour_clustering
        from arts_ai.c3_risk.train_oulad import train_oulad_risk

        run("c1_behaviour", train_behaviour_clustering)
        run("c3_oulad_risk", train_oulad_risk)

    if results["steps"].get("download_uci", {}).get("status") == "ok":
        from arts_ai.c3_risk.train_uci import train_uci_benchmark

        run("c3_uci", train_uci_benchmark)

    from arts_ai.c2_recommendation.ednet_correctness import train_ednet_correctness
    from arts_ai.c2_recommendation.arts_recommend import train_arts_recommendation
    from arts_ai.c3_risk.train_synthetic import train_synthetic_arts_risk
    from arts_ai.c4_chatbot.rag import build_index_from_synthetic
    from arts_ai.c4_chatbot.topic_classifier import train_topic_classifier

    run("c2_ednet", train_ednet_correctness)
    if results["steps"].get("synthetic_arts", {}).get("status") == "ok":
        run("c2_arts", train_arts_recommendation)
        run("c3_synth_risk", train_synthetic_arts_risk)
        run("c4_index", build_index_from_synthetic)
        run("c4_topic", train_topic_classifier)

    results["finished_at"] = datetime.now(timezone.utc).isoformat()
    out = paths.reports / "pipeline_run.json"
    out.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    logger.info("Pipeline finished -> %s", out)


if __name__ == "__main__":
    main()
