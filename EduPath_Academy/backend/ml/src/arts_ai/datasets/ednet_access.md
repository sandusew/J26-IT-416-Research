# EdNet access (legitimate)

Do **not** bypass access controls or submit academic forms on a user’s behalf.

## Official sources

1. GitHub: https://github.com/riiid/ednet — KT1 `https://bit.ly/ednet_kt1`, Contents `https://bit.ly/ednet-content` (CC BY-NC 4.0)
2. Mirror used successfully: http://base.ustc.edu.cn/data/EdNet/

## Acquisition status (this machine)

| Asset | Status | Evidence |
|-------|--------|----------|
| Contents | Downloaded + extracted | `EdNet-Contents.zip`; `contents/**/questions.csv` |
| KT1 archive | Downloaded | `EdNet-KT1.zip` (1,218,656,153 B) |
| KT1 CSVs | Selective extract **8,000** of ~784,309 | `raw/ednet/kt1/` |
| Subset | **600 students / 300,851 rows** (seed=42) | `processed/ednet/ednet_kt1_subset.csv` |
| Correctness | Contents join | 0 nulls |
| Train v1 (preserved) | Majority on +F1 | `c2_ednet_20261013T121127_34960c38` |
| Train v2 (serving) | Logistic on val ROC-AUC | `c2_ednet_v2_20261013T153128_f83023f6` |
| Diagnosis | Why majority won v1 | `reports/ednet_baseline_diagnosis.json` |

## Commands

```powershell
$env:EDNET_CSV_POOL='8000'; $env:EDNET_MAX_STUDENTS='600'
backend\ml\.venv\Scripts\python.exe backend\ml\scripts\download_ednet.py
backend\ml\.venv\Scripts\python.exe -c "from arts_ai.c2_recommendation.ednet_correctness_v2 import train_ednet_correctness_v2; print(train_ednet_correctness_v2(update_latest_pointer=True))"
```
