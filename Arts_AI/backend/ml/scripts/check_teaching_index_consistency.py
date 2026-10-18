"""Compare practice teaching packages to the serving domain index (no rebuild)."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRACTICE = ROOT / "data/arts_content/practice/packages"
INDEXES = ROOT / "data/arts_content/indexes"
OUT = ROOT / "reports/teaching_index_consistency.json"


def sha_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> dict:
    ptr = (INDEXES / "LATEST_DOMAIN_INDEX.txt").read_text(encoding="utf-8").strip()
    idx_dir = INDEXES / ptr
    status_p = INDEXES / "LATEST_DOMAIN_INDEX_STATUS.json"
    status = json.loads(status_p.read_text(encoding="utf-8")) if status_p.exists() else {}
    # Prefer status document list; else scan meta in index dir
    indexed_docs = {}
    meta_dir = idx_dir / "documents"
    if meta_dir.exists():
        for p in meta_dir.glob("*.json"):
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
                indexed_docs[d.get("document_id") or p.stem] = d
            except Exception:
                continue
    # Fallback: status document_ids + optional hashes
    if not indexed_docs and status.get("document_ids"):
        for did in status["document_ids"]:
            indexed_docs[did] = {"document_id": did}

    pkg_docs = {}
    for pkg in sorted(PRACTICE.iterdir()):
        if not pkg.is_dir():
            continue
        body = pkg / "teaching_package.body.txt"
        man_p = pkg / "package_manifest.json"
        if not body.exists() or not man_p.exists():
            continue
        man = json.loads(man_p.read_text(encoding="utf-8"))
        tid = man.get("topic_id") or pkg.name
        did = f"prac_pkg_{tid}"
        pkg_docs[did] = {
            "document_id": did,
            "topic_id": tid,
            "body_sha256": sha_file(body),
            "body_bytes": body.stat().st_size,
            "mtime_utc": datetime.fromtimestamp(body.stat().st_mtime, tz=timezone.utc).isoformat(),
        }

    missing_in_index = [d for d in pkg_docs if d not in indexed_docs]
    extra_prac_in_index = [
        d for d in indexed_docs if str(d).startswith("prac_pkg_") and d not in pkg_docs
    ]
    # Hash compare when index stores content_sha / text_sha
    hash_mismatches = []
    hash_compared = 0
    for did, meta in pkg_docs.items():
        im = indexed_docs.get(did) or {}
        ih = im.get("content_sha256") or im.get("text_sha256") or im.get("sha256")
        if ih:
            hash_compared += 1
            if ih != meta["body_sha256"]:
                hash_mismatches.append({"document_id": did, "package": meta["body_sha256"], "index": ih})

    rebuild_needed = bool(missing_in_index or hash_mismatches)
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "serving_index": ptr,
        "index_status": {
            "n_documents": status.get("n_documents") or status.get("documents"),
            "n_chunks": status.get("n_chunks"),
            "status": status.get("status"),
        },
        "n_practice_packages": len(pkg_docs),
        "n_indexed_docs_known": len(indexed_docs),
        "missing_practice_packages_in_index": missing_in_index,
        "extra_practice_packages_in_index": extra_prac_in_index,
        "hash_compared": hash_compared,
        "hash_mismatches": hash_mismatches,
        "rebuild_needed": rebuild_needed,
        "note": (
            "Question-bank changes alone do not require index rebuild when teaching_package.body.txt "
            "hashes match indexed practice packages. Wiki approved extracts are separate documents."
        ),
        "evidence": "Questions changed in deficit-fill; teaching package bodies checked against index membership.",
    }
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in (
        "serving_index", "n_practice_packages", "missing_practice_packages_in_index",
        "hash_compared", "hash_mismatches", "rebuild_needed"
    )}, indent=2))
    return report


if __name__ == "__main__":
    main()
