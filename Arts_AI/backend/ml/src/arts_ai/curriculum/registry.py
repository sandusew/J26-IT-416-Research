"""Canonical G.C.E. A/L Arts curriculum registry (provisional until proposal approved).

Syllabus PDFs are used as *structure references* only. Full NIE text is not treated as
licensed teaching content for the domain index.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arts_ai.common.hashing import file_sha256
from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths

CURRICULUM_VERSION = "nie_al_arts_provisional_v0.1"
SCOPE_STATUS = "provisional_awaiting_stakeholder_confirmation"

# Structure derived from NIE public syllabi (English titles). Not teacher-approved.
# prerequisite_topic_ids empty unless NIE document states a sequence; proposed prereqs
# go in separate field with basis=proposed_research_not_official.


def _topic(
    *,
    subject_id: str,
    subject_name: str,
    medium: str,
    grade: str,
    unit_id: str,
    unit_title: str,
    topic_id: str,
    topic_title: str,
    learning_outcomes: list[str],
    source_reference: str,
    source_page_or_section: str,
    prerequisite_topic_ids: list[str] | None = None,
    prerequisite_basis: str = "none_stated_in_nie_excerpt",
) -> dict[str, Any]:
    return {
        "curriculum_version": CURRICULUM_VERSION,
        "subject_id": subject_id,
        "subject_name": subject_name,
        "medium": medium,
        "grade": grade,
        "unit_id": unit_id,
        "unit_title": unit_title,
        "topic_id": topic_id,
        "topic_title": topic_title,
        "learning_outcomes": learning_outcomes,
        "source_reference": source_reference,
        "source_page_or_section": source_page_or_section,
        "prerequisite_topic_ids": prerequisite_topic_ids or [],
        "prerequisite_basis": prerequisite_basis,
        "scope_status": SCOPE_STATUS,
        "review_status": "structure_unreviewed",
    }


def build_registry_rows() -> list[dict[str, Any]]:
    hist = "https://nie.lk/pdffiles/tg/e12syl11.pdf"
    geo = "https://www.nie.lk/pdffiles/tg/eGr12TG%20Geography.pdf"
    pol = "https://www.nie.lk/pdffiles/tg/eALSyl%20Political.pdf"
    eco = "https://nie.lk/pdffiles/tg/e12syl49.pdf"

    rows: list[dict[str, Any]] = []

    # --- History: compulsory Sri Lanka track (Grade 12 competencies from NIE 2009 syllabus) ---
    hist_sl = [
        ("hist_sl_sources", "Sources for Sri Lankan history", "§3.1 competency 1.0", ["Use literary and archaeological sources critically"]),
        ("hist_sl_geography", "Geographical factors in Sri Lankan history", "§3.1 competency 2.0", ["Analyse geographical influence on civilization"]),
        ("hist_sl_prehistoric", "Pre-historic and early settlements", "§3.1 competency 3.0", ["Describe pre-historic eras and early Aryan settlements"]),
        ("hist_sl_buddhism", "Establishment and expansion of Buddhism", "§3.1 competency 4.0", ["Explain establishment of Buddhism and socio-cultural change"]),
        ("hist_sl_rajarata_politics", "Political evolution of Rajarata (Anuradhapura–Polonnaruwa)", "§3.1 competency 5.0", ["Analyse rise/fall of Anuradhapura and Polonnaruwa politics"]),
        ("hist_sl_rajarata_society", "Economy, irrigation and society of Rajarata", "§3.1 competency 6.0", ["Examine agriculture, irrigation, trade and culture"]),
        ("hist_sl_post_polonnaruwa", "Kingdoms after Polonnaruwa to 16th century", "§3.1 competency 7.0", ["Describe successor kingdoms and foreign relations"]),
        ("hist_sl_colonial_modern", "Colonial period to 1978 constitutional change", "syllabus intro / Grade 13 SL themes", ["Outline colonial transformation through 1978 executive presidency"]),
    ]
    for i, (tid, title, sec, los) in enumerate(hist_sl):
        prereq = [hist_sl[i - 1][0]] if i > 0 else []
        rows.append(
            _topic(
                subject_id="sub_history",
                subject_name="History",
                medium="english",
                grade="12" if i < 7 else "13",
                unit_id="hist_unit_sri_lanka",
                unit_title="History of Sri Lanka (compulsory)",
                topic_id=tid,
                topic_title=title,
                learning_outcomes=los,
                source_reference=hist,
                source_page_or_section=sec,
                prerequisite_topic_ids=prereq,
                prerequisite_basis="proposed_sequential_research_not_official_nie_rule" if prereq else "none_stated_in_nie_excerpt",
            )
        )

    # Elective tracks — structure only (one elective typically chosen at A/L)
    for tid, title, unit, sec in [
        ("hist_in_sources", "Sources for Indian history", "hist_unit_india", "§3.2"),
        ("hist_in_geography", "Geography and Indian history", "hist_unit_india", "§3.2"),
        ("hist_in_indus_vedic", "Indus and Vedic civilizations", "hist_unit_india", "§3.2"),
        ("hist_eu_civilization", "Forces shaping European civilization", "hist_unit_europe", "syllabus intro Europe"),
        ("hist_eu_modern", "Europe 1500–1989 selected themes", "hist_unit_europe", "syllabus intro Europe"),
        ("hist_mw_since_1500", "Modern world since 1500 (Asia/Africa/Europe/America)", "hist_unit_modern_world", "syllabus intro Modern World"),
    ]:
        rows.append(
            _topic(
                subject_id="sub_history",
                subject_name="History",
                medium="english",
                grade="12",
                unit_id=unit,
                unit_title=unit.replace("hist_unit_", "History elective: "),
                topic_id=tid,
                topic_title=title,
                learning_outcomes=[f"Demonstrate understanding of: {title}"],
                source_reference=hist,
                source_page_or_section=sec,
            )
        )

    # --- Geography Grade 12 (2017 TG structure: Physical / Human / Practical) ---
    for tid, title, unit, sec in [
        ("geo_basic_concepts", "Basic concepts of Geography", "geo_unit_intro", "Grade 12 TG contents"),
        ("geo_physical_nature", "Nature of Physical Geography", "geo_unit_physical", "Physical Geography"),
        ("geo_landforms", "Landforms / main relief types", "geo_unit_physical", "Physical Geography"),
        ("geo_climate", "Climate systems", "geo_unit_physical", "Physical Geography"),
        ("geo_population", "Population", "geo_unit_human", "Human Geography"),
        ("geo_settlement_urban", "Settlement and urbanization (incl. Sri Lanka)", "geo_unit_human", "Human Geography"),
        ("geo_agriculture", "World / regional agriculture", "geo_unit_human", "Human Geography"),
        ("geo_practical_maps", "Practical Geography and map skills", "geo_unit_practical", "Practical Geography"),
    ]:
        rows.append(
            _topic(
                subject_id="sub_geography",
                subject_name="Geography",
                medium="english",
                grade="12",
                unit_id=unit,
                unit_title=unit.replace("geo_unit_", "Geography: "),
                topic_id=tid,
                topic_title=title,
                learning_outcomes=[f"Demonstrate competency related to: {title}"],
                source_reference=geo,
                source_page_or_section=sec,
            )
        )

    # --- Political Science 15 topics (2017 syllabus narrative) ---
    pol_topics = [
        ("pol_nature", "Nature of Political Science, study of politics and approaches", "12", "Topics 1–2"),
        ("pol_subfields", "Political Science and its sub-fields", "12", "Topic 2"),
        ("pol_state", "The State", "12", "Topic 3"),
        ("pol_forms_gov", "Forms of government", "12", "Topic 4"),
        ("pol_ideologies", "Political ideologies", "12", "Topic 5"),
        ("pol_conflict", "Conflict and conflict resolution", "12", "Topic 6"),
        ("pol_colonial", "Colonial transformation of Sri Lanka", "12", "Topic 7"),
        ("pol_westminster", "Westminster model in Sri Lanka and changes", "12", "Topic 8"),
        ("pol_democracy", "Democratic governance — theory and practice", "13", "Grade 13 Topic 1"),
        ("pol_comparative", "Comparative models of government", "13", "Grade 13 comparative"),
        ("pol_constitution_1978", "Constitution of 1978 and selected amendments", "13", "1978 constitution themes"),
        ("pol_parties", "Political party system of Sri Lanka", "13", "Party system"),
        ("pol_international", "International politics and implications for Sri Lanka", "13", "International politics"),
        ("pol_public_policy", "Public policy (introductory)", "13", "syllabus narrative"),
        ("pol_citizen", "Citizenship and political values", "12", "Aims of teaching"),
    ]
    for tid, title, grade, sec in pol_topics:
        rows.append(
            _topic(
                subject_id="sub_political",
                subject_name="Political Science",
                medium="english",
                grade=grade,
                unit_id=f"pol_grade_{grade}",
                unit_title=f"Political Science Grade {grade}",
                topic_id=tid,
                topic_title=title,
                learning_outcomes=[f"Demonstrate understanding of: {title}"],
                source_reference=pol,
                source_page_or_section=sec,
            )
        )

    # --- Economics (revised syllabus 2012) — high-level units pending full page parse ---
    for tid, title, sec in [
        ("eco_intro", "Nature and scope of Economics", "Economics syllabus intro"),
        ("eco_scarcity_choice", "Scarcity, choice and opportunity cost", "core concepts"),
        ("eco_demand_supply", "Demand, supply and markets", "market analysis"),
        ("eco_national_income", "National income and macroeconomic indicators", "macro"),
        ("eco_money_banking", "Money, banking and financial system", "macro/finance"),
        ("eco_gov_policy", "Government economic policy", "policy"),
        ("eco_intl_trade", "International trade and finance", "external sector"),
        ("eco_development", "Economic development and Sri Lankan context", "development"),
    ]:
        rows.append(
            _topic(
                subject_id="sub_economics",
                subject_name="Economics",
                medium="english",
                grade="12",
                unit_id="eco_al_core",
                unit_title="Economics A/L core (structure provisional)",
                topic_id=tid,
                topic_title=title,
                learning_outcomes=[f"Demonstrate understanding of: {title}"],
                source_reference=eco,
                source_page_or_section=sec,
            )
        )

    # Sinhala Literature — in provisional synthetic list but domain deferred
    rows.append(
        _topic(
            subject_id="sub_sinhala_lit",
            subject_name="Sinhala Literature",
            medium="sinhala",
            grade="12",
            unit_id="si_lit_deferred",
            unit_title="Sinhala Literature (structure pending official syllabus intake)",
            topic_id="si_lit_placeholder",
            topic_title="Placeholder — official unit list not yet registered",
            learning_outcomes=[],
            source_reference="PENDING_official_sinhala_literature_syllabus",
            source_page_or_section="n/a",
        )
    )
    return rows


def synthetic_topic_mappings(registry: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map legacy generated topic IDs; do not silently rename training labels."""
    # Provisional synthetic used generic Topic 1..8 per subject
    mappings = []
    by_subject: dict[str, list[dict[str, Any]]] = {}
    for r in registry:
        if r["topic_id"] == "si_lit_placeholder":
            continue
        by_subject.setdefault(r["subject_id"], []).append(r)

    legacy = {
        "sub_history": [f"sub_history_t{i:02d}" for i in range(8)],
        "sub_geography": [f"sub_geography_t{i:02d}" for i in range(8)],
        "sub_economics": [f"sub_economics_t{i:02d}" for i in range(8)],
        "sub_political": [f"sub_political_t{i:02d}" for i in range(8)],
        "sub_sinhala_lit": [f"sub_sinhala_lit_t{i:02d}" for i in range(8)],
    }
    for sid, old_ids in legacy.items():
        canon = by_subject.get(sid) or []
        for i, old in enumerate(old_ids):
            if sid == "sub_sinhala_lit":
                mappings.append(
                    {
                        "legacy_topic_id": old,
                        "canonical_topic_id": None,
                        "status": "unmapped",
                        "note": "Sinhala Literature canonical units pending official syllabus registration",
                    }
                )
                continue
            if i < len(canon):
                mappings.append(
                    {
                        "legacy_topic_id": old,
                        "canonical_topic_id": canon[i]["topic_id"],
                        "canonical_title": canon[i]["topic_title"],
                        "status": "partial_match",
                        "note": "Ordinal slot mapping from provisional generated Topic N — not name-equivalent; requires teacher review",
                    }
                )
            else:
                mappings.append(
                    {
                        "legacy_topic_id": old,
                        "canonical_topic_id": None,
                        "status": "unmapped",
                        "note": "No ordinal canonical slot",
                    }
                )
    return mappings


