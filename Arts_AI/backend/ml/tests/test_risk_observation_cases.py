"""Focused risk observation cases: missing vs zero vs complete vs unsupported."""

from __future__ import annotations

from fastapi.testclient import TestClient

from arts_ai.inference.app import app, load_artifacts


def _client() -> TestClient:
    load_artifacts()
    return TestClient(app)


def test_no_observation_data():
    c = _client()
    r = c.post("/v1/risk/predict", json={})
    assert r.status_code == 200
    assert r.json()["status"] == "no_observation_data"


def test_incomplete_observation_window():
    c = _client()
    r = c.post(
        "/v1/risk/predict",
        json={
            "features": {"total_clicks": 10, "active_days": 2},
            "num_of_prev_attempts": 0,
            "studied_credits": 60,
            "observation": {
                "observation_window_complete": False,
                "data_source": "oulad_vle",
                "required_cutoff_days": 13,
            },
        },
    )
    assert r.status_code == 200
    assert r.json()["status"] == "incomplete_observation_window"


def test_complete_zero_activity_allowed():
    c = _client()
    r = c.post(
        "/v1/risk/predict",
        json={
            "features": {
                "total_clicks": 0,
                "active_days": 0,
                "click_regularity_cv": 0,
                "recency_last_active_day": 0,
                "prop_resource": 0,
                "prop_oucontent": 0,
                "prop_forumng": 0,
                "prop_quiz": 0,
                "prop_other": 0,
            },
            "num_of_prev_attempts": 0,
            "studied_credits": 60,
            "observation": {
                "observation_window_complete": True,
                "data_source": "oulad_vle",
                "n_vle_events_in_window": 0,
                "feature_availability": "complete",
                "required_cutoff_days": 13,
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok_zero_activity"
    assert body["probability_fail"] is not None
    assert body["features_used"]["recency_last_active_day"] == 14.0  # cutoff 13 + 1


def test_complete_with_activity_ok():
    c = _client()
    r = c.post(
        "/v1/risk/predict",
        json={
            "features": {
                "total_clicks": 120,
                "active_days": 8,
                "click_regularity_cv": 0.4,
                "recency_last_active_day": 2,
                "prop_resource": 0.2,
                "prop_oucontent": 0.5,
                "prop_forumng": 0.1,
                "prop_quiz": 0.1,
                "prop_other": 0.1,
            },
            "num_of_prev_attempts": 0,
            "studied_credits": 60,
            "observation": {
                "observation_window_complete": True,
                "data_source": "oulad_vle",
                "n_vle_events_in_window": 40,
                "feature_availability": "complete",
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert 0.0 <= body["probability_fail"] <= 1.0


def test_all_zero_without_completeness_is_insufficient():
    c = _client()
    r = c.post(
        "/v1/risk/predict",
        json={
            "features": {"total_clicks": 0, "active_days": 0},
            "num_of_prev_attempts": 0,
            "studied_credits": 60,
            "observation": {"data_source": "unknown"},
        },
    )
    assert r.status_code == 200
    assert r.json()["status"] == "insufficient_data"


def test_experimental_transfer_does_not_bypass_missing_features():
    c = _client()
    r = c.post(
        "/v1/risk/predict",
        json={
            "experimental_domain_transfer": True,
            "observation": {"feature_availability": "none"},
        },
    )
    assert r.status_code == 200
    assert r.json()["status"] == "no_observation_data"


def test_unsupported_application_domain():
    c = _client()
    r = c.post(
        "/v1/risk/predict",
        json={
            "features": {"total_clicks": 5, "active_days": 1},
            "num_of_prev_attempts": 0,
            "studied_credits": 60,
            "observation": {
                "data_source": "application_events",
                "observation_window_complete": False,
            },
        },
    )
    assert r.status_code == 200
    assert r.json()["status"] == "unsupported_application_domain"
