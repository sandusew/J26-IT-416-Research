"""Chat corpus fixture policy — FastAPI enforces server-side gates."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from arts_ai.inference.app import app


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("ARTS_AI_ALLOW_TEST_FIXTURES", raising=False)
    monkeypatch.setenv("NODE_ENV", "development")
    return TestClient(app)


def test_default_corpus_is_domain(client):
    r = client.post(
        "/v1/chat/ask",
        json={
            "student_id": "syn_s0000",
            "question": "What was Anuradhapura?",
            "use_generation": False,
            "subject_id": "sub_history",
            "language": "en",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("corpus_mode") == "domain"
    assert body.get("corpus_provenance") != "generated_content"


def test_fixture_rejected_without_server_flag(client, monkeypatch):
    monkeypatch.delenv("ARTS_AI_ALLOW_TEST_FIXTURES", raising=False)
    r = client.post(
        "/v1/chat/ask",
        json={
            "student_id": "syn_s0000",
            "question": "hello",
            "corpus_mode": "fixture",
            "use_generation": False,
        },
    )
    assert r.status_code == 403


def test_fixture_allowed_with_server_flag(client, monkeypatch):
    monkeypatch.setenv("ARTS_AI_ALLOW_TEST_FIXTURES", "true")
    monkeypatch.setenv("NODE_ENV", "development")
    r = client.post(
        "/v1/chat/ask",
        json={
            "student_id": "syn_s0000",
            "question": "hello",
            "corpus_mode": "fixture",
            "use_generation": False,
        },
    )
    assert r.status_code == 200
    assert r.json().get("corpus_mode") == "fixture"
    assert r.json().get("corpus_provenance") == "generated_content"


def test_production_rejects_fixture(client, monkeypatch):
    monkeypatch.setenv("ARTS_AI_ALLOW_TEST_FIXTURES", "true")
    monkeypatch.setenv("NODE_ENV", "production")
    r = client.post(
        "/v1/chat/ask",
        json={
            "student_id": "syn_s0000",
            "question": "hello",
            "corpus_mode": "fixture",
            "use_generation": False,
        },
    )
    assert r.status_code == 403


def test_sinhala_unsupported(client):
    r = client.post(
        "/v1/chat/ask",
        json={
            "student_id": "syn_s0000",
            "question": "Anuradhapura",
            "corpus_mode": "domain",
            "language": "si",
            "use_generation": False,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("answer_type") == "unsupported_language"
    assert body.get("unsupported_language") is True
