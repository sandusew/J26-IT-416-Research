"""Project path resolution rooted at backend/ml."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


def _find_ml_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if parent.name == "ml" and (parent / "src").exists():
            return parent
    # Fallback: assume installed editable from backend/ml
    return Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Paths:
    ml_root: Path

    @property
    def configs(self) -> Path:
        return self.ml_root / "configs"

    @property
    def data(self) -> Path:
        return self.ml_root / "data"

    @property
    def public_raw(self) -> Path:
        return self.data / "public" / "raw"

    @property
    def public_processed(self) -> Path:
        return self.data / "public" / "processed"

    @property
    def synthetic(self) -> Path:
        return self.data / "synthetic"

    @property
    def arts_content(self) -> Path:
        return self.data / "arts_content"

    @property
    def artifacts(self) -> Path:
        return self.ml_root / "artifacts"

    @property
    def reports(self) -> Path:
        return self.ml_root / "reports"

    @property
    def notebooks(self) -> Path:
        return self.ml_root / "notebooks"

    @property
    def environment(self) -> Path:
        return self.ml_root / "environment"

    def artifact(self, component: str) -> Path:
        return self.artifacts / component

    def ensure(self) -> None:
        for p in (
            self.public_raw,
            self.public_processed,
            self.synthetic,
            self.arts_content,
            self.artifacts / "c1",
            self.artifacts / "c2",
            self.artifacts / "c3",
            self.artifacts / "c4",
            self.reports,
            self.environment,
        ):
            p.mkdir(parents=True, exist_ok=True)


_PATHS: Paths | None = None


def get_paths(ml_root: Path | None = None) -> Paths:
    global _PATHS
    if ml_root is not None:
        _PATHS = Paths(ml_root=ml_root.resolve())
        return _PATHS
    if _PATHS is None:
        _PATHS = Paths(ml_root=_find_ml_root())
    return _PATHS
