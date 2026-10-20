"""Chronological synthetic Arts learner & operational data generator.

Hidden simulator state is kept separate from observable model inputs.
All outputs are labelled SYNTHETIC with provenance fields.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from arts_ai import __generator_version__
from arts_ai.common.config import load_yaml_config
from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import DatasetManifest, write_manifest
from arts_ai.common.paths import get_paths

logger = get_logger("arts_ai.synthetic")


@dataclass
class SyntheticArtsResult:
    output_dir: Path
    tables: dict[str, pd.DataFrame] = field(default_factory=dict)
    hidden_state_path: Path | None = None
    manifest_path: Path | None = None
    config: dict[str, Any] = field(default_factory=dict)


def _assign_scenarios(rng: np.random.Generator, n: int, cfg: dict[str, Any]) -> list[str]:
    scenarios = cfg.get("scenarios", {})
    labels = ["baseline"] * n
    assigned = set()
    for name, spec in scenarios.items():
        frac = float(spec.get("fraction", 0))
        k = int(round(frac * n))
        candidates = [i for i in range(n) if i not in assigned]
        pick = rng.choice(candidates, size=min(k, len(candidates)), replace=False)
        for i in pick:
            labels[int(i)] = name
            assigned.add(int(i))
    return labels


def _split_students(student_ids: list[str], seed: int, ratios: dict[str, float]) -> dict[str, str]:
    """Separate students across splits with derived seeds (no overlap)."""
    rng = np.random.default_rng(seed + 99)
    ids = list(student_ids)
    rng.shuffle(ids)
    n = len(ids)
    n_train = int(n * ratios["train"])
    n_val = int(n * ratios["validation"])
    mapping = {}
    for i, sid in enumerate(ids):
        if i < n_train:
            mapping[sid] = "train"
        elif i < n_train + n_val:
            mapping[sid] = "validation"
        else:
            mapping[sid] = "test"
    return mapping


def generate_synthetic_arts(config_name: str = "synthetic_arts.yaml") -> SyntheticArtsResult:
    cfg = load_yaml_config(config_name)
    seed = int(cfg.get("seed", 42))
    rng = np.random.default_rng(seed)
    gen_ts = datetime.now(timezone.utc)
    paths = get_paths()
    out_dir = paths.synthetic / f"{cfg.get('scenario_id', 'arts')}_seed{seed}"
    out_dir.mkdir(parents=True, exist_ok=True)
    hidden_dir = out_dir / "hidden_state"
    hidden_dir.mkdir(exist_ok=True)

    pop = cfg["population"]
    n_students = int(pop["n_students"])
    n_teachers = int(pop["n_teachers"])
    horizon = int(pop["time_horizon_days"])
    start = date.fromisoformat(pop["start_date"])
    tz = ZoneInfo(cfg.get("teachers", {}).get("timezone", "Asia/Colombo"))

    # --- Catalogue (provisional) ---
    subjects_rows = []
    topics_rows = []
    prereq_rows = []
    resources_rows = []
    questions_rows = []
    knowledge_docs = []

    for sub in cfg["subjects"]["list"]:
        subjects_rows.append(
            {
                "subject_id": sub["subject_id"],
                "name": sub["name"],
                "grade": pop["grade"],
                "medium": sub["medium"],
                "syllabus_version": "provisional_v0.1",
                "is_provisional": True,
                "data_origin": "sourced_content",
                "review_status": "unreviewed",
                "generator_version": __generator_version__,
                "scenario_id": cfg["scenario_id"],
                "seed": seed,
            }
        )
        topic_ids = []
        for t_i in range(int(cfg["topics_per_subject"])):
            tid = f"{sub['subject_id']}_t{t_i:02d}"
            topic_ids.append(tid)
            topics_rows.append(
                {
                    "topic_id": tid,
                    "subject_id": sub["subject_id"],
                    "name": f"{sub['name']} Topic {t_i + 1}",
                    "learning_objective": f"Demonstrate understanding of {sub['name']} topic {t_i + 1}",
                    "data_origin": "generated_content",
                    "review_status": "pending_review",
                    "generator_version": __generator_version__,
                    "scenario_id": cfg["scenario_id"],
                    "seed": seed,
                }
            )
            if t_i > 0:
                prereq_rows.append(
                    {
                        "topic_id": tid,
                        "prerequisite_topic_id": topic_ids[t_i - 1],
                        "data_origin": "generated_content",
                        "generator_version": __generator_version__,
                        "scenario_id": cfg["scenario_id"],
                        "seed": seed,
                    }
                )
            for r_i in range(int(cfg["resources_per_topic"])):
                rid = f"{tid}_r{r_i}"
                rtype = ["note", "video", "quiz", "exercise"][r_i % 4]
                resources_rows.append(
                    {
                        "resource_id": rid,
                        "topic_id": tid,
                        "type": rtype,
                        "difficulty": float(np.clip(rng.normal(0.4 + 0.05 * t_i, 0.1), 0, 1)),
                        "language": sub["medium"],
                        "source_reference": f"provisional_catalogue:{rid}",
                        "review_status": "unreviewed",
                        "title": f"{sub['name']} {tid} resource {r_i}",
                        "data_origin": "generated_content",
                        "generator_version": __generator_version__,
                        "scenario_id": cfg["scenario_id"],
                        "seed": seed,
                    }
                )
            for q_i in range(int(cfg["questions_per_topic"])):
                qid = f"{tid}_q{q_i}"
                questions_rows.append(
                    {
                        "question_id": qid,
                        "topic_id": tid,
                        "type": "mcq",
                        "text": f"[GENERATED-AWAITING-REVIEW] {sub['name']} topic {t_i + 1} Q{q_i + 1}",
                        "options": json.dumps(["A", "B", "C", "D"]),
                        "answer_or_rubric": "A",
                        "max_marks": 1.0,
                        "difficulty": float(np.clip(rng.normal(0.5, 0.15), 0, 1)),
                        "explanation": "[GENERATED-AWAITING-REVIEW] Brief explanation placeholder.",
                        "source_reference": f"generated:{qid}",
                        "review_status": "pending_review",
                        "data_origin": "generated_content",
                        "generator_version": __generator_version__,
                        "scenario_id": cfg["scenario_id"],
                        "seed": seed,
                    }
                )
            # Knowledge doc per topic (generated, not verified syllabus)
            knowledge_docs.append(
                {
                    "document_id": f"doc_{tid}",
                    "subject_id": sub["subject_id"],
                    "topic_id": tid,
                    "source_reference": "generated_provisional_notes",
                    "permission_reference": "synthetic_demo_fixture",
                    "version": "0.1.0",
                    "review_status": "unreviewed",
                    "title": f"Provisional notes: {sub['name']} Topic {t_i + 1}",
                    "text": (
                        f"This is GENERATED educational content awaiting review for "
                        f"{sub['name']} topic {t_i + 1}. It is NOT verified syllabus material. "
                        f"Learning objective: understand core ideas of topic {t_i + 1}. "
                        f"Key terms include concept-{t_i}-a, concept-{t_i}-b, and concept-{t_i}-c. "
                        f"Students should practise applying definitions and comparing examples."
                    ),
                    "data_origin": "generated_content",
                    "generator_version": __generator_version__,
                    "scenario_id": cfg["scenario_id"],
                    "seed": seed,
                }
            )

    subjects_df = pd.DataFrame(subjects_rows)
    topics_df = pd.DataFrame(topics_rows)
    prereq_df = pd.DataFrame(prereq_rows)
    resources_df = pd.DataFrame(resources_rows)
    questions_df = pd.DataFrame(questions_rows)
    knowledge_df = pd.DataFrame(knowledge_docs)

    # --- Students ---
    scenario_labels = _assign_scenarios(rng, n_students, cfg)
    mediums = pop["mediums"]
    age_bands = pop["age_bands"]
    students = []
    hidden = []
    for i in range(n_students):
        sid = f"syn_s{i:04d}"
        scenario = scenario_labels[i]
        join_delay = 0
        if scenario == "late_joining":
            join_delay = int(rng.normal(cfg["scenarios"]["late_joining"]["join_delay_days_mean"], 7))
            join_delay = max(7, join_delay)
        enrol = start + timedelta(days=join_delay)
        students.append(
            {
                "student_id": sid,
                "grade": pop["grade"],
                "age_band": age_bands[int(rng.integers(0, len(age_bands)))],
                "medium": mediums[int(rng.integers(0, len(mediums)))],
                "enrolment_date": enrol.isoformat(),
                "scenario_id": scenario,
                "data_origin": "synthetic_learner",
                "generator_version": __generator_version__,
                "seed": seed,
                "generation_timestamp": gen_ts.isoformat(),
                "parameter_config_ref": config_name,
            }
        )
        # Hidden proficiency per subject
        for sub in cfg["subjects"]["list"]:
            prof = float(
                np.clip(
                    rng.normal(cfg["proficiency"]["initial_mean"], cfg["proficiency"]["initial_std"]),
                    0.05,
                    0.95,
                )
            )
            hidden.append(
                {
                    "student_id": sid,
                    "subject_id": sub["subject_id"],
                    "hidden_proficiency": prof,
                    "scenario_id": scenario,
                    "dropout_day": None,
                }
            )

    students_df = pd.DataFrame(students)
    hidden_df = pd.DataFrame(hidden)
    split_map = _split_students(
        students_df["student_id"].tolist(),
        seed,
        cfg["splits"],
    )
    students_df["split_membership"] = students_df["student_id"].map(split_map)

    # Dropout / inactivity markers in hidden state
    for i, row in hidden_df.iterrows():
        sid = row["student_id"]
        sc = students_df.loc[students_df.student_id == sid, "scenario_id"].iloc[0]
        if sc == "inactive" or rng.random() < cfg["missingness"]["dropout_rate"]:
            lo = min(40, max(horizon // 2, 1))
            hi = max(horizon, lo + 1)
            hidden_df.at[i, "dropout_day"] = int(rng.integers(lo, hi))

    # --- Teachers ---
    teachers = []
    expertise = []
    availability = []
    for t in range(n_teachers):
        tid = f"syn_t{t:03d}"
        teachers.append(
            {
                "teacher_id": tid,
                "display_name": f"Demo Teacher {t + 1}",
                "is_synthetic_fixture": True,
                "data_origin": "synthetic_operational",
                "generator_version": __generator_version__,
                "scenario_id": cfg["scenario_id"],
                "seed": seed,
            }
        )
        sub = cfg["subjects"]["list"][t % len(cfg["subjects"]["list"])]
        expertise.append(
            {
                "teacher_id": tid,
                "subject_id": sub["subject_id"],
                "topic_ids": json.dumps(
                    topics_df.loc[topics_df.subject_id == sub["subject_id"], "topic_id"].head(3).tolist()
                ),
                "proficiency_level": "secondary",
                "data_origin": "synthetic_operational",
                "generator_version": __generator_version__,
                "seed": seed,
            }
        )
        # Weekly slots across horizon
        for week in range(horizon // 7):
            for slot in range(int(cfg["teachers"]["slots_per_week"])):
                day = start + timedelta(days=week * 7 + (slot % 5))
                hour = 9 + (slot % 6)
                start_dt = datetime(day.year, day.month, day.day, hour, 0, tzinfo=tz)
                end_dt = start_dt + timedelta(minutes=int(cfg["teachers"]["slot_duration_minutes"]))
                availability.append(
                    {
                        "availability_id": f"{tid}_w{week}_s{slot}",
                        "teacher_id": tid,
                        "start_at": start_dt.isoformat(),
                        "end_at": end_dt.isoformat(),
                        "timezone": str(tz),
                        "data_origin": "synthetic_operational",
                        "generator_version": __generator_version__,
                        "seed": seed,
                    }
                )

    teachers_df = pd.DataFrame(teachers)
    expertise_df = pd.DataFrame(expertise)
    availability_df = pd.DataFrame(availability)

    # --- Chronological activity generation ---
    student_subjects = []
    events = []
    attempts = []
    assessments = []
    assessment_results = []
    attendance = []
    interventions = []
    rec_logs = []
    consultations = []
    study_groups = []
    memberships = []
    questionnaires = []
    learning_evals = []

    # One assessment mid and end per subject
    for sub in cfg["subjects"]["list"]:
        for label, day_offset, aid in (("mid", 60, "mid"), ("end", 110, "end")):
            assessments.append(
                {
                    "assessment_id": f"{sub['subject_id']}_{aid}",
                    "subject_id": sub["subject_id"],
                    "date": (start + timedelta(days=day_offset)).isoformat(),
                    "max_marks": 100.0,
                    "pass_mark": 40.0,
                    "grading_policy_version": "sim_v1",
                    "data_origin": "synthetic_learner",
                    "generator_version": __generator_version__,
                    "seed": seed,
                }
            )

    # Study groups
    for sub in cfg["subjects"]["list"]:
        gid = f"grp_{sub['subject_id']}"
        study_groups.append(
            {
                "group_id": gid,
                "name": f"{sub['name']} Peer Group",
                "subject_id": sub["subject_id"],
                "topic_id": None,
                "created_at": datetime(start.year, start.month, start.day, tzinfo=tz).isoformat(),
                "data_origin": "synthetic_operational",
                "generator_version": __generator_version__,
                "seed": seed,
            }
        )

    event_counter = 0
    attempt_counter = 0
    rec_counter = 0
    consult_counter = 0

    prof_cfg = cfg["proficiency"]
    act_cfg = cfg["activity"]

    for _, stu in students_df.iterrows():
        sid = stu["student_id"]
        scenario = stu["scenario_id"]
        enrol = date.fromisoformat(stu["enrolment_date"])
        split = stu["split_membership"]
        # enrol in 3 random subjects
        chosen = rng.choice(cfg["subjects"]["list"], size=min(3, len(cfg["subjects"]["list"])), replace=False)
        for sub in chosen:
            student_subjects.append(
                {
                    "student_id": sid,
                    "subject_id": sub["subject_id"],
                    "enrolled_at": datetime(enrol.year, enrol.month, enrol.day, tzinfo=tz).isoformat(),
                    "status": "active",
                    "data_origin": "synthetic_learner",
                    "generator_version": __generator_version__,
                    "scenario_id": scenario,
                    "seed": seed,
                    "split_membership": split,
                }
            )
            if rng.random() < cfg["teachers"]["group_participation_rate"]:
                memberships.append(
                    {
                        "group_id": f"grp_{sub['subject_id']}",
                        "student_id": sid,
                        "joined_at": datetime(enrol.year, enrol.month, enrol.day, tzinfo=tz).isoformat(),
                        "role": "member",
                        "data_origin": "synthetic_operational",
                        "generator_version": __generator_version__,
                        "seed": seed,
                        "split_membership": split,
                    }
                )

        # Questionnaire
        for qcode in ("motivation", "study_hours", "preferred_medium"):
            questionnaires.append(
                {
                    "student_id": sid,
                    "questionnaire_version": "sim_v1",
                    "question_code": qcode,
                    "response_value": str(rng.integers(1, 6)),
                    "answered_at": datetime(enrol.year, enrol.month, enrol.day, 10, 0, tzinfo=tz).isoformat(),
                    "data_origin": "synthetic_learner",
                    "generator_version": __generator_version__,
                    "scenario_id": scenario,
                    "seed": seed,
                    "split_membership": split,
                }
            )

        # Activity multiplier by scenario
        act_mult = 1.0
        gain_mult = 1.0
        max_events_week = None
        if scenario == "inactive":
            act_mult = float(cfg["scenarios"]["inactive"]["activity_multiplier"])
        elif scenario == "sparse_history":
            max_events_week = int(cfg["scenarios"]["sparse_history"]["max_events_per_week"])
        elif scenario == "improving":
            gain_mult = float(cfg["scenarios"]["improving"]["gain_multiplier"])
        elif scenario == "declining":
            gain_mult = float(cfg["scenarios"]["declining"]["gain_multiplier"])
        elif scenario == "cold_start":
            max_events_week = 0  # only a couple of events total handled below

        dropout_days = hidden_df.loc[hidden_df.student_id == sid, "dropout_day"].dropna()
        dropout_day = int(dropout_days.iloc[0]) if len(dropout_days) else None

        # Update hidden proficiency over time & generate events
        subject_ids = [c["subject_id"] for c in chosen]
        for day_offset in range(horizon):
            cur = start + timedelta(days=day_offset)
            if cur < enrol:
                continue
            if dropout_day is not None and day_offset >= dropout_day:
                break

            # Forgetting + learning opportunity
            for sub_id in subject_ids:
                mask = (hidden_df.student_id == sid) & (hidden_df.subject_id == sub_id)
                prof = float(hidden_df.loc[mask, "hidden_proficiency"].iloc[0])
                prof = float(np.clip(prof - prof_cfg["forgetting_rate_per_day"], 0.05, 0.99))
                hidden_df.loc[mask, "hidden_proficiency"] = prof

            # Sessions this day (approx from weekly mean)
            weekly = rng.normal(act_cfg["sessions_per_week_mean"], act_cfg["sessions_per_week_std"]) * act_mult
            p_day = max(0.0, weekly / 7.0)
            if scenario == "cold_start" and day_offset > enrol.toordinal() - start.toordinal() + 3:
                # only early tiny activity
                if len([e for e in events if e["student_id"] == sid]) >= int(
                    cfg["scenarios"]["cold_start"]["max_events"]
                ):
                    continue
            if rng.random() > min(p_day, 0.95):
                continue

            n_ev = 1
            if max_events_week is not None:
                week_events = sum(
                    1
                    for e in events
                    if e["student_id"] == sid
                    and abs(
                        date.fromisoformat(e["event_timestamp"][:10]).toordinal() - cur.toordinal()
                    )
                    < 7
                )
                if week_events >= max_events_week:
                    continue

            for _ in range(n_ev):
                sub_id = subject_ids[int(rng.integers(0, len(subject_ids)))]
                topic_pool = topics_df.loc[topics_df.subject_id == sub_id]
                topic = topic_pool.iloc[int(rng.integers(0, len(topic_pool)))]
                res_pool = resources_df.loc[resources_df.topic_id == topic["topic_id"]]
                res = res_pool.iloc[int(rng.integers(0, len(res_pool)))]
                session_id = f"{sid}_d{day_offset}"
                ts = datetime(cur.year, cur.month, cur.day, int(rng.integers(8, 21)), int(rng.integers(0, 60)), tzinfo=tz)
                event_counter += 1
                active_sec = float(
                    np.clip(
                        rng.normal(act_cfg["available_study_minutes_mean"], act_cfg["available_study_minutes_std"])
                        * 60
                        / 3,
                        30,
                        3600,
                    )
                )
                events.append(
                    {
                        "event_id": f"ev{event_counter:07d}",
                        "student_id": sid,
                        "session_id": session_id,
                        "resource_id": res["resource_id"],
                        "event_type": "view" if res["type"] != "quiz" else "quiz_start",
                        "event_timestamp": ts.isoformat(),
                        "active_seconds": active_sec,
                        "progress_percent": float(np.clip(rng.normal(70, 20), 0, 100)),
                        "data_origin": "synthetic_learner",
                        "generator_version": __generator_version__,
                        "scenario_id": scenario,
                        "seed": seed,
                        "split_membership": split,
                        # observable only — no hidden proficiency
                    }
                )

                # Learning gain applied to hidden state
                mask = (hidden_df.student_id == sid) & (hidden_df.subject_id == sub_id)
                gain = float(rng.normal(prof_cfg["learning_gain_mean"], prof_cfg["learning_gain_std"])) * gain_mult
                prof = float(hidden_df.loc[mask, "hidden_proficiency"].iloc[0])
                hidden_df.loc[mask, "hidden_proficiency"] = float(np.clip(prof + gain, 0.05, 0.99))

                # Question attempt sometimes
                if rng.random() < 0.5:
                    q_pool = questions_df.loc[questions_df.topic_id == topic["topic_id"]]
                    q = q_pool.iloc[int(rng.integers(0, len(q_pool)))]
                    prof = float(hidden_df.loc[mask, "hidden_proficiency"].iloc[0])
                    # correctness from hidden proficiency vs difficulty (simulator only)
                    logit = act_cfg["response_correctness_logit_scale"] * (prof - float(q["difficulty"]))
                    p_correct = 1 / (1 + np.exp(-logit))
                    correct = int(rng.random() < p_correct)
                    if scenario == "missing_data" and rng.random() < cfg["scenarios"]["missing_data"]["miss_prob"]:
                        score = None
                    else:
                        score = float(correct) + float(rng.normal(0, cfg["noise"]["score_noise_std"]))
                        score = float(np.clip(score, 0, 1))
                    attempt_counter += 1
                    started = ts
                    elapsed = float(
                        np.clip(
                            rng.normal(act_cfg["response_time_seconds_mean"], act_cfg["response_time_seconds_std"]),
                            5,
                            300,
                        )
                    )
                    attempts.append(
                        {
                            "attempt_id": f"att{attempt_counter:07d}",
                            "student_id": sid,
                            "question_id": q["question_id"],
                            "started_at": started.isoformat(),
                            "submitted_at": (started + timedelta(seconds=elapsed)).isoformat(),
                            "response": "A" if correct else "B",
                            "score": score,
                            "max_marks": 1.0,
                            "attempt_number": 1,
                            "hints_used": int(rng.integers(0, 3)),
                            "grading_method": "auto",
                            "data_origin": "synthetic_learner",
                            "generator_version": __generator_version__,
                            "scenario_id": scenario,
                            "seed": seed,
                            "split_membership": split,
                        }
                    )

                    # Recommendation log (observable)
                    rec_counter += 1
                    candidates = res_pool["resource_id"].tolist()
                    rec_logs.append(
                        {
                            "recommendation_id": f"rec{rec_counter:07d}",
                            "student_id": sid,
                            "profile_snapshot_id": f"snap_{sid}_{day_offset}",
                            "model_or_policy_version": "sim_prerequisite_v0",
                            "candidate_ids": json.dumps(candidates),
                            "resource_id": res["resource_id"],
                            "rank": 1,
                            "score": float(rng.random()),
                            "generated_at": ts.isoformat(),
                            "shown_at": ts.isoformat(),
                            "opened_at": (ts + timedelta(minutes=1)).isoformat() if rng.random() > 0.3 else None,
                            "completed_at": (ts + timedelta(minutes=10)).isoformat() if rng.random() > 0.5 else None,
                            "data_origin": "synthetic_learner",
                            "generator_version": __generator_version__,
                            "scenario_id": scenario,
                            "seed": seed,
                            "split_membership": split,
                        }
                    )

            # Attendance weekday
            if cur.weekday() < 5 and rng.random() < 0.85:
                for sub_id in subject_ids:
                    attendance.append(
                        {
                            "student_id": sid,
                            "subject_id": sub_id,
                            "class_date": cur.isoformat(),
                            "attendance_status": "present" if rng.random() > 0.15 else "absent",
                            "data_origin": "synthetic_learner",
                            "generator_version": __generator_version__,
                            "scenario_id": scenario,
                            "seed": seed,
                            "split_membership": split,
                        }
                    )

        # Assessment results from hidden proficiency
        for sub_id in subject_ids:
            mask = (hidden_df.student_id == sid) & (hidden_df.subject_id == sub_id)
            prof = float(hidden_df.loc[mask, "hidden_proficiency"].iloc[0])
            for aid in ("mid", "end"):
                if cfg["missingness"]["missing_assessment_rate"] and rng.random() < cfg["missingness"]["missing_assessment_rate"]:
                    status = "absent"
                    marks = None
                else:
                    marks = float(np.clip(rng.normal(prof * 100, 8), 0, 100))
                    status = "distinction" if marks >= 75 else ("pass" if marks >= 40 else "fail")
                assessment_results.append(
                    {
                        "student_id": sid,
                        "assessment_id": f"{sub_id}_{aid}",
                        "marks_obtained": marks,
                        "result_status": status,
                        "available_at": (
                            datetime.fromisoformat(
                                (start + timedelta(days=60 if aid == "mid" else 110)).isoformat()
                            ).replace(tzinfo=tz)
                        ).isoformat(),
                        "data_origin": "synthetic_learner",
                        "generator_version": __generator_version__,
                        "scenario_id": scenario,
                        "seed": seed,
                        "split_membership": split,
                    }
                )
            # Learning evaluation record
            learning_evals.append(
                {
                    "student_id": sid,
                    "topic_id": topics_df.loc[topics_df.subject_id == sub_id, "topic_id"].iloc[0],
                    "pre_assessment_id": f"{sub_id}_mid",
                    "post_assessment_id": f"{sub_id}_end",
                    "assigned_method": "sim_prerequisite_v0",
                    "assignment_method": "simulated",
                    "pre_score": None,
                    "post_score": None,
                    "started_at": datetime(enrol.year, enrol.month, enrol.day, tzinfo=tz).isoformat(),
                    "completed_at": None,
                    "data_origin": "synthetic_learner",
                    "generator_version": __generator_version__,
                    "scenario_id": scenario,
                    "seed": seed,
                    "split_membership": split,
                }
            )

        # Occasional intervention & consultation
        if rng.random() < 0.2:
            interventions.append(
                {
                    "intervention_id": f"int_{sid}",
                    "student_id": sid,
                    "type": "extra_practice",
                    "recommended_at": datetime(enrol.year, enrol.month, enrol.day, tzinfo=tz).isoformat(),
                    "completed_at": None,
                    "notes": "Simulated recommendation; no causal claim",
                    "data_origin": "synthetic_operational",
                    "generator_version": __generator_version__,
                    "scenario_id": scenario,
                    "seed": seed,
                    "split_membership": split,
                }
            )
        if rng.random() < 0.15:
            teach = teachers_df.iloc[int(rng.integers(0, len(teachers_df)))]["teacher_id"]
            slot_start = datetime(enrol.year, enrol.month, enrol.day, 10, 0, tzinfo=tz) + timedelta(days=14)
            consult_counter += 1
            consultations.append(
                {
                    "consultation_id": f"con{consult_counter:05d}",
                    "student_id": sid,
                    "teacher_id": teach,
                    "subject_id": subject_ids[0],
                    "requested_slot_start": slot_start.isoformat(),
                    "requested_slot_end": (slot_start + timedelta(minutes=30)).isoformat(),
                    "state": "requested",
                    "meeting_url": None,
                    "meeting_integration_status": "unconfigured",
                    "notes": "Synthetic demo fixture",
                    "created_at": slot_start.isoformat(),
                    "updated_at": slot_start.isoformat(),
                    "data_origin": "synthetic_operational",
                    "generator_version": __generator_version__,
                    "scenario_id": scenario,
                    "seed": seed,
                    "split_membership": split,
                }
            )

    tables = {
        "students": students_df,
        "student_subjects": pd.DataFrame(student_subjects),
        "subjects": subjects_df,
        "topics": topics_df,
        "topic_prerequisites": prereq_df,
        "resources": resources_df,
        "questions": questions_df,
        "learning_events": pd.DataFrame(events),
        "question_attempts": pd.DataFrame(attempts),
        "assessments": pd.DataFrame(assessments),
        "assessment_results": pd.DataFrame(assessment_results),
        "attendance": pd.DataFrame(attendance),
        "support_interventions": pd.DataFrame(interventions),
        "recommendation_logs": pd.DataFrame(rec_logs),
        "learning_evaluations": pd.DataFrame(learning_evals),
        "questionnaire_responses": pd.DataFrame(questionnaires),
        "knowledge_documents": knowledge_df,
        "teachers": teachers_df,
        "teacher_expertise": expertise_df,
        "teacher_availability": availability_df,
        "consultations": pd.DataFrame(consultations),
        "study_groups": pd.DataFrame(study_groups),
        "group_memberships": pd.DataFrame(memberships),
    }

    for name, df in tables.items():
        path = out_dir / f"{name}.csv"
        df.to_csv(path, index=False)

    hidden_path = hidden_dir / "hidden_proficiency.csv"
    hidden_df.to_csv(hidden_path, index=False)
    # Mark hidden state clearly
    (hidden_dir / "README.md").write_text(
        "# Hidden simulator state\n\n"
        "This directory contains latent variables used by the generator "
        "(e.g. hidden_proficiency). These must NOT be used as model inputs.\n",
        encoding="utf-8",
    )

    # Config snapshot
    cfg_path = out_dir / "parameter_config.json"
    cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    counts = {k: len(v) for k, v in tables.items()}
    manifest = DatasetManifest(
        dataset_id=f"synthetic_arts_{cfg['scenario_id']}",
        name="Synthetic Arts learner and operational data",
        data_category="synthetic_learner",
        source_url=None,
        license="synthetic demonstration data — not collected from any institute",
        local_path=str(out_dir),
        checksum_sha256=file_sha256(cfg_path),
        record_counts=counts,
        filters={"scenarios": list(cfg.get("scenarios", {}).keys())},
        domain="sri_lankan_al_arts_SIMULATED",
        intended_use="C1 twin validation; C2 Arts recommendations; C3 synthetic risk; C4 demo content",
        generator_version=__generator_version__,
        seed=seed,
        scenario_id=cfg["scenario_id"],
        notes=(
            "SYNTHETIC. Not institutional data. Hidden state separated under hidden_state/. "
            "Subjects/topics are provisional. Generated content awaits review."
        ),
    )
    man_path = write_manifest(manifest, out_dir / "dataset_manifest.json")
    # Also copy to manifests folder
    manifests_dir = paths.synthetic / "manifests"
    manifests_dir.mkdir(exist_ok=True)
    write_manifest(manifest, manifests_dir / f"{cfg['scenario_id']}_seed{seed}.json")

    logger.info("Generated synthetic Arts data at %s (%s students)", out_dir, n_students)
    return SyntheticArtsResult(
        output_dir=out_dir,
        tables=tables,
        hidden_state_path=hidden_path,
        manifest_path=man_path,
        config=cfg,
    )
