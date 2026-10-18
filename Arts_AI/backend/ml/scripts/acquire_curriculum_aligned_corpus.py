"""Acquire supplemental CC BY-SA extracts mapped to *canonical* curriculum topic IDs.

Wikipedia remains supplemental — not a complete A/L teaching corpus.
NIE PDFs are not ingested as teaching text (permission unclear).
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from arts_ai.common.hashing import file_sha256
from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths
from arts_ai.curriculum.registry import CURRICULUM_VERSION

UA = "ArtsAI-ResearchBot/0.1 (local educational research; curriculum-aligned supplemental)"

# Supplemental CC sources mapped to canonical topic_ids from nie_al_arts_provisional_v0.1
DOCS = [
    {
        "document_id": "wiki_en_anuradhapura",
        "wiki_title": "Anuradhapura",
        "subject_id": "sub_history",
        "topic_id": "hist_sl_rajarata_politics",
        "learning_outcomes_supported": ["Analyse rise/fall of Anuradhapura and Polonnaruwa politics"],
        "title": "Anuradhapura (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_polonnaruwa",
        "wiki_title": "Polonnaruwa",
        "subject_id": "sub_history",
        "topic_id": "hist_sl_rajarata_politics",
        "learning_outcomes_supported": ["Analyse rise/fall of Anuradhapura and Polonnaruwa politics"],
        "title": "Polonnaruwa (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_buddhism_sri_lanka",
        "wiki_title": "Buddhism_in_Sri_Lanka",
        "subject_id": "sub_history",
        "topic_id": "hist_sl_buddhism",
        "learning_outcomes_supported": ["Explain establishment of Buddhism and socio-cultural change"],
        "title": "Buddhism in Sri Lanka (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_physical_geography",
        "wiki_title": "Physical_geography",
        "subject_id": "sub_geography",
        "topic_id": "geo_physical_nature",
        "learning_outcomes_supported": ["Demonstrate competency related to: Nature of Physical Geography"],
        "title": "Physical geography (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_urbanization",
        "wiki_title": "Urbanization",
        "subject_id": "sub_geography",
        "topic_id": "geo_settlement_urban",
        "learning_outcomes_supported": ["Demonstrate competency related to: Settlement and urbanization"],
        "title": "Urbanization (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_supply_demand",
        "wiki_title": "Supply_and_demand",
        "subject_id": "sub_economics",
        "topic_id": "eco_demand_supply",
        "learning_outcomes_supported": ["Demonstrate understanding of: Demand, supply and markets"],
        "title": "Supply and demand (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_opportunity_cost",
        "wiki_title": "Opportunity_cost",
        "subject_id": "sub_economics",
        "topic_id": "eco_scarcity_choice",
        "learning_outcomes_supported": ["Demonstrate understanding of: Scarcity, choice and opportunity cost"],
        "title": "Opportunity cost (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_forms_of_government",
        "wiki_title": "List_of_forms_of_government",
        "subject_id": "sub_political",
        "topic_id": "pol_forms_gov",
        "learning_outcomes_supported": ["Demonstrate understanding of: Forms of government"],
        "title": "Forms of government (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_political_ideology",
        "wiki_title": "Political_ideology",
        "subject_id": "sub_political",
        "topic_id": "pol_ideologies",
        "learning_outcomes_supported": ["Demonstrate understanding of: Political ideologies"],
        "title": "Political ideology (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_prehistory_sri_lanka",
        "wiki_title": "Prehistory_of_Sri_Lanka",
        "subject_id": "sub_history",
        "topic_id": "hist_sl_prehistoric",
        "learning_outcomes_supported": ["Describe pre-historic eras and early Aryan settlements"],
        "title": "Prehistory of Sri Lanka (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_climate_sri_lanka",
        "wiki_title": "Climate_of_Sri_Lanka",
        "subject_id": "sub_geography",
        "topic_id": "geo_climate",
        "learning_outcomes_supported": ["Demonstrate competency related to: Climate systems"],
        "title": "Climate of Sri Lanka (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_state_polity",
        "wiki_title": "State_(polity)",
        "subject_id": "sub_political",
        "topic_id": "pol_state",
        "learning_outcomes_supported": ["Demonstrate understanding of: The State"],
        "title": "State (polity) (Wikipedia extract)",
    },
    {
        "document_id": "wiki_en_national_income",
        "wiki_title": "National_income",
        "subject_id": "sub_economics",
        "topic_id": "eco_national_income",
        "learning_outcomes_supported": [
            "Demonstrate understanding of: National income and macroeconomic indicators"
        ],
        "title": "National income (Wikipedia extract)",
    },
]


def fetch_extract(title: str, max_attempts: int = 3) -> dict:
    """Fetch a Wikipedia extract with bounded retries on HTTP 429."""
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
        {
            "action": "query",
            "prop": "extracts",
            "explaintext": "1",
            "redirects": "1",
            "titles": title.replace("_", " "),
            "format": "json",
        }
    )
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            page = next(iter(data["query"]["pages"].values()))
            if "missing" in page or not page.get("extract"):
                raise RuntimeError(f"missing extract: {title}")
            text = page["extract"].strip()
            if len(text) > 10000:
                text = text[:10000].rsplit("\n", 1)[0] + "\n\n[Extract truncated for local indexing.]"
            return {
                "pageid": page.get("pageid"),
                "title": page.get("title"),
                "text": text,
                "url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
            }
        except Exception as e:  # noqa: BLE001 — bounded retry then re-raise
            last_err = e
            if "429" not in str(e) and not isinstance(e, urllib.error.HTTPError):
                raise
            if attempt >= max_attempts:
                break
            time.sleep(8 * attempt)
    assert last_err is not None
    raise last_err


def main() -> dict:
    pending = get_paths().arts_content / "approved_pending"
    pending.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    acquired = []
    errors = []
    for spec in DOCS:
        try:
            page = fetch_extract(spec["wiki_title"])
            out = pending / f"{spec['document_id']}.txt"
            out.write_text(page["text"], encoding="utf-8")
            meta = {
                "document_id": spec["document_id"],
                "title": spec["title"],
                "source_url": page["url"],
                "publisher_author": "Wikipedia contributors",
                "publication_version": f"pageid={page['pageid']}",
                "curriculum_version": CURRICULUM_VERSION,
                "subject_id": spec["subject_id"],
                "topic_id": spec["topic_id"],
                "grade_year": "A/L",
                "language": "en",
                "acquisition_timestamp_utc": now,
                "file_hash": file_sha256(out),
                "usage_permission_or_license": "CC-BY-SA-4.0",
                "usage_permitted": True,
                "license_attribution_required": True,
                "modification_notes": "Plaintext extract truncated for local research indexing",
                "learning_outcomes_supported": spec["learning_outcomes_supported"],
                "curriculum_mapping_basis": "manual_map_to_canonical_topic_id_provisional_registry",
                "content_review_status": "unreviewed",
                "review_status": "unreviewed",
                "teacher_reviewed": False,
                "curriculum_relevance_checked": True,
                "extraction_method": "wikipedia_mediawiki_api_plaintext_extract",
                "extraction_quality_status": "ok",
                "data_origin": "authentic_public_cc_by_sa_supplemental",
                "role": "supplemental_not_complete_al_teaching_corpus",
                "acquired": True,
            }
            (pending / f"{spec['document_id']}.txt.meta.json").write_text(
                json.dumps(meta, indent=2), encoding="utf-8"
            )
            acquired.append({"document_id": spec["document_id"], "topic_id": spec["topic_id"]})
        except Exception as e:  # noqa: BLE001
            errors.append({"document_id": spec["document_id"], "error": str(e)})

    # Remap existing wiki docs to canonical topic IDs if still on legacy IDs
    remaps = {
        "wiki_en_sri_lanka_history": "hist_sl_colonial_modern",
        "wiki_en_geography_sri_lanka": "geo_basic_concepts",
        "wiki_en_economics": "eco_intro",
        "wiki_en_politics_sri_lanka": "pol_international",
    }
    arts = get_paths().arts_content
    for folder in (pending, arts / "approved"):
        for did, tid in remaps.items():
            meta_p = folder / f"{did}.txt.meta.json"
            if not meta_p.exists():
                meta_p = folder / f"{did}.meta.json"
            if meta_p.exists():
                meta = json.loads(meta_p.read_text(encoding="utf-8"))
                meta["topic_id"] = tid
                meta["curriculum_version"] = CURRICULUM_VERSION
                meta["curriculum_mapping_basis"] = "remapped_from_legacy_synthetic_slot_to_canonical"
                meta["role"] = "supplemental_not_complete_al_teaching_corpus"
                meta_p.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    report = {
        "generated_at_utc": now,
        "curriculum_version": CURRICULUM_VERSION,
        "n_acquired": len(acquired),
        "acquired": acquired,
        "errors": errors,
        "note": "Supplemental CC BY-SA only; not complete A/L syllabus teaching coverage; unreviewed",
    }
    save_json(report, get_paths().reports / "c4_curriculum_aligned_acquisition.json")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()
