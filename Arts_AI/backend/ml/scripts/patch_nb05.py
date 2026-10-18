import json
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "notebooks" / "05_synthetic_arts.ipynb"
nb = json.loads(p.read_text(encoding="utf-8"))
for c in nb["cells"]:
    if c["cell_type"] == "code" and any("generate_synthetic_arts" in line for line in c["source"]):
        c["source"] = [
            "from arts_ai.common.paths import get_paths\n",
            "from arts_ai.synthetic.generator import generate_synthetic_arts\n",
            "import pandas as pd\n",
            "existing = sorted([d for d in get_paths().synthetic.iterdir() if d.is_dir() and (d / 'dataset_manifest.json').exists()])\n",
            "if existing:\n",
            "    out = existing[-1]\n",
            "    print('Reusing existing synthetic dataset:', out)\n",
            "    print({f.stem: len(pd.read_csv(f)) for f in out.glob('*.csv')})\n",
            "else:\n",
            "    r = generate_synthetic_arts()\n",
            "    print(r.output_dir)\n",
            "    print({k: len(v) for k, v in r.tables.items()})\n",
            "    print('manifest', r.manifest_path)\n",
        ]
p.write_text(json.dumps(nb, indent=2), encoding="utf-8")
print("patched", p)
