"""Generator reproducibility and cutoff/schema smoke tests."""

from arts_ai.synthetic.generator import generate_synthetic_arts
from arts_ai.common.config import load_yaml_config


def test_synthetic_reproducible(tmp_path, monkeypatch):
    # Use smaller population via patched config file
    import yaml
    from arts_ai.common import paths as paths_mod

    cfg = load_yaml_config("synthetic_arts.yaml")
    cfg["population"]["n_students"] = 20
    cfg["population"]["n_teachers"] = 2
    cfg["population"]["time_horizon_days"] = 30
    cfg["seed"] = 123
    cfg["scenario_id"] = "unit_test_tiny"
    cfg_path = tmp_path / "synthetic_arts.yaml"
    cfg_path.write_text(yaml.dump(cfg), encoding="utf-8")

    # Point configs to tmp by monkeypatching get_paths configs — simpler: write into real configs temporarily
    from arts_ai.common.paths import get_paths

    real_cfg = get_paths().configs / "synthetic_arts_unit.yaml"
    real_cfg.write_text(yaml.dump(cfg), encoding="utf-8")
    try:
        r1 = generate_synthetic_arts("synthetic_arts_unit.yaml")
        r2 = generate_synthetic_arts("synthetic_arts_unit.yaml")
        assert len(r1.tables["students"]) == 20
        assert r1.tables["students"]["student_id"].tolist() == r2.tables["students"]["student_id"].tolist()
        assert "data_origin" in r1.tables["students"].columns
        assert (r1.tables["students"]["data_origin"] == "synthetic_learner").all()
        # Hidden state separate
        assert r1.hidden_state_path is not None
        assert r1.hidden_state_path.exists()
        assert "hidden_proficiency" not in r1.tables["learning_events"].columns
    finally:
        if real_cfg.exists():
            real_cfg.unlink()


def test_consultation_conflict():
    import pandas as pd
    from arts_ai.c4_chatbot.consultation import ConsultationService

    teachers = pd.DataFrame(
        [{"teacher_id": "t1", "display_name": "T", "is_synthetic_fixture": True}]
    )
    expertise = pd.DataFrame([{"teacher_id": "t1", "subject_id": "sub_history", "topic_ids": "[]"}])
    availability = pd.DataFrame(
        [
            {
                "availability_id": "a1",
                "teacher_id": "t1",
                "start_at": "2025-02-01T09:00:00+05:30",
                "end_at": "2025-02-01T12:00:00+05:30",
                "timezone": "Asia/Colombo",
            }
        ]
    )
    svc = ConsultationService(teachers, expertise, availability)
    r1 = svc.request_consultation(
        "s1", "t1", "2025-02-01T10:00:00+05:30", "2025-02-01T10:30:00+05:30", "sub_history"
    )
    assert r1["ok"]
    r2 = svc.request_consultation(
        "s2", "t1", "2025-02-01T10:15:00+05:30", "2025-02-01T10:45:00+05:30", "sub_history"
    )
    assert not r2["ok"]
    assert "conflict" in r2["error"]