def write_registry() -> dict[str, Any]:
    root = get_paths().data / "curriculum"
    root.mkdir(parents=True, exist_ok=True)
    rows = build_registry_rows()
    mappings = synthetic_topic_mappings(rows)
    payload = {
        "curriculum_version": CURRICULUM_VERSION,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "scope_status": SCOPE_STATUS,
        "n_topics": len(rows),
        "subjects": sorted({r["subject_id"] for r in rows}),
        "note": (
            "PROVISIONAL. Approved proposal missing from repo. "
            "Structure titles from NIE public syllabi; not teacher-reviewed; "
            "not full Arts stream coverage."
        ),
        "topics": rows,
        "legacy_topic_mappings": mappings,
    }
    out = root / f"{CURRICULUM_VERSION}_registry.json"
    save_json(payload, out)
    (root / "LATEST_CURRICULUM.txt").write_text(CURRICULUM_VERSION, encoding="utf-8")
    save_json(
        {
            "curriculum_version": CURRICULUM_VERSION,
            "registry_path": f"backend/ml/data/curriculum/{out.name}",
            "registry_sha256": file_sha256(out),
            "n_topics": len(rows),
            "n_legacy_mappings": len(mappings),
            "mapping_status_counts": {
                s: sum(1 for m in mappings if m["status"] == s)
                for s in ("exact_match", "reviewed_equivalent", "partial_match", "unmapped")
            },
        },
        get_paths().reports / "curriculum_registry_build.json",
    )
    return payload


def load_registry() -> dict[str, Any]:
    root = get_paths().data / "curriculum"
    ptr = root / "LATEST_CURRICULUM.txt"
    if not ptr.exists():
        return write_registry()
    ver = ptr.read_text(encoding="utf-8").strip()
    path = root / f"{ver}_registry.json"
    if not path.exists():
        return write_registry()
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_topic_ids() -> set[str]:
    reg = load_registry()
    return {t["topic_id"] for t in reg.get("topics", []) if t.get("topic_id")}


if __name__ == "__main__":
    p = write_registry()
    print(json.dumps({"curriculum_version": p["curriculum_version"], "n_topics": p["n_topics"]}, indent=2))
