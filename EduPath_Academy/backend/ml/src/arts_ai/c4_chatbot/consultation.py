"""Teacher/peer matching policies, booking state transitions, conflict checks."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import pandas as pd

from arts_ai.schemas.chatbot import ConsultationState


def meeting_provider_status() -> dict[str, Any]:
    """Env flag ≠ a tested meeting provider. Never claim ready from config alone."""
    from pathlib import Path

    flag = (os.environ.get("MEETING_INTEGRATION") or "unconfigured").strip().lower()
    provider = (os.environ.get("MEETING_PROVIDER") or "").strip()
    tested_env = (os.environ.get("MEETING_PROVIDER_TESTED") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    # Prefer Express smoke evidence path when present
    smoke_path = (
        Path(__file__).resolve().parents[4]
        / "api"
        / "reports"
        / "meeting_smoke_test.json"
    )
    smoke_pass = False
    if smoke_path.exists():
        try:
            import json

            smoke = json.loads(smoke_path.read_text(encoding="utf-8"))
            smoke_pass = smoke.get("result") == "pass"
        except Exception:  # noqa: BLE001
            smoke_pass = False
    configured_flag = flag == "configured"
    has_creds = bool(
        os.environ.get("MEETING_API_KEY") or os.environ.get("MEETING_CLIENT_SECRET")
    )
    ready = bool(provider and configured_flag and has_creds and smoke_pass)
    return {
        "env_flag": flag,
        "provider_name": provider or None,
        "configured_flag": configured_flag,
        "credentials_present": has_creds,
        "tested_env_flag": tested_env,
        "smoke_tested": smoke_pass,
        "smoke_path": str(smoke_path) if smoke_path.exists() else None,
        "tested": smoke_pass,  # env flag alone is insufficient
        "status": "ready" if ready else "unconfigured",
        "note": (
            "MEETING_INTEGRATION=configured alone does not mean a provider was tested. "
            "Require MEETING_PROVIDER + credentials + backend/api/reports/meeting_smoke_test.json "
            "written only after a real provider call (MEETING_PROVIDER_TESTED alone is insufficient)."
        ),
    }


class ConsultationService:
    """Policy-based matching — not a trained model unless labelled data exists."""

    def __init__(
        self,
        teachers: pd.DataFrame,
        expertise: pd.DataFrame,
        availability: pd.DataFrame,
        *,
        meeting_integration: str = "unconfigured",
        timezone: str = "Asia/Colombo",
    ):
        self.teachers = teachers
        self.expertise = expertise
        self.availability = availability.copy()
        self.meeting_integration = meeting_integration
        self.timezone = ZoneInfo(timezone)
        self.consultations: dict[str, dict[str, Any]] = {}

    def match_teachers(self, subject_id: str, limit: int = 5) -> list[dict[str, Any]]:
        rows = self.expertise[self.expertise["subject_id"] == subject_id]
        out = []
        for _, r in rows.head(limit).iterrows():
            t = self.teachers[self.teachers["teacher_id"] == r["teacher_id"]]
            out.append(
                {
                    "teacher_id": r["teacher_id"],
                    "display_name": t.iloc[0]["display_name"] if len(t) else r["teacher_id"],
                    "subject_id": subject_id,
                    "is_synthetic_fixture": True,
                    "matching_policy": "subject_expertise_lookup",
                    "trained_model": False,
                }
            )
        return out

    def _parse_dt(self, value: str | datetime) -> datetime:
        if isinstance(value, datetime):
            dt = value
        else:
            dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=self.timezone)
        return dt

    def has_conflict(self, teacher_id: str, start: datetime, end: datetime) -> bool:
        start, end = self._parse_dt(start), self._parse_dt(end)
        for c in self.consultations.values():
            if c["teacher_id"] != teacher_id:
                continue
            if c["state"] in (
                ConsultationState.CANCELLED.value,
                ConsultationState.DECLINED.value,
            ):
                continue
            cs, ce = self._parse_dt(c["requested_slot_start"]), self._parse_dt(c["requested_slot_end"])
            if start < ce and end > cs:
                return True
        return False

    def slot_available(self, teacher_id: str, start: datetime, end: datetime) -> bool:
        start, end = self._parse_dt(start), self._parse_dt(end)
        avail = self.availability[self.availability["teacher_id"] == teacher_id]
        for _, row in avail.iterrows():
            a_start, a_end = self._parse_dt(row["start_at"]), self._parse_dt(row["end_at"])
            if start >= a_start and end <= a_end:
                return True
        return False

    def request_consultation(
        self,
        student_id: str,
        teacher_id: str,
        start: str,
        end: str,
        subject_id: str | None = None,
    ) -> dict[str, Any]:
        start_dt, end_dt = self._parse_dt(start), self._parse_dt(end)
        if end_dt <= start_dt:
            return {"ok": False, "error": "end must be after start"}
        if not self.slot_available(teacher_id, start_dt, end_dt):
            return {"ok": False, "error": "requested slot not within teacher availability"}
        if self.has_conflict(teacher_id, start_dt, end_dt):
            return {"ok": False, "error": "booking conflict with existing consultation"}

        cid = f"con_{uuid4().hex[:10]}"
        now = datetime.now(self.timezone)
        meeting_url = None
        integration_status = self.meeting_integration
        if integration_status != "configured":
            integration_status = "unconfigured"
            meeting_url = None  # Never fabricate external meeting links

        rec = {
            "consultation_id": cid,
            "student_id": student_id,
            "teacher_id": teacher_id,
            "subject_id": subject_id,
            "requested_slot_start": start_dt.isoformat(),
            "requested_slot_end": end_dt.isoformat(),
            "state": ConsultationState.REQUESTED.value,
            "meeting_url": meeting_url,
            "meeting_integration_status": integration_status,
            "notes": None,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "notifications": [
                {"type": "student_request_recorded", "at": now.isoformat()},
                {"type": "teacher_notify_pending", "at": now.isoformat()},
            ],
        }
        self.consultations[cid] = rec
        return {"ok": True, "consultation": rec}

    def transition(self, consultation_id: str, new_state: str, actor_role: str) -> dict[str, Any]:
        if consultation_id not in self.consultations:
            return {"ok": False, "error": "not found"}
        c = self.consultations[consultation_id]
        cur = c["state"]
        allowed = {
            ConsultationState.REQUESTED.value: {
                ConsultationState.APPROVED.value: {"teacher", "admin"},
                ConsultationState.DECLINED.value: {"teacher", "admin"},
                ConsultationState.CANCELLED.value: {"student", "teacher", "admin"},
            },
            ConsultationState.APPROVED.value: {
                ConsultationState.COMPLETED.value: {"teacher", "admin"},
                ConsultationState.CANCELLED.value: {"student", "teacher", "admin"},
            },
        }
        if new_state not in allowed.get(cur, {}):
            return {"ok": False, "error": f"illegal transition {cur} -> {new_state}"}
        if actor_role not in allowed[cur][new_state]:
            return {"ok": False, "error": f"role {actor_role} cannot apply {new_state}"}
        c["state"] = new_state
        c["updated_at"] = datetime.now(self.timezone).isoformat()
        if new_state == ConsultationState.APPROVED.value:
            if c["meeting_integration_status"] == "unconfigured":
                c["meeting_url"] = None
                c["notifications"].append(
                    {
                        "type": "approved_but_meeting_integration_unconfigured",
                        "at": c["updated_at"],
                    }
                )
        c["notifications"].append({"type": f"state_{new_state}", "at": c["updated_at"]})
        return {"ok": True, "consultation": c}
