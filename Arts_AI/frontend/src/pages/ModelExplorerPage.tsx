import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { FlaskConical, Play } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { PageHeader, LoadingState, ErrorState, EmptyState, JsonDisclosure } from '../components/ui'
import {
  kindClass,
  summarizeC1,
  summarizeC2EdNet,
  summarizeC2Rank,
  summarizeC3,
  summarizeC4,
  summarizeLearnerRecs,
  type PanelSummary,
} from '../lib/modelPanelSummary'

const C1_PUBLIC_EXAMPLE = {
  total_clicks: 84,
  active_days: 6,
  click_regularity_cv: 0.35,
  recency_last_active_day: 3,
  prop_resource: 0.25,
  prop_oucontent: 0.45,
  prop_forumng: 0.1,
  prop_quiz: 0.1,
  prop_other: 0.1,
}

const C3_PUBLIC_ZERO_ACTIVITY = {
  features: {
    total_clicks: 0,
    active_days: 0,
    click_regularity_cv: 0,
    recency_last_active_day: 0,
    prop_resource: 0,
    prop_oucontent: 0,
    prop_forumng: 0,
    prop_quiz: 0,
    prop_other: 0,
  },
  num_of_prev_attempts: 0,
  studied_credits: 60,
  observation: {
    observation_window_complete: true,
    data_source: 'oulad_vle',
    n_vle_events_in_window: 0,
    feature_availability: 'complete',
    required_cutoff_days: 13,
  },
}

const C3_PUBLIC_ACTIVITY = {
  features: {
    total_clicks: 120,
    active_days: 8,
    click_regularity_cv: 0.4,
    recency_last_active_day: 2,
    prop_resource: 0.2,
    prop_oucontent: 0.5,
    prop_forumng: 0.1,
    prop_quiz: 0.1,
    prop_other: 0.1,
  },
  num_of_prev_attempts: 0,
  studied_credits: 60,
  observation: {
    observation_window_complete: true,
    data_source: 'oulad_vle',
    n_vle_events_in_window: 40,
    feature_availability: 'complete',
  },
}

const C3_INCOMPLETE_WINDOW = {
  features: {
    total_clicks: 10,
    active_days: 1,
    click_regularity_cv: 0.1,
    recency_last_active_day: 1,
    prop_resource: 0.2,
    prop_oucontent: 0.5,
    prop_forumng: 0.1,
    prop_quiz: 0.1,
    prop_other: 0.1,
  },
  num_of_prev_attempts: 0,
  studied_credits: 60,
  observation: {
    observation_window_complete: false,
    data_source: 'oulad_vle',
    n_vle_events_in_window: 2,
    feature_availability: 'incomplete',
    required_cutoff_days: 13,
  },
}

const C3_ARTS_UNSUPPORTED = {
  features: {
    total_clicks: 5,
    active_days: 1,
    click_regularity_cv: 0.2,
    recency_last_active_day: 1,
    prop_resource: 0.2,
    prop_oucontent: 0.5,
    prop_forumng: 0.1,
    prop_quiz: 0.1,
    prop_other: 0.1,
  },
  num_of_prev_attempts: 0,
  studied_credits: 60,
  observation: {
    observation_window_complete: false,
    data_source: 'arts_app',
    n_vle_events_in_window: 5,
    feature_availability: 'partial',
  },
}

/** EdNet-style history aggregates — not Arts question IDs. */
const C2_EDNET_EXAMPLE = {
  hist_count: 12,
  hist_accuracy: 0.62,
  hist_accuracy_10: 0.7,
  hist_mean_elapsed: 45,
  hist_std_elapsed: 18,
  question_difficulty_train: 0.55,
}

/** Historical synthetic catalogue vocabulary (T01/T02) for trainedScorerUsed demos. */
const C2_RANK_HISTORICAL = {
  student_id: 'demo_s0001',
  stu_open_rate: 0.42,
  candidates: [
    { resource_id: 'res_a', difficulty: 0.4, topic_id: 'T01' },
    { resource_id: 'res_b', difficulty: 0.6, topic_id: 'T02' },
  ],
}

const C2_RANK_ARTS_CANONICAL = {
  student_id: 'demo_s0001',
  stu_open_rate: 0.42,
  candidates: [
    { resource_id: 'res_hist_sl_sources_v1', difficulty: 0.35, topic_id: 'hist_sl_sources' },
    { resource_id: 'res_hist_sl_geography_v1', difficulty: 0.55, topic_id: 'hist_sl_geography' },
  ],
}

