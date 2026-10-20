"""Typed data contracts for Arts AI domain entities."""

from arts_ai.schemas.student import (
    Student,
    StudentSubject,
    QuestionnaireResponse,
    DiagnosticAssignment,
    LearningEvent,
)
from arts_ai.schemas.content import (
    Subject,
    Topic,
    TopicPrerequisite,
    Resource,
    Question,
    QuestionAttempt,
)
from arts_ai.schemas.progress import (
    Assessment,
    AssessmentResult,
    Attendance,
    SupportIntervention,
)
from arts_ai.schemas.recommendations import RecommendationLog, LearningEvaluation
from arts_ai.schemas.chatbot import (
    KnowledgeDocument,
    QAEvaluation,
    ChatInteraction,
    Teacher,
    TeacherExpertise,
    TeacherAvailability,
    Consultation,
    StudyGroup,
    GroupMembership,
)
from arts_ai.schemas.provenance import Provenance

__all__ = [
    "Student",
    "StudentSubject",
    "QuestionnaireResponse",
    "DiagnosticAssignment",
    "LearningEvent",
    "Subject",
    "Topic",
    "TopicPrerequisite",
    "Resource",
    "Question",
    "QuestionAttempt",
    "Assessment",
    "AssessmentResult",
    "Attendance",
    "SupportIntervention",
    "RecommendationLog",
    "LearningEvaluation",
    "KnowledgeDocument",
    "QAEvaluation",
    "ChatInteraction",
    "Teacher",
    "TeacherExpertise",
    "TeacherAvailability",
    "Consultation",
    "StudyGroup",
    "GroupMembership",
    "Provenance",
]
