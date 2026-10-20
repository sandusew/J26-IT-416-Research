"""Educational content schemas."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from arts_ai.schemas.provenance import Provenance, ReviewStatus
from arts_ai.schemas.student import Medium


class ResourceType(str, Enum):
    NOTE = "note"
    VIDEO = "video"
    QUIZ = "quiz"
    EXERCISE = "exercise"
    PAST_PAPER = "past_paper"
    SUMMARY = "summary"
    EXTERNAL = "external"


class QuestionType(str, Enum):
    MCQ = "mcq"
    SHORT = "short"
    ESSAY = "essay"
    TRUE_FALSE = "true_false"


class GradingMethod(str, Enum):
    AUTO = "auto"
    RUBRIC = "rubric"
    TEACHER = "teacher"
    PEER = "peer"


class Subject(BaseModel):
    subject_id: str
    name: str
    grade: str
    medium: Medium
    syllabus_version: str
    is_provisional: bool = True
    provenance: Provenance | None = None


class Topic(BaseModel):
    topic_id: str
    subject_id: str
    name: str
    learning_objective: str
    provenance: Provenance | None = None


class TopicPrerequisite(BaseModel):
    topic_id: str
    prerequisite_topic_id: str
    provenance: Provenance | None = None


class Resource(BaseModel):
    resource_id: str
    topic_id: str
    type: ResourceType
    difficulty: float = Field(ge=0, le=1)
    language: Medium
    source_reference: str
    review_status: ReviewStatus = ReviewStatus.UNREVIEWED
    title: str | None = None
    provenance: Provenance | None = None


class Question(BaseModel):
    question_id: str
    topic_id: str
    type: QuestionType
    text: str
    options: list[str] | None = None
    answer_or_rubric: str
    max_marks: float
    difficulty: float = Field(ge=0, le=1)
    explanation: str | None = None
    source_reference: str
    review_status: ReviewStatus = ReviewStatus.UNREVIEWED
    provenance: Provenance | None = None


class QuestionAttempt(BaseModel):
    attempt_id: str
    student_id: str
    question_id: str
    started_at: datetime
    submitted_at: datetime | None = None
    response: Any = None
    score: float | None = None
    max_marks: float
    attempt_number: int = 1
    hints_used: int = 0
    grading_method: GradingMethod = GradingMethod.AUTO
    provenance: Provenance | None = None
