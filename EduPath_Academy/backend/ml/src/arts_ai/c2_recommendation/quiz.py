"""Adaptive quiz selection from reviewed / available content."""

from __future__ import annotations

from typing import Any

import pandas as pd


def select_adaptive_quiz(
    questions: pd.DataFrame,
    attempts: pd.DataFrame,
    student_id: str,
    topic_id: str,
    *,
    n: int = 5,
    prefer_review_status: tuple[str, ...] = ("reviewed", "pending_review", "unreviewed"),
) -> list[dict[str, Any]]:
    """Select questions by difficulty near estimated proficiency; retain review_status on explanations."""
    pool = questions[questions["topic_id"] == topic_id].copy()
    if pool.empty:
        return []

    stu = attempts[attempts["student_id"] == student_id]
    if len(stu) and stu["score"].notna().any():
        est = float(stu["score"].dropna().mean())
    else:
        est = 0.5

    # Prefer higher review status
    status_rank = {s: i for i, s in enumerate(prefer_review_status)}
    pool["status_rank"] = pool["review_status"].map(lambda x: status_rank.get(x, 99))
    pool["diff_gap"] = (pool["difficulty"] - est).abs()
    pool = pool.sort_values(["status_rank", "diff_gap"])

    selected = []
    for _, q in pool.head(n).iterrows():
        selected.append(
            {
                "question_id": q["question_id"],
                "topic_id": q["topic_id"],
                "text": q["text"],
                "options": q.get("options"),
                "difficulty": float(q["difficulty"]),
                "explanation": q.get("explanation"),
                "explanation_review_status": q.get("review_status"),
                "source_reference": q.get("source_reference"),
                "selection_policy": "difficulty_near_estimated_score",
            }
        )
    return selected
