# Arts AI — Training Results

Actual metrics from executed pipeline on this workstation (2026-10-13). Weak results reported as-is.

## Pipeline evidence

- `backend/ml/reports/pipeline_run.json`
- Per-component JSON under `backend/ml/reports/`
- Run manifests + charts under `backend/ml/artifacts/c*/`

## C1 — OULAD behavioural clustering

| Metric | Value |
|--------|-------|
| Selected K | 6 |
| Silhouette train | 0.226 |
| Silhouette val | 0.225 |
| Silhouette test | 0.223 |
| Stability ARI (val) | 0.978 |
| Eligible with activity | 26,425 / 32,593 |
| Run | `c1_20261013T025838_cd8e0dbf` |

Classification accuracy is **not** applicable.

## C3 — OULAD academic risk (Fail vs Pass/Distinction)

| Model | Test F1 | Test ROC-AUC | Test PR-AUC |
|-------|---------|--------------|-------------|
| Dummy stratified | 0.303 | 0.495 | 0.315 |
| Logistic Regression | 0.379 | 0.696 | 0.507 |
| LightGBM (selected) | **0.406** | ~0.69 | ~0.51 |

- Observation cutoff: course days 0–13  
- Withdrawn excluded: 10,156  
- Run: `c3_oulad_20261013T025915_454f809b`

## C3 — UCI Student Performance (separate)

| Metric | Value |
|--------|-------|
| F1 | 0.879 |
| ROC-AUC | 0.972 |
| Note | No weekly event histories |

## C2 — EdNet correctness

**Blocked.** Authentic KT1 not available. See `c2_ednet_blocked.json`. Synthetic data was not substituted.

## C2 — Arts simulated recommendations

| Metric | Value |
|--------|-------|
| Test AP | 0.672 |
| Test relevance rate (baseline) | 0.694 |
| Test ROC-AUC | 0.477 |
| Note | Simulation only; subjects provisional |

## C3 — Synthetic Arts risk

| Metric | Value |
|--------|-------|
| Test F1 | 0.571 |
| Test ROC-AUC | 0.645 |

## C4 — Topic classifier (generated examples)

| Metric | Value |
|--------|-------|
| Accuracy | 0.042 |
| Macro F1 | 0.015 |
| Note | Weak result on formulaic generated text; reported honestly |

## C4 — Retrieval index

BM25 index built from generated knowledge documents. Indexing ≠ LLM training. `sentence-transformers` not installed in this environment (optional).
