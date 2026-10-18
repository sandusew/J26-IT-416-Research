"""Verify trained_ranker: FastAPI scores + optional Express gateway path."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd

from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths


def _post(url: str, body: dict, headers: dict | None = None, timeout: int = 30) -> tuple[int, dict]:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:  # noqa: BLE001
            return e.code, {"error": raw}


def _get(url: str, headers: dict | None = None, timeout: int = 30) -> tuple[int, dict]:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:  # noqa: BLE001
            return e.code, {"error": raw}


def main() -> dict:
    ml_base = os.environ.get("ML_BASE", "http://127.0.0.1:8000")
    api_base = os.environ.get("API_BASE")  # optional Express
    paths = get_paths()
    run_id = (paths.artifact("c2") / "LATEST_RANK_RUN.txt").read_text(encoding="utf-8").strip()
    bundle = joblib.load(paths.artifact("c2") / run_id / "ranker_pointwise.joblib")
    model = bundle["model"]
    feat_cols = bundle.get("feature_cols") or ["difficulty", "stu_open_rate"]

    candidates = [
        {"resource_id": "res_a", "difficulty": 0.2, "topic_id": "t0"},
        {"resource_id": "res_b", "difficulty": 0.8, "topic_id": "t1"},
        {"resource_id": "res_c", "difficulty": 0.5, "topic_id": "t2"},
    ]
    open_rate = 0.4
    df = pd.DataFrame(
        [
            {
                "difficulty": c["difficulty"],
                "stu_open_rate": open_rate,
            }
            for c in candidates
        ]
    )
    direct = model.predict_proba(df[feat_cols])[:, 1].tolist()

    status, http = _post(
        f"{ml_base.rstrip('/')}/v1/recommendations/score",
        {
            "student_id": "syn_s0000",
            "stu_open_rate": open_rate,
            "candidates": candidates,
        },
    )
    scores = http.get("scores") or []
    http_by_id = {s["resourceId"]: s["score"] for s in scores}
    parity = []
    for c, d in zip(candidates, direct):
        h = http_by_id.get(c["resource_id"])
        parity.append(
            {
                "resource_id": c["resource_id"],
                "direct": float(d),
                "http": h,
                "match": h is not None and abs(float(h) - float(d)) < 1e-6,
            }
        )

    # Empty candidates
    st_empty, empty_body = _post(
        f"{ml_base.rstrip('/')}/v1/recommendations/score",
        {"student_id": "syn_s0000", "stu_open_rate": open_rate, "candidates": []},
    )

    express = None
    if api_base:
        # login + recommendations with trained_ranker
        st_login, login = _post(
            f"{api_base.rstrip('/')}/auth/login",
            {"username": "stu", "password": "pw"},
        )
        token = login.get("token")
        if token:
            st_rec, rec = _get(
                f"{api_base.rstrip('/')}/learning/recommendations/syn_s0000"
                f"?subjectId=sub_history&policyMode=trained_ranker",
                headers={"Authorization": f"Bearer {token}"},
            )
            express = {
                "login_status": st_login,
                "rec_status": st_rec,
                "trainedScorerUsed": rec.get("trainedScorerUsed"),
                "policyMode": rec.get("policyMode"),
                "modelVersion": rec.get("modelVersion"),
                "fallbackReason": rec.get("fallbackReason"),
                "n_recommendations": len(rec.get("recommendations") or []),
                "nEligible": rec.get("nEligible"),
            }

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "ranker_run_id": run_id,
        "bundle_run_id": bundle.get("run_id"),
        "ml_base": ml_base,
        "score_http_status": status,
        "http_ok": http.get("ok"),
        "trainedScorerUsed": http.get("trainedScorerUsed"),
        "modelVersion": http.get("modelVersion"),
        "feature_cols": feat_cols,
        "parity_all_matched": all(p["match"] for p in parity),
        "parity": parity,
        "empty_candidates": {
            "status": st_empty,
            "ok": empty_body.get("ok"),
            "trainedScorerUsed": empty_body.get("trainedScorerUsed"),
            "n_scores": len(empty_body.get("scores") or []),
        },
        "express_gateway": express,
        "note": "Simulation-trained ranker; not real-student effectiveness. Opt-in only.",
    }
    out = paths.reports / "c2_trained_ranker_http_verify.json"
    save_json(report, out)
    print(
        json.dumps(
            {
                "ranker_run_id": run_id,
                "parity_all_matched": report["parity_all_matched"],
                "modelVersion": report["modelVersion"],
                "express": express,
                "report": str(out),
            },
            indent=2,
        )
    )
    return report


if __name__ == "__main__":
    main()
