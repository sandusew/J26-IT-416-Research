"""Evaluate domain retrieval against a labelled question set grounded in acquired docs.

Machine-authored evaluation examples are labelled as such. Not teacher-reviewed.
Questions and answer keys live under arts_content/eval/ and are NOT ingested into the index.

Gold expansion after corpus growth is multi-document relevance (honest multi-gold),
not silent retuning of BM25. New topic cases added as held-out expansion.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from arts_ai.c4_chatbot.knowledge_ingest import ensure_layout, load_domain_index
from arts_ai.common.hashing import file_sha256
from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths
from arts_ai.curriculum.registry import CURRICULUM_VERSION

# Machine-authored; review_status=unreviewed.
# Gold may list multiple relevant document_ids after supplemental corpus expansion.
EVAL_CASES = [
    {
        "id": "q_hist_answerable",
        "question": "What periods or kingdoms are associated with the early history of Sri Lanka?",
        "language": "en",
        "answerable": True,
        "subject_id": "sub_history",
        "topic_id": "hist_sl_rajarata_politics",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": [
            "wiki_en_sri_lanka_history",
            "wiki_en_anuradhapura",
            "wiki_en_polonnaruwa",
            "wiki_en_buddhism_sri_lanka",
            "prac_pkg_hist_sl_rajarata_politics",
            "prac_pkg_hist_sl_sources",
        ],
        "key_facts": ["Sri Lanka", "history"],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "core",
    },
    {
        "id": "q_geo_answerable",
        "question": "Describe the physical geography and location of Sri Lanka.",
        "language": "en",
        "answerable": True,
        "subject_id": "sub_geography",
        "topic_id": "geo_basic_concepts",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": [
            "wiki_en_geography_sri_lanka",
            "wiki_en_physical_geography",
            "prac_pkg_geo_basic_concepts",
            "prac_pkg_geo_physical_nature",
        ],
        "key_facts": ["Sri Lanka", "Indian Ocean"],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "core",
    },
    {
        "id": "q_econ_answerable",
        "question": "What is economics as a field of study concerned with?",
        "language": "en",
        "answerable": True,
        "subject_id": "sub_economics",
        "topic_id": "eco_intro",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": ["wiki_en_economics", "prac_pkg_eco_intro", "prac_pkg_eco_development"],
        "key_facts": ["economics", "resources"],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "core",
    },
    {
        "id": "q_pol_answerable",
        "question": "How is the government or political system of Sri Lanka organised?",
        "language": "en",
        "answerable": True,
        "subject_id": "sub_political",
        "topic_id": "pol_international",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": [
            "wiki_en_politics_sri_lanka",
            "wiki_en_forms_of_government",
            "prac_pkg_pol_forms_gov",
            "prac_pkg_pol_international",
        ],
        "key_facts": ["Sri Lanka", "government"],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "core",
    },
    {
        "id": "q_unanswerable_quantum",
        "question": "What is the exact half-life of unobtanium-42 used in Sri Lankan A/L chemistry practicals?",
        "language": "en",
        "answerable": False,
        "subject_id": "sub_history",
        "topic_id": "hist_sl_sources",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": [],
        "key_facts": [],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "core",
    },
    {
        "id": "q_ambiguous_trade",
        "question": "How did trade shape development?",
        "language": "en",
        "answerable": True,
        "ambiguous": True,
        "subject_id": None,  # intentionally unfiltered — ambiguous across subjects
        "topic_id": "hist_sl_colonial_modern",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": [
            "wiki_en_sri_lanka_history",
            "wiki_en_economics",
            "prac_pkg_eco_intl_trade",
            "prac_pkg_hist_sl_colonial_modern",
        ],
        "key_facts": ["trade"],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "core",
        "note": "Ambiguous across history/economics; any of expected docs counts as partial hit",
    },
    {
        "id": "q_si_unclaimed",
        "question": "ශ්‍රී ලංකාවේ ඉතිහාසය පිළිබඳ කෙටි විස්තරයක් දෙන්න",
        "language": "si",
        "answerable": True,
        "subject_id": "sub_history",
        "topic_id": "hist_sl_colonial_modern",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": ["wiki_en_sri_lanka_history"],
        "key_facts": [],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "core",
        "note": "Sinhala query — retrieval support not claimed; result recorded honestly",
    },
    # Held-out expansion (chosen before further retrieval tuning)
    {
        "id": "q_hist_anuradhapura",
        "question": "What was Anuradhapura and why was it important in Sri Lankan history?",
        "language": "en",
        "answerable": True,
        "subject_id": "sub_history",
        "topic_id": "hist_sl_rajarata_politics",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": [
            "wiki_en_anuradhapura",
            "wiki_en_polonnaruwa",
            "prac_pkg_hist_sl_rajarata_politics",
        ],
        "key_facts": ["Anuradhapura"],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "held_out_expansion",
    },
    {
        "id": "q_eco_supply_demand",
        "question": "Explain supply and demand and how prices are determined in a market.",
        "language": "en",
        "answerable": True,
        "subject_id": "sub_economics",
        "topic_id": "eco_demand_supply",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": [
            "wiki_en_supply_demand",
            "wiki_en_opportunity_cost",
            "prac_pkg_eco_demand_supply",
        ],
        "key_facts": ["supply", "demand"],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "held_out_expansion",
    },
    {
        "id": "q_pol_ideology",
        "question": "What is a political ideology and what are common examples?",
        "language": "en",
        "answerable": True,
        "subject_id": "sub_political",
        "topic_id": "pol_ideologies",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": ["wiki_en_political_ideology", "prac_pkg_pol_ideologies"],
        "key_facts": ["ideology"],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "held_out_expansion",
    },
    {
        "id": "q_wrong_subject_geo_as_history",
        "question": "Describe the physical geography and location of Sri Lanka.",
        "language": "en",
        "answerable": False,
        "subject_id": "sub_history",
        "topic_id": "hist_sl_geography",
        "curriculum_version": CURRICULUM_VERSION,
        "expected_document_ids": [],
        "expect_wrong_subject_abstention": True,
        "key_facts": [],
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "split": "held_out_expansion",
        "note": "Same geo question with history subject filter — expect abstention or non-geo docs only",
    },
]


def main() -> dict:
    paths = ensure_layout()
    eval_dir = paths["eval"]
    cases_path = eval_dir / "domain_retrieval_eval_cases.json"
    save_json(
        {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "authoring_provenance": "machine_authored_research_eval",
            "review_status": "unreviewed",
            "in_retrieval_corpus": False,
            "curriculum_version": CURRICULUM_VERSION,
            "n_cases": len(EVAL_CASES),
            "cases": EVAL_CASES,
            "teacher_review_workflow": "backend/ml/data/arts_content/TEACHER_REVIEW_TEMPLATE.md",
            "note": (
                "Multi-gold document relevance after supplemental corpus expansion. "
                "Subject filter applied when subject_id set. Not teacher-reviewed."
            ),
        },
        cases_path,
    )

    idx = load_domain_index()
    reports_dir = get_paths().reports
    latest_path = reports_dir / "c4_domain_retrieval_eval.json"
    # Preserve prior report if it was for a different corpus version
    if latest_path.exists():
        prior = json.loads(latest_path.read_text(encoding="utf-8"))
        prior_cv = prior.get("corpus_version")
        ptr = get_paths().arts_content / "indexes" / "LATEST_DOMAIN_INDEX.txt"
        current_cv = ptr.read_text(encoding="utf-8").strip() if ptr.exists() else None
        if prior_cv and current_cv and prior_cv != current_cv:
            hist = reports_dir / "historical" / f"c4_domain_retrieval_eval__{prior_cv}.json"
            hist.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(latest_path, hist)

    if idx is None:
        report = {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "status": "skipped_no_domain_index",
            "n_documents": 0,
            "n_chunks": 0,
            "n_questions": len(EVAL_CASES),
        }
        save_json(report, latest_path)
        print(json.dumps(report, indent=2))
        return report

    ptr = get_paths().arts_content / "indexes" / "LATEST_DOMAIN_INDEX.txt"
    corpus_version = (idx.config or {}).get("corpus_version") or (
        ptr.read_text(encoding="utf-8").strip() if ptr.exists() else None
    )
    index_file = (
        get_paths().arts_content / "indexes" / str(corpus_version) / "domain_knowledge_index.joblib"
    )
    eval_id = f"c4_retr_eval_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    eval_set_sha = file_sha256(cases_path) if cases_path.exists() else None
    index_sha = file_sha256(index_file) if index_file.exists() else None

    doc_ids = sorted({c.get("document_id") for c in idx.chunks if c.get("document_id")})
    results = []
    hits_at_3 = 0
    recall_numer = 0
    recall_denom = 0
    answerable = [
        c
        for c in EVAL_CASES
        if c.get("answerable")
        and c.get("expected_document_ids")
        and c.get("language") != "si"
        and not c.get("expect_wrong_subject_abstention")
    ]
    for case in EVAL_CASES:
        retrieved = idx.retrieve(
            case["question"],
            top_k=5,
            subject_id=case.get("subject_id"),
            language=None if case.get("language") == "si" else case.get("language"),
        )
        # Sinhala: do not claim language filter success — run unfiltered EN corpus for honesty
        if case.get("language") == "si":
            retrieved = idx.retrieve(case["question"], top_k=5)
        retrieved_docs = [r.get("document_id") for r in retrieved]
        gold = set(case.get("expected_document_ids") or [])
        top3 = set(retrieved_docs[:3])
        hit = bool(gold & top3) if gold else None
        if case in answerable and hit:
            hits_at_3 += 1
        if case in answerable and gold:
            recall_numer += len(gold & top3)
            recall_denom += len(gold)
        insufficient = len(retrieved) == 0
        if case.get("expect_wrong_subject_abstention"):
            geo_leak = any("geography" in str(d) or "physical" in str(d) for d in retrieved_docs[:3])
            wrong_ok = insufficient or not geo_leak
        else:
            wrong_ok = None
        citation_ok = all(d in doc_ids for d in retrieved_docs if d)
        results.append(
            {
                "id": case["id"],
                "answerable": case.get("answerable"),
                "language": case.get("language"),
                "split": case.get("split"),
                "subject_id": case.get("subject_id"),
                "n_retrieved": len(retrieved),
                "retrieved_document_ids": retrieved_docs,
                "hit_at_3": hit,
                "recall_at_3_question": (len(gold & top3) / len(gold)) if gold else None,
                "insufficient_evidence_behavior": insufficient,
                "wrong_subject_ok": wrong_ok,
                "citations_map_to_corpus": citation_ok,
                "n_gold_docs": len(gold),
                "note": case.get("note"),
            }
        )

    n_ans = len(answerable)
    core_ans = [c for c in answerable if c.get("split") == "core"]
    core_hits = sum(
        1
        for r in results
        if r["id"] in {c["id"] for c in core_ans} and r.get("hit_at_3")
    )
    report = {
        "evaluation_id": eval_id,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "corpus_version": corpus_version,
        "index_path": f"backend/ml/data/arts_content/indexes/{corpus_version}/domain_knowledge_index.joblib"
        if corpus_version
        else None,
        "index_sha256": index_sha,
        "eval_cases_path": "backend/ml/data/arts_content/eval/domain_retrieval_eval_cases.json",
        "eval_cases_sha256": eval_set_sha,
        "retrieval_config": {
            "method": "BM25" if getattr(idx, "embedding_matrix", None) is None else "hybrid",
            "top_k": 5,
            "subject_filter": True,
            "language_filter": True,
        },
        "n_documents": len(doc_ids),
        "n_chunks": len(idx.chunks),
        "n_questions_total": len(EVAL_CASES),
        "n_answerable_eligible": n_ans,
        "exclusions": [
            {"id": c["id"], "reason": "sinhala_support_not_claimed"}
            for c in EVAL_CASES
            if c.get("language") == "si"
        ]
        + [
            {"id": c["id"], "reason": "wrong_subject_probe"}
            for c in EVAL_CASES
            if c.get("expect_wrong_subject_abstention")
        ],
        "hit_at_3": {
            "numerator": hits_at_3,
            "denominator": n_ans,
            "value": (hits_at_3 / n_ans) if n_ans else None,
            "definition": "1 if any gold document_id in top-3; denominator = eligible answerable",
        },
        "recall_at_3_micro": {
            "numerator": recall_numer,
            "denominator": recall_denom,
            "value": (recall_numer / recall_denom) if recall_denom else None,
            "definition": "sum_q |gold∩top3| / sum_q |gold| over eligible answerable",
        },
        "hit_at_3_core_only": {
            "numerator": core_hits,
            "denominator": len(core_ans),
            "value": (core_hits / len(core_ans)) if core_ans else None,
        },
        "recall_at_3_label_note": (
            "Do not treat historical recall_at_3 field as multi-gold Recall@3; "
            "use recall_at_3_micro here and c4_retrieval_eval_audit.json."
        ),
        "recall_at_3": (hits_at_3 / n_ans) if n_ans else None,
        "hits_at_3": hits_at_3,
        "cases": results,
        "scoring_criteria": "Hit@3 vs multi-gold Recall@3 reported separately",
        "authoring_provenance": "machine_authored_research_eval",
        "review_status": "unreviewed",
        "sinhala_support_claimed": False,
        "subject_filter_used": True,
        "note": "Machine-authored suite — not teacher-validated educational effectiveness",
    }
    report["representative_failures"] = [
        r
        for r in results
        if r.get("hit_at_3") is False
        or (
            r.get("answerable") is False
            and not r.get("insufficient_evidence_behavior")
            and r.get("wrong_subject_ok") is not True
        )
    ][:8]
    save_json(report, latest_path)
    save_json(report, reports_dir / f"{eval_id}.json")
    # Pointer for current attributed eval
    (reports_dir / "LATEST_DOMAIN_RETRIEVAL_EVAL.txt").write_text(eval_id, encoding="utf-8")
    print(
        json.dumps(
            {
                "evaluation_id": eval_id,
                "corpus_version": corpus_version,
                "index_sha256": index_sha,
                "n_documents": report["n_documents"],
                "n_chunks": report["n_chunks"],
                "hit_at_3": report["hit_at_3"],
                "recall_at_3_micro": report["recall_at_3_micro"],
            },
            indent=2,
        )
    )
    return report


if __name__ == "__main__":
    main()
