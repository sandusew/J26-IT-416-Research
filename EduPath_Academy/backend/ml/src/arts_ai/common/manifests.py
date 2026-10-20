"""Dataset and training-run manifests."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DatasetManifest(BaseModel):
    dataset_id: str
    name: str
    data_category: str  # authentic_public | synthetic_learner | sourced_content | generated_content
    source_url: str | None = None
    license: str | None = None
    schema_version: str = "0.1.0"
    local_path: str
    checksum_sha256: str | None = None
    archive_size_bytes: int | None = None
    extracted_size_bytes: int | None = None
    selected_sample_size: int | None = None
    record_counts: dict[str, int] = Field(default_factory=dict)
    filters: dict[str, Any] = Field(default_factory=dict)
    domain: str | None = None
    intended_use: str | None = None
    generator_version: str | None = None
    seed: int | None = None
    scenario_id: str | None = None
    notes: str | None = None
    created_at: str = Field(default_factory=_utc_now)


class RunManifest(BaseModel):
    run_id: str
    component: str
    task: str
    config_name: str
    config: dict[str, Any] = Field(default_factory=dict)
    data_hashes: dict[str, str] = Field(default_factory=dict)
    sample_counts: dict[str, int] = Field(default_factory=dict)
    feature_schema: list[str] = Field(default_factory=list)
    split_manifest_path: str | None = None
    seeds: dict[str, int] = Field(default_factory=dict)
    hyperparameters: dict[str, Any] = Field(default_factory=dict)
    dependency_versions: dict[str, str] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    artifact_paths: dict[str, str] = Field(default_factory=dict)
    artifact_hashes: dict[str, str] = Field(default_factory=dict)
    model_card_path: str | None = None
    status: str = "completed"
    notes: str | None = None
    created_at: str = Field(default_factory=_utc_now)


def write_manifest(manifest: BaseModel, path: Path | str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
    return path


def read_manifest(path: Path | str, model: type[BaseModel] = RunManifest) -> BaseModel:
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    return model.model_validate(data)


def save_json(obj: Any, path: Path | str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")
    return path
