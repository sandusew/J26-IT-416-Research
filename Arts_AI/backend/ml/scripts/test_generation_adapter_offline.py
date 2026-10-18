"""Offline generation adapter checks (no live provider credentials required)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from arts_ai.c4_chatbot.generation import GenerationProvider, load_generation_config
from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths


def main() -> dict:
    # Force disabled provider
    os.environ.pop("ARTS_AI_GENERATION_PROVIDER", None)
    cfg = load_generation_config()
    assert cfg.provider == "none"
    p = GenerationProvider(cfg)
    assert p.status.get("ready") is False
    r = p.generate(question="What is history?", passages=["Passage A about chronology."])
    assert r.used is False
    assert r.mode == "extractive_template"

    # Misconfigured openai_compatible without key
    os.environ["ARTS_AI_GENERATION_PROVIDER"] = "openai_compatible"
    os.environ["ARTS_AI_GENERATION_MODEL"] = "gpt-test"
    os.environ.pop(os.environ.get("ARTS_AI_GENERATION_API_KEY_ENV", "ARTS_AI_LLM_API_KEY"), None)
    p2 = GenerationProvider(load_generation_config())
    assert p2.status.get("ready") is False
    assert "missing_credentials" in (p2.status.get("blocker") or "")
    r2 = p2.generate(question="q", passages=["p"])
    assert r2.used is False

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "n_cases": 2,
        "n_passed": 2,
        "live_provider_tested": False,
        "note": "Offline adapter/unit checks only; live generation requires credentials",
        "cases": [
            {"name": "disabled_defaults_extractive", "pass": True},
            {"name": "openai_compatible_missing_key", "pass": True},
        ],
    }
    out = get_paths().reports / "c4_generation_adapter_offline.json"
    save_json(report, out)
    print(json.dumps(report, indent=2))
    # cleanup env pollution for subsequent loads in same process
    os.environ.pop("ARTS_AI_GENERATION_PROVIDER", None)
    os.environ.pop("ARTS_AI_GENERATION_MODEL", None)
    return report


if __name__ == "__main__":
    main()
