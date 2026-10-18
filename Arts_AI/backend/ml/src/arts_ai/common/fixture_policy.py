"""Server-side fixture corpus policy for FastAPI chat.

Client corpus_mode=fixture alone never enables fixtures. Configure via ML process env
(ARTS_AI_ALLOW_TEST_FIXTURES / NODE_ENV) — Node env is not inherited automatically.
"""

from __future__ import annotations

import os
from typing import Any


def fixtures_allowed_by_server() -> bool:
    node_env = (os.environ.get("NODE_ENV") or os.environ.get("ARTS_AI_ENV") or "development").lower()
    if node_env == "production":
        return False
    flag = (os.environ.get("ARTS_AI_ALLOW_TEST_FIXTURES") or "").strip().lower()
    return flag in ("1", "true", "yes")


def resolve_chat_corpus_mode(
    requested: str | None,
    *,
    client_fixture_opt_in: bool | None = None,
) -> dict[str, Any]:
    """
    Default corpus is domain.
    Fixture only when server allows AND (explicit corpus_mode=fixture OR client opt-in).
    """
    raw = (requested or "domain").strip().lower()
    if raw in ("", "default"):
        raw = "domain"
    wants_fixture = raw in ("fixture", "generated", "generated_fixture") or client_fixture_opt_in is True
    server_ok = fixtures_allowed_by_server()
    node_env = (os.environ.get("NODE_ENV") or os.environ.get("ARTS_AI_ENV") or "development").lower()

    if wants_fixture and not server_ok:
        return {
            "ok": False,
            "corpus_mode": None,
            "error": "fixtures_not_enabled",
            "reason": (
                "fixtures_forbidden_in_production"
                if node_env == "production"
                else "fixtures_require_server_ARTS_AI_ALLOW_TEST_FIXTURES"
            ),
            "http_status": 403,
        }
    if wants_fixture and server_ok:
        return {
            "ok": True,
            "corpus_mode": "fixture",
            "error": None,
            "reason": None,
            "http_status": 200,
        }
    # Domain (and aliases)
    if raw in ("domain", "arts_domain", "approved"):
        return {
            "ok": True,
            "corpus_mode": "domain",
            "error": None,
            "reason": None,
            "http_status": 200,
        }
    # Unknown mode → treat as domain request for safety (no silent fixture)
    return {
        "ok": True,
        "corpus_mode": "domain",
        "error": None,
        "reason": f"unknown_mode_coerced_to_domain:{raw}",
        "http_status": 200,
    }
