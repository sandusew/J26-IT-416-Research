"""Regenerate CURRENT_STATE_MANIFEST.json from actual artifacts (UTC; project-relative paths)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from arts_ai.common.hashing import file_sha256
from arts_ai.common.paths import get_paths

ROOT = Path(__file__).resolve().parents[3]  # Arts_AI/


def _rel(path: Path | str) -> str:
    p = Path(path).resolve()
    try:
        return str(p.relative_to(ROOT.resolve())).replace("\\", "/")
    except ValueError:
        return str(p).replace("\\", "/")


def _ptr(component: str, name: str) -> str | None:
    p = get_paths().artifact(component) / name
    return p.read_text(encoding="utf-8").strip() if p.exists() else None


def _hash_if(path: Path) -> str | None:
    return file_sha256(path) if path.exists() else None


def main() -> dict:
    paths = get_paths()
    c2 = paths.artifact("c2")
    c4 = paths.artifact("c4")
    c1 = paths.artifact("c1")
    c3 = paths.artifact("c3")

    ednet = _ptr("c2", "LATEST_EDNET_RUN.txt")
    rank = _ptr("c2", "LATEST_RANK_RUN.txt")
    arts = _ptr("c2", "LATEST_ARTS_RUN.txt")
    topic_serving = _ptr("c4", "LATEST_TOPIC_SERVING.txt") or _ptr("c4", "LATEST_TOPIC_NL_RUN.txt")
    topic_marker = _ptr("c4", "LATEST_TOPIC_RUN.txt")
    topic_nl = _ptr("c4", "LATEST_TOPIC_NL_RUN.txt")
    c1_run = _ptr("c1", "LATEST_RUN.txt")
    c3_run = _ptr("c3", "LATEST_OULAD_RUN.txt")

    domain_ptr = paths.arts_content / "indexes" / "LATEST_DOMAIN_INDEX.txt"
    domain_run = domain_ptr.read_text(encoding="utf-8").strip() if domain_ptr.exists() else None
    domain_idx = (
        paths.arts_content / "indexes" / domain_run / "domain_knowledge_index.joblib"
        if domain_run
        else None
    )
    domain_status_path = paths.arts_content / "indexes" / "LATEST_DOMAIN_INDEX_STATUS.json"
    domain_status = {}
    if domain_status_path.exists():
        domain_status = json.loads(domain_status_path.read_text(encoding="utf-8"))

    pooled_ap = {
        "candidate_runs": [
            "c2_arts_20261013T025936_8b27814f",
            "c2_arts_20261013T030235_5a8b703d",
        ],
        "resolved": "c2_arts_20261013T025936_8b27814f",
        "note": "Do not silently assign one run's metrics to another",
    }
    m025 = c2 / "c2_arts_20261013T025936_8b27814f" / "metrics.json"
    m030 = c2 / "c2_arts_20261013T030235_5a8b703d" / "metrics.json"
    if m025.exists():
        mt = json.loads(m025.read_text(encoding="utf-8")).get("test") or {}
        pooled_ap["resolved_test_ap"] = mt.get("ap")
        pooled_ap["resolved_test_n"] = mt.get("n")
        pooled_ap["metrics_path"] = _rel(m025)
        pooled_ap["metrics_sha256"] = file_sha256(m025)
    if m030.exists():
        mt = json.loads(m030.read_text(encoding="utf-8")).get("test") or {}
        pooled_ap["alternate_030235"] = {
            "run_id": "c2_arts_20261013T030235_5a8b703d",
            "test_ap": mt.get("ap"),
            "test_n": mt.get("n"),
            "metrics_path": _rel(m030),
            "note": "Different tiny run; do not assign AP to 025936",
        }
    if arts:
        pooled_ap["latest_arts_pointer"] = arts

    evidence = []
    for rel, attribution in (
        ("backend/api/tests/logs/integration_final_8of8.log", "historical_8_pass"),
        ("backend/api/tests/logs/integration_post_rec_policy.log", "historical_9_pass_policy"),
        ("backend/api/tests/logs/integration_post_nl_serving.log", "prior_11_pass_nl_serving"),
        ("backend/api/tests/logs/integration_post_domain_content.log", "prior_domain_integration"),
        ("backend/api/tests/last_run.log", "last_run_copy"),
        ("backend/api/reports/trained_ranker_express_smoke.json", "trained_ranker_express_live"),
        ("backend/ml/reports/c4_topic_nl_http_parity.json", "c4_nl_http_parity"),
        ("backend/ml/reports/c2_trained_ranker_http_verify.json", "c2_ranker_fastapi_parity"),
        ("backend/ml/reports/c4_knowledge_ingest_status.json", "knowledge_ingest"),
        ("backend/ml/reports/c4_domain_acquisition.json", "domain_acquisition"),
        ("backend/ml/reports/c4_curriculum_aligned_acquisition.json", "curriculum_aligned_corpus"),
        ("backend/ml/reports/c4_domain_retrieval_eval.json", "domain_retrieval_eval"),
        ("backend/ml/reports/c4_retrieval_eval_audit.json", "retrieval_eval_audit"),
        ("backend/ml/reports/LATEST_DOMAIN_RETRIEVAL_EVAL.txt", "latest_retrieval_eval_pointer"),
        ("backend/ml/reports/curriculum_coverage_matrix.json", "curriculum_coverage"),
        ("backend/ml/reports/curriculum_registry_build.json", "curriculum_registry"),
        ("backend/ml/reports/catalogue_validation.json", "catalogue_validation"),
        ("backend/ml/reports/model_identities_verified.json", "model_identities"),
        ("backend/ml/reports/c4_generation_adapter_offline.json", "generation_offline"),
        ("backend/docs/CONTINUATION_REPORT_20261015_ATLAS_HANDOFF.md", "prior_atlas_handoff_continuation"),
        ("backend/docs/FINAL_ACCEPTANCE_20261015.md", "final_acceptance"),
        ("backend/ml/reports/practice_content_quality.json", "practice_content_quality"),
        ("backend/ml/reports/practice_deficit_fill.json", "practice_deficit_fill"),
        ("backend/ml/reports/teaching_index_consistency.json", "teaching_index_consistency"),
        ("backend/ml/reports/retrieval_eval_comparability.md", "retrieval_eval_comparability"),
        ("backend/api/reports/verify_populated_backend.json", "verify_populated_backend"),
        ("backend/api/reports/demo_populated_e2e.json", "demo_populated_e2e"),
        ("backend/api/reports/topic_quiz_capacity.json", "topic_quiz_capacity"),
        ("backend/api/reports/practice_bank_reconciliation.json", "practice_bank_reconciliation"),
        ("backend/api/reports/practice_republish.json", "practice_republish"),
        ("backend/docs/CONTINUATION_REPORT_20261014_CHAT_RECOVERY.md", "prior_chat_recovery_continuation"),
        ("backend/docs/CONTINUATION_REPORT_20261014_FIXTURE_ISOLATION.md", "prior_fixture_isolation_continuation"),
        ("backend/docs/CONTINUATION_REPORT_20261014_CANONICAL_WORKFLOW.md", "prior_canonical_workflow_continuation"),
        ("backend/docs/CONTINUATION_REPORT_20261014_CURRICULUM_FIXES.md", "prior_curriculum_fixes_continuation"),
        ("backend/docs/CONTINUATION_REPORT_20261013_NL_SERVING.md", "historical_nl_continuation"),
    ):
        p = ROOT / rel
        if p.exists():
            evidence.append(
                {
                    "path": rel,
                    "attribution": attribution,
                    "sha256": file_sha256(p),
                    "mtime_utc": datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat(),
                }
            )
    # Prefer newest curriculum-phase integration log if present
    log_dir = ROOT / "backend/api/tests/logs"
    if log_dir.exists():
        curriculum_logs = sorted(
            list(log_dir.glob("integration_curriculum_fixes_*.log"))
            + list(log_dir.glob("integration_curriculum_phase_*.log")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if curriculum_logs:
            evidence.insert(
                0,
                {
                    "path": _rel(curriculum_logs[0]),
                    "attribution": "current_curriculum_fixes_integration",
                    "sha256": file_sha256(curriculum_logs[0]),
                    "mtime_utc": datetime.fromtimestamp(
                        curriculum_logs[0].stat().st_mtime, tz=timezone.utc
                    ).isoformat(),
                },
            )
        meeting_logs = sorted(
            log_dir.glob("meeting_contract_*.log"), key=lambda p: p.stat().st_mtime, reverse=True
        )
        if meeting_logs:
            evidence.insert(
                1,
                {
                    "path": _rel(meeting_logs[0]),
                    "attribution": "meeting_provider_contract_suite",
                    "sha256": file_sha256(meeting_logs[0]),
                    "mtime_utc": datetime.fromtimestamp(
                        meeting_logs[0].stat().st_mtime, tz=timezone.utc
                    ).isoformat(),
                },
            )
        canon_logs = sorted(
            log_dir.glob("canonical_catalogue_*.log"), key=lambda p: p.stat().st_mtime, reverse=True
        )
        if canon_logs:
            evidence.insert(
                0,
                {
                    "path": _rel(canon_logs[0]),
                    "attribution": "canonical_catalogue_fixture_suite",
                    "sha256": file_sha256(canon_logs[0]),
                    "mtime_utc": datetime.fromtimestamp(
                        canon_logs[0].stat().st_mtime, tz=timezone.utc
                    ).isoformat(),
                },
            )
        integ_logs = sorted(
            log_dir.glob("integration_20*.log"), key=lambda p: p.stat().st_mtime, reverse=True
        )
        if integ_logs:
            evidence.insert(
                0,
                {
                    "path": _rel(integ_logs[0]),
                    "attribution": "current_integration_suite",
                    "sha256": file_sha256(integ_logs[0]),
                    "mtime_utc": datetime.fromtimestamp(
                        integ_logs[0].stat().st_mtime, tz=timezone.utc
                    ).isoformat(),
                },
            )

    def model_file(run_dir: Path, names: list[str]) -> tuple[str | None, str | None]:
        for n in names:
            f = run_dir / n
            if f.exists():
                return n, file_sha256(f)
        return None, None

    serving_map = {}
    if c1_run:
        n, h = model_file(c1 / c1_run, ["kmeans_pipeline.joblib"])
        serving_map["POST /v1/behaviour/cluster"] = {
            "run_id": c1_run,
            "path": f"backend/ml/artifacts/c1/{c1_run}/{n}",
            "sha256": h,
            "provenance": "authentic_public_oulad",
        }
    if c3_run:
        n, h = model_file(c3 / c3_run, ["risk_pipeline.joblib"])
        serving_map["POST /v1/risk/predict"] = {
            "run_id": c3_run,
            "path": f"backend/ml/artifacts/c3/{c3_run}/{n}",
            "sha256": h,
            "provenance": "authentic_public_oulad",
        }
    if ednet:
        n, h = model_file(c2 / ednet, ["correctness_pipeline.joblib"])
        serving_map["POST /v1/correctness/predict"] = {
            "run_id": ednet,
            "path": f"backend/ml/artifacts/c2/{ednet}/{n}",
            "sha256": h,
            "provenance": "authentic_public_ednet_subset",
        }
    if rank:
        n, h = model_file(c2 / rank, ["ranker_pointwise.joblib"])
        serving_map["POST /v1/recommendations/score"] = {
            "run_id": rank,
            "path": f"backend/ml/artifacts/c2/{rank}/{n}",
            "sha256": h,
            "provenance": "synthetic_learner_simulation",
        }
    if topic_serving:
        n, h = model_file(c4 / topic_serving, ["topic_nl_classifier.joblib", "topic_classifier.joblib"])
        serving_map["POST /v1/topic/classify"] = {
            "run_id": topic_serving,
            "path": f"backend/ml/artifacts/c4/{topic_serving}/{n}",
            "sha256": h,
            "provenance": "generated_content — closed-set evaluation",
            "marker_historical_run": topic_marker,
            "nl_eval_run": topic_nl,
            "note": "NL serving ≠ marker sanity; not overall chatbot accuracy",
        }
    idx = c4 / "knowledge_index.joblib"
    serving_map["POST /v1/chat/ask (corpus_mode=fixture)"] = {
        "index_path": _rel(idx) if idx.exists() else "backend/ml/artifacts/c4/knowledge_index.joblib",
        "sha256": _hash_if(idx),
        "default_answer_type": "extractive_template",
        "provenance": "generated_content",
        "note": "Indexing is not model training",
    }
    serving_map["POST /v1/chat/ask (corpus_mode=domain)"] = {
        "corpus_version": domain_run,
        "index_path": _rel(domain_idx) if domain_idx and domain_idx.exists() else None,
        "sha256": _hash_if(domain_idx) if domain_idx else None,
        "n_documents": domain_status.get("n_registered") or domain_status.get("n_indexable"),
        "n_chunks": domain_status.get("n_chunks"),
        "domain_retrieval_status": domain_status.get("domain_retrieval_status"),
        "provenance": "authentic_public_cc_by_sa (unreviewed); NIE candidates excluded",
        "note": "Domain mode does not silently fall back to fixtures",
    }
    serving_map["GET /learning/recommendations"] = {
        "default_policyMode": "prerequisite_aware",
        "trained_opt_in": True,
        "ranker_run_id": rank,
    }

    retrieval_eval = {}
    reval = paths.reports / "c4_domain_retrieval_eval.json"
    if reval.exists():
        retrieval_eval = json.loads(reval.read_text(encoding="utf-8"))

    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "generator": "backend/ml/scripts/generate_current_state_manifest.py",
        "project": "Arts AI",
        "package": "arts_ai",
        "pointers": {
            "c1": c1_run,
            "c2_ednet": ednet,
            "c2_rank": rank,
            "c2_arts_latest": arts,
            "c2_arts_pooled_ap_resolved": "c2_arts_20261013T025936_8b27814f",
            "c3_oulad": c3_run,
            "c4_topic_serving": topic_serving,
            "c4_topic_marker_historical": topic_marker,
            "c4_topic_nl": topic_nl,
            "c4_domain_index": domain_run,
        },
        "endpoint_to_artifact": serving_map,
        "c2_pooled_ap_resolution": pooled_ap,
        "domain_retrieval_eval_summary": {
            "evaluation_id": retrieval_eval.get("evaluation_id"),
            "corpus_version": retrieval_eval.get("corpus_version"),
            "index_sha256": retrieval_eval.get("index_sha256"),
            "eval_cases_sha256": retrieval_eval.get("eval_cases_sha256"),
            "generated_at_utc": retrieval_eval.get("generated_at_utc"),
            "retrieval_config": retrieval_eval.get("retrieval_config"),
            "n_documents": retrieval_eval.get("n_documents"),
            "n_chunks": retrieval_eval.get("n_chunks"),
            "n_questions_total": retrieval_eval.get("n_questions_total")
            or retrieval_eval.get("n_questions"),
            "hit_at_3": retrieval_eval.get("hit_at_3"),
            "recall_at_3_micro": retrieval_eval.get("recall_at_3_micro"),
            "recall_at_3_historical_label_was_hit": retrieval_eval.get("recall_at_3"),
            "report": "backend/ml/reports/c4_domain_retrieval_eval.json",
            "audit": "backend/ml/reports/c4_retrieval_eval_audit.json",
            "historical_eval_on_prior_index": (
                "backend/ml/reports/historical/"
                "c4_domain_retrieval_eval__c4_index_20261014T002016_9178797b.json"
            ),
            "note": "Machine-authored eval bound to exact index SHA; Hit@3 ≠ multi-gold Recall@3; not teacher-validated",
        },
        "canonical_catalogue": {
            "import_route": "POST /catalogue/import",
            "quiz_assign": "POST /learning/quiz/:studentId/assign",
            "quiz_submit": "POST /learning/quiz/:studentId/assignments/:assignmentId/submit",
            "review_package": (
                "backend/ml/data/curriculum/review_packages/hist_sl_rajarata_politics_v0/"
            ),
            "authentic_approved_questions": 0,
            "authentic_approved_resources": 0,
            "fixture_workflow_tested": True,
            "fixture_isolation_server_side": True,
            "fixture_env_flag": "ARTS_AI_ALLOW_TEST_FIXTURES",
            "client_flag_alone_insufficient": True,
            "authentic_approved_content_exercised": False,
            "note": "Test fixtures labelled isTestFixture; do not count as teacher review",
        },
        "curriculum": {
            "version": "nie_al_arts_provisional_v0.1",
            "scope_status": "provisional_awaiting_stakeholder_confirmation",
            "approved_proposal_in_repo": False,
            "technical_test_slice": "hist_sl_rajarata_politics (provisional; not final subject approval)",
            "registry": "backend/ml/data/curriculum/nie_al_arts_provisional_v0.1_registry.json",
            "coverage_matrix": "backend/ml/reports/curriculum_coverage_matrix.json",
            "coverage_summary": "backend/docs/CURRICULUM_COVERAGE_SUMMARY.md",
            "requirements_matrix": "backend/docs/REQUIREMENTS_TO_IMPLEMENTATION.md",
            "model_gap_table": "backend/docs/MODEL_GAP_TABLE.md",
            "scope_decisions": "backend/ml/data/curriculum/SCOPE_DECISIONS.md",
        },
        "integration_tests": {
            "historical_8_pass": {
                "log": "backend/api/tests/logs/integration_final_8of8.log",
            },
            "historical_9_pass": {
                "log": "backend/api/tests/logs/integration_post_rec_policy.log",
            },
            "prior_11_pass": {
                "log": "backend/api/tests/logs/integration_post_nl_serving.log",
            },
            "current_suite": {
                "command": "node --test tests/integration.test.js",
                "cwd": "backend/api",
                "env": {"ML_INFERENCE_URL": "http://127.0.0.1:8000"},
                "evidence": evidence,
            },
        },
        "configuration_state_no_secrets": {
            "recommendation_policy_default": "prerequisite_aware",
            "meeting_provider_env_set": bool(__import__("os").environ.get("MEETING_PROVIDER")),
            "meeting_smoke_json_present": (ROOT / "backend/api/reports/meeting_smoke_test.json").exists(),
            "generation_provider": __import__("os").environ.get("ARTS_AI_GENERATION_PROVIDER") or "none",
            "generation_live_verified": False,
            "meeting_live_verified": False,
        },
        "remaining_blockers": [
            "Approved research proposal / guideline PDF missing from workspace",
            "Stakeholder confirmation of subject list, media, grades, syllabus edition/cohort",
            "Teacher review of domain Wikipedia extracts (0/45 teacher_reviewed_content)",
            "Official learning-outcome verbatim extracts with page evidence (currently 0/45 official)",
            "NIE syllabus reuse permission unclear — candidates only; not indexed as teaching text",
            "Verified curriculum-aligned question bank (0/45; synthetic partial_match ≠ verified)",
            "Sinhala literature domain content + Sinhala QA not claimed",
            "Generative chat live provider requires credentials (configure backend/ml/.env only if missing)",
            "Meeting provider choice + credentials + smoke JSON",
            "wiki_en_climate_sri_lanka acquired to approved_pending after 429 retry — still unreviewed and not promoted into serving index (geo_climate; outside hist technical slice)",
            "Authentic approved canonical question/resource bank still empty (fixture path tested only)",
            "For fixture demos set ARTS_AI_ALLOW_TEST_FIXTURES=true in backend/api/.env (never production)",
            "Local Arts labelled data for mastery / A/L exam-outcome models",
        ],
        "test_suites": {
            "integration": {
                "command": "node --test tests/integration.test.js",
                "cwd": "backend/api",
                "attribution": "integration_only",
            },
            "canonical_catalogue": {
                "command": "node --test tests/canonical_catalogue.test.js",
                "cwd": "backend/api",
                "attribution": "canonical_fixture_workflow_only",
                "env_required": {"ARTS_AI_ALLOW_TEST_FIXTURES": "true", "NODE_ENV": "test"},
            },
            "meeting_contract": {
                "command": "node --test tests/meeting_provider_contract.test.js",
                "cwd": "backend/api",
                "attribution": "meeting_contract_only",
            },
            "risk_observation": {
                "command": "pytest tests/test_risk_observation_cases.py -q",
                "cwd": "backend/ml",
            },
            "live_generation": {
                "command": ".\\.venv\\Scripts\\python.exe scripts\\smoke_generation_live.py --live",
                "cwd": "backend/ml",
                "status": "blocked_missing_configuration",
                "script": "backend/ml/scripts/smoke_generation_live.py",
            },
            "live_meeting": {
                "command": "node scripts\\smoke_meeting_live.js --live",
                "cwd": "backend/api",
                "status": "blocked_missing_configuration",
                "script": "backend/api/scripts/smoke_meeting_live.js",
            },
            "quiz_submission_recovery": {
                "command": "node --test tests/quiz_submission_recovery.test.js",
                "cwd": "backend/api",
            },
            "chat_fixture_policy": {
                "command": "pytest tests/test_chat_fixture_policy.py -q",
                "cwd": "backend/ml",
            },
            "fixture_derived_state": {
                "command": "node --test tests/fixture_derived_state.test.js",
                "cwd": "backend/api",
            },
            "note": "Earlier combined runs remain separately attributed; blocked live smoke ≠ pass",
        },
        "serving_ranker_architecture": {
            "run_id": rank,
            "pipeline": "StandardScaler → LogisticRegression",
            "artifact": f"backend/ml/artifacts/c2/{rank}/ranker_pointwise.joblib" if rank else None,
            "sha256": serving_map.get("POST /v1/recommendations/score", {}).get("sha256"),
            "note": "Verified via joblib.load; not LightGBM. Historical LightGBM claims belong to other run IDs if any.",
        },
        "continuation_report": "backend/docs/CONTINUATION_REPORT_20261015_DEFICIT_FILL.md",
        "final_acceptance": "backend/docs/FINAL_ACCEPTANCE_20261015.md",
    }

    # Practice content counts from live verify + quality repair (honest; not forced to 540)
    verify_path = ROOT / "backend/api/reports/verify_populated_backend.json"
    quality_path = ROOT / "backend/ml/reports/practice_content_quality.json"
    demo_path = ROOT / "backend/api/reports/demo_populated_e2e.json"
    republish_path = ROOT / "backend/api/reports/practice_republish.json"
    pub_q, pub_r = None, None
    if verify_path.exists():
        vdoc = json.loads(verify_path.read_text(encoding="utf-8"))
        for step in vdoc.get("steps") or []:
            if step.get("name") == "published_practice_available":
                detail = step.get("detail") or {}
                pub_q = detail.get("publishedPracticeQuestions")
                pub_r = detail.get("publishedPracticeResources")
                break
        manifest["verify_populated_backend"] = {
            "passed": vdoc.get("passed"),
            "failed": vdoc.get("failed"),
            "generated_at_utc": vdoc.get("generated_at_utc"),
            "mongo": vdoc.get("config_mongo"),
            "evidence": "backend/api/reports/verify_populated_backend.json",
        }
    quality = {}
    if quality_path.exists():
        quality = json.loads(quality_path.read_text(encoding="utf-8"))
    demo = {}
    if demo_path.exists():
        demo = json.loads(demo_path.read_text(encoding="utf-8"))
    republish = {}
    if republish_path.exists():
        republish = json.loads(republish_path.read_text(encoding="utf-8"))

    practice = {
        "policy": "published_practice_default",
        "content_policy_doc": "backend/docs/CONTENT_POLICY.md",
        "n_topics_usable_packages": 45,
        "n_ai_authored_questions_authored_historical": 540,
        "n_eligible_questions_after_repair": quality.get("eligible_questions_after_repair"),
        "n_teaching_packages": quality.get("eligible_resources_after_repair") or 45,
        "published_practice_questions": pub_q,
        "published_practice_resources": pub_r,
        "authentic_approved_questions": 0,
        "teacher_reviewed_questions": 0,
        "topics_with_ge_8_questions": quality.get("topics_with_ge_8_questions"),
        "topics_with_ge_12_questions": quality.get("topics_with_ge_12_questions"),
        "medium": "english",
        "sinhala_literature": "deferred",
        "scope_note": (
            "Implementation assumption for local backend population; not stakeholder-approved "
            "complete national syllabus coverage; Sinhala Literature deferred; English medium only. "
            "Deficit-fill closed 12 distinct published questions per English topic where sources allowed."
        ),
        "domain_index": domain_run,
        "quality_report": "backend/ml/reports/practice_content_quality.md",
        "deficit_fill_report": "backend/ml/reports/practice_deficit_fill.json",
        "index_consistency": "backend/ml/reports/teaching_index_consistency.json",
        "reconciliation": "backend/api/reports/practice_bank_reconciliation.json",
        "topic_quiz_capacity": "backend/api/reports/topic_quiz_capacity.json",
        "coverage_report": "backend/ml/reports/practice_topic_coverage.json",
        "import_publish_evidence": "backend/api/reports/practice_republish.json",
        "demo_e2e": "backend/api/reports/demo_populated_e2e.json",
        "review_kinds_performed": quality.get("review_kinds_performed"),
        "review_kinds_not_performed": quality.get("review_kinds_not_performed"),
        "export_before_republish": republish.get("exportPath"),
        "reconciliation_531_vs_486": (
            "Pre-fill batch had 531 rows but 45 duplicate questionId::version keys → 486 unique published. "
            "Post-fill: 540 distinct published (12×45)."
        ),
    }
    cap_path = ROOT / "backend/api/reports/topic_quiz_capacity.json"
    if cap_path.exists():
        cap = json.loads(cap_path.read_text(encoding="utf-8"))
        practice["topics_assignable_12q"] = {
            "passed": cap.get("passed"),
            "failed": cap.get("failed"),
            "n_topics": cap.get("n_topics"),
            "generated_at_utc": cap.get("generated_at_utc"),
        }
    fill_path = ROOT / "backend/ml/reports/practice_deficit_fill.json"
    if fill_path.exists():
        fill = json.loads(fill_path.read_text(encoding="utf-8"))
        practice["deficit_fill"] = {
            "newly_authored": fill.get("newly_authored"),
            "topics_meeting_12": fill.get("topics_meeting_12"),
            "blockers": fill.get("blockers"),
        }
    manifest["practice_content"] = practice
    manifest["canonical_catalogue"]["published_practice_questions"] = pub_q
    manifest["canonical_catalogue"]["published_practice_resources"] = pub_r
    manifest["canonical_catalogue"]["practice_publication_policy"] = True
    if demo:
        manifest["test_suites"]["demo_populated_e2e"] = {
            "command": "node scripts/demo_populated_e2e.js",
            "cwd": "backend/api",
            "passed": demo.get("passed"),
            "failed": demo.get("failed"),
            "evidence": "backend/api/reports/demo_populated_e2e.json",
            "generated_at_utc": demo.get("generated_at_utc"),
        }
    manifest["test_suites"]["verify_populated_backend"] = {
        "command": "node scripts/verify_populated_backend.js",
        "cwd": "backend/api",
        "passed": (manifest.get("verify_populated_backend") or {}).get("passed"),
        "failed": (manifest.get("verify_populated_backend") or {}).get("failed"),
        "evidence": "backend/api/reports/verify_populated_backend.json",
        "note": "Non-destructive Atlas verification; does not reseed",
    }

    out = ROOT / "backend" / "docs" / "CURRENT_STATE_MANIFEST.json"
    # Prefer newest dated integration log, else curriculum-phase, else prior domain log
    import re

    last_log = None
    log_dir = ROOT / "backend/api/tests/logs"
    if log_dir.exists():
        cand = sorted(
            list(log_dir.glob("integration_20*.log"))
            + list(log_dir.glob("integration_curriculum_fixes_*.log"))
            + list(log_dir.glob("integration_curriculum_phase_*.log")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if cand:
            last_log = cand[0]
    if last_log is None:
        last_log = ROOT / "backend/api/tests/logs/integration_post_domain_content.log"
    if last_log.exists():
        raw = last_log.read_bytes()
        if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
            text = raw.decode("utf-16", errors="replace")
        elif len(raw) > 3 and raw[1] == 0 and raw[3] == 0:
            text = raw.decode("utf-16-le", errors="replace")
        else:
            text = raw.decode("utf-8-sig", errors="replace")
        # Node reporter may be UTF-8 or PowerShell UTF-16 Tee-Object output
        m = re.search(r"tests\s+(\d+)", text, re.I)
        p = re.search(r"pass\s+(\d+)", text, re.I)
        f = re.search(r"fail\s+(\d+)", text, re.I)
        if p:
            manifest["integration_tests"]["current_suite"]["passed"] = int(p.group(1))
        if f:
            manifest["integration_tests"]["current_suite"]["failed"] = int(f.group(1))
        if m:
            manifest["integration_tests"]["current_suite"]["n_tests"] = int(m.group(1))
        manifest["integration_tests"]["current_suite"]["log"] = _rel(last_log)

    # Parse latest canonical catalogue suite counts
    if log_dir.exists():
        clogs = sorted(
            log_dir.glob("canonical_catalogue_*.log"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if clogs:
            raw = clogs[0].read_bytes()
            text = raw.decode("utf-8-sig", errors="replace")
            if "\x00" in text[:200]:
                text = raw.decode("utf-16-le", errors="replace")
            p = re.search(r"pass\s+(\d+)", text, re.I)
            f = re.search(r"fail\s+(\d+)", text, re.I)
            n = re.search(r"tests\s+(\d+)", text, re.I)
            manifest["test_suites"]["canonical_catalogue"]["log"] = _rel(clogs[0])
            manifest["test_suites"]["canonical_catalogue"]["log_sha256"] = file_sha256(clogs[0])
            manifest["test_suites"]["canonical_catalogue"]["executed_at_utc"] = datetime.fromtimestamp(
                clogs[0].stat().st_mtime, tz=timezone.utc
            ).isoformat()
            manifest["test_suites"]["canonical_catalogue"]["exit_code"] = 0 if (f and int(f.group(1)) == 0) else None
            if p:
                manifest["test_suites"]["canonical_catalogue"]["passed"] = int(p.group(1))
            if f:
                manifest["test_suites"]["canonical_catalogue"]["failed"] = int(f.group(1))
            if n:
                manifest["test_suites"]["canonical_catalogue"]["n_tests"] = int(n.group(1))

        mlogs = sorted(
            log_dir.glob("meeting_contract_*.log"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if mlogs:
            raw = mlogs[0].read_bytes()
            text = raw.decode("utf-8-sig", errors="replace")
            if "\x00" in text[:200]:
                text = raw.decode("utf-16-le", errors="replace")
            p = re.search(r"pass\s+(\d+)", text, re.I)
            f = re.search(r"fail\s+(\d+)", text, re.I)
            n = re.search(r"tests\s+(\d+)", text, re.I)
            manifest["test_suites"]["meeting_contract"]["log"] = _rel(mlogs[0])
            manifest["test_suites"]["meeting_contract"]["log_sha256"] = file_sha256(mlogs[0])
            manifest["test_suites"]["meeting_contract"]["executed_at_utc"] = datetime.fromtimestamp(
                mlogs[0].stat().st_mtime, tz=timezone.utc
            ).isoformat()
            if p:
                manifest["test_suites"]["meeting_contract"]["passed"] = int(p.group(1))
            if f:
                manifest["test_suites"]["meeting_contract"]["failed"] = int(f.group(1))
            if n:
                manifest["test_suites"]["meeting_contract"]["n_tests"] = int(n.group(1))
            manifest["test_suites"]["meeting_contract"]["exit_code"] = (
                0 if f and int(f.group(1)) == 0 else None
            )

        for suite_key, pattern, kind in (
            ("quiz_submission_recovery", "quiz_recovery_*.log", "node"),
            ("fixture_derived_state", "fixture_derived_*.log", "node"),
            ("chat_fixture_policy", "chat_fixture_policy_*.log", "pytest"),
        ):
            slogs = sorted(log_dir.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
            if not slogs:
                continue
            raw = slogs[0].read_bytes()
            text = raw.decode("utf-8-sig", errors="replace")
            if "\x00" in text[:200]:
                text = raw.decode("utf-16-le", errors="replace")
            manifest["test_suites"][suite_key]["log"] = _rel(slogs[0])
            manifest["test_suites"][suite_key]["log_sha256"] = file_sha256(slogs[0])
            manifest["test_suites"][suite_key]["executed_at_utc"] = datetime.fromtimestamp(
                slogs[0].stat().st_mtime, tz=timezone.utc
            ).isoformat()
            if kind == "node":
                p = re.search(r"pass\s+(\d+)", text, re.I)
                f = re.search(r"fail\s+(\d+)", text, re.I)
                n = re.search(r"tests\s+(\d+)", text, re.I)
                if p:
                    manifest["test_suites"][suite_key]["passed"] = int(p.group(1))
                if f:
                    manifest["test_suites"][suite_key]["failed"] = int(f.group(1))
                if n:
                    manifest["test_suites"][suite_key]["n_tests"] = int(n.group(1))
                manifest["test_suites"][suite_key]["exit_code"] = (
                    0 if f and int(f.group(1)) == 0 else None
                )
            else:
                p = re.search(r"(\d+)\s+passed", text, re.I)
                f = re.search(r"(\d+)\s+failed", text, re.I)
                if p:
                    manifest["test_suites"][suite_key]["passed"] = int(p.group(1))
                manifest["test_suites"][suite_key]["failed"] = int(f.group(1)) if f else 0
                manifest["test_suites"][suite_key]["exit_code"] = (
                    0 if manifest["test_suites"][suite_key]["failed"] == 0 else 1
                )

        # Latest offline smoke evidence (blocked ≠ pass)
        gen_smokes = sorted(
            (ROOT / "backend/ml/reports").glob("generation_live_smoke_*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if gen_smokes:
            gdoc = json.loads(gen_smokes[0].read_text(encoding="utf-8"))
            manifest["test_suites"]["live_generation"]["evidence"] = _rel(gen_smokes[0])
            manifest["test_suites"]["live_generation"]["outcome"] = gdoc.get("outcome")
            manifest["test_suites"]["live_generation"]["executed_at_utc"] = gdoc.get(
                "generated_at_utc"
            )
        meet_smokes = sorted(
            (ROOT / "backend/api/reports").glob("meeting_live_smoke_*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if meet_smokes:
            mdoc = json.loads(meet_smokes[0].read_text(encoding="utf-8"))
            manifest["test_suites"]["live_meeting"]["evidence"] = _rel(meet_smokes[0])
            manifest["test_suites"]["live_meeting"]["outcome"] = mdoc.get("outcome")
            manifest["test_suites"]["live_meeting"]["executed_at_utc"] = mdoc.get(
                "generated_at_utc"
            )

        rlogs = sorted(
            log_dir.glob("risk_observation_*.log"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if rlogs:
            raw = rlogs[0].read_bytes()
            text = raw.decode("utf-8-sig", errors="replace")
            if "\x00" in text[:200]:
                text = raw.decode("utf-16-le", errors="replace")
            # pytest: "7 passed"
            p = re.search(r"(\d+)\s+passed", text, re.I)
            f = re.search(r"(\d+)\s+failed", text, re.I)
            manifest["test_suites"]["risk_observation"]["log"] = _rel(rlogs[0])
            manifest["test_suites"]["risk_observation"]["log_sha256"] = file_sha256(rlogs[0])
            manifest["test_suites"]["risk_observation"]["executed_at_utc"] = datetime.fromtimestamp(
                rlogs[0].stat().st_mtime, tz=timezone.utc
            ).isoformat()
            if p:
                manifest["test_suites"]["risk_observation"]["passed"] = int(p.group(1))
            if f:
                manifest["test_suites"]["risk_observation"]["failed"] = int(f.group(1))
            else:
                manifest["test_suites"]["risk_observation"]["failed"] = 0
            manifest["test_suites"]["risk_observation"]["exit_code"] = (
                0 if manifest["test_suites"]["risk_observation"].get("failed", 0) == 0 else 1
            )

        if last_log and last_log.exists():
            manifest["integration_tests"]["current_suite"]["log_sha256"] = file_sha256(last_log)
            manifest["integration_tests"]["current_suite"]["executed_at_utc"] = datetime.fromtimestamp(
                last_log.stat().st_mtime, tz=timezone.utc
            ).isoformat()
            manifest["integration_tests"]["current_suite"]["exit_code"] = (
                0
                if manifest["integration_tests"]["current_suite"].get("failed", 1) == 0
                else 1
            )
            manifest["test_suites"]["integration"]["log"] = _rel(last_log)
            manifest["test_suites"]["integration"]["passed"] = manifest["integration_tests"][
                "current_suite"
            ].get("passed")
            manifest["test_suites"]["integration"]["failed"] = manifest["integration_tests"][
                "current_suite"
            ].get("failed")
            manifest["test_suites"]["integration"]["n_tests"] = manifest["integration_tests"][
                "current_suite"
            ].get("n_tests")
            manifest["test_suites"]["integration"]["exit_code"] = manifest["integration_tests"][
                "current_suite"
            ].get("exit_code")
            manifest["test_suites"]["integration"]["executed_at_utc"] = manifest[
                "integration_tests"
            ]["current_suite"].get("executed_at_utc")

    out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": _rel(out), "generated_at_utc": manifest["generated_at_utc"]}, indent=2))
    return manifest


if __name__ == "__main__":
    main()
