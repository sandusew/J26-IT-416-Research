"""FastAPI inference endpoints — models loaded from disk, not trained at startup."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Load backend/ml/.env and optional backend/api/.env without overriding existing OS env.
# Express .env does NOT automatically configure a separately launched uvicorn process.
try:
    from dotenv import load_dotenv

    _ml_root = Path(__file__).resolve().parents[3]  # backend/ml
    load_dotenv(_ml_root / ".env", override=False)
    load_dotenv(_ml_root.parent / "api" / ".env", override=False)
except Exception:  # noqa: BLE001
    pass

from arts_ai import __version__
from arts_ai.common.paths import get_paths
from arts_ai.c1_behaviour.digital_twin import DigitalTwinService
from arts_ai.c4_chatbot.rag import KnowledgeIndex, answer_question

app = FastAPI(title="Arts AI ML Inference", version=__version__)

_state: dict[str, Any] = {
    "c1": None,
    "c3": None,
    "c2_ednet": None,
    "c2_arts": None,
    "c2_rank": None,
    "c4_index": None,  # generated/fixture index (default chat)
    "c4_domain_index": None,  # approved/permitted domain corpus
    "c4_topic": None,  # serving topic classifier (NL preferred)
    "c4_topic_marker": None,  # historical marker-era sanity model
    "twin": DigitalTwinService(),
}


def _read_latest(component: str, pointer: str) -> Path | None:
    p = get_paths().artifact(component) / pointer
    if not p.exists():
        return None
    run_id = p.read_text(encoding="utf-8").strip()
    return get_paths().artifact(component) / run_id


def load_artifacts() -> None:
    """Load artifacts from disk. Safe to call multiple times; does not train."""
    get_paths().ensure()
    c1 = _read_latest("c1", "LATEST_RUN.txt")
    if c1:
        model = c1 / "kmeans_pipeline.joblib"
        if model.exists():
            _state["c1"] = joblib.load(model)
            _state["twin"].model_path = model
            _state["twin"].load()
    c3 = _read_latest("c3", "LATEST_OULAD_RUN.txt")
    if c3:
        model = c3 / "risk_pipeline.joblib"
        if model.exists():
            _state["c3"] = joblib.load(model)
    c2e = _read_latest("c2", "LATEST_EDNET_RUN.txt")
    if c2e:
        model = c2e / "correctness_pipeline.joblib"
        if model.exists():
            _state["c2_ednet"] = joblib.load(model)
    c2a = _read_latest("c2", "LATEST_ARTS_RUN.txt")
    if c2a:
        model = c2a / "arts_candidate_scorer.joblib"
        if model.exists():
            _state["c2_arts"] = joblib.load(model)
    c2r = _read_latest("c2", "LATEST_RANK_RUN.txt")
    if c2r:
        model = c2r / "ranker_pointwise.joblib"
        if model.exists():
            _state["c2_rank"] = joblib.load(model)
            if isinstance(_state["c2_rank"], dict) and "run_id" not in _state["c2_rank"]:
                _state["c2_rank"]["run_id"] = c2r.name
    try:
        _state["c4_index"] = KnowledgeIndex.load()
        if _state["c4_index"] is not None:
            _state["c4_index"].config = {
                **(_state["c4_index"].config or {}),
                "corpus_mode": (_state["c4_index"].config or {}).get("corpus_mode")
                or "generated_fixture",
            }
    except FileNotFoundError:
        _state["c4_index"] = None
    try:
        from arts_ai.c4_chatbot.knowledge_ingest import load_domain_index

        _state["c4_domain_index"] = load_domain_index()
    except Exception:  # noqa: BLE001
        _state["c4_domain_index"] = None

    # Topic serving: prefer explicit LATEST_TOPIC_SERVING, else NL pointer, else marker
    serving_ptr = get_paths().artifact("c4") / "LATEST_TOPIC_SERVING.txt"
    nl_ptr = get_paths().artifact("c4") / "LATEST_TOPIC_NL_RUN.txt"
    marker_ptr = get_paths().artifact("c4") / "LATEST_TOPIC_RUN.txt"
    _state["c4_topic"] = None
    _state["c4_topic_marker"] = None

    def _load_topic_bundle(run_dir: Path) -> dict[str, Any] | None:
        for name in ("topic_nl_classifier.joblib", "topic_classifier.joblib"):
            mp = run_dir / name
            if mp.exists():
                bundle = joblib.load(mp)
                if isinstance(bundle, dict):
                    bundle.setdefault("run_id", run_dir.name)
                    bundle.setdefault("artifact_file", name)
                    return bundle
        return None

    marker_dir = _read_latest("c4", "LATEST_TOPIC_RUN.txt")
    if marker_dir:
        _state["c4_topic_marker"] = _load_topic_bundle(marker_dir)

    serving_dir = None
    if serving_ptr.exists():
        serving_dir = get_paths().artifact("c4") / serving_ptr.read_text(encoding="utf-8").strip()
    elif nl_ptr.exists():
        serving_dir = get_paths().artifact("c4") / nl_ptr.read_text(encoding="utf-8").strip()
    elif marker_ptr.exists():
        serving_dir = get_paths().artifact("c4") / marker_ptr.read_text(encoding="utf-8").strip()
    if serving_dir and serving_dir.exists():
        _state["c4_topic"] = _load_topic_bundle(serving_dir)


@app.on_event("startup")
def startup() -> None:
    load_artifacts()


@app.middleware("http")
async def ensure_models_loaded(request, call_next):
    if _state["c1"] is None and _state["c3"] is None and _state["c4_index"] is None:
        load_artifacts()
    return await call_next(request)


class BehaviourFeatures(BaseModel):
    total_clicks: float = 0
    active_days: float = 0
    click_regularity_cv: float = 0
    recency_last_active_day: float = 0
    prop_resource: float = 0
    prop_oucontent: float = 0
    prop_forumng: float = 0
    prop_quiz: float = 0
    prop_other: float = 0


class TwinUpdateRequest(BaseModel):
    student_id: str
    events: list[dict[str, Any]] = Field(default_factory=list)
    observation_window_days: int = 14
    data_category: str = "synthetic_learner"


class RiskObservationMeta(BaseModel):
    """Explicit observation contract — do not infer completeness from zero/nonzero alone."""

    observation_start_day: int | None = None
    observation_end_day: int | None = None
    required_cutoff_days: int = 13
    # True = full [0..cutoff] window observed; False = incomplete; None = not asserted
    observation_window_complete: bool | None = None
    data_source: str | None = None  # oulad_vle | application_events | unknown
    # None = caller did not report event count (cannot treat zeros as observed inactivity)
    n_vle_events_in_window: int | None = None
    feature_availability: str | None = None  # complete | partial | none


class RiskRequest(BaseModel):
    features: BehaviourFeatures | None = None
    num_of_prev_attempts: float | None = None
    studied_credits: float | None = None
    observation: RiskObservationMeta | None = None
    # Explicit opt-in for non-OULAD domain vectors that still satisfy the feature contract
    experimental_domain_transfer: bool = False


class CorrectnessRequest(BaseModel):
    hist_count: float
    hist_accuracy: float
    hist_accuracy_10: float
    hist_mean_elapsed: float
    hist_std_elapsed: float
    question_difficulty_train: float | None = None  # v2 models; optional for v1


class ChatRequest(BaseModel):
    student_id: str
    question: str
    digital_twin: dict[str, Any] | None = None
    conversation_history: list[dict[str, Any]] | None = None
    # When False, force extractive_template even if a generation provider is ready
    use_generation: bool = True
    # Default domain. Fixture requires ARTS_AI_ALLOW_TEST_FIXTURES on this ML process.
    corpus_mode: str = "domain"
    allow_chat_fixtures: bool | None = None
    subject_id: str | None = None
    language: str | None = None


class TopicRequest(BaseModel):
    text: str


class RankCandidate(BaseModel):
    resource_id: str
    difficulty: float = 0.5
    topic_id: str | None = None


class RankScoreRequest(BaseModel):
    student_id: str
    stu_open_rate: float | None = None
    candidates: list[RankCandidate]


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "arts_ai_ml", "version": __version__}


@app.get("/ready")
def ready() -> dict[str, Any]:
    missing = []
    if _state["c1"] is None:
        missing.append("c1_behaviour_model")
    if _state["c3"] is None:
        missing.append("c3_risk_model")
    if _state["c2_ednet"] is None:
        missing.append("c2_ednet_model")
    if _state["c2_arts"] is None:
        missing.append("c2_arts_model")
    if _state["c4_index"] is None:
        missing.append("c4_knowledge_index")
    if _state["c4_topic"] is None:
        missing.append("c4_topic_classifier_serving")
    if _state["c2_rank"] is None:
        missing.append("c2_ranker_opt_in")
    from arts_ai.c4_chatbot.generation import get_generation_provider
    from arts_ai.c4_chatbot.consultation import meeting_provider_status

    gen = get_generation_provider()
    try:
        meeting = meeting_provider_status()
    except Exception:  # noqa: BLE001
        meeting = {
            "status": "unconfigured",
            "tested": False,
            "note": "Env flag alone does not mean meeting provider was tested",
        }
    topic = _state["c4_topic"] or {}
    fix = _state["c4_index"]
    dom = _state["c4_domain_index"]
    return {
        "ready": len([m for m in missing if m != "c2_ranker_opt_in"]) == 0,
        "missing": missing,
        "serving": {
            "topic_classifier": {
                "run_id": topic.get("run_id"),
                "task": topic.get("task"),
                "artifact_file": topic.get("artifact_file"),
                "n_classes": len(topic.get("classes") or []),
                "marker_historical_loaded": _state["c4_topic_marker"] is not None,
                "scope": "generated_content_closed_set_evaluation",
            },
            "c2_rank": {
                "loaded": _state["c2_rank"] is not None,
                "run_id": (_state["c2_rank"] or {}).get("run_id"),
            },
            "knowledge_fixture_index": {
                "loaded": fix is not None,
                "corpus_mode": (fix.config or {}).get("corpus_mode") if fix else None,
                "n_chunks": len(fix.chunks) if fix else 0,
            },
            "knowledge_domain_index": {
                "loaded": dom is not None,
                "corpus_version": (dom.config or {}).get("corpus_version") if dom else None,
                "n_chunks": len(dom.chunks) if dom else 0,
                "status": "ready" if dom is not None else "awaiting_content",
            },
        },
        "providers": {
            "meeting_integration": meeting,
            "llm_auto_download": False,
            "generation": gen.status,
            "generation_mode_default": "extractive_template",
        },
        "note": "Training is separate from API startup; missing items reported accurately",
    }


@app.post("/v1/behaviour/cluster")
def behaviour_cluster(body: BehaviourFeatures) -> dict[str, Any]:
    if _state["c1"] is None:
        raise HTTPException(503, "c1 model missing")
    bundle = _state["c1"]
    cols = bundle["feature_cols"]
    X = np.array([[getattr(body, c) for c in cols]], dtype=float)
    cluster = int(bundle["pipeline"].predict(X)[0])
    return {
        "cluster_id": cluster,
        "model_version": bundle.get("run_id"),
        "cutoff_days": bundle.get("cutoff_days"),
        "data_category": "inference_input",
    }


@app.post("/v1/digital-twin/update")
def digital_twin_update(body: TwinUpdateRequest) -> dict[str, Any]:
    twin: DigitalTwinService = _state["twin"]
    return twin.update_from_events(
        body.student_id,
        body.events,
        observation_window_days=body.observation_window_days,
        data_category=body.data_category,
    )


def _risk_case(
    *,
    status: str,
    reason: str,
    cols: list[str],
    bundle: dict[str, Any],
    observation: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out = {
        "status": status,
        "probability_fail": None,
        "policy_band": None,
        "reason": reason,
        "required_feature_cols": cols,
        "model_version": bundle.get("run_id"),
        "positive_class": bundle.get("positive_class", "Fail"),
        "observation": observation,
        "note": "Not A/L exam-failure prediction; public OULAD Fail outcome only",
    }
    if extra:
        out.update(extra)
    return out


@app.post("/v1/risk/predict")
def risk_predict(body: RiskRequest) -> dict[str, Any]:
    """OULAD risk with explicit missing-vs-zero observation handling.

    Training kept enrolled students with zero VLE activity in-window (features filled:
    clicks/active_days/props=0, recency_last_active_day=cutoff+1). Inference may score
    that case only when observation completeness is explicitly asserted.
    """
    if _state["c3"] is None:
        raise HTTPException(503, "c3 model missing")
    bundle = _state["c3"]
    cols = list(bundle["feature_cols"])
    cutoff = int(bundle.get("cutoff_days") or 13)
    obs = body.observation or RiskObservationMeta()
    obs_dump = obs.model_dump()
    domain_transfer = bool(body.experimental_domain_transfer)

    # experimental_domain_transfer must not bypass missing/invalid observation contracts
    if body.features is None or obs.feature_availability == "none":
        return _risk_case(
            status="no_observation_data",
            reason="No VLE feature payload / feature_availability=none",
            cols=cols,
            bundle=bundle,
            observation=obs_dump,
        )

    feat = body.features.model_dump()
    # Context fields: missing is distinct from zero only when None was sent
    if body.num_of_prev_attempts is None or body.studied_credits is None:
        if not domain_transfer:
            return _risk_case(
                status="incomplete_feature_contract",
                reason="num_of_prev_attempts and studied_credits are required (do not invent)",
                cols=cols,
                bundle=bundle,
                observation=obs_dump,
            )
    feat["num_of_prev_attempts"] = (
        float(body.num_of_prev_attempts) if body.num_of_prev_attempts is not None else 0.0
    )
    feat["studied_credits"] = (
        float(body.studied_credits) if body.studied_credits is not None else 60.0
    )

    src = (obs.data_source or "unknown").lower()
    unsupported_src = src in {"application_events", "application", "arts_app"} and not domain_transfer
    if unsupported_src and obs.observation_window_complete is not True:
        return _risk_case(
            status="unsupported_application_domain",
            reason=(
                "Application event streams are not OULAD VLE features. "
                "Supply OULAD-compatible observations with observation_window_complete=true, "
                "or set experimental_domain_transfer only when the full feature contract is valid."
            ),
            cols=cols,
            bundle=bundle,
            observation=obs_dump,
        )

    if obs.observation_window_complete is False:
        return _risk_case(
            status="incomplete_observation_window",
            reason=f"Observation window incomplete relative to required cutoff days 0..{cutoff}",
            cols=cols,
            bundle=bundle,
            observation=obs_dump,
        )

    # Completeness must be explicit — all-zero alone is not evidence of observed inactivity
    complete = obs.observation_window_complete is True
    events_reported = obs.n_vle_events_in_window is not None
    if not complete and not (domain_transfer and obs.feature_availability == "complete"):
        return _risk_case(
            status="insufficient_data",
            reason=(
                "Observation completeness not asserted. "
                "Set observation.observation_window_complete=true for a full cutoff window, "
                "or feature_availability=complete with experimental_domain_transfer for transfer experiments. "
                "All-zero feature values alone do not imply observed inactivity."
            ),
            cols=cols,
            bundle=bundle,
            observation=obs_dump,
        )

    total_clicks = float(feat.get("total_clicks") or 0.0)
    active_days = float(feat.get("active_days") or 0.0)
    zero_activity = total_clicks <= 0 and active_days <= 0
    if events_reported and int(obs.n_vle_events_in_window or 0) == 0:
        zero_activity = True

    # Match training fillna semantics for genuine zero-activity in a complete window
    if zero_activity and complete:
        feat["total_clicks"] = 0.0
        feat["active_days"] = 0.0
        feat["click_regularity_cv"] = 0.0
        for c in ("prop_resource", "prop_oucontent", "prop_forumng", "prop_quiz", "prop_other"):
            feat[c] = 0.0
        # Training used cutoff_days+1 when no activity was observed
        feat["recency_last_active_day"] = float(cutoff + 1)

    if obs.feature_availability == "partial":
        return _risk_case(
            status="incomplete_feature_contract",
            reason="feature_availability=partial — do not invent missing proportions/recency",
            cols=cols,
            bundle=bundle,
            observation=obs_dump,
        )

    X = np.array([[float(feat.get(c, 0.0)) for c in cols]], dtype=float)
    model = bundle["models"][bundle["selected"]]
    proba = float(model.predict_proba(X)[0, 1])
    bands = bundle.get("policy_bands", {"high": 0.6, "medium": 0.35, "low": 0.0})
    if proba >= bands.get("high", 0.6):
        band = "high"
    elif proba >= bands.get("medium", 0.35):
        band = "medium"
    else:
        band = "low"

    if zero_activity and complete:
        status = "ok_zero_activity"
        note = (
            "Complete observation window with zero VLE activity — eligible under OULAD training "
            "contract (recency_last_active_day=cutoff+1). Not A/L exam prediction."
        )
    elif domain_transfer:
        status = "experimental_domain_transfer"
        note = "OULAD Fail outcome under explicit domain-transfer flag; not validated A/L exam prediction"
    else:
        status = "ok"
        note = "OULAD Fail outcome; not validated A/L exam prediction"

    return {
        "status": status,
        "probability_fail": proba,
        "policy_band": band,
        "policy_band_note": "Policy threshold on probability — not ground-truth label",
        "model_selected": bundle["selected"],
        "model_version": bundle.get("run_id"),
        "positive_class": bundle.get("positive_class", "Fail"),
        "observation": obs_dump,
        "features_used": {c: float(feat.get(c, 0.0)) for c in cols},
        "zero_activity_observed": zero_activity and complete,
        "note": note,
    }


@app.post("/v1/correctness/predict")
def correctness_predict(body: CorrectnessRequest) -> dict[str, Any]:
    if _state["c2_ednet"] is None:
        raise HTTPException(
            503,
            "c2 EdNet model missing (authentic EdNet may be unavailable)",
        )
    bundle = _state["c2_ednet"]
    cols = bundle["feature_cols"]
    # Support v1 (5 feats) and v2 (6 feats) by filling missing optional attrs with defaults
    row = []
    for c in cols:
        if hasattr(body, c):
            row.append(float(getattr(body, c)))
        elif c == "question_difficulty_train":
            row.append(0.5)
        else:
            row.append(0.0)
    X = np.array([row], dtype=float)
    model = bundle["model"]
    proba = float(model.predict_proba(X)[0, 1]) if hasattr(model, "predict_proba") else float(model.predict(X)[0])
    return {
        "probability_correct": proba,
        "model_version": bundle.get("run_id"),
        "selected": bundle.get("selected"),
        "note": "Correctness prediction is not recommendation effectiveness",
    }


@app.post("/v1/recommendations/score")
def recommendations_score(body: RankScoreRequest) -> dict[str, Any]:
    """Score eligible candidates with the saved pointwise ranker (no retraining)."""
    bundle = _state["c2_rank"]
    if bundle is None or bundle.get("model") is None:
        return {
            "ok": False,
            "fallbackReason": "ranker_artifact_unavailable",
            "modelVersion": None,
            "scores": [],
        }
    model = bundle["model"]
    feat_cols = bundle.get("feature_cols") or ["difficulty", "stu_open_rate"]
    open_rate = body.stu_open_rate if body.stu_open_rate is not None else 0.5
    rows = []
    for c in body.candidates:
        rows.append(
            {
                "resource_id": c.resource_id,
                "difficulty": float(c.difficulty),
                "stu_open_rate": float(open_rate),
                "topic_id": c.topic_id,
            }
        )
    if not rows:
        return {
            "ok": True,
            "modelVersion": bundle.get("run_id"),
            "trainedScorerUsed": True,
            "scores": [],
        }
    import pandas as pd

    df = pd.DataFrame(rows)
    X = df[feat_cols]
    proba = model.predict_proba(X)[:, 1]
    scores = [
        {
            "resourceId": r["resource_id"],
            "topicId": r.get("topic_id"),
            "score": float(p),
            "reason": "trained_pointwise_open_probability",
        }
        for r, p in zip(rows, proba)
    ]
    scores.sort(key=lambda x: x["score"], reverse=True)
    return {
        "ok": True,
        "modelVersion": bundle.get("run_id"),
        "trainedScorerUsed": True,
        "feature_cols": feat_cols,
        "scores": scores,
        "note": "Simulation-trained scorer; not real-student effectiveness",
    }


@app.post("/v1/chat/ask")
def chat_ask(body: ChatRequest) -> dict[str, Any]:
    from arts_ai.common.fixture_policy import resolve_chat_corpus_mode

    policy = resolve_chat_corpus_mode(
        body.corpus_mode,
        client_fixture_opt_in=body.allow_chat_fixtures,
    )
    if not policy["ok"]:
        raise HTTPException(
            policy["http_status"],
            detail={
                "error": policy["error"],
                "reason": policy["reason"],
                "note": (
                    "Configure ARTS_AI_ALLOW_TEST_FIXTURES=true on the ML process "
                    "(Node env does not automatically apply here)."
                ),
            },
        )
    mode = policy["corpus_mode"]
    history = body.conversation_history
    if mode == "domain" and history:
        history = [
            t
            for t in history
            if not (isinstance(t, dict) and str(t.get("corpus_mode") or "").lower() == "fixture")
        ]
    twin = body.digital_twin
    if mode == "domain" and isinstance(twin, dict):
        twin = {
            k: v
            for k, v in twin.items()
            if k
            not in (
                "observed_topic_performance_fixture",
                "fixture_weak_topics",
            )
        }
        if twin.get("data_category") == "test_fixture_learner":
            twin = {**twin, "weak_topics": [], "personalization_suppressed": True}

    if mode == "domain":
        idx = _state["c4_domain_index"]
        if idx is None:
            return {
                "student_id": body.student_id,
                "answer": "Domain knowledge index unavailable (awaiting permitted Arts content).",
                "answer_type": "insufficient_evidence",
                "insufficient_evidence": True,
                "citations": [],
                "corpus_mode": "domain",
                "corpus_version": None,
                "corpus_provenance": None,
                "domain_index_status": "unavailable",
                "note": "Requested domain corpus; fixture index was NOT substituted.",
            }
        corpus_meta = {
            "corpus_mode": "domain",
            "corpus_version": (idx.config or {}).get("corpus_version"),
            "corpus_provenance": (idx.config or {}).get("data_origin") or "domain",
        }
    else:
        idx = _state["c4_index"]
        if idx is None:
            raise HTTPException(503, "fixture knowledge index missing")
        corpus_meta = {
            "corpus_mode": "fixture",
            "corpus_version": (idx.config or {}).get("corpus_version") or "generated_fixture",
            "corpus_provenance": "generated_content",
            "is_test_fixture_corpus": True,
        }
    result = answer_question(
        body.question,
        idx,
        digital_twin=twin,
        conversation_history=history,
        use_generation=body.use_generation,
        model_version=str(corpus_meta["corpus_version"]),
        subject_id=body.subject_id,
        language=body.language,
    )
    result["student_id"] = body.student_id
    result.update(corpus_meta)
    if policy.get("reason"):
        result["corpus_mode_note"] = policy["reason"]
    result["topic_classifier_note"] = (
        "NL topic classifier is a closed-set generated-content evaluation artifact; "
        "it does not block domain retrieval for catalogue topics outside that taxonomy."
    )
    return result


@app.post("/v1/topic/classify")
def topic_classify(body: TopicRequest) -> dict[str, Any]:
    if _state["c4_topic"] is None:
        raise HTTPException(
            503,
            "topic classifier missing — set artifacts/c4/LATEST_TOPIC_SERVING.txt or LATEST_TOPIC_NL_RUN.txt",
        )
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "text_required")
    bundle = _state["c4_topic"]
    model = bundle["model"]
    # Match NL training input policy when present
    if bundle.get("input_policy") == "strip_label_shortcuts":
        from arts_ai.c4_chatbot.topic_nl_eval import strip_label_shortcuts

        text = strip_label_shortcuts(text)
    pred = model.predict([text])[0]
    classes = [str(c) for c in (bundle.get("classes") or [])]
    return {
        "topic_id": str(pred),
        "model_version": bundle.get("run_id"),
        "task": bundle.get("task") or "topic_classification",
        "experiment_scope": "closed_set_generated_nl_topics",
        "n_supported_classes": len(classes),
        "supported_in_closed_set": str(pred) in set(classes) if classes else None,
        "note": (
            "Closed-set topic classification on generated/unreviewed educational text. "
            "Metrics such as accuracy≈0.722 are experiment-specific — not overall chatbot accuracy "
            "or local Arts validation. Marker-era 100% model is historical sanity only."
        ),
        "data_category": "generated_content",
    }
