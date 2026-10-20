"""Digital Twin update service with evidence counts and insufficient-data states."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from arts_ai.common.logging_utils import get_logger
from arts_ai.common.paths import get_paths

logger = get_logger("arts_ai.c1.twin")


def _latest_c1_model() -> Path | None:
    root = get_paths().artifact("c1")
    latest = root / "LATEST_RUN.txt"
    if not latest.exists():
        return None
    run_id = latest.read_text(encoding="utf-8").strip()
    path = root / run_id / "kmeans_pipeline.joblib"
    return path if path.exists() else None


class DigitalTwinService:
    def __init__(self, model_path: Path | str | None = None, min_events: int = 5):
        self.model_path = Path(model_path) if model_path else _latest_c1_model()
        self.min_events = min_events
        self._bundle: dict[str, Any] | None = None
        self.profiles: dict[str, dict[str, Any]] = {}
        self.profile_version = 0

    def load(self) -> bool:
        if self.model_path is None or not self.model_path.exists():
            logger.warning("No C1 model available for digital twin")
            return False
        self._bundle = joblib.load(self.model_path)
        return True

    @property
    def ready(self) -> bool:
        return self._bundle is not None

    def update_from_events(
        self,
        student_id: str,
        events: list[dict[str, Any]] | pd.DataFrame,
        *,
        observation_window_days: int = 14,
        data_category: str = "synthetic_learner",
    ) -> dict[str, Any]:
        """Update twin profile. Validates synthetic Arts updates separately from OULAD clusters."""
        now = datetime.now(timezone.utc)
        if isinstance(events, list):
            df = pd.DataFrame(events)
        else:
            df = events.copy()

        evidence_count = len(df)
        state = "ok"
        cluster = None
        distances = None
        model_version = None

        if evidence_count < self.min_events:
            state = "insufficient_data"
        elif not self.ready and not self.load():
            state = "model_unavailable"
        else:
            assert self._bundle is not None
            model_version = self._bundle.get("run_id")
            feature_cols = self._bundle["feature_cols"]
            # Map observable event aggregates into feature vector (same semantics as training)
            feats = self._events_to_features(df, feature_cols, observation_window_days)
            pipe = self._bundle["pipeline"]
            X = np.array([[feats.get(c, 0.0) for c in feature_cols]], dtype=float)
            cluster = int(pipe.predict(X)[0])
            # Distance to centroids in scaled space
            Xs = pipe.named_steps["scaler"].transform(X)
            centers = pipe.named_steps["kmeans"].cluster_centers_
            distances = {
                str(i): float(np.linalg.norm(Xs[0] - centers[i])) for i in range(len(centers))
            }

        self.profile_version += 1
        profile = {
            "student_id": student_id,
            "profile_version": self.profile_version,
            "timestamp": now.isoformat(),
            "observation_window_days": observation_window_days,
            "evidence_count": evidence_count,
            "state": state,
            "cluster_id": cluster,
            "cluster_distances": distances,
            "model_version": model_version,
            "data_category": data_category,
            "transfer_warning": (
                "OULAD-derived clusters are not assumed valid for Arts learners without evaluation"
                if data_category == "synthetic_learner"
                else None
            ),
        }
        self.profiles[student_id] = profile
        return profile

    def _events_to_features(
        self, df: pd.DataFrame, feature_cols: list[str], window_days: int
    ) -> dict[str, float]:
        if df.empty:
            return {c: 0.0 for c in feature_cols}
        # Expect columns similar to learning_events or OULAD-like aggregates
        if "sum_click" in df.columns:
            total_clicks = float(df["sum_click"].sum())
            active_days = float(df["date"].nunique()) if "date" in df.columns else float(len(df))
            last_day = float(df["date"].max()) if "date" in df.columns else 0.0
        else:
            total_clicks = float(len(df))
            if "event_timestamp" in df.columns:
                days = pd.to_datetime(df["event_timestamp"], utc=True).dt.floor("D")
                active_days = float(days.nunique())
                last_day = float((days.max() - days.min()).days) if active_days else 0.0
            else:
                active_days = float(min(len(df), window_days))
                last_day = 0.0
        recency = float(max(window_days - last_day, 0))
        # Resource type props if available
        props = {
            "prop_resource": 0.25,
            "prop_oucontent": 0.25,
            "prop_forumng": 0.25,
            "prop_quiz": 0.25,
            "prop_other": 0.0,
        }
        if "event_type" in df.columns:
            vc = df["event_type"].value_counts(normalize=True)
            props["prop_quiz"] = float(vc.get("quiz_start", 0) + vc.get("quiz_submit", 0))
            props["prop_resource"] = float(vc.get("view", 0) + vc.get("download", 0))
            props["prop_oucontent"] = float(vc.get("complete", 0))
            props["prop_forumng"] = 0.0
            props["prop_other"] = float(max(0.0, 1.0 - sum(props.values()) + props["prop_other"]))

        regularity = 0.0
        if "sum_click" in df.columns and "date" in df.columns:
            daily = df.groupby("date")["sum_click"].sum()
            if daily.mean() > 0:
                regularity = float(daily.std(ddof=0) / daily.mean())

        out = {
            "total_clicks": total_clicks,
            "active_days": active_days,
            "click_regularity_cv": regularity,
            "recency_last_active_day": recency,
            **props,
        }
        return {c: float(out.get(c, 0.0)) for c in feature_cols}

    def get_profile(self, student_id: str) -> dict[str, Any] | None:
        return self.profiles.get(student_id)
