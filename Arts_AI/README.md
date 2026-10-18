# Arts AI

Local AI/ML research backend for a personalized learning platform aimed at Sri Lankan A/L Arts students.

## Components

1. Cognitive Digital Twin and Behaviour Analysis (OULAD clustering)
2. Personalized Learning and Recommendation Engine (EdNet public track + Arts simulation)
3. Academic Risk and Progress Analytics (OULAD primary + UCI + synthetic)
4. Context-Aware AI Chatbot and Teacher/Peer Consultation (RAG + booking policies)

## Layout

- `backend/api/` — Express gateway, auth, MongoDB persistence
- `backend/ml/` — Python package `arts_ai`, training, notebooks, artifacts
- `backend/docs/` — setup, dataset register, viva guide, API guide

## Quick start

See [`backend/docs/LOCAL_SETUP.md`](backend/docs/LOCAL_SETUP.md).

```powershell
cd backend\ml
.\.venv\Scripts\Activate.ps1
python scripts\run_pipeline.py
uvicorn arts_ai.inference.app:app --port 8000
```

## Data integrity

No institutional student dataset was supplied. Synthetic learner data is explicitly labelled and must not be presented as collected from an institute. EdNet public-track experiments remain incomplete until authentic KT1 is available.

## Documentation

| Doc | Path |
|-----|------|
| Local setup | `backend/docs/LOCAL_SETUP.md` |
| Dataset register | `backend/docs/DATASET_REGISTER.md` |
| Data dictionary | `backend/docs/DATA_DICTIONARY.md` |
| Synthetic spec | `backend/docs/SYNTHETIC_DATA_SPEC.md` |
| Model status | `backend/docs/MODEL_STATUS.md` |
| Training results | `backend/docs/TRAINING_RESULTS.md` |
| API guide | `backend/docs/API_GUIDE.md` |
| Viva demo | `backend/docs/VIVA_DEMO_GUIDE.md` |
