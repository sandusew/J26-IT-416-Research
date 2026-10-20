"""Recommendation and learning-evaluation schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from arts_ai.schemas.provenance import Provenance


class RecommendationLog(BaseModel):
    recommendation_id: str
    student_id: str
    profile_snapshot_id: str | None = None
    model_or_policy_version: str
    candidate_ids: list[str] = Field(default_factory=list)
    resource_id: str
    rank: int
    score: float
    generated_at: datetime
    shown_at: datetime | None = None
    opened_at: datetime | None = None
    completed_at: datetime | None = None
    provenance: Provenance | None = None


class LearningEvaluation(BaseModel):
    student_id: str
    topic_id: str
    pre_assessment_id: str | None = None
    post_assessment_id: str | None = None
    assigned_method: str
    assignment_method: str
    pre_score: float | None = None
    post_score: float | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    extra: dict[str, Any] = Field(default_factory=dict)
    provenance: Provenance | None = None
