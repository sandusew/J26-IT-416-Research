"""Component 4: Context-Aware AI Chatbot and Teacher/Peer Consultation."""

from arts_ai.c4_chatbot.rag import KnowledgeIndex, answer_question
from arts_ai.c4_chatbot.topic_classifier import train_topic_classifier
from arts_ai.c4_chatbot.consultation import ConsultationService

__all__ = [
    "KnowledgeIndex",
    "answer_question",
    "train_topic_classifier",
    "ConsultationService",
]
