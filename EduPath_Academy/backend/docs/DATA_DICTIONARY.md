# Arts AI — Data Dictionary

Typed schemas live in `backend/ml/src/arts_ai/schemas/`. Units and enums below.

## Provenance (all mixed tables)

| field | type | notes |
|-------|------|-------|
| data_origin | enum | `authentic_public`, `synthetic_learner`, `synthetic_operational`, `sourced_content`, `generated_content`, `derived` |
| generator_version | string | e.g. `0.1.0` |
| scenario_id | string | simulation scenario |
| seed | int | RNG seed |
| generation_timestamp | ISO-8601 | UTC |
| split_membership | enum | `train` / `validation` / `test` / `none` |
| review_status | enum | `unreviewed`, `pending_review`, `reviewed`, `rejected`, `not_applicable` |

## Student & activity

| entity | key fields | notes |
|--------|------------|-------|
| students | student_id, grade, age_band, medium, enrolment_date | medium: sinhala/tamil/english |
| student_subjects | student_id, subject_id, enrolled_at, status | FK to subjects |
| questionnaire_responses | student_id, questionnaire_version, question_code, response_value, answered_at | |
| diagnostic_assignments | assignment_id, student_id, activity_id, assigned_at, due_at, completed_at, status | |
| learning_events | event_id, student_id, session_id, resource_id, event_type, event_timestamp, active_seconds, progress_percent | `active_seconds` observed only — not inferred from clicks |

## Content

| entity | key fields | notes |
|--------|------------|-------|
| subjects | subject_id, name, grade, medium, syllabus_version, is_provisional | provisional Arts catalogue flagged |
| topics | topic_id, subject_id, name, learning_objective | |
| topic_prerequisites | topic_id, prerequisite_topic_id | DAG edge |
| resources | resource_id, topic_id, type, difficulty∈[0,1], language, source_reference, review_status | Arts IDs ≠ EdNet IDs |
| questions | question_id, topic_id, type, text, options, answer_or_rubric, max_marks, difficulty, explanation, source_reference, review_status | generated explanations retain review_status |
| question_attempts | attempt_id, student_id, question_id, started_at, submitted_at, response, score, max_marks, attempt_number, hints_used, grading_method | |

## Progress

| entity | key fields | notes |
|--------|------------|-------|
| assessments | assessment_id, subject_id, date, max_marks, pass_mark, grading_policy_version | |
| assessment_results | student_id, assessment_id, marks_obtained, result_status, available_at | |
| attendance | student_id, subject_id, class_date, attendance_status | |
| support_interventions | intervention_id, student_id, type, recommended_at, completed_at | **no causal improvement claim** |

## Recommendations

| entity | key fields | notes |
|--------|------------|-------|
| recommendation_logs | recommendation_id, student_id, profile_snapshot_id, model_or_policy_version, candidate_ids, resource_id, rank, score, generated_at, shown_at, opened_at, completed_at | |
| learning_evaluations | student_id, topic_id, pre/post assessment ids, assigned_method, timestamps | |

## Chatbot & consultation

| entity | key fields | notes |
|--------|------------|-------|
| knowledge_documents | document_id, subject_id, topic_id, source_reference, permission_reference, version, review_status | |
| qa_evaluation | qa_id, question, expected_answer, supporting_passage, answerable, origin, review_status | origin: generated / manually_authored / teacher_reviewed / squad |
| chat_interactions | interaction_id, student_id, question, answer, citations, model_version, timestamp, feedback | |
| teachers / teacher_expertise | teacher_id, subjects/topics | synthetic fixtures flagged |
| teacher_availability | timezone-aware start_at/end_at | Asia/Colombo default |
| consultations | request→approve/decline/cancel/complete | meeting_url null if integration unconfigured |
| study_groups / group_memberships | group_id, student_id | |

## OULAD public tables (authentic)

See Kuzilek et al. OULAD schema: `studentInfo`, `studentVle` (`date` = days from module start), `vle.activity_type`, `final_result` ∈ {Pass, Fail, Distinction, Withdrawn}.