const C4_TOPIC_EXAMPLE =
  'Geographical factors in Sri Lankan history including climate, rivers, and the central highlands.'

const C4_ARCHITECTURE = 'TF-IDF (TfidfVectorizer) → LogisticRegression'

type PanelState = {
  loading: boolean
  result: Record<string, unknown> | null
  error: string | null
  body: Record<string, unknown>
}

function emptyPanel(body: Record<string, unknown>): PanelState {
  return { loading: false, result: null, error: null, body }
}

export default function ModelExplorerPage() {
  const { token, user, hasRole } = useAuth()
  const [ready, setReady] = useState<Record<string, unknown> | null>(null)
  const [readyLoading, setReadyLoading] = useState(true)
  const [readyError, setReadyError] = useState<string | null>(null)

  const [c1, setC1] = useState<PanelState>(() => emptyPanel(C1_PUBLIC_EXAMPLE))
  const [c3, setC3] = useState<PanelState>(() => emptyPanel(C3_PUBLIC_ACTIVITY))
  const [c2ed, setC2ed] = useState<PanelState>(() => emptyPanel(C2_EDNET_EXAMPLE))
  const [c2rank, setC2rank] = useState<PanelState>(() => emptyPanel(C2_RANK_HISTORICAL))
  const [c2recsFallback, setC2recsFallback] = useState<PanelState>(() =>
    emptyPanel({
      student_id: 'demo_s0001',
      policyMode: 'trained_ranker',
      catalogueMode: 'canonical',
      contentPolicy: 'published_practice',
    }),
  )
  const [c4, setC4] = useState<PanelState>(() => emptyPanel({ text: C4_TOPIC_EXAMPLE }))

  const c1Ref = useRef(c1)
  const c3Ref = useRef(c3)
  const c2edRef = useRef(c2ed)
  const c2rankRef = useRef(c2rank)
  const c2recsRef = useRef(c2recsFallback)
  const c4Ref = useRef(c4)
  const runSeq = useRef<Record<string, number>>({})
  c1Ref.current = c1
  c3Ref.current = c3
  c2edRef.current = c2ed
  c2rankRef.current = c2rank
  c2recsRef.current = c2recsFallback
  c4Ref.current = c4

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setReadyLoading(true)
    api
      .mlReady(token)
      .then((r) => {
        if (!cancelled) setReady(r)
      })
      .catch((e) => {
        if (!cancelled) setReadyError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setReadyLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function run(
    key: string,
    setter: Dispatch<SetStateAction<PanelState>>,
    fn: () => Promise<Record<string, unknown>>,
  ) {
    const id = (runSeq.current[key] = (runSeq.current[key] || 0) + 1)
    setter((p) => ({ ...p, loading: true, error: null, result: null }))
    try {
      const result = await fn()
      if (runSeq.current[key] !== id) return
      setter((p) => ({ ...p, loading: false, result, error: null }))
    } catch (e) {
      if (runSeq.current[key] !== id) return
      setter((p) => ({ ...p, loading: false, result: null, error: errorMessage(e) }))
    }
  }

  if (!hasRole('teacher', 'admin')) {
    return (
      <>
        <PageHeader title="Model Explorer" subtitle="Staff-only diagnostics." />
        <EmptyState title="Teachers and admins only" detail="Students cannot run Model Explorer panels." />
      </>
    )
  }

  const serving = (ready?.serving || {}) as Record<string, Record<string, unknown>>
  const topicServingHint =
    serving?.topic_classifier?.run_id != null
      ? `${C4_ARCHITECTURE} · serving ${String(serving.topic_classifier.run_id)} · ${String(serving.topic_classifier.n_classes || '?')} classes`
      : C4_ARCHITECTURE

  return (
    <div>
      <PageHeader
        title="Model Explorer"
        subtitle="Run real ML inference via the API. Results are experimental — not Arts A/L exam predictions. Demo inputs are not written to student Twin profiles."
        actions={<FlaskConical className="h-6 w-6 text-teal-700" aria-hidden />}
      />

      <div className="card mb-4 space-y-2 text-sm text-navy-800/80">
        <p>
          <strong>C1 / C3:</strong> Trained on public OULAD — not Sri Lankan A/L learners. Cluster silhouette
          scores measure separation on OULAD, not accuracy for your students.
        </p>
        <p>
          <strong>C2 EdNet:</strong> Public-domain next-answer correctness on EdNet history features — not Arts
          question IDs and not learning effectiveness.
        </p>
        <p>
          <strong>C2 rank:</strong> Historical synthetic score endpoint vs canonical Arts learner recommendations
          (prerequisite_aware default; trained_ranker + canonical → vocabulary fallback).
        </p>
        <p>
          <strong>C4 topic:</strong> Closed-set {C4_ARCHITECTURE} — hint only, not chatbot quality or full syllabus
          coverage.
        </p>
      </div>

      {readyLoading ? <LoadingState label="Loading /ml/ready…" /> : null}
      {readyError ? <ErrorState message={readyError} /> : null}
      {ready ? (
        <div className="card mb-6 text-xs text-navy-800/70">
          <p>ML ready: {String(ready.ready)}</p>
          {Array.isArray(ready.missing) && ready.missing.length ? (
            <p>Missing: {(ready.missing as string[]).join(', ')}</p>
          ) : null}
          <JsonDisclosure label="Serving versions from /ml/ready" data={serving} />
        </div>
      ) : null}

      <div className="space-y-6">
        <ModelPanel
          id="c1"
          title="C1 — OULAD behaviour cluster"
          disclaimer="OULAD public dataset; not A/L cohort behaviour. Does not update student profiles."
          versionHint={
            serving?.c1?.run_id
              ? `serving hint ${String(serving.c1.run_id)}`
              : 'model_version returned in response when C1 artifact is loaded'
          }
          state={c1}
          summary={summarizeC1(c1.result)}
          onLoadExample={() => setC1(emptyPanel(C1_PUBLIC_EXAMPLE))}
          onRun={() =>
            run('c1', setC1, () =>
              api.behaviourCluster(token!, c1Ref.current.body as Record<string, number>),
            )
          }
        />

        <ModelPanel
          id="c3"
          title="C3 — OULAD risk (days 0–13)"
          disclaimer="Predicts OULAD Fail label — not a validated A/L exam predictor."
          versionHint={
            serving?.c3?.run_id ? `serving hint ${String(serving.c3.run_id)}` : undefined
          }
          state={c3}
          summary={summarizeC3(c3.result)}
          onLoadExample={() => setC3(emptyPanel(C3_PUBLIC_ACTIVITY))}
          extraActions={[
            {
              label: 'Load zero-activity OULAD example',
              onClick: () => setC3(emptyPanel(C3_PUBLIC_ZERO_ACTIVITY)),
            },
            {
              label: 'Load incomplete observation',
              onClick: () => setC3(emptyPanel(C3_INCOMPLETE_WINDOW)),
            },
            {
              label: 'Load Arts-domain unsupported',
              onClick: () => setC3(emptyPanel(C3_ARTS_UNSUPPORTED)),
            },
          ]}
          onRun={() => run('c3', setC3, () => api.riskPredict(token!, c3Ref.current.body))}
        />

        <ModelPanel
          id="c2-ednet"
          title="C2 — EdNet next-answer correctness (public domain)"
          disclaimer="EdNet KT1 history aggregates — do not substitute Arts IDs. Not learning effectiveness."
          versionHint="Expect model_version from EdNet v2 serving artifact"
          state={c2ed}
          summary={summarizeC2EdNet(c2ed.result)}
          onLoadExample={() => setC2ed(emptyPanel(C2_EDNET_EXAMPLE))}
          onRun={() =>
            run('c2ed', setC2ed, () =>
              api.correctnessPredict(token!, c2edRef.current.body as Record<string, number>),
            )
          }
        />

        <ModelPanel
          id="c2-rank"
          title="C2 — Resource ranker score (diagnostic)"
          disclaimer="POST /ml/recommendations/score — historical vocabulary demo. Default app recs stay prerequisite_aware."
          versionHint={
            serving?.c2_rank?.run_id ? `run ${String(serving.c2_rank.run_id)}` : undefined
          }
          state={c2rank}
          summary={summarizeC2Rank(c2rank.result)}
          onLoadExample={() => setC2rank(emptyPanel(C2_RANK_HISTORICAL))}
          extraActions={[
            {
              label: 'Load Arts topic IDs (score only)',
              onClick: () => setC2rank(emptyPanel(C2_RANK_ARTS_CANONICAL)),
            },
          ]}
          exampleLabel="Load example"
          onRun={() =>
            run('c2rank', setC2rank, () =>
              api.rankScore(
                token!,
                c2rankRef.current.body as Parameters<typeof api.rankScore>[1],
              ),
            )
          }
        />

        <ModelPanel
          id="c2-recs-fallback"
          title="C2 — Canonical Arts catalogue fallback (learner path)"
          disclaimer="GET /learning/recommendations with trained_ranker + catalogueMode=canonical — expect prerequisite_aware fallback. Does not write Twin state."
          state={c2recsFallback}
          summary={summarizeLearnerRecs(c2recsFallback.result)}
          onLoadExample={() =>
            setC2recsFallback(
              emptyPanel({
                student_id: user?.studentId || 'demo_s0001',
                policyMode: 'trained_ranker',
                catalogueMode: 'canonical',
                contentPolicy: 'published_practice',
              }),
            )
          }
          exampleLabel="Load example"
          onRun={() =>
            run('c2recs', setC2recsFallback, async () => {
              const body = c2recsRef.current.body
              const sid = String(body.student_id || 'demo_s0001')
              const out = await api.recommendations(token!, sid, {
                policyMode: String(body.policyMode || 'trained_ranker'),
                catalogueMode: String(body.catalogueMode || 'canonical'),
                contentPolicy: String(body.contentPolicy || 'published_practice'),
                limit: 8,
              })
              return out as unknown as Record<string, unknown>
            })
          }
        />

        <ModelPanel
          id="c4-topic"
          title="C4 — NL topic classify (closed set)"
          disclaimer="Closed-set hint over provisional curriculum topic ids — not DistilBERT open QA; not chatbot quality."
          versionHint={topicServingHint}
          state={c4}
          summary={summarizeC4(c4.result, C4_ARCHITECTURE)}
          exampleLabel="Load example"
          bodyEditor
          onBodyChange={(next) => setC4((p) => ({ ...p, body: next, result: null, error: null }))}
          onLoadExample={() => setC4(emptyPanel({ text: C4_TOPIC_EXAMPLE }))}
          onRun={() =>
            run('c4', setC4, () => api.topicClassify(token!, String(c4Ref.current.body.text || '')))
          }
        />
      </div>
    </div>
  )
}

function ResultSummary({ summary }: { summary: PanelSummary }) {
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${kindClass(summary.kind)}`}>
      <p className="font-medium">{summary.headline}</p>
      <p className="mt-0.5 text-xs opacity-80">outcome: {summary.kind}</p>
      {summary.details.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {summary.details.map((d) => (
            <li key={d.label}>
              <span className="font-medium">{d.label}:</span> {d.value}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ModelPanel({
  title,
  disclaimer,
  versionHint,
  state,
  summary,
  onLoadExample,
  exampleLabel = 'Load public-data example',
  extraActions,
  onRun,
  bodyEditor,
  onBodyChange,
}: {
  id: string
  title: string
  disclaimer: string
  versionHint?: string
  state: PanelState
  summary: PanelSummary | null
  onLoadExample: () => void
  exampleLabel?: string
  extraActions?: Array<{ label: string; onClick: () => void }>
  onRun: () => void
  bodyEditor?: boolean
  onBodyChange?: (body: Record<string, unknown>) => void
}) {
  return (
    <section className="card">
      <h2 className="font-display text-lg text-navy-950">{title}</h2>
      <p className="mt-1 text-xs text-amber-900">{disclaimer}</p>
      {versionHint ? <p className="mt-1 text-xs text-navy-800/55">{versionHint}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={onLoadExample}>
          {exampleLabel}
        </button>
        {extraActions?.map((a) => (
          <button key={a.label} type="button" className="btn-secondary text-xs" onClick={a.onClick}>
            {a.label}
          </button>
        ))}
        <button type="button" className="btn-primary text-xs" disabled={state.loading} onClick={onRun}>
          <Play className="h-3.5 w-3.5" aria-hidden />
          {state.loading ? 'Running…' : 'Run inference'}
        </button>
      </div>
      {bodyEditor && onBodyChange ? (
        <label className="mt-3 block text-xs text-navy-800/80">
          Natural-language text
          <textarea
            className="mt-1 w-full rounded-lg border border-navy-800/15 bg-white p-2 text-sm text-navy-950"
            rows={3}
            value={String(state.body.text || '')}
            onChange={(e) => onBodyChange({ ...state.body, text: e.target.value })}
          />
        </label>
      ) : (
        <JsonDisclosure label="Request body" data={state.body} />
      )}
      {state.error ? <ErrorState message={state.error} onRetry={onRun} /> : null}
      {summary ? <ResultSummary summary={summary} /> : null}
      {state.result ? <JsonDisclosure label="Sanitized response JSON" data={state.result} /> : null}
    </section>
  )
}
