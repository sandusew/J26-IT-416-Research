"""Verify NL topic classifier: direct joblib predictions match HTTP /v1/topic/classify."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import urllib.error
import urllib.request

from arts_ai.c4_chatbot.topic_nl_eval import strip_label_shortcuts
from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths


def _http_classify(base: str, text: str) -> dict:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/v1/topic/classify",
        data=json.dumps({"text": text}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main(base_url: str = "http://127.0.0.1:8000") -> dict:
    paths = get_paths()
    serving = (paths.artifact("c4") / "LATEST_TOPIC_SERVING.txt").read_text(encoding="utf-8").strip()
    art = paths.artifact("c4") / serving
    bundle = joblib.load(art / "topic_nl_classifier.joblib")
    model = bundle["model"]
    cases = [
        "Summarise chronology and evidence standards in a history unit.",
        "How do trade routes and markets interact in economics?",
        "Explain governance institutions and reform movements.",
        "asdf qwerty unrelated junk",
        "",  # expect HTTP 400
    ]
    results = []
    for text in cases:
        row = {"text": text[:120], "http_ok": None, "direct": None, "http": None, "match": None}
        if not text.strip():
            try:
                _http_classify(base_url, text)
                row["http_ok"] = True
                row["match"] = False
                row["error"] = "expected_400_for_empty"
            except urllib.error.HTTPError as e:
                row["http_ok"] = e.code == 400
                row["match"] = e.code == 400
                row["http_status"] = e.code
            results.append(row)
            continue
        cleaned = strip_label_shortcuts(text) if bundle.get("input_policy") == "strip_label_shortcuts" else text
        direct = str(model.predict([cleaned])[0])
        row["direct"] = direct
        try:
            http = _http_classify(base_url, text)
            row["http"] = http.get("topic_id")
            row["model_version"] = http.get("model_version")
            row["http_ok"] = True
            row["match"] = row["http"] == direct and http.get("model_version") == bundle.get("run_id")
        except Exception as e:  # noqa: BLE001
            row["http_ok"] = False
            row["error"] = str(e)
            row["match"] = False
        results.append(row)

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "serving_run_id": serving,
        "bundle_run_id": bundle.get("run_id"),
        "base_url": base_url,
        "n_cases": len(results),
        "n_matched": sum(1 for r in results if r.get("match")),
        "all_matched": all(r.get("match") for r in results),
        "cases": results,
    }
    out = paths.reports / "c4_topic_nl_http_parity.json"
    save_json(report, out)
    print(json.dumps({k: report[k] for k in ("serving_run_id", "n_matched", "n_cases", "all_matched")}, indent=2))
    return report


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
    main(url)
