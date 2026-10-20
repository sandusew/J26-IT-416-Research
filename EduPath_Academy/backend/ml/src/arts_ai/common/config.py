"""YAML configuration loading."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from arts_ai.common.paths import get_paths


def load_yaml_config(name: str | Path) -> dict[str, Any]:
    """Load a YAML config by filename from configs/ or absolute path."""
    path = Path(name)
    if not path.is_file():
        path = get_paths().configs / name
    if not path.is_file():
        raise FileNotFoundError(f"Config not found: {name}")
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Config root must be a mapping: {path}")
    return data
