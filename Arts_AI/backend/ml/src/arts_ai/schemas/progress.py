"""Progress, attendance and intervention schemas."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum

from pydantic import BaseModel

from arts_ai.schemas.provenance import Provenance


class ResultStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    DISTINCTION = "distinction"
    ABSENT = "absent"
    WITHDRAWN = "withdrawn"
    PENDING = "pending"


class AttendanceStatus(str, Enum):
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"
    EXCUSED = "excused"


class InterventionType(str, Enum):
    REMEDIATION = "remediation"
    COUNSELLING = "counselling"
    PEER_GROUP = "peer_group"
    TEACHER_CONSULT = "teacher_consult"
    EXTRA_PRACTICE = "extra_practice"


class Assessment(BaseModel):
    assessment_id: str
    subject_id: str
    date: date
    max_marks: float
    pass_mark: float
    grading_policy_version: str
    provenance: Provenance | None = None


class AssessmentResult(BaseModel):
    student_id: str
    assessment_id: str
    marks_obtained: float | None = None
    result_status: ResultStatus
    available_at: datetime
    provenance: Provenance | None = None


class Attendance(BaseModel):
    student_id: str
    subject_id: str
    class_date: date
    attendance_status: AttendanceStatus
    provenance: Provenance | None = None


class SupportIntervention(BaseModel):
    intervention_id: str
    student_id: str
    type: InterventionType
    recommended_at: datetime
    completed_at: datetime | None = None
    notes: str | None = None
    provenance: Provenance | None = None
