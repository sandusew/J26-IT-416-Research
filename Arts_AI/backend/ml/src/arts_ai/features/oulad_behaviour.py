"""OULAD behavioural features for clustering (pre-outcome, cutoff-aware)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from arts_ai.common.logging_utils import get_logger

logger = get_logger("arts_ai.features.behaviour")


def build_behaviour_features(
    student_info: pd.DataFrame,
    student_vle: pd.DataFrame,
    vle: pd.DataFrame,
    *,
    cutoff_days: int = 13,
) -> pd.DataFrame:
    """Build supported activity features using course days 0..cutoff_days inclusive.

    Does NOT convert clicks to study minutes/mastery/attention.
    Excludes identifiers from the returned feature matrix (keeps id columns separately).
    Late registration / withdrawal / no activity flagged separately.
    """
    sv = student_vle.copy()
    # OULAD date is days relative to module start; negative = before start
    sv = sv[(sv["date"] >= 0) & (sv["date"] <= cutoff_days)]

    vle_cols = vle[["id_site", "activity_type"]].drop_duplicates()
    sv = sv.merge(vle_cols, on="id_site", how="left")

    key = ["code_module", "code_presentation", "id_student"]

    agg = (
        sv.groupby(key)
        .agg(
            total_clicks=("sum_click", "sum"),
            active_days=("date", "nunique"),
            last_active_day=("date", "max"),
            first_active_day=("date", "min"),
            n_events=("sum_click", "count"),
        )
        .reset_index()
    )

    # Regularity: coefficient of variation of daily clicks
    daily = sv.groupby(key + ["date"])["sum_click"].sum().reset_index()
    reg = (
        daily.groupby(key)["sum_click"]
        .agg(lambda s: float(s.std(ddof=0) / s.mean()) if s.mean() > 0 else 0.0)
        .reset_index(name="click_regularity_cv")
    )
    agg = agg.merge(reg, on=key, how="left")

    # Recency: days since last activity within window (higher = less recent)
    agg["recency_last_active_day"] = cutoff_days - agg["last_active_day"]

    # Resource-type proportions
    type_counts = (
        sv.groupby(key + ["activity_type"])["sum_click"].sum().reset_index(name="clicks")
    )
    pivot = type_counts.pivot_table(
        index=key, columns="activity_type", values="clicks", fill_value=0
    )
    pivot["total"] = pivot.sum(axis=1).replace(0, np.nan)

    def prop(col: str) -> pd.Series:
        if col in pivot.columns:
            return (pivot[col] / pivot["total"]).fillna(0.0)
        return pd.Series(0.0, index=pivot.index)

    props = pd.DataFrame(
        {
            "prop_resource": prop("resource"),
            "prop_oucontent": prop("oucontent"),
            "prop_forumng": prop("forumng"),
            "prop_quiz": prop("quiz"),
        }
    )
    known = ["resource", "oucontent", "forumng", "quiz"]
    other_cols = [c for c in pivot.columns if c not in known + ["total"]]
    if other_cols:
        props["prop_other"] = pivot[other_cols].sum(axis=1) / pivot["total"]
    else:
        props["prop_other"] = 0.0
    props = props.fillna(0.0).reset_index()

    feat = agg.merge(props, on=key, how="left")

    # Merge student info for cohort flags (not used as cluster features)
    info = student_info.copy()
    out = info.merge(feat, on=key if set(key).issubset(info.columns) else ["id_student"], how="left")
    # Fix merge if code columns only on one side
    if "total_clicks" not in out.columns:
        out = info.merge(feat, on=["id_student"], how="left")

    out["total_clicks"] = out["total_clicks"].fillna(0)
    out["active_days"] = out["active_days"].fillna(0)
    out["click_regularity_cv"] = out["click_regularity_cv"].fillna(0)
    out["recency_last_active_day"] = out["recency_last_active_day"].fillna(cutoff_days + 1)
    for c in ("prop_resource", "prop_oucontent", "prop_forumng", "prop_quiz", "prop_other"):
        out[c] = out[c].fillna(0.0)

    # Late registration: registered after day 0 (if date_registration available)
    if "date_registration" in out.columns:
        out["late_registration"] = out["date_registration"].fillna(0) > 0
    else:
        out["late_registration"] = False

    out["is_withdrawn"] = out.get("final_result", pd.Series(dtype=str)).eq("Withdrawn")
    out["no_observed_activity"] = out["total_clicks"] <= 0
    out["insufficient_data"] = out["no_observed_activity"] | (out["active_days"] < 1)
    out["observation_cutoff_days"] = cutoff_days
    out["data_category"] = "authentic_public"

    feature_cols = [
        "total_clicks",
        "active_days",
        "click_regularity_cv",
        "recency_last_active_day",
        "prop_resource",
        "prop_oucontent",
        "prop_forumng",
        "prop_quiz",
        "prop_other",
    ]
    # Ensure no outcome leakage into feature list
    assert "final_result" not in feature_cols
    out.attrs["feature_cols"] = feature_cols
    logger.info(
        "Behaviour features: %s students, %s eligible with activity",
        len(out),
        int((~out["insufficient_data"]).sum()),
    )
    return out
