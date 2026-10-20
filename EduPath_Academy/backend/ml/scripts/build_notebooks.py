"""Create executed-ready Jupyter notebooks that call shared modules."""

from __future__ import annotations

import json
from pathlib import Path

from arts_ai.common.paths import get_paths


def nb(cells: list[tuple[str, str]]) -> dict:
    out_cells = []
    for kind, source in cells:
        src = source.strip("\n") + "\n"
        if kind == "md":
            out_cells.append(
                {
                    "cell_type": "markdown",
                    "metadata": {},
                    "source": [line + "\n" for line in src.split("\n")],
                }
            )
        else:
            out_cells.append(
                {
                    "cell_type": "code",
                    "execution_count": None,
                    "metadata": {},
                    "outputs": [],
                    "source": [line + "\n" for line in src.split("\n")],
                }
            )
    return {
        "cells": out_cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3 (arts_ai)",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


NOTEBOOKS = {
    "01_dataset_audit.ipynb": [
        ("md", "# Dataset audit and preparation\nAuthentic public vs synthetic categories kept separate."),
        (
            "code",
            """
from arts_ai.common.paths import get_paths
from arts_ai.datasets.oulad import download_oulad
from arts_ai.datasets.uci_student import download_uci_student
from arts_ai.datasets.ednet import download_ednet_subset
import json

paths = get_paths(); paths.ensure()
oulad = download_oulad()
uci = download_uci_student()
ednet = download_ednet_subset(max_students=200)
print('OULAD:', oulad.get('status'), oulad.get('errors'))
print('UCI:', uci.get('status'))
print('EdNet:', ednet.get('status'), ednet.get('errors'))
print('NOTE: If EdNet failed, do NOT claim public EdNet experiment completed with synthetic data.')
""",
        ),
    ],
    "02_behaviour_clustering.ipynb": [
        ("md", "# C1 Behaviour clustering (OULAD)\nCourse days 0–13; silhouette selection; no classification accuracy."),
        (
            "code",
            """
from arts_ai.c1_behaviour.train import train_behaviour_clustering
result = train_behaviour_clustering()
print(result['run_id'])
print(result['metrics'])
""",
        ),
    ],
    "03_academic_risk.ipynb": [
        ("md", "# C3 Academic risk (OULAD primary)\nFail vs Pass/Distinction; Withdrawn excluded."),
        (
            "code",
            """
from arts_ai.c3_risk.train_oulad import train_oulad_risk
from arts_ai.c3_risk.train_uci import train_uci_benchmark
r = train_oulad_risk()
print(r['run_id'], r['metrics']['selected_on_validation_f1'])
print('test', r['metrics']['test'][r['metrics']['selected_on_validation_f1']])
u = train_uci_benchmark()
print('UCI', u['metrics'])
""",
        ),
    ],
    "04_ednet_correctness.ipynb": [
        ("md", "# C2 EdNet next-answer correctness (public track)\nBlocked if authentic KT1 unavailable — no silent synthetic replacement."),
        (
            "code",
            """
from arts_ai.c2_recommendation.ednet_correctness import train_ednet_correctness
r = train_ednet_correctness()
print(r)
""",
        ),
    ],
    "05_synthetic_arts.ipynb": [
        ("md", "# Synthetic Arts generation\nAll rows labelled synthetic_learner / generated_content."),
        (
            "code",
            """
from arts_ai.synthetic.generator import generate_synthetic_arts
r = generate_synthetic_arts()
print(r.output_dir)
print({k: len(v) for k, v in r.tables.items()})
print('manifest', r.manifest_path)
""",
        ),
    ],
    "06_simulated_recommendation.ipynb": [
        ("md", "# C2 Arts simulated recommendation\nPrerequisite baseline + candidate scorer on held-out simulated learners."),
        (
            "code",
            """
from arts_ai.c2_recommendation.arts_recommend import train_arts_recommendation
r = train_arts_recommendation()
print(r['metrics'])
""",
        ),
    ],
    "07_chatbot_retrieval.ipynb": [
        ("md", "# C4 Chatbot retrieval + topic classifier\nIndexing is not model training. Generated content awaits review."),
        (
            "code",
            """
from arts_ai.c4_chatbot.rag import build_index_from_synthetic, KnowledgeIndex, answer_question
from arts_ai.c4_chatbot.topic_classifier import train_topic_classifier

info = build_index_from_synthetic()
print(info)
idx = KnowledgeIndex.load()
ans = answer_question('What is concept-0-a in History topic 1?', idx)
print(ans['insufficient_evidence'], ans['citations'][:1])
t = train_topic_classifier()
print(t)
""",
        ),
    ],
    "08_results_summary_inference.ipynb": [
        ("md", "# Results summary and saved-model inference smoke"),
        (
            "code",
            """
from pathlib import Path
import json, joblib
from arts_ai.common.paths import get_paths
import numpy as np

p = get_paths()
reports = list(p.reports.glob('*.json'))
print('Reports:', [r.name for r in reports])
# C1 inference
latest = (p.artifact('c1') / 'LATEST_RUN.txt')
if latest.exists():
    run = latest.read_text().strip()
    bundle = joblib.load(p.artifact('c1') / run / 'kmeans_pipeline.joblib')
    X = np.zeros((1, len(bundle['feature_cols'])))
    print('C1 cluster', bundle['pipeline'].predict(X)[0], 'run', run)
# C3 inference
latest3 = p.artifact('c3') / 'LATEST_OULAD_RUN.txt'
if latest3.exists():
    run = latest3.read_text().strip()
    bundle = joblib.load(p.artifact('c3') / run / 'risk_pipeline.joblib')
    cols = bundle['feature_cols']
    X = np.zeros((1, len(cols)))
    m = bundle['models'][bundle['selected']]
    print('C3 proba_fail', m.predict_proba(X)[0,1], 'selected', bundle['selected'])
print('Done')
""",
        ),
    ],
}


def main():
    nb_dir = get_paths().notebooks
    nb_dir.mkdir(parents=True, exist_ok=True)
    for name, cells in NOTEBOOKS.items():
        path = nb_dir / name
        path.write_text(json.dumps(nb(cells), indent=2), encoding="utf-8")
        print("wrote", path)


if __name__ == "__main__":
    main()
