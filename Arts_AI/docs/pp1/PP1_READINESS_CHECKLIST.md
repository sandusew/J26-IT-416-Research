# PP1 readiness checklist

Based on the client PP1 message (complete Model Explorer, quiz→Twin, recs, consultations, ACL, UI quality, four-tier tests, handoff docs).  
**Official numbered rubric document:** not present in-repo → **official rubric compliance unconfirmed**.

| Criterion | Status | Notes |
|-----------|--------|-------|
| Student UI wired to Express gateway | Yes | No browser→Atlas/FastAPI |
| Teacher Model Explorer A–E | Yes | Browser + API evidence 2026-10-16 |
| Models from existing artifacts (no retrain) | Yes | Versions from serving metadata |
| Quiz → progress → Twin persistence | Yes | Twin sync on submit (fix); API restart verified |
| Recommendations prerequisite_aware + canonical practice | Yes | Subject filter on Progress |
| Consultations + notifications | Yes | `meetingUrl=null` when unconfigured |
| Access control (API, not UI-only) | Yes | C1–C4 staff 403 for students |
| UI quality / clear outcomes | Yes | Stale results cleared; outcome kinds labeled |
| Unit / component / integration / system tests | Yes | See `FRONTEND_TEST_RESULTS.md` |
| Evidence index + laptop setup + final acceptance | Yes | `EVIDENCE_INDEX.md`, `CLIENT_LAPTOP_SETUP.md`, `FINAL_UI_ACCEPTANCE.md` |
| Startup / demo reproducible | Yes | `DEMO_GUIDE.md`, `CLIENT_LAPTOP_SETUP.md` |
| Atlas credentials preserved | Yes | Not rotated / not printed |
| Client laptop physically verified | **No** | Instructions prepared only |
| Live LLM / live meeting | **No** | Unconfigured ≠ pass |
| Educational / research validation | **No** | Not claimed |

## Remaining external dependencies

- Live generative LLM provider credentials + smoke
- Live meeting provider credentials + smoke JSON
- Teacher educational validation of practice content
- Official NIE LO extracts / Sinhala Literature scope
- Physical client-laptop run of `CLIENT_LAPTOP_SETUP.md`

## Verdict

**PP1 scoped UI/backend verification is ready on this development machine against Atlas `arts_ai` and local Express/FastAPI.**  
Do not equate unsupported model responses with successful inference. Do not claim full research or A/L exam validation. Client-laptop and live-provider verification remain outstanding.
