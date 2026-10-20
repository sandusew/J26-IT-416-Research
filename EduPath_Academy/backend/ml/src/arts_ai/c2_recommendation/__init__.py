"""Component 2: Personalized Learning and Recommendation Engine."""

from arts_ai.c2_recommendation.ednet_correctness import train_ednet_correctness
from arts_ai.c2_recommendation.arts_recommend import train_arts_recommendation
from arts_ai.c2_recommendation.quiz import select_adaptive_quiz

__all__ = ["train_ednet_correctness", "train_arts_recommendation", "select_adaptive_quiz"]
