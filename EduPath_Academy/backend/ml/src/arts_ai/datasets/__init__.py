"""Dataset downloaders and loaders."""

from arts_ai.datasets.download_utils import download_file, extract_archive, validate_or_cache
from arts_ai.datasets.oulad import download_oulad, load_oulad
from arts_ai.datasets.ednet import download_ednet_subset, load_ednet_subset
from arts_ai.datasets.uci_student import download_uci_student, load_uci_student

__all__ = [
    "download_file",
    "extract_archive",
    "validate_or_cache",
    "download_oulad",
    "load_oulad",
    "download_ednet_subset",
    "load_ednet_subset",
    "download_uci_student",
    "load_uci_student",
]
