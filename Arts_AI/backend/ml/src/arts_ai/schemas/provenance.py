"""Row-level and dataset-level provenance."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class DataOrigin(str, Enum):
    AUTHENTIC_PUBLIC = "authentic_public"
    SYNTHETIC_LEARNER = "synthetic_learner"
    SYNTHETIC_OPERATIONAL = "synthetic_operational"
    SOURCED_CONTENT = "sourced_content"
    GENERATED_CONTENT = "generated_content"
    DERIVED = "derived"


class ReviewStatus(str, Enum):
    UNREVIEWED = "unreviewed"
    PENDING_REVIEW = "pending_review"
    REVIEWED = "reviewed"
    REJECTED = "rejected"
    NOT_APPLICABLE = "not_applicable"


class Provenance(BaseModel):
    data_origin: DataOrigin
    generator_version: str | None = None
    scenario_id: str | None = None
    seed: int | None = None
    generation_timestamp: datetime | None = None
    parameter_config_ref: str | None = None
    source_references: list[str] = Field(default_factory=list)
    source_record_ids: list[str] = Field(default_factory=list)
    split_membership: str | None = None  # train | validation | test | none
    extra: dict[str, Any] = Field(default_factory=dict)
