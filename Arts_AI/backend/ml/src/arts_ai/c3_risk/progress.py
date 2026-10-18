"""Progress summaries and intervention records (no causal claims)."""

from __future__ import annotations

from typing import Any

import pandas as pd


def progress_summary(
    student_id: str,
    assessment_results: pd.DataFrame,
    attendance: pd.DataFrame,
    interventions: pd.DataFrame | None = None,
) -> dict[str, Any]:
    ar = assessment_results[assessment_results["student_id"] == student_id]
    att = attendance[attendance["student_id"] == student_id]
    present_rate = None
    if len(att):
        present_rate = float((att["attendance_status"] == "present").mean())

    marks = ar["marks_obtained"].dropna()
    summary = {
        "student_id": student_id,
        "n_assessment_results": int(len(ar)),
        "mean_marks": float(marks.mean()) if len(marks) else None,
        "latest_result_status": ar.sort_values("available_at")["result_status"].iloc[-1]
        if len(ar)
        else None,
        "attendance_present_rate": present_rate,
        "interventions": [],
        "causal_claim": False,
        "note": "Summaries and intervention logs only; no causal improvement claimed",
    }
    if interventions is not None:
        iv = interventions[interventions["student_id"] == student_id]
        summary["interventions"] = iv.to_dict(orient="records")
    return summary
