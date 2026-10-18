/** Map Model Explorer API responses into short, honest outcome summaries. */

export type PanelOutcomeKind =
  | 'success'
  | 'validation'
  | 'unsupported'
  | 'incomplete'
  | 'infrastructure'
  | 'empty'

export type PanelSummary = {
  kind: PanelOutcomeKind
  headline: string
  details: Array<{ label: string; value: string }>
}

function str(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

export function summarizeC1(result: Record<string, unknown> | null): PanelSummary | null {
  if (!result) return null
  const cluster = str(result.cluster_id ?? result.clusterId)
  const version = str(result.model_version ?? result.modelVersion)
  if (cluster == null) {
    return {
      kind: 'validation',
      headline: 'No cluster_id in response',
      details: version ? [{ label: 'model_version', value: version }] : [],
    }
  }
  return {
    kind: 'success',
    headline: `Cluster ID ${cluster}`,
    details: [
      ...(version ? [{ label: 'model_version', value: version }] : []),
      ...(str(result.note) ? [{ label: 'note', value: str(result.note)! }] : []),
    ],
  }
}

export function summarizeC2EdNet(result: Record<string, unknown> | null): PanelSummary | null {
  if (!result) return null
  const p = result.probability_correct ?? result.correctness_probability
  const version = str(result.model_version ?? result.modelVersion)
  if (typeof p !== 'number') {
    return {
      kind: 'validation',
      headline: 'No correctness probability returned',
      details: version ? [{ label: 'model_version', value: version }] : [],
    }
  }
  return {
    kind: 'success',
    headline: `Next-answer correctness P(correct) = ${p.toFixed(4)}`,
    details: [
      ...(version ? [{ label: 'model_version', value: version }] : []),
      ...(str(result.selected) ? [{ label: 'selected', value: str(result.selected)! }] : []),
      {
        label: 'meaning',
        value: 'Public-domain EdNet next-answer correctness — not learning effectiveness',
      },
    ],
  }
}

export function summarizeC2Rank(result: Record<string, unknown> | null): PanelSummary | null {
  if (!result) return null
  const trained = result.trainedScorerUsed
  const version = str(result.modelVersion ?? result.model_version)
  const fallback = str(result.fallbackReason)
  const scores = Array.isArray(result.scores) ? result.scores : []
  if (result.ok === false || fallback) {
    return {
      kind: fallback ? 'unsupported' : 'infrastructure',
      headline: fallback ? `Fallback: ${fallback}` : 'Ranker unavailable',
      details: [
        { label: 'trainedScorerUsed', value: String(trained) },
        ...(version ? [{ label: 'modelVersion', value: version }] : []),
      ],
    }
  }
  return {
    kind: trained === true ? 'success' : 'validation',
    headline:
      trained === true
        ? `Trained scorer used — ${scores.length} candidate score(s)`
        : 'Response without trainedScorerUsed=true',
    details: [
      { label: 'trainedScorerUsed', value: String(trained) },
      ...(version ? [{ label: 'modelVersion', value: version }] : []),
      ...scores.slice(0, 5).map((s: Record<string, unknown>, i: number) => ({
        label: `score[${i}]`,
        value: `${str(s.resourceId) || '?'} → ${typeof s.score === 'number' ? s.score.toFixed(4) : str(s.score)}`,
      })),
    ],
  }
}

export function summarizeLearnerRecs(result: Record<string, unknown> | null): PanelSummary | null {
  if (!result) return null
  const policy = str(result.policyMode) || '—'
  const trained = result.trainedScorerUsed
  const fallback = str(result.fallbackReason)
  const version = str(result.modelVersion)
  const n = Array.isArray(result.recommendations) ? result.recommendations.length : null
  return {
    kind: fallback ? 'unsupported' : 'success',
    headline: fallback
      ? `Learner recs fell back to ${policy} (${fallback})`
      : `Learner recs policyMode=${policy}`,
    details: [
      { label: 'trainedScorerUsed', value: String(trained) },
      ...(version ? [{ label: 'modelVersion', value: version }] : []),
      ...(str(result.catalogueMode) ? [{ label: 'catalogueMode', value: str(result.catalogueMode)! }] : []),
      ...(n != null ? [{ label: 'nRecommendations', value: String(n) }] : []),
      ...(fallback ? [{ label: 'fallbackReason', value: fallback }] : []),
    ],
  }
}

export function summarizeC3(result: Record<string, unknown> | null): PanelSummary | null {
  if (!result) return null
  const status = str(result.status) || 'ok'
  const version = str(result.model_version ?? result.modelVersion)
  const band = str(result.policy_band ?? result.risk_band)
  const pFail = result.probability_fail
  const reason = str(result.reason)

  if (
    status === 'incomplete_observation_window' ||
    status === 'insufficient_data' ||
    status === 'incomplete_feature_contract'
  ) {
    return {
      kind: 'incomplete',
      headline: `Observation state: ${status}`,
      details: [
        ...(reason ? [{ label: 'reason', value: reason }] : []),
        ...(version ? [{ label: 'model_version', value: version }] : []),
      ],
    }
  }
  if (status === 'unsupported_application_domain') {
    return {
      kind: 'unsupported',
      headline: 'Unsupported Arts-domain request',
      details: [
        ...(reason ? [{ label: 'reason', value: reason }] : []),
        ...(version ? [{ label: 'model_version', value: version }] : []),
      ],
    }
  }
  return {
    kind: 'success',
    headline:
      typeof pFail === 'number'
        ? `OULAD P(Fail)=${pFail.toFixed(4)}${band ? ` · band ${band}` : ''}`
        : `Risk status ${status}`,
    details: [
      { label: 'status', value: status },
      ...(version ? [{ label: 'model_version', value: version }] : []),
      ...(str(result.model_selected) ? [{ label: 'model_selected', value: str(result.model_selected)! }] : []),
      ...(str(result.note) ? [{ label: 'note', value: str(result.note)! }] : []),
    ],
  }
}

export function summarizeC4(
  result: Record<string, unknown> | null,
  architectureHint?: string | null,
): PanelSummary | null {
  if (!result) return null
  const topic = str(result.topic_id ?? result.predicted_topic)
  const conf = result.confidence ?? result.probability
  const version = str(result.model_version ?? result.modelVersion)
  const arch = str(result.architecture) || architectureHint || null
  if (!topic) {
    return {
      kind: 'validation',
      headline: 'No predicted topic returned',
      details: version ? [{ label: 'model_version', value: version }] : [],
    }
  }
  return {
    kind: 'success',
    headline: `Predicted topic: ${topic}`,
    details: [
      ...(typeof conf === 'number' ? [{ label: 'confidence', value: conf.toFixed(4) }] : []),
      ...(version ? [{ label: 'model_version', value: version }] : []),
      ...(arch ? [{ label: 'architecture', value: arch }] : []),
      ...(str(result.task) ? [{ label: 'task', value: str(result.task)! }] : []),
      ...(str(result.n_supported_classes)
        ? [{ label: 'n_supported_classes', value: str(result.n_supported_classes)! }]
        : []),
    ],
  }
}

export function kindClass(kind: PanelOutcomeKind): string {
  switch (kind) {
    case 'success':
      return 'border-teal-200 bg-teal-50 text-teal-950'
    case 'validation':
    case 'incomplete':
      return 'border-amber-200 bg-amber-50 text-amber-950'
    case 'unsupported':
      return 'border-orange-200 bg-orange-50 text-orange-950'
    case 'infrastructure':
      return 'border-red-200 bg-red-50 text-red-950'
    default:
      return 'border-navy-800/10 bg-sand-50 text-navy-900'
  }
}
