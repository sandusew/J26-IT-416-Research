# Arts AI — Dataset Register

| dataset_id | category | source | license | archive size | extracted size | selected sample | intended use | status |
|------------|----------|--------|---------|--------------|----------------|-----------------|--------------|--------|
| oulad | authentic_public | UCI mirror `349` / Open University | CC BY 4.0 (per docs) | 46,748,244 B | ~464,413,754 B | full tables | C1 clustering; C3 risk | acquired |
| ednet_kt1_subset | authentic_public | https://github.com/riiid/ednet (bit.ly / USTC mirrors) | CC BY-NC-SA 4.0 | KT1 zip ~1.22 GB local | selective extract | **600 students / 300,851 interactions** (manifest); v2 split 390/105/105 | C2 correctness | **acquired** — serving `c2_ednet_v2_*`; see `processed/ednet/dataset_manifest.json` |
| uci_student_performance | authentic_public | UCI ML DB `00320/student.zip` | CC BY 4.0 (UCI) | 20,478 B | ~153,688 B | mat+por CSVs | separate C3 benchmark | acquired |
| squad_2.0 | authentic_public | SQuAD Explorer | SQuAD license | — | — | — | optional QA bench | **not downloaded** (no defined Arts KB use) |
| synthetic_arts_* | synthetic_learner | local generator `arts_ai.synthetic` | synthetic demo — not institutional | see run manifest | see run tables | config population | C1 twin val; C2 Arts; C3 synth; C4 content | generated locally |
| arts_content generated | generated_content | provisional catalogue | awaiting review | — | — | topics/resources/questions | C4 fixture RAG | generated; **not verified syllabus** |
| arts_domain_wikipedia_cc | authentic_public | English Wikipedia extracts (MediaWiki API) | CC BY-SA 4.0 | — | text extracts | supplemental docs mapped to provisional curriculum topics | C4 domain RAG | acquired; **unreviewed**; indexed; **not** complete A/L corpus |
| nie_al_syllabus_pdfs | official_public_page_candidate | nie.lk syllabus PDFs | reuse **unclear** / all rights reserved | PDF | — | History + Economics (+ others) candidates | curriculum **structure** reference only | acquired to `candidates/`; **not indexed** as teaching text |
| nie_al_arts_provisional_v0.1 | curriculum_structure | NIE public syllabi titles | structure reference | registry JSON | — | History, Geography, Political Science, Economics (+ Sinhala Lit placeholder) | canonical topic IDs | **provisional** — awaiting stakeholder confirmation |

## EdNet historical note

Earlier access attempts recorded form-gated / missing-subset failures (`ednet_unavailable.json`, `c2_ednet_blocked.json`). Those remain **historical**. Authentic KT1 was later acquired via public mirrors; subset CSV and **v2** serving run are current. Do not re-state EdNet as blocked.

Paths: `backend/ml/data/public/processed/ednet/ednet_kt1_subset.csv`, `dataset_manifest.json`.

## Integrity rules

- Synthetic rows are labelled with `data_origin`, `generator_version`, `scenario_id`, `seed`.
- Synthetic smoke tables must **not** replace the public EdNet experiment.
- Checksums and paths: see `backend/ml/data/public/processed/*/dataset_manifest.json` and `backend/ml/data/synthetic/manifests/`.
- Wikipedia supplemental extracts ≠ full syllabus teaching coverage.
- NIE PDFs: structure reference / candidates pending permission — not auto-indexed teaching corpus.

## Schema notes

- OULAD: course-relative `date` on VLE events; cutoff days 0–13 inclusive for C1/C3.
- UCI Student Performance: **no** weekly event histories.
- EdNet KT1 columns: `timestamp`, `solving_id`, `question_id`, `user_answer`, `elapsed_time`, `student_id`, `correct`.
