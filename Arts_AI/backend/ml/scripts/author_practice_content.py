"""Acquire grounding sources and author AI source-grounded practice packages + questions.

Resumable: skips topics that already have a completed package manifest.
Does not claim teacher review or official past-paper status.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRACTICE = ROOT / "data/arts_content/practice"
APPROVED = ROOT / "data/arts_content/approved"
PENDING = ROOT / "data/arts_content/approved_pending"
SOURCES = PRACTICE / "sources"
PACKAGES = PRACTICE / "packages"
BATCHES = PRACTICE / "batches"
MAP_PATH = PRACTICE / "topic_source_map.json"
PROGRESS = PRACTICE / "authoring_progress.json"
UA = "ArtsAI-ResearchBot/0.1 (local educational research; practice content grounding)"
CURRICULUM = "nie_al_arts_provisional_v0.1"


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def load_json(p: Path, default):
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return default


def save_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


def fetch_wiki_extract(title: str, max_attempts: int = 3) -> dict:
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
            if "missing" in page or not (page.get("extract") or "").strip():
                raise RuntimeError(f"missing extract: {title}")
            text = page["extract"].strip()
            if len(text) > 12000:
                text = text[:12000].rsplit("\n", 1)[0] + "\n\n[Extract truncated.]"
            return {
                "pageid": page.get("pageid"),
                "title": page.get("title"),
                "text": text,
                "url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}",
                "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt >= max_attempts:
                break
            time.sleep(4 * attempt)
    assert last_err is not None
    raise last_err


def load_local_doc(doc_id: str) -> tuple[str, dict] | None:
    for folder, meta_suffix in (
        (APPROVED, ".meta.json"),
        (PENDING, ".txt.meta.json"),
        (PENDING, ".meta.json"),
    ):
        txt = folder / f"{doc_id}.txt"
        meta_p = folder / f"{doc_id}{meta_suffix}"
        if not meta_p.exists():
            meta_p = folder / f"{doc_id}.meta.json"
        if txt.exists():
            meta = json.loads(meta_p.read_text(encoding="utf-8")) if meta_p.exists() else {}
            return txt.read_text(encoding="utf-8"), meta
    return None


def paragraphs(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    # Prefer informative paragraphs
    scored = []
    for p in parts:
        if len(p) < 80:
            continue
        if p.startswith("==") or p.startswith("["):
            continue
        scored.append(p)
    return scored


def sentences(text: str) -> list[str]:
    bits = re.split(r"(?<=[.!?])\s+", text)
    out = []
    for s in bits:
        s = s.strip()
        if 60 <= len(s) <= 280 and not s.startswith("=="):
            out.append(s)
    return out


def acquire_sources_for_topic(topic: dict) -> list[dict]:
    sources = []
    # Prefer existing local docs
    for doc_id in topic.get("existing_document_ids") or []:
        loaded = load_local_doc(doc_id)
        if not loaded:
            continue
        text, meta = loaded
        sources.append(
            {
                "source_id": doc_id,
                "title": meta.get("title") or doc_id,
                "publisher_author": meta.get("publisher_author") or "Wikipedia contributors",
                "url": meta.get("source_url"),
                "retrieved_at_utc": meta.get("acquisition_timestamp_utc")
                or datetime.now(timezone.utc).isoformat(),
                "edition_or_revision": meta.get("publication_version"),
                "subject_id": topic["subject_id"],
                "topic_id": topic["topic_id"],
                "language": "en",
                "licence": meta.get("usage_permission_or_license") or "CC-BY-SA-4.0",
                "permission_evidence": "CC-BY-SA-4.0 Wikipedia extract already acquired locally",
                "role": "supplemental_teaching_material",
                "official_curriculum_reference": False,
                "local_checksum": sha256_text(text),
                "text": text,
                "origin": "local_approved_or_pending",
            }
        )
    # Fetch additional wiki titles not already covered
    have_titles = { (s.get("title") or "").lower() for s in sources }
    for title in topic.get("wiki_titles") or []:
        nice = title.replace("_", " ")
        if nice.lower() in have_titles:
            continue
        cache = SOURCES / f"wiki_{re.sub(r'[^a-zA-Z0-9]+', '_', title).strip('_').lower()}.json"
        if cache.exists():
            page = json.loads(cache.read_text(encoding="utf-8"))
        else:
            try:
                page = fetch_wiki_extract(title)
                save_json(cache, {k: v for k, v in page.items()})
                time.sleep(0.6)
            except Exception as e:  # noqa: BLE001
                sources.append(
                    {
                        "source_id": f"blocked_{title}",
                        "error": str(e),
                        "blocked": True,
                    }
                )
                continue
        text = page["text"]
        sid = f"wiki_en_{re.sub(r'[^a-z0-9]+', '_', title.lower()).strip('_')}"
        sources.append(
            {
                "source_id": sid,
                "title": page.get("title") or nice,
                "publisher_author": "Wikipedia contributors",
                "url": page.get("url"),
                "retrieved_at_utc": page.get("retrieved_at_utc"),
                "edition_or_revision": f"pageid={page.get('pageid')}",
                "subject_id": topic["subject_id"],
                "topic_id": topic["topic_id"],
                "language": "en",
                "licence": "CC-BY-SA-4.0",
                "permission_evidence": "CC-BY-SA-4.0; attribution required; local truncated extract",
                "role": "supplemental_teaching_material",
                "official_curriculum_reference": False,
                "local_checksum": sha256_text(text),
                "text": text,
                "origin": "wikipedia_api",
            }
        )
        have_titles.add((page.get("title") or nice).lower())
    return sources


def build_package(topic: dict, sources: list[dict]) -> dict | None:
    usable = [s for s in sources if not s.get("blocked") and (s.get("text") or "").strip()]
    if not usable:
        return None
    combined = "\n\n".join(s["text"] for s in usable)
    paras = paragraphs(combined)
    if len(paras) < 3:
        # Fall back to sentence chunks
        sents = sentences(combined)
        paras = [" ".join(sents[i : i + 3]) for i in range(0, min(9, len(sents)), 3)]
    if len(paras) < 3:
        return None

    sections = []
    labels = [
        "Core concepts and definitions",
        "Historical or systematic development",
        "Applications, evidence, and Sri Lankan / comparative context",
    ]
    for i, label in enumerate(labels):
        body = paras[i] if i < len(paras) else paras[-1]
        # Attach a second paragraph when available for substance
        if i + 3 < len(paras):
            body = body + "\n\n" + paras[i + 3]
        src = usable[i % len(usable)]
        sections.append(
            {
                "heading": label,
                "text": body.strip(),
                "source_ids": [src["source_id"]],
                "source_url": src.get("url"),
            }
        )

    # Key terms: pick capitalized multi-word or concept list with short defs from first sentence mentioning them
    terms = []
    for concept in topic.get("key_concepts") or []:
        definition = None
        for s in sentences(combined):
            if concept.lower() in s.lower():
                definition = s
                break
        if not definition:
            definition = (
                f"{concept}: a key idea for {topic['topic_title']} "
                f"(see cited sources; AI-authored gloss)."
            )
        terms.append({"term": concept, "definition": definition, "source_ids": [usable[0]["source_id"]]})
        if len(terms) >= 8:
            break

    overview = (
        f"This AI-authored practice package supports the provisional topic "
        f"「{topic['topic_title']}」 ({topic['topic_id']}) for English-medium study. "
        f"Explanations are grounded in openly licensed public encyclopedia extracts "
        f"and are not teacher-reviewed syllabus notes or official NIE teaching text.\n\n"
        f"{paras[0][:900]}"
    )

    worked = (
        f"Worked application: Using the cited sources, identify one concrete example "
        f"related to {topic['topic_title']}, state the concept it illustrates, and "
        f"note one limitation of the source (e.g. encyclopedia summary depth). "
        f"Do not invent dates or quotations absent from the cited passages."
    )
    revision = (
        "Revision summary: (1) Restate the topic focus in one sentence. "
        "(2) List three key terms with definitions tied to sources. "
        "(3) Name one misconception and why it is misleading. "
        "(4) Cite at least one source URL used above."
    )

    package_text_parts = [
        f"# {topic['topic_title']}",
        "",
        "## Content provenance",
        "content_origin=ai_authored_source_grounded; human_review=unreviewed; not a test fixture.",
        "",
        "## Overview",
        overview,
        "",
        "## Learning objectives (inferred — not official NIE verbatim extracts)",
    ]
    for obj in topic.get("inferred_objectives") or []:
        package_text_parts.append(f"- [{obj.get('label')}] {obj.get('text')}")
    for sec in sections:
        package_text_parts.extend(["", f"## {sec['heading']}", sec["text"], f"(Source: {sec['source_url'] or sec['source_ids']})"])
    package_text_parts.extend(["", "## Key terms"])
    for t in terms:
        package_text_parts.append(f"- **{t['term']}**: {t['definition']}")
    package_text_parts.extend(
        [
            "",
            "## Worked example / application",
            worked,
            "",
            "## Common misconceptions",
        ]
    )
    for m in topic.get("misconceptions") or []:
        package_text_parts.append(f"- {m}")
    package_text_parts.extend(["", "## Revision summary", revision, "", "## Source references"])
    for s in usable:
        package_text_parts.append(
            f"- {s['source_id']}: {s.get('title')} — {s.get('url')} "
            f"(licence {s.get('licence')}; retrieved {s.get('retrieved_at_utc')}; "
            f"checksum {s.get('local_checksum')[:12]}…)"
        )

    body = "\n".join(package_text_parts)
    return {
        "topic_id": topic["topic_id"],
        "subject_id": topic["subject_id"],
        "topic_title": topic["topic_title"],
        "grade": topic.get("grade") or "12",
        "language": "en",
        "content_origin": "ai_authored_source_grounded",
        "human_review": "unreviewed",
        "is_test_fixture": False,
        "body_text": body,
        "sections": sections,
        "key_terms": terms,
        "source_ids": [s["source_id"] for s in usable],
        "sources_meta": [{k: v for k, v in s.items() if k != "text"} for s in usable],
        "content_hash": sha256_text(body),
        "authored_at_utc": datetime.now(timezone.utc).isoformat(),
    }


def _option_ids(options: list[str]) -> list[dict]:
    return [{"optionId": f"opt_{i+1}", "text": o} for i, o in enumerate(options)]


def generate_questions(topic: dict, package: dict, sources: list[dict]) -> list[dict]:
    usable = [s for s in sources if not s.get("blocked") and s.get("text")]
    pool_sents = []
    for s in usable:
        for sent in sentences(s["text"]):
            pool_sents.append((sent, s["source_id"], s.get("url")))
    # Deduplicate near-identical starts
    seen = set()
    uniq = []
    for sent, sid, url in pool_sents:
        key = sent[:50].lower()
        if key in seen:
            continue
        seen.add(key)
        uniq.append((sent, sid, url))
    questions = []
    concepts = topic.get("key_concepts") or [topic["topic_title"]]
    misconceptions = topic.get("misconceptions") or []

    # Q1–Q8: MCQ from sentences / concepts
    for i in range(12):
        qid = f"prac_{topic['topic_id']}_q{i+1:02d}"
        if i < 8 and uniq:
            sent, sid, url = uniq[i % len(uniq)]
            # Build stem that asks for a grounded fact without leaking full answer awkwardly
            concept = concepts[i % len(concepts)]
            correct = concept
            distractors = [
                concepts[(i + 1) % len(concepts)],
                concepts[(i + 2) % len(concepts)],
                misconceptions[i % len(misconceptions)][:80]
                if misconceptions
                else f"Unrelated claim about {topic['topic_title']}",
            ]
            # Ensure distractors != correct and unique
            opts = []
            for o in [correct] + distractors:
                o = str(o).strip()
                if o and o not in opts:
                    opts.append(o)
            while len(opts) < 4:
                opts.append(f"Option filler {len(opts)+1} for {topic['topic_id']} (invalid if selected)")
            opts = opts[:4]
            # Rotate correct position
            rot = i % 4
            opts = opts[rot:] + opts[:rot]
            # After rotate, correct text still `correct`
            explanation = (
                f"According to source-grounded materials for {topic['topic_title']}, "
                f"the supported answer is «{correct}». Supporting passage: {sent} "
                f"(source_id={sid}). This is an AI-authored practice item, not a past paper."
            )
            # Prefer asking which concept the passage supports when concept appears in sentence
            if correct.lower() in sent.lower():
                prompt = (
                    f"[{topic['topic_title']}] Which concept is directly supported by this "
                    f"source-grounded statement: «{sent[:180]}{'…' if len(sent)>180 else ''}»?"
                )
            else:
                prompt = (
                    f"[{topic['topic_title']}] Based on the cited public sources for this topic, "
                    f"which concept best matches the focus of the teaching package section "
                    f"discussing: «{sent[:160]}{'…' if len(sent)>160 else ''}»?"
                )
                # If concept not in sentence, use a safer correct answer drawn from sentence subject
                # Keep correct as concept only if we attach explanation honesty
                explanation = (
                    f"AI-authored practice item. The teaching package emphasises «{correct}» "
                    f"for {topic['topic_title']}. Related source passage ({sid}): {sent}"
                )
            questions.append(
                {
                    "questionId": qid,
                    "version": "1",
                    "curriculumVersion": CURRICULUM,
                    "subjectId": topic["subject_id"],
                    "topicId": topic["topic_id"],
                    "language": "en",
                    "grade": str(topic.get("grade") or "12"),
                    "questionType": "mcq",
                    "prompt": prompt,
                    "options": opts,
                    "optionIds": _option_ids(opts),
                    "correctAnswerOrRubric": correct if correct in opts else opts[0],
                    "explanation": explanation,
                    "maxMarks": 1,
                    "difficulty": round(0.25 + (i % 5) * 0.12, 2),
                    "difficultyBasis": "author_estimate",
                    "sourceReference": url or sid,
                    "sourceIds": [sid],
                    "supportingPassages": [{"source_id": sid, "passage": sent, "url": url}],
                    "provenance": "ai_authored_source_grounded_practice_not_past_paper",
                    "contentOrigin": "ai_authored_source_grounded",
                    "permissionStatus": "ai_authored_with_cc_by_sa_source_attribution",
                    "mappingBasis": "inferred_provisional_registry_topic",
                    "mappingStatus": "canonical_direct",
                    "mappingConfidence": "medium_inferred",
                    "reviewStatus": "draft",
                    "humanReviewStatus": "unreviewed",
                    "automatedValidation": "pending",
                    "learnerAvailability": "draft",
                    "isTestFixture": False,
                    "dataOrigin": "ai_authored_practice_bank_v1",
                    "learningOutcomeId": (topic.get("inferred_objectives") or [{}])[0].get("text"),
                }
            )
        elif i < 10:
            # True/false misconception
            claim = misconceptions[i % len(misconceptions)] if misconceptions else "This topic has no sources."
            prompt = (
                f"[{topic['topic_id']} Q{i+1}] True or false: «{claim}» is a sound way to understand "
                f"{topic['topic_title']}."
            )
            questions.append(
                {
                    "questionId": qid,
                    "version": "1",
                    "curriculumVersion": CURRICULUM,
                    "subjectId": topic["subject_id"],
                    "topicId": topic["topic_id"],
                    "language": "en",
                    "grade": str(topic.get("grade") or "12"),
                    "questionType": "true_false",
                    "prompt": prompt,
                    "options": ["True", "False"],
                    "optionIds": _option_ids(["True", "False"]),
                    "correctAnswerOrRubric": "False",
                    "explanation": (
                        f"False — this is listed as a common misconception for "
                        f"{topic['topic_title']} in the AI-authored package. "
                        f"Prefer source-grounded explanations over slogans."
                    ),
                    "maxMarks": 1,
                    "difficulty": 0.35,
                    "difficultyBasis": "author_estimate",
                    "sourceReference": package["source_ids"][0],
                    "sourceIds": package["source_ids"][:2],
                    "supportingPassages": [],
                    "provenance": "ai_authored_source_grounded_practice_not_past_paper",
                    "contentOrigin": "ai_authored_source_grounded",
                    "permissionStatus": "ai_authored_with_cc_by_sa_source_attribution",
                    "mappingBasis": "inferred_provisional_registry_topic",
                    "mappingStatus": "canonical_direct",
                    "mappingConfidence": "medium_inferred",
                    "reviewStatus": "draft",
                    "humanReviewStatus": "unreviewed",
                    "automatedValidation": "pending",
                    "learnerAvailability": "draft",
                    "isTestFixture": False,
                    "dataOrigin": "ai_authored_practice_bank_v1",
                }
            )
        else:
            # Short identification (unique prompt per index)
            concept = concepts[i % len(concepts)]
            alt = concepts[(i + 3) % len(concepts)]
            prompt = (
                f"[{topic['topic_id']} Q{i+1}] In one short phrase, name the package key concept "
                f"closest to «{concept}» (not «{alt}») for {topic['topic_title']}."
            )
            questions.append(
                {
                    "questionId": qid,
                    "version": "1",
                    "curriculumVersion": CURRICULUM,
                    "subjectId": topic["subject_id"],
                    "topicId": topic["topic_id"],
                    "language": "en",
                    "grade": str(topic.get("grade") or "12"),
                    "questionType": "short_answer",
                    "prompt": prompt,
                    "options": None,
                    "correctAnswerOrRubric": concept,
                    "explanation": (
                        f"Accepted focus concept from the package: {concept}. "
                        f"AI-authored practice — not teacher-marked exam material."
                    ),
                    "maxMarks": 1,
                    "difficulty": 0.4,
                    "difficultyBasis": "author_estimate",
                    "sourceReference": package["source_ids"][0],
                    "sourceIds": package["source_ids"][:2],
                    "provenance": "ai_authored_source_grounded_practice_not_past_paper",
                    "contentOrigin": "ai_authored_source_grounded",
                    "permissionStatus": "ai_authored_with_cc_by_sa_source_attribution",
                    "mappingBasis": "inferred_provisional_registry_topic",
                    "mappingStatus": "canonical_direct",
                    "mappingConfidence": "medium_inferred",
                    "reviewStatus": "draft",
                    "humanReviewStatus": "unreviewed",
                    "automatedValidation": "pending",
                    "learnerAvailability": "draft",
                    "isTestFixture": False,
                    "dataOrigin": "ai_authored_practice_bank_v1",
                }
            )

    # Fix MCQ correct answers to always be in options
    for q in questions:
        if q["questionType"] == "mcq":
            if q["correctAnswerOrRubric"] not in q["options"]:
                q["correctAnswerOrRubric"] = q["options"][0]
                q["explanation"] += " [auto-aligned correct option to options list]"
    return questions[:12]


def validate_question(q: dict, prompts_seen: set[str]) -> list[str]:
    errs = []
    if q.get("isTestFixture"):
        errs.append("must_not_be_fixture")
    if q.get("contentOrigin") != "ai_authored_source_grounded":
        errs.append("bad_content_origin")
    if q.get("humanReviewStatus") == "teacher_approved":
        errs.append("cannot_self_claim_teacher_approval")
    if q.get("reviewStatus") == "approved_for_learner":
        errs.append("cannot_self_approve")
    prompt = (q.get("prompt") or "").strip().lower()
    if not prompt:
        errs.append("missing_prompt")
    if prompt in prompts_seen:
        errs.append("duplicate_prompt")
    prompts_seen.add(prompt)
    if q["questionType"] == "mcq":
        opts = q.get("options") or []
        if len(opts) < 2:
            errs.append("mcq_options")
        if len(set(opts)) != len(opts):
            errs.append("duplicate_options")
        if q.get("correctAnswerOrRubric") not in opts:
            errs.append("correct_not_in_options")
        # exactly one correct string match
        matches = [o for o in opts if o == q.get("correctAnswerOrRubric")]
        if len(matches) != 1:
            errs.append("not_exactly_one_correct")
    if q["questionType"] == "true_false":
        if q.get("correctAnswerOrRubric") not in ("True", "False"):
            errs.append("tf_answer")
    if not q.get("sourceIds") and not q.get("sourceReference"):
        errs.append("missing_source")
    if "past paper" in (q.get("provenance") or "").lower() and "not_past" not in (
        q.get("provenance") or ""
    ).lower():
        errs.append("past_paper_claim")
    if q.get("difficultyBasis") != "author_estimate":
        errs.append("difficulty_basis")
    return errs


def author_topic(topic: dict, prompts_seen: set[str]) -> dict:
    tid = topic["topic_id"]
    pkg_dir = PACKAGES / tid
    pkg_dir.mkdir(parents=True, exist_ok=True)
    manifest_p = pkg_dir / "package_manifest.json"
    if manifest_p.exists() and (pkg_dir / "import_batch.json").exists():
        return {"topic_id": tid, "status": "skipped_existing", "path": str(manifest_p)}

    sources = acquire_sources_for_topic(topic)
    save_json(pkg_dir / "sources.json", [{k: v for k, v in s.items() if k != "text"} for s in sources])
    usable = [s for s in sources if not s.get("blocked") and s.get("text")]
    if not usable:
        return {"topic_id": tid, "status": "blocked_no_sources", "sources": sources}

    package = build_package(topic, sources)
    if not package:
        return {"topic_id": tid, "status": "blocked_insufficient_text"}

    (pkg_dir / "teaching_package.md").write_text(package["body_text"], encoding="utf-8")
    save_json(manifest_p, {k: v for k, v in package.items() if k != "body_text"})
    (pkg_dir / "teaching_package.body.txt").write_text(package["body_text"], encoding="utf-8")

    questions = generate_questions(topic, package, sources)
    accepted = []
    quarantined = []
    for q in questions:
        errs = validate_question(q, prompts_seen)
        if errs:
            q["automatedValidation"] = "failed"
            q["validationErrors"] = errs
            quarantined.append(q)
        else:
            q["automatedValidation"] = "passed"
            accepted.append(q)

    resource = {
        "resourceId": f"prac_{tid}_pkg",
        "version": "1",
        "curriculumVersion": CURRICULUM,
        "subjectId": topic["subject_id"],
        "topicIds": [tid],
        "language": "en",
        "grade": str(topic.get("grade") or "12"),
        "resourceType": "teaching_package",
        "title": f"{topic['topic_title']} — AI-authored practice package",
        "difficulty": 0.5,
        "difficultyBasis": "author_estimate",
        "prerequisiteTopicIds": topic.get("prerequisite_topic_ids") or [],
        "sourceDocumentIdOrUrl": (usable[0].get("url") or usable[0]["source_id"]),
        "availability": "draft",
        "permissionStatus": "ai_authored_with_cc_by_sa_source_attribution",
        "usagePermissionOrLicense": "AI-authored text; underlying extracts CC-BY-SA-4.0",
        "mappingBasis": "inferred_provisional_registry_topic",
        "mappingStatus": "canonical_direct",
        "mappingConfidence": "medium_inferred",
        "reviewStatus": "draft",
        "humanReviewStatus": "unreviewed",
        "automatedValidation": "passed" if accepted else "failed",
        "learnerAvailability": "draft",
        "isTestFixture": False,
        "contentOrigin": "ai_authored_source_grounded",
        "dataOrigin": "ai_authored_practice_bank_v1",
        "provenance": "ai_authored_source_grounded_teaching_package",
        "sourceIds": package["source_ids"],
        "bodyText": package["body_text"],
    }

    batch = {
        "dryRun": True,
        "note": "AI-authored practice — not teacher-reviewed; not fixtures; not authentic past papers",
        "questions": accepted,
        "resources": [resource],
        "quarantined_questions": [
            {"questionId": q["questionId"], "errors": q.get("validationErrors")} for q in quarantined
        ],
    }
    save_json(pkg_dir / "import_batch.json", batch)
    save_json(pkg_dir / "quarantine.json", quarantined)
    return {
        "topic_id": tid,
        "status": "authored",
        "n_questions_accepted": len(accepted),
        "n_quarantined": len(quarantined),
        "n_sources": len(usable),
        "package_hash": package["content_hash"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Author at most N topics (0=all)")
    parser.add_argument("--topic", type=str, default="", help="Single topic_id")
    args = parser.parse_args()

    if not MAP_PATH.exists():
        from build_topic_source_map import main as build_map

        build_map()

    smap = load_json(MAP_PATH, {})
    topics = smap.get("topics") or []
    if args.topic:
        topics = [t for t in topics if t["topic_id"] == args.topic]
    if args.limit and args.limit > 0:
        topics = topics[: args.limit]

    progress = load_json(PROGRESS, {"completed": {}, "blocked": {}})
    prompts_seen: set[str] = set()
    results = []
    for topic in topics:
        tid = topic["topic_id"]
        print(f"authoring {tid} ...", flush=True)
        try:
            r = author_topic(topic, prompts_seen)
        except Exception as e:  # noqa: BLE001
            r = {"topic_id": tid, "status": "error", "error": str(e)}
        results.append(r)
        if r.get("status") == "authored":
            progress["completed"][tid] = r
        elif str(r.get("status", "")).startswith("blocked"):
            progress["blocked"][tid] = r
        progress["updated_at_utc"] = datetime.now(timezone.utc).isoformat()
        save_json(PROGRESS, progress)

    # Combined import batch
    all_q = []
    all_r = []
    for t in smap.get("topics") or []:
        p = PACKAGES / t["topic_id"] / "import_batch.json"
        if not p.exists():
            continue
        batch = json.loads(p.read_text(encoding="utf-8"))
        all_q.extend(batch.get("questions") or [])
        all_r.extend(batch.get("resources") or [])
    combined = {
        "dryRun": False,
        "note": "Combined AI-authored practice bank — import then publish-practice; not teacher approval",
        "questions": all_q,
        "resources": all_r,
        "n_questions": len(all_q),
        "n_resources": len(all_r),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    save_json(BATCHES / "combined_import_batch.json", combined)
    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "n_results": len(results),
        "results": results,
        "combined_n_questions": len(all_q),
        "combined_n_resources": len(all_r),
        "combined_batch": str(BATCHES / "combined_import_batch.json"),
    }
    save_json(ROOT / "reports/practice_authoring_summary.json", summary)
    print(json.dumps(summary, indent=2)[:4000])


if __name__ == "__main__":
    main()
