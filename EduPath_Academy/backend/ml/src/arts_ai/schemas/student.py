"""Student and activity schemas."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from arts_ai.schemas.provenance import Provenance


class Medium(str, Enum):
    SINHALA = "sinhala"
    TAMIL = "tamil"
    ENGLISH = "english"


class EnrolmentStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    WITHDRAWN = "withdrawn"
    DEFERRED = "deferred"


class AssignmentStatus(str, Enum):
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"


class EventType(str, Enum):
    VIEW = "view"
    CLICK = "click"
    COMPLETE = "complete"
    QUIZ_START = "quiz_start"
    QUIZ_SUBMIT = "quiz_submit"
    DOWNLOAD = "download"
    PAUSE = "pause"
    RESUME = "resume"


class Student(BaseModel):
    student_id: str
    grade: str  # e.g. "A/L"
    age_band: str | None = None
    medium: Medium
    enrolment_date: date
    provenance: Provenance | None = None


class StudentSubject(BaseModel):
    student_id: str
    subject_id: str
    enrolled_at: datetime
    status: EnrolmentStatus = EnrolmentStatus.ACTIVE
    provenance: Provenance | None = None


class QuestionnaireResponse(BaseModel):
    student_id: str
    questionnaire_version: str
    question_code: str
    response_value: Any
    answered_at: datetime
    provenance: Provenance | None = None


class DiagnosticAssignment(BaseModel):
    assignment_id: str
    student_id: str
    activity_id: str
    assigned_at: datetime
    due_at: datetime | None = None
    completed_at: datetime | None = None
    status: AssignmentStatus = AssignmentStatus.ASSIGNED
    provenance: Provenance | None = None


class LearningEvent(BaseModel):
    event_id: str
    student_id: str
    session_id: str
    resource_id: str | None = None
    event_type: EventType
    event_timestamp: datetime
    active_seconds: float | None = Field(default=None, description="Observed active seconds; not inferred from clicks")
    progress_percent: float | None = Field(default=None, ge=0, le=100)
    provenance: Provenance | None = None
