import { describe, expect, it } from 'vitest'
import {
  summarizeC1,
  summarizeC2EdNet,
  summarizeC2Rank,
  summarizeC3,
  summarizeC4,
  summarizeLearnerRecs,
} from './modelPanelSummary'

describe('modelPanelSummary', () => {
  it('summarizes C1 cluster success', () => {
    const s = summarizeC1({ cluster_id: 0, model_version: 'c1_test' })
    expect(s?.kind).toBe('success')
    expect(s?.headline).toContain('0')
    expect(s?.details.some((d) => d.value === 'c1_test')).toBe(true)
  })

  it('labels EdNet probability as next-answer correctness', () => {
    const s = summarizeC2EdNet({ probability_correct: 0.3779, model_version: 'ednet_v2' })
    expect(s?.kind).toBe('success')
    expect(s?.headline).toContain('0.3779')
    expect(s?.details.some((d) => d.value.includes('not learning effectiveness'))).toBe(true)
  })

  it('summarizes trained ranker scores', () => {
    const s = summarizeC2Rank({
      ok: true,
      trainedScorerUsed: true,
      modelVersion: 'c2_rank_rev',
      scores: [{ resourceId: 'res_a', score: 0.46 }],
    })
    expect(s?.kind).toBe('success')
    expect(s?.headline).toMatch(/Trained scorer/i)
  })

  it('summarizes learner catalogue fallback', () => {
    const s = summarizeLearnerRecs({
      policyMode: 'prerequisite_aware',
      trainedScorerUsed: false,
      fallbackReason: 'topic_vocabulary_incompatible_canonical_catalogue',
      catalogueMode: 'canonical',
      recommendations: [],
    })
    expect(s?.kind).toBe('unsupported')
    expect(s?.headline).toContain('topic_vocabulary_incompatible_canonical_catalogue')
  })

  it('distinguishes C3 incomplete vs success', () => {
    const inc = summarizeC3({
      status: 'incomplete_observation_window',
      reason: 'incomplete',
    })
    expect(inc?.kind).toBe('incomplete')
    const ok = summarizeC3({
      status: 'ok',
      probability_fail: 0.18,
      policy_band: 'low',
      model_version: 'c3_oulad',
    })
    expect(ok?.kind).toBe('success')
    expect(ok?.headline).toContain('0.1800')
  })

  it('shows C4 topic and architecture hint without inventing confidence', () => {
    const s = summarizeC4(
      { topic_id: 'sub_history_t06', model_version: 'c4_topic_nl' },
      'TF-IDF → LogisticRegression',
    )
    expect(s?.kind).toBe('success')
    expect(s?.headline).toContain('sub_history_t06')
    expect(s?.details.some((d) => d.label === 'confidence')).toBe(false)
    expect(s?.details.some((d) => d.value.includes('TF-IDF'))).toBe(true)
  })
})
