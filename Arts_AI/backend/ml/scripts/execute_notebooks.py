"""Execute notebooks with the project venv kernel; skip heavy retrain if ART_AI_SMOKE=1."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from arts_ai.common.paths import get_paths


def main() -> None:
    nb_dir = get_paths().notebooks
    out_dir = nb_dir / "executed"
    out_dir.mkdir(parents=True, exist_ok=True)
    smoke = os.environ.get("ARTS_AI_SMOKE", "0") == "1"
    notebooks = sorted(nb_dir.glob("0*.ipynb"))
    if smoke:
        # Evidence-preserving smoke: summary + blocked ednet + retrieval only
        notebooks = [
            nb_dir / "04_ednet_correctness.ipynb",
            nb_dir / "07_chatbot_retrieval.ipynb",
            nb_dir / "08_results_summary_inference.ipynb",
        ]
    py = sys.executable
    for nb in notebooks:
        if not nb.exists():
            continue
        out = out_dir / nb.name.replace(".ipynb", ".executed.ipynb")
        cmd = [
            py,
            "-m",
            "jupyter",
            "nbconvert",
            "--to",
            "notebook",
            "--execute",
            "--ExecutePreprocessor.timeout=1800",
            f"--output={out.name}",
            f"--output-dir={out_dir}",
            str(nb),
        ]
        print("Executing", nb.name, "->", out)
        subprocess.check_call(cmd)
    print("Done. Executed notebooks in", out_dir)


if __name__ == "__main__":
    main()
