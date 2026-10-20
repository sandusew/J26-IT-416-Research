"""Curriculum registry and coverage utilities for Arts AI."""

from arts_ai.curriculum.registry import (
    CURRICULUM_VERSION,
    canonical_topic_ids,
    load_registry,
    write_registry,
)

__all__ = [
    "CURRICULUM_VERSION",
    "canonical_topic_ids",
    "load_registry",
    "write_registry",
]
