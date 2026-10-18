"""OULAD academic-risk features at a declared observation cutoff."""

from __future__ import annotations

import pandas as pd

from arts_ai.features.oulad_behaviour import build_behaviour_features


def build_risk_features(
    student_info: pd.DataFrame,
    student_vle: pd.DataFrame,
    vle: pd.DataFrame,
    student_registration: pd.DataFrame | None = None,
    *,
    cutoff_days: int = 13,
) -> pd.DataFrame:
    """Features available at cutoff only; target attached separately by training code."""
    feat = build_behaviour_features(
        student_info, student_vle, vle, cutoff_days=cutoff_days
    )
    # Demographic/context available at start (not future outcomes)
    keep_demo = [
        c
        for c in (
            "code_module",
            "code_presentation",
            "id_student",
            "gender",
            "region",
            "highest_education",
            "imd_band",
            "age_band",
            "num_of_prev_attempts",
            "studied_credits",
            "disability",
            "final_result",
        )
        if c in feat.columns
    ]
    feature_cols = list(feat.attrs.get("feature_cols", []))
    # Add studied_credits / num_of_prev_attempts as pre-cutoff context
    for c in ("num_of_prev_attempts", "studied_credits"):
        if c in feat.columns and c not in feature_cols:
            feature_cols.append(c)
    out = feat.copy()
    out.attrs["feature_cols"] = feature_cols
    out.attrs["target_col"] = "final_result"
    return out
