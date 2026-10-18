"""Component 3: Academic Risk and Progress Analytics."""

from arts_ai.c3_risk.train_oulad import train_oulad_risk
from arts_ai.c3_risk.train_uci import train_uci_benchmark
from arts_ai.c3_risk.train_synthetic import train_synthetic_arts_risk
from arts_ai.c3_risk.progress import progress_summary

__all__ = [
    "train_oulad_risk",
    "train_uci_benchmark",
    "train_synthetic_arts_risk",
    "progress_summary",
]
