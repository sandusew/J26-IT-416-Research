"""Checksum helpers for manifests and reproducibility."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd


def file_sha256(path: Path | str, chunk_size: int = 1 << 20) -> str:
    path = Path(path)
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def dataframe_hash(df: "pd.DataFrame", cols: list[str] | None = None) -> str:
    """Stable content hash of a DataFrame (sorted rows for determinism)."""
    import pandas as pd

    subset = df if cols is None else df[cols]
    # Convert to CSV bytes with sorted index for stability
    content = subset.sort_index(axis=0).sort_index(axis=1).to_csv(index=True).encode("utf-8")
    return hashlib.sha256(content).hexdigest()


def bytes_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
