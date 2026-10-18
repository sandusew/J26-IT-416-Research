"""Build topic_source_map.json for in-scope English Arts topics (excl. Sinhala lit)."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REG = ROOT / "data/curriculum/nie_al_arts_provisional_v0.1_registry.json"
OUT = ROOT / "data/arts_content/practice/topic_source_map.json"

WIKI = {
    "hist_sl_sources": ["Historiography_of_Sri_Lanka", "Mahavamsa", "Culavamsa"],
    "hist_sl_geography": ["Geography_of_Sri_Lanka"],
    "hist_sl_prehistoric": ["Prehistory_of_Sri_Lanka", "Balangoda_Man"],
    "hist_sl_buddhism": ["Buddhism_in_Sri_Lanka", "Mahinda_(Buddhist_monk)"],
    "hist_sl_rajarata_politics": ["Anuradhapura", "Polonnaruwa", "Rajarata"],
    "hist_sl_rajarata_society": ["Anuradhapura", "Irrigation_in_Sri_Lanka"],
    "hist_sl_post_polonnaruwa": [
        "Kingdom_of_Dambadeniya",
        "Kingdom_of_Kotte",
        "Kingdom_of_Sitawaka",
    ],
    "hist_sl_colonial_modern": [
        "History_of_Sri_Lanka",
        "British_Ceylon",
        "Sri_Lankan_independence_movement",
    ],
    "hist_in_sources": ["Historiography_of_India", "Puranas", "Edicts_of_Ashoka"],
    "hist_in_geography": ["Geography_of_India", "Indo-Gangetic_Plain", "Deccan_Plateau"],
    "hist_in_indus_vedic": ["Indus_Valley_Civilisation", "Vedic_period", "Rigveda"],
    "hist_eu_civilization": ["History_of_Europe", "Ancient_Greece", "Roman_Empire"],
    "hist_eu_modern": ["Early_modern_Europe", "Industrial_Revolution", "French_Revolution"],
    "hist_mw_since_1500": ["Early_modern_period", "Age_of_Discovery", "Cold_War"],
    "geo_basic_concepts": ["Geography", "Human_geography", "Physical_geography"],
    "geo_physical_nature": ["Physical_geography", "Geomorphology", "Hydrology"],
    "geo_landforms": ["Landform", "Mountain", "Plateau"],
    "geo_climate": ["Climate", "Climate_of_Sri_Lanka", "Monsoon"],
    "geo_population": ["Demography", "Population_of_Sri_Lanka"],
    "geo_settlement_urban": ["Urbanization", "Settlement_geography"],
    "geo_agriculture": ["Agriculture", "Agriculture_in_Sri_Lanka"],
    "geo_practical_maps": ["Cartography", "Map_projection", "Topographic_map"],
    "pol_nature": ["Political_science", "Politics"],
    "pol_subfields": ["Political_science", "Comparative_politics", "International_relations"],
    "pol_state": ["State_(polity)", "Sovereignty", "Nation_state"],
    "pol_forms_gov": ["Form_of_government", "Democracy", "Republic"],
    "pol_ideologies": ["Political_ideology", "Liberalism", "Socialism"],
    "pol_conflict": ["Conflict_resolution", "Peacebuilding"],
    "pol_colonial": ["British_Ceylon", "Colonialism"],
    "pol_westminster": ["Westminster_system", "Parliament_of_Sri_Lanka"],
    "pol_democracy": ["Democracy", "Liberal_democracy", "Electoral_system"],
    "pol_comparative": ["Comparative_politics", "Presidential_system", "Parliamentary_system"],
    "pol_constitution_1978": [
        "Constitution_of_Sri_Lanka",
        "Sri_Lankan_Constitution_of_1978",
    ],
    "pol_parties": ["Political_party", "United_National_Party", "Sri_Lanka_Freedom_Party"],
    "pol_international": [
        "International_relations",
        "Foreign_relations_of_Sri_Lanka",
        "Non-Aligned_Movement",
    ],
    "pol_public_policy": ["Public_policy", "Policy_analysis"],
    "pol_citizen": ["Citizenship", "Political_culture", "Civic_engagement"],
    "eco_intro": ["Economics", "Microeconomics", "Macroeconomics"],
    "eco_scarcity_choice": ["Scarcity", "Opportunity_cost", "Production–possibility_frontier"],
    "eco_demand_supply": ["Supply_and_demand", "Market_(economics)"],
    "eco_national_income": ["National_income", "Gross_domestic_product"],
    "eco_money_banking": ["Money", "Bank", "Central_bank"],
    "eco_gov_policy": ["Fiscal_policy", "Monetary_policy"],
    "eco_intl_trade": ["International_trade", "Comparative_advantage", "Balance_of_trade"],
    "eco_development": ["Economic_development", "Economy_of_Sri_Lanka"],
}

EXISTING = {
    "hist_sl_rajarata_politics": ["wiki_en_anuradhapura", "wiki_en_polonnaruwa"],
    "hist_sl_buddhism": ["wiki_en_buddhism_sri_lanka"],
    "hist_sl_prehistoric": ["wiki_en_prehistory_sri_lanka"],
    "hist_sl_colonial_modern": ["wiki_en_sri_lanka_history"],
    "geo_basic_concepts": ["wiki_en_geography_sri_lanka"],
    "geo_physical_nature": ["wiki_en_physical_geography"],
    "geo_climate": ["wiki_en_climate_sri_lanka"],
    "geo_settlement_urban": ["wiki_en_urbanization"],
    "eco_intro": ["wiki_en_economics"],
    "eco_demand_supply": ["wiki_en_supply_demand"],
    "eco_scarcity_choice": ["wiki_en_opportunity_cost"],
    "eco_national_income": ["wiki_en_national_income"],
    "pol_forms_gov": ["wiki_en_forms_of_government"],
    "pol_ideologies": ["wiki_en_political_ideology"],
    "pol_international": ["wiki_en_politics_sri_lanka"],
    "pol_state": ["wiki_en_state_polity"],
}


def main() -> None:
    reg = json.loads(REG.read_text(encoding="utf-8"))
    topics = [t for t in reg["topics"] if t["subject_id"] != "sub_sinhala_lit"]
    out_topics = []
    for t in topics:
        tid = t["topic_id"]
        wiki = WIKI.get(tid, [t["topic_title"].replace(" ", "_")])
        concepts = [w.replace("_", " ").split("(")[0].strip() for w in wiki]
        # Expand with title tokens for question variety
        for token in t["topic_title"].replace("(", " ").replace(")", " ").split():
            if len(token) > 4 and token.lower() not in {c.lower() for c in concepts}:
                concepts.append(token)
        concepts = concepts[:12]
        los = t.get("learning_outcomes") or []
        objs = [
            {
                "text": lo,
                "label": "inferred_from_provisional_registry_structure_not_official_verbatim",
            }
            for lo in los
        ]
        if len(objs) < 2:
            objs.extend(
                [
                    {
                        "text": f"Explain core ideas of {t['topic_title']}",
                        "label": "inferred_not_official",
                    },
                    {
                        "text": f"Apply concepts from {t['topic_title']} using cited public sources",
                        "label": "inferred_not_official",
                    },
                ]
            )
        out_topics.append(
            {
                "topic_id": tid,
                "subject_id": t["subject_id"],
                "topic_title": t["topic_title"],
                "grade": t.get("grade"),
                "wiki_titles": wiki,
                "existing_document_ids": EXISTING.get(tid, []),
                "inferred_objectives": objs,
                "key_concepts": concepts,
                "misconceptions": [
                    f"{t['topic_title']} can be reduced to a single date or slogan",
                    f"Listing names alone demonstrates understanding of {t['topic_title']}",
                    f"{t['topic_title']} is isolated from other Arts subjects",
                ],
                "blocked": False,
                "prerequisite_topic_ids": t.get("prerequisite_topic_ids") or [],
            }
        )
    doc = {
        "curriculum_version": "nie_al_arts_provisional_v0.1",
        "medium": "english",
        "scope_note": (
            "Implementation assumption for local backend population; "
            "not stakeholder-approved complete national syllabus coverage; "
            "Sinhala Literature deferred; English medium only."
        ),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "n_topics": len(out_topics),
        "topics": out_topics,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(OUT), "n_topics": len(out_topics)}, indent=2))


if __name__ == "__main__":
    main()
