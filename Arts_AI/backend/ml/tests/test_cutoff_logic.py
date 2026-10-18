"""Ensure behaviour features respect course-day cutoff and exclude outcomes."""

import pandas as pd

from arts_ai.features.oulad_behaviour import build_behaviour_features


def test_cutoff_excludes_future_clicks():
    student_info = pd.DataFrame(
        [
            {
                "code_module": "AAA",
                "code_presentation": "2013J",
                "id_student": 1,
                "final_result": "Pass",
                "date_registration": -10,
            }
        ]
    )
    vle = pd.DataFrame(
        [
            {"id_site": 10, "activity_type": "resource"},
            {"id_site": 11, "activity_type": "quiz"},
        ]
    )
    student_vle = pd.DataFrame(
        [
            {
                "code_module": "AAA",
                "code_presentation": "2013J",
                "id_student": 1,
                "id_site": 10,
                "date": 5,
                "sum_click": 3,
            },
            {
                "code_module": "AAA",
                "code_presentation": "2013J",
                "id_student": 1,
                "id_site": 11,
                "date": 20,
                "sum_click": 100,
            },
        ]
    )
    feat = build_behaviour_features(student_info, student_vle, vle, cutoff_days=13)
    row = feat.iloc[0]
    assert row["total_clicks"] == 3
    assert "final_result" not in feat.attrs["feature_cols"]
    assert row["observation_cutoff_days"] == 13
