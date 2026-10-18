# PP1 component diagram

```text
┌─────────────────────────────┐
│  React UI (Vite :5173)      │
│  Auth · Student · Teacher   │
│  Model Explorer (staff)     │
└──────────────┬──────────────┘
               │ HTTP + JWT
               │ VITE_API_BASE_URL or /api proxy
               ▼
┌─────────────────────────────┐
│  Express gateway (:4000)    │
│  Auth, catalogue, learning  │
│  consultations, /ml proxies │
└───────┬──────────────┬──────┘
        │              │
        ▼              ▼
┌───────────────┐  ┌──────────────────────────┐
│ MongoDB Atlas │  │ FastAPI inference (:8000)│
│ DB: arts_ai   │  │ C1/C2/C3/C4 artifacts    │
│ users, quiz,  │  │ domain index (BM25)      │
│ catalogue…    │  └────────────┬─────────────┘
└───────────────┘               │
                                ▼
                   ┌────────────────────────────┐
                   │ Saved models + domain index│
                   │ (no retrain for PP1 UI)    │
                   └────────────────────────────┘

Optional (actual status 2026-10-16: unconfigured / blocked ≠ pass)
┌────────────────────┐   ┌─────────────────────┐
│ LLM generation     │   │ Meeting provider     │
│ extractive default │   │ meetingUrl = null    │
│ generation ready=F │   │ smoke_tested=false   │
└────────────────────┘   └─────────────────────┘
```

Data path: **React → Express → Atlas**; **Express → FastAPI → saved models / domain index**.  
Browser never receives Atlas URIs or provider secrets.
