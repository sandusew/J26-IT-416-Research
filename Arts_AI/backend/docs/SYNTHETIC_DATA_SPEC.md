# Synthetic Data Specification

**Status:** Simulation experiment for unavailable local institutional data.  
**Not** collected from any institute. No consent forms, participant records, or teacher approvals are claimed.

## Configuration

- File: `backend/ml/configs/synthetic_arts.yaml`
- Generator: `arts_ai.synthetic.generator` version `0.1.0`
- Default scenario_id: `arts_al_baseline_v1`
- Default seed: `42`

## Population & horizon

- 400 simulated students, 12 teachers, 120-day horizon from `2025-01-06`
- Provisional A/L Arts subjects (History, Geography, Economics, Political Science, Sinhala Literature)
- Topics/resources/questions are **generated / provisional** and await review

## Process

1. Assign scenario labels (cold_start, sparse_history, improving, declining, inactive, late_joining, missing_data) **before** evaluation.
2. Maintain **hidden** proficiency per student×subject under `hidden_state/` — never used as model inputs.
3. Generate events chronologically with FK-consistent IDs.
4. Split by **student** with separate membership; no student overlap across train/val/test.
5. Attach provenance: `data_origin`, `generator_version`, `scenario_id`, `seed`, `generation_timestamp`, `parameter_config_ref`, `split_membership`.

## Assumptions (do not retune to chase test scores)

- Initial proficiency ~ N(0.45, 0.15)
- Learning gain ~ N(0.03, 0.02) with forgetting 0.002/day
- Activity ~ 3.5 sessions/week; response correctness via logit(proficiency − difficulty)
- Missingness / dropout rates as in config
- Parameter sources are heuristics; order-of-magnitude only informed by public engagement literature

## Sensitivity scenarios

Declared in config `scenarios:` — evaluated separately on held-out simulated learners for C2.

## Fixtures

Teacher and student demo accounts are **synthetic demonstration fixtures**, not real participants.
