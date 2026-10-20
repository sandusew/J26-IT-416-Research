# Arts AI — Audit Matrix (2026-10-13 revision)

| Requirement | Implementation path | Execution evidence | Finding | Required fix |
|-------------|--------------------|--------------------|---------|--------------|
| C1 silhouette≈0.223, ARI≈0.978 | `c1_behaviour/train.py`, `artifacts/c1/c1_20261013T025838_*` | `reports/c1_behaviour_metrics.json` | **Verified** (sil_test 0.22346, ARI 0.97795) | None for metrics; transfer to Arts still unevaluated |
| C2 EdNet blocked | `datasets/ednet.py` | `reports/c2_ednet_blocked.json` | **Verified blocked**; access is public via bit.ly (not form-only) | Document exact URLs + local layout; do not auto-claim without KT1+Contents |
| C2 Arts AP≈0.672, prev≈0.694, AUC≈0.477 | `c2_arts_20261013T025936_*` | Original metrics in artifact; `reports/c2_arts_metrics.json` was later overwritten by notebook re-run | **Verified original**; prevalence mislabelled as “random baseline”; metric is **pooled binary AP**, not per-query ranking; AUC≈0.48 = weak discrimination | Revised per-query ranking under new run ID |
| C3 OULAD F1≈0.406 | `c3_oulad_*` | `reports/c3_oulad_metrics.json` LightGBM test F1 0.40639 | **Verified**; cutoff days 0–13 in code; Withdrawn excluded | Keep day-14 as separate experiment; calibration chart exists |
| C3 UCI F1≈0.879 | `c3_uci_20261013T025936_*` | Original artifact | **Verified Math-only with G1/G2**; no student_id — mat/por overlap risk if combined; G1/G2 are period grades | Revised student_key split + with/without G1/G2 |
| C4 topic acc≈0.042 | `c4_topic_*` pre-revision | `reports/audit/c4_topic_diagnosis.json` | **Root cause confirmed**: 100% generic cross-topic templates; v0/v1 near-duplicates; shared fact stems; default TF-IDF split hyphens | Distinctive subject-qualified text; A/B source split; hyphen token_pattern; baselines |
| C4 chat as “generative” | `c4_chatbot/rag.py` `answer_question` | Smoke: `answer_type=extractive_template` | Index≠generative chatbot; BM25 extractive template | Label `answer_type`; tighten insufficient-evidence |
| Digital Twin persistence | Express `DigitalTwinProfile` + `/ml/digital-twin` | Model exists; GET added | POST persisted; GET was missing | Added GET `/learning/digital-twin/:id` |
| Diagnostics / quiz / recs / progress / peers / notifications | Missing routes | Code audit | Gaps vs scope | Added `/learning/*` routes |
| Meeting integration | `MEETING_INTEGRATION` flag | Consultations set `meetingUrl=null` | Flag≠working provider | Report unconfigured; never fabricate links |
| Authz / conflicts | `middleware/auth.js`, consultations | Integration tests | Needed automated checks | `api/tests/integration.test.js` |

## Evaluation integrity

- Original metrics retained under `artifacts/*/…` and `reports/audit/*_ORIGINAL.json`.
- Revised experiments use new run IDs (`*_rev_*`) and `*_REVISED.json` reports.
- Revised test sets are **not** claimed as untouched original holdouts.
