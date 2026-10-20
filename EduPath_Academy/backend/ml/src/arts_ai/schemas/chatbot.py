"""Chatbot, teacher consultation and peer-group schemas."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator

from arts_ai.schemas.provenance import Provenance, ReviewStatus


class ConsultationState(str, Enum):
    REQUESTED = "requested"
    APPROVED = "approved"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    DECLINED = "declined"


class KnowledgeDocument(BaseModel):
    document_id: str
    subject_id: str | None = None
    topic_id: str | None = None
    source_reference: str
    permission_reference: str
    version: str
    review_status: ReviewStatus = ReviewStatus.UNREVIEWED
    title: str | None = None
    text: str | None = None
    provenance: Provenance | None = None


class QAEvaluation(BaseModel):
    qa_id: str
    question: str
    expected_answer: str
    supporting_passage: str | None = None
    answerable: bool = True
    origin: str  # generated | manually_authored | teacher_reviewed | squad
    review_status: ReviewStatus = ReviewStatus.UNREVIEWED
    provenance: Provenance | None = None


class ChatInteraction(BaseModel):
    interaction_id: str
    student_id: str
    question: str
    answer: str
    citations: list[dict[str, Any]] = Field(default_factory=list)
    model_version: str
    timestamp: datetime
    feedback: str | None = None
    insufficient_evidence: bool = False
    provenance: Provenance | None = None


class Teacher(BaseModel):
    teacher_id: str
    display_name: str
    is_synthetic_fixture: bool = True
    provenance: Provenance | None = None


class TeacherExpertise(BaseModel):
    teacher_id: str
    subject_id: str
    topic_ids: list[str] = Field(default_factory=list)
    proficiency_level: str = "secondary"
    provenance: Provenance | None = None


class TeacherAvailability(BaseModel):
    availability_id: str
    teacher_id: str
    start_at: datetime
    end_at: datetime
    timezone: str = "Asia/Colombo"
    provenance: Provenance | None = None

    @field_validator("start_at", "end_at")
    @classmethod
    def require_tz(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("availability timestamps must be timezone-aware")
        return v


class Consultation(BaseModel):
    consultation_id: str
    student_id: str
    teacher_id: str
    subject_id: str | None = None
    requested_slot_start: datetime
    requested_slot_end: datetime
    state: ConsultationState = ConsultationState.REQUESTED
    meeting_url: str | None = None
    meeting_integration_status: str = "unconfigured"  # unconfigured | configured | failed
    notes: str | None = None
    created_at: datetime
    updated_at: datetime
    provenance: Provenance | None = None


class StudyGroup(BaseModel):
    group_id: str
    name: str
    subject_id: str
    topic_id: str | None = None
    created_at: datetime
    provenance: Provenance | None = None


class GroupMembership(BaseModel):
    group_id: str
    student_id: str
    joined_at: datetime
    role: str = "member"
    provenance: Provenance | None = None
