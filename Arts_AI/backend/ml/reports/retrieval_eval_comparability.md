# Retrieval evaluation comparability note

## Do not treat Hit@3 / Recall@3 across these runs as a direct improvement

| Evaluation | Corpus | Gold set | Recall@3 denom | Hit@3 |
|------------|--------|----------|----------------|-------|
| Historical (wiki-focused gold) | `c4_index_20261014T002208_333d545a` | Wiki document IDs primarily | **16** | 6/8 (0.75) |
| Expanded gold + practice packages | `c4_index_20261014T173535_894e48ef` | Wiki + `prac_pkg_*` IDs | **29** | 7/8 (0.875) |

Different **gold document sets** and **denominators** mean the metrics are **not directly comparable**.

## Current evaluation identity

- Queries/keys live under `backend/ml/data/arts_content/eval/` and are **not** ingested into the teaching index.
- Authorship: machine-authored research eval; **unreviewed** by teachers.
- AI-authored packages in gold are **the same teaching artefacts** as the index — they are not independent corroborating sources.
- Held-out expansion cases are labelled `held_out_expansion` / `held_out`.
- Unanswerable, Sinhala-unclaimed, and wrong-subject cases are included.

## What is reported

Report **index hash**, **evaluation-set hash**, configuration, denominators, and authorship separately for each run. Do not claim teacher validation or answer quality from Hit@k alone.
