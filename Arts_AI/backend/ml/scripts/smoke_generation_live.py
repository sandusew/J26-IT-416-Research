"""Live generation smoke — requires explicit --live and configured provider.

Never prints secrets. Writes structured evidence under backend/ml/reports/.
Missing credentials → blocked_missing_configuration (exit 2), not pass.

Usage (from backend/ml):
  .\\.venv\\Scripts\\python.exe scripts\\smoke_generation_live.py
  .\\.venv\\Scripts\\python.exe scripts\\smoke_generation_live.py --live
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"


def _config_identity() -> dict:
    provider = (os.environ.get("ARTS_AI_GENERATION_PROVIDER") or "none").strip().lower()
    key_env = os.environ.get("ARTS_AI_GENERATION_API_KEY_ENV", "ARTS_AI_LLM_API_KEY")
    key_present = bool(os.environ.get(key_env))
    base = os.environ.get("ARTS_AI_GENERATION_API_BASE") or ""
    model = os.environ.get("ARTS_AI_GENERATION_MODEL") or ""
    fp = hashlib.sha256(f"{provider}|{base}|{model}|{key_present}".encode()).hexdigest()[:16]
    return {
        "provider": provider,
        "model": model or None,
        "api_base_configured": bool(base),
        "api_key_present": key_present,
        "config_fingerprint": fp,
        "enabled": provider not in ("", "none", "off", "extractive"),
    }


def _post(url: str, payload: dict, timeout: float = 45.0) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return resp.status, body
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"raw": raw}
        return e.code, body


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Contact live provider")
    parser.add_argument("--base", default=os.environ.get("ML_INFERENCE_URL", "http://127.0.0.1:8000"))
    args = parser.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)
    cfg = _config_identity()
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    out_path = REPORTS / f"generation_live_smoke_{ts}.json"
    evidence: dict = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "live_requested": args.live,
        "config": cfg,
        "checks": [],
        "outcome": None,
    }

    if not args.live:
        evidence["outcome"] = "blocked_missing_configuration"
        evidence["blocker"] = "pass --live to run; dry inspection only"
        evidence["note"] = "Not a pass — live flag required"
        out_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        print(json.dumps({"wrote": str(out_path), "outcome": evidence["outcome"]}, indent=2))
        return 2

    if not cfg["enabled"] or not cfg["api_key_present"]:
        evidence["outcome"] = "blocked_missing_configuration"
        evidence["blocker"] = (
            "Set ARTS_AI_GENERATION_PROVIDER=openai_compatible, "
            "ARTS_AI_GENERATION_MODEL, ARTS_AI_GENERATION_API_BASE, and API key env on ML process"
        )
        out_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        print(json.dumps({"wrote": str(out_path), "outcome": evidence["outcome"]}, indent=2))
        return 2

    # Domain chat with generation
    status, body = _post(
        f"{args.base.rstrip('/')}/v1/chat/ask",
        {
            "student_id": "syn_s0000",
            "question": "What was Anuradhapura in Sri Lankan history?",
            "corpus_mode": "domain",
            "subject_id": "sub_history",
            "language": "en",
            "use_generation": True,
            "conversation_history": [
                {"role": "user", "content": "Tell me about Rajarata briefly.", "corpus_mode": "domain"}
            ],
        },
    )
    evidence["checks"].append(
        {
            "name": "domain_generation",
            "http_status": status,
            "answer_type": body.get("answer_type"),
            "generation_mode": body.get("generation_mode"),
            "is_generative_llm": body.get("is_generative_llm"),
            "corpus_mode": body.get("corpus_mode"),
            "corpus_version": body.get("corpus_version"),
            "citation_ids": [c.get("document_id") for c in (body.get("citations") or [])],
            "generation_meta": body.get("generation"),
        }
    )

    # Insufficient evidence probe
    status2, body2 = _post(
        f"{args.base.rstrip('/')}/v1/chat/ask",
        {
            "student_id": "syn_s0000",
            "question": "What is the half-life of unobtanium-42?",
            "corpus_mode": "domain",
            "subject_id": "sub_history",
            "language": "en",
            "use_generation": True,
        },
    )
    evidence["checks"].append(
        {
            "name": "insufficient_evidence",
            "http_status": status2,
            "insufficient_evidence": body2.get("insufficient_evidence"),
            "answer_type": body2.get("answer_type"),
        }
    )

    gen_ok = (
        status == 200
        and body.get("is_generative_llm") is True
        and body.get("answer_type") == "generative_over_retrieved"
        and body.get("corpus_mode") == "domain"
    )
    cites = body.get("citations") or []
    cite_ok = all(c.get("document_id") for c in cites) if cites else False
    if gen_ok and cite_ok:
        evidence["outcome"] = "passed"
        evidence["quality_note"] = (
            "Mechanical checks only — citation presence ≠ teacher-assessed factual grounding"
        )
        # Also write LATEST pointer without deleting historical
        (REPORTS / "LATEST_GENERATION_LIVE_SMOKE.txt").write_text(out_path.name, encoding="utf-8")
        exit_code = 0
    elif status == 200 and body.get("generation_mode") == "extractive_fallback":
        evidence["outcome"] = "failed"
        evidence["blocker"] = "Provider configured but fell back to extractive_template"
        exit_code = 1
    else:
        evidence["outcome"] = "failed"
        evidence["blocker"] = f"Unexpected response status={status}"
        exit_code = 1

    out_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(out_path), "outcome": evidence["outcome"]}, indent=2))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
