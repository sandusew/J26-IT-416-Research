"""Document ingestion, chunking, embeddings/BM25 retrieval, citations."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
from rank_bm25 import BM25Okapi

from arts_ai.common.config import load_yaml_config
from arts_ai.common.hashing import file_sha256
from arts_ai.common.logging_utils import get_logger
from arts_ai.common.manifests import save_json
from arts_ai.common.paths import get_paths

logger = get_logger("arts_ai.c4.rag")


def chunk_text(text: str, chunk_size: int = 400, overlap: int = 50) -> list[str]:
    words = text.split()
    if not words:
        return []
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + chunk_size])
        chunks.append(chunk)
        i += max(chunk_size - overlap, 1)
    return chunks


_STOP = {
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was",
    "were", "be", "what", "which", "who", "how", "why", "when", "where", "does", "do",
    "did", "can", "could", "should", "would", "with", "from", "that", "this", "these",
    "those", "about", "into", "available", "knowledge", "passages", "please", "tell",
    "me", "describe", "explained", "described",
}


def _tokenize(text: str) -> list[str]:
    toks = re.findall(r"[a-z0-9]+", text.lower())
    # Drop ultra-common function words so long natural questions do not zero-out BM25
    filtered = [t for t in toks if t not in _STOP and len(t) > 1]
    return filtered or toks


@dataclass
class KnowledgeIndex:
    chunks: list[dict[str, Any]] = field(default_factory=list)
    bm25: Any = None
    embedding_matrix: np.ndarray | None = None
    embedding_model_name: str | None = None
    _st_model: Any = None
    config: dict[str, Any] = field(default_factory=dict)
    index_path: Path | None = None

    def ingest_documents(self, docs: pd.DataFrame | list[dict[str, Any]], cfg: dict | None = None) -> int:
        cfg = cfg or load_yaml_config("c4_chatbot.yaml").get("retrieval", {})
        self.config = cfg
        if isinstance(docs, list):
            docs = pd.DataFrame(docs)
        chunk_size = int(cfg.get("chunk_size", 400))
        overlap = int(cfg.get("chunk_overlap", 50))
        self.chunks = []
        for _, row in docs.iterrows():
            text = str(row.get("text") or "")
            for i, ch in enumerate(chunk_text(text, chunk_size, overlap)):
                self.chunks.append(
                    {
                        "chunk_id": f"{row.get('document_id', 'doc')}_{i}",
                        "document_id": row.get("document_id"),
                        "subject_id": row.get("subject_id"),
                        "topic_id": row.get("topic_id"),
                        "language": row.get("language") or "en",
                        "curriculum_version": row.get("curriculum_version"),
                        "source_reference": row.get("source_reference"),
                        "permission_reference": row.get("permission_reference"),
                        "review_status": row.get("review_status"),
                        "data_origin": row.get("data_origin"),
                        "text": ch,
                    }
                )
        tokenized = [_tokenize(c["text"]) for c in self.chunks]
        self.bm25 = BM25Okapi(tokenized) if tokenized else None

        # Optional sentence-transformers; skip auto-download of huge LLMs
        model_name = cfg.get("embedding_model", "sentence-transformers/all-MiniLM-L6-v2")
        self.embedding_model_name = model_name
        try:
            from sentence_transformers import SentenceTransformer

            self._st_model = SentenceTransformer(model_name)
            emb = self._st_model.encode([c["text"] for c in self.chunks], show_progress_bar=False)
            # normalize for IP = cosine
            emb = np.asarray(emb, dtype=np.float32)
            emb /= np.linalg.norm(emb, axis=1, keepdims=True) + 1e-12
            self.embedding_matrix = emb
            logger.info("Built dense embeddings with %s", model_name)
        except Exception as e:  # noqa: BLE001
            logger.warning("sentence-transformers unavailable (%s); using BM25 only", e)
            self._st_model = None
            self.embedding_matrix = None
        return len(self.chunks)

    def save(self, path: Path | str | None = None, *, update_latest_pointer: bool = True) -> Path:
        path = Path(path) if path else get_paths().artifact("c4") / "knowledge_index.joblib"
        path.parent.mkdir(parents=True, exist_ok=True)
        # Don't pickle heavy ST model — reload by name
        bundle = {
            "chunks": self.chunks,
            "embedding_matrix": self.embedding_matrix,
            "embedding_model_name": self.embedding_model_name,
            "config": self.config,
            "has_dense": self.embedding_matrix is not None,
        }
        joblib.dump(bundle, path)
        # Rebuild bm25 on load
        meta = {
            "n_chunks": len(self.chunks),
            "has_dense": self.embedding_matrix is not None,
            "embedding_model_name": self.embedding_model_name,
            "checksum": file_sha256(path),
            "corpus_mode": (self.config or {}).get("corpus_mode"),
            "corpus_version": (self.config or {}).get("corpus_version"),
            "note": "Indexing is NOT model training",
        }
        save_json(meta, path.with_suffix(".meta.json"))
        self.index_path = path
        if update_latest_pointer:
            # Store project-relative path when possible
            root = get_paths().ml_root.parent.parent
            try:
                rel = str(path.resolve().relative_to(root.resolve())).replace("\\", "/")
            except ValueError:
                rel = str(path)
            (get_paths().artifact("c4") / "LATEST_INDEX.txt").write_text(rel, encoding="utf-8")
        return path

    @classmethod
    def load(cls, path: Path | str | None = None) -> "KnowledgeIndex":
        if path is None:
            latest = get_paths().artifact("c4") / "LATEST_INDEX.txt"
            if latest.exists():
                path = latest.read_text(encoding="utf-8").strip()
            else:
                path = get_paths().artifact("c4") / "knowledge_index.joblib"
        path = Path(path)
        if not path.is_absolute() and not path.exists():
            # Resolve project-relative pointers (e.g. backend/ml/artifacts/...)
            root = get_paths().ml_root.parent.parent
            cand = root / path
            if cand.exists():
                path = cand
            else:
                cand2 = get_paths().ml_root / path
                if cand2.exists():
                    path = cand2
        if not path.exists():
            raise FileNotFoundError(f"Knowledge index missing: {path}")
        bundle = joblib.load(path)
        obj = cls(
            chunks=bundle["chunks"],
            embedding_matrix=bundle.get("embedding_matrix"),
            embedding_model_name=bundle.get("embedding_model_name"),
            config=bundle.get("config", {}),
            index_path=path,
        )
        tokenized = [_tokenize(c["text"]) for c in obj.chunks]
        obj.bm25 = BM25Okapi(tokenized) if tokenized else None
        if bundle.get("has_dense") and obj.embedding_model_name:
            try:
                from sentence_transformers import SentenceTransformer

                obj._st_model = SentenceTransformer(obj.embedding_model_name)
            except Exception as e:  # noqa: BLE001
                logger.warning("Could not reload embedding model: %s", e)
        return obj

    def retrieve(
        self,
        query: str,
        top_k: int | None = None,
        *,
        subject_id: str | None = None,
        language: str | None = None,
    ) -> list[dict[str, Any]]:
        top_k = top_k or int(self.config.get("top_k", 5))
        if not self.chunks:
            return []
        # Optional hard filters (curriculum-aligned chat); empty after filter → insufficient evidence
        eligible_idx = list(range(len(self.chunks)))
        if subject_id:
            sid = subject_id.lower().strip()
            eligible_idx = [
                i
                for i in eligible_idx
                if str(self.chunks[i].get("subject_id") or "").lower() == sid
            ]
        if language:
            lang = language.lower().strip()
            lang_aliases = {
                "en": {"en", "english"},
                "english": {"en", "english"},
                "si": {"si", "sinhala"},
                "sinhala": {"si", "sinhala"},
                "ta": {"ta", "tamil"},
                "tamil": {"ta", "tamil"},
            }
            allowed = lang_aliases.get(lang, {lang})
            eligible_idx = [
                i
                for i in eligible_idx
                if str(self.chunks[i].get("language") or "en").lower() in allowed
                or not self.chunks[i].get("language")
            ]
        if subject_id and not eligible_idx:
            return []
        scores = np.zeros(len(self.chunks), dtype=float)
        if self.bm25 is not None:
            toks = _tokenize(query)
            # Prefer rarer query terms, but fall back to the full token set when rare-only
            # scoring yields no positive evidence (common when distinctive words are absent
            # from the passage but frequent topic terms like sri/lanka remain informative).
            query_variants = [toks]
            if self.chunks and toks:
                n = len(self.chunks)
                rare = []
                for t in toks:
                    df = sum(1 for c in self.chunks if t in _tokenize(str(c.get("text") or "")))
                    if n and df / n <= 0.55:
                        rare.append(t)
                if rare and rare != toks:
                    query_variants = [rare, toks]
            bm = np.zeros(len(self.chunks), dtype=float)
            for qtoks in query_variants:
                cand = np.asarray(self.bm25.get_scores(qtoks), dtype=float)
                cand = np.maximum(cand, 0.0)
                if cand.max() > bm.max():
                    bm = cand
                if bm.max() > 0 and qtoks is query_variants[0]:
                    break
            if bm.max() > 0:
                bm = bm / (bm.max() + 1e-12)
            scores += bm
        if self.embedding_matrix is not None and self._st_model is not None:
            q = self._st_model.encode([query], show_progress_bar=False)
            q = np.asarray(q, dtype=np.float32)
            q /= np.linalg.norm(q, axis=1, keepdims=True) + 1e-12
            dense = (self.embedding_matrix @ q.T).ravel()
            scores = 0.5 * scores + 0.5 * dense
        # Subject keyword boost before top-k selection
        qlow = query.lower()
        for i, ch in enumerate(self.chunks):
            subj = str(ch.get("subject_id") or "").lower()
            if "geography" in qlow and "geography" in subj:
                scores[i] += 0.2
            if "history" in qlow and "history" in subj:
                scores[i] += 0.2
            if "econom" in qlow and "econom" in subj:
                scores[i] += 0.2
            if ("politic" in qlow or "government" in qlow) and "political" in subj:
                scores[i] += 0.2

        # Mask non-eligible chunks before top-k
        if subject_id or language:
            mask = np.full(len(self.chunks), -np.inf)
            for i in eligible_idx:
                mask[i] = scores[i]
            scores = mask
        idx = np.argsort(-scores)[:top_k]
        # Absolute floor for BM25-only and dense hybrid alike
        min_sim = float(self.config.get("min_similarity", 0.25))
        if self.embedding_matrix is None:
            # BM25 normalized scores: require clearer match than near-zero noise
            min_sim = float(self.config.get("min_bm25_score", 0.15))
        q_content = [t for t in _tokenize(query) if t not in _STOP and len(t) >= 3]
        n_chunks = max(len(self.chunks), 1)
        df_map = {
            t: sum(1 for c in self.chunks if t in _tokenize(str(c.get("text") or "")))
            for t in q_content
        }
        known = [t for t in q_content if df_map.get(t, 0) > 0]
        unknown = [t for t in q_content if df_map.get(t, 0) == 0]
        # Invented / out-of-corpus queries: multiple long unknown tokens (e.g. unobtanium)
        long_unknown = [t for t in unknown if len(t) >= 10]
        if q_content and len(long_unknown) >= 2:
            return []
        if q_content and len(unknown) >= 3 and len(known) <= 2:
            return []
        known_distinctive = [t for t in known if df_map[t] / n_chunks <= 0.35]
        out = []
        for i in idx:
            if not np.isfinite(scores[i]):
                continue
            if float(scores[i]) < min_sim:
                continue
            chunk_toks = set(_tokenize(str(self.chunks[i].get("text") or "")))
            if known_distinctive and not (set(known_distinctive) & chunk_toks):
                continue
            if not known_distinctive and known and len(set(known) & chunk_toks) < min(2, len(known)):
                continue
            item = dict(self.chunks[i])
            item["score"] = float(scores[i])
            item["query_term_overlap"] = len(set(q_content) & chunk_toks)
            out.append(item)
        out.sort(key=lambda x: float(x.get("score") or 0), reverse=True)
        return out


def _summarise_twin(digital_twin: dict[str, Any] | None) -> str | None:
    if not digital_twin:
        return None
    parts = []
    for key in ("cluster_id", "risk_band", "mastery_summary", "weak_topics", "profile_version"):
        if key in digital_twin and digital_twin[key] is not None:
            parts.append(f"{key}={digital_twin[key]}")
    # Keep short — used to bias retrieval query, not invent facts
    if not parts and digital_twin:
        parts.append(str({k: digital_twin[k] for k in list(digital_twin)[:6]}))
    return "; ".join(parts) if parts else None


def _summarise_history(history: list[dict[str, Any]] | None, max_turns: int = 4) -> str | None:
    if not history:
        return None
    lines = []
    for turn in history[-max_turns:]:
        role = turn.get("role") or turn.get("speaker") or "user"
        content = turn.get("content") or turn.get("text") or turn.get("question") or ""
        if content:
            lines.append(f"{role}: {str(content)[:240]}")
    return " | ".join(lines) if lines else None


def answer_question(
    query: str,
    index: KnowledgeIndex,
    *,
    model_version: str = "extractive_template_v0",
    digital_twin: dict[str, Any] | None = None,
    conversation_history: list[dict[str, Any]] | None = None,
    use_generation: bool = True,
    subject_id: str | None = None,
    language: str | None = None,
) -> dict[str, Any]:
    cfg = index.config or load_yaml_config("c4_chatbot.yaml").get("retrieval", {})
    twin_summary = _summarise_twin(digital_twin)
    history_summary = _summarise_history(conversation_history)

    lang_norm = (language or "").strip().lower()
    if lang_norm in {"si", "sinhala", "sin"}:
        return {
            "answer": (
                "Sinhala-medium domain retrieval is not claimed for the current supplemental "
                "English corpus. No answer is provided rather than silently substituting English fixtures."
            ),
            "answer_type": "unsupported_language",
            "generation_mode": "none",
            "is_generative_llm": False,
            "citations": [],
            "insufficient_evidence": True,
            "unsupported_language": True,
            "language_requested": language,
            "model_version": model_version,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "note": "sinhala_support_not_claimed",
        }

    # Primary retrieval on the user question (avoid diluting BM25 with metadata noise).
    # Twin/history are used to (1) boost topic-relevant hits and (2) condition generation.
    # Optional subject/language filters support curriculum-aligned domain chat.
    hits = index.retrieve(query, subject_id=subject_id, language=language)
    twin_boost_applied = False
    history_boost_applied = False
    if hits and digital_twin:
        weak = digital_twin.get("weak_topics") or digital_twin.get("focus_topics") or []
        if isinstance(weak, str):
            weak = [weak]
        weak_l = [str(w).lower() for w in weak]
        if weak_l:
            for h in hits:
                blob = " ".join(
                    str(h.get(k) or "") for k in ("topic_id", "subject_id", "text")
                ).lower()
                if any(w.replace(" ", "_") in blob or w in blob for w in weak_l):
                    h["score"] = float(h.get("score") or 0) + 0.05
                    twin_boost_applied = True
            hits.sort(key=lambda x: float(x.get("score") or 0), reverse=True)
    if hits and history_summary:
        # Light lexical boost from prior user turns (content words only)
        hist_toks = set(re.findall(r"[a-z]{4,}", history_summary.lower()))
        if hist_toks:
            for h in hits:
                tset = set(re.findall(r"[a-z]{4,}", str(h.get("text") or "").lower()))
                overlap = len(hist_toks & tset)
                if overlap:
                    h["score"] = float(h.get("score") or 0) + 0.01 * min(overlap, 5)
                    history_boost_applied = True
            hits.sort(key=lambda x: float(x.get("score") or 0), reverse=True)

    context_usage = {
        "digital_twin_accepted": digital_twin is not None,
        "digital_twin_used_in_retrieval": twin_boost_applied,
        "digital_twin_used_in_answer_preamble": bool(twin_summary),
        "conversation_history_accepted": bool(conversation_history),
        "conversation_history_used_in_retrieval": history_boost_applied,
        "conversation_history_used_in_answer_preamble": bool(history_summary),
        "retrieval_query_expanded": False,
        "note": "Twin/history boost re-ranking and answer preamble; primary BM25 uses the user question",
    }

    if not hits:
        return {
            "answer": cfg.get(
                "insufficient_evidence_message",
                "Insufficient reviewed evidence in the knowledge base to answer confidently.",
            ),
            "answer_type": "insufficient_evidence",
            "generation_mode": "none",
            "is_generative_llm": False,
            "citations": [],
            "insufficient_evidence": True,
            "model_version": model_version,
            "context_usage": context_usage,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    # Extractive template — no fabricated syllabus facts beyond retrieved passages
    passages = []
    citations = []
    for h in hits:
        passages.append(h["text"])
        citations.append(
            {
                "document_id": h.get("document_id"),
                "chunk_id": h.get("chunk_id"),
                "source_reference": h.get("source_reference"),
                "review_status": h.get("review_status"),
                "data_origin": h.get("data_origin"),
                "score": h.get("score"),
                "passage_excerpt": h["text"][:240],
            }
        )
    extractive_answer = (
        "Based on available knowledge passages (check review_status — generated content is not verified syllabus):\n\n"
        + "\n\n---\n\n".join(passages[:3])
    )
    if twin_summary:
        extractive_answer = (
            f"[Learner context used for retrieval emphasis: {twin_summary}]\n\n" + extractive_answer
        )
    if history_summary:
        extractive_answer = (
            f"[Prior turns considered for retrieval: {history_summary[:200]}]\n\n" + extractive_answer
        )

    answer = extractive_answer
    answer_type = "extractive_template"
    generation_mode = "retrieved_passages_with_preamble"
    is_generative = False
    generation_meta: dict[str, Any] = {"attempted": False}

    if use_generation:
        from arts_ai.c4_chatbot.generation import get_generation_provider

        provider = get_generation_provider()
        gen = provider.generate(
            question=query,
            passages=passages[:4],
            twin_summary=twin_summary,
            history_summary=history_summary,
        )
        generation_meta = {
            "attempted": True,
            "used": gen.used,
            "provider": gen.provider,
            "reason": gen.reason,
            "provider_status": gen.meta,
        }
        if gen.used and gen.text:
            # Citations must still map to retrieved sources (do not invent doc ids)
            cited_ids = {c.get("document_id") for c in citations if c.get("document_id")}
            answer = gen.text
            answer_type = "generative_over_retrieved"
            generation_mode = gen.mode
            is_generative = True
            generation_meta["citation_document_ids"] = sorted(x for x in cited_ids if x)
            generation_meta["citations_validated_against_retrieval"] = True
        else:
            # Honest fallback — explicitly report extractive mode
            answer_type = "extractive_template"
            generation_mode = "extractive_fallback"
            generation_meta["fallback"] = "extractive_template"

    return {
        "answer": answer,
        "answer_type": answer_type,
        "generation_mode": generation_mode,
        "is_generative_llm": is_generative,
        "citations": citations,
        "insufficient_evidence": False,
        "model_version": model_version if not is_generative else f"gen:{generation_meta.get('provider')}",
        "context_usage": context_usage,
        "generation": generation_meta,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "interaction_id": f"chat_{uuid4().hex[:12]}",
        "note": (
            "Default answers are extractive_template. Generative rewrite only when a "
            "configured provider is ready; otherwise extractive mode is reported explicitly."
        ),
    }


def build_index_from_synthetic() -> dict[str, Any]:
    """Ingest synthetic/generated knowledge docs — clearly labelled."""
    root = get_paths().synthetic
    dirs = sorted([p for p in root.iterdir() if p.is_dir() and (p / "knowledge_documents.csv").exists()])
    if not dirs:
        raise FileNotFoundError("No knowledge_documents.csv in synthetic data")
    docs = pd.read_csv(dirs[-1] / "knowledge_documents.csv")
    # Also copy into arts_content with provenance
    content_dir = get_paths().arts_content / "generated_awaiting_review"
    content_dir.mkdir(parents=True, exist_ok=True)
    docs.to_csv(content_dir / "knowledge_documents.csv", index=False)
    (content_dir / "README.md").write_text(
        "# Generated educational content awaiting review\n\n"
        "These passages are NOT verified syllabus material.\n",
        encoding="utf-8",
    )
    idx = KnowledgeIndex()
    n = idx.ingest_documents(docs)
    path = idx.save()
    return {"n_chunks": n, "index_path": str(path), "data_origin": "generated_content"}
