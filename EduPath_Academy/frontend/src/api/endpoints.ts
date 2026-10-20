import { apiRequest } from './client'
import type {
  AssignmentView,
  AuthUser,
  CatalogueMeta,
  CanonicalResource,
  ChatResponse,
  Consultation,
  LoginResponse,
  QuizHistoryRow,
  NotificationItem,
  ProgressResponse,
  RecommendationsResponse,
  TwinResponse,
} from './types'

const CURRICULUM = 'nie_al_arts_provisional_v0.1'

export const api = {
  health: () => apiRequest<{ status: string }>('/health'),
  ready: () => apiRequest<Record<string, unknown>>('/ready'),

  login: (username: string, password: string) =>
    apiRequest<LoginResponse>('/auth/login', { body: { username, password } }),

  register: (body: Record<string, unknown>) =>
    apiRequest<LoginResponse>('/auth/register', { body }),

  me: (token: string) => apiRequest<{ user: AuthUser }>('/auth/me', { token }),

  updateProfile: (token: string, body: Record<string, unknown>) =>
    apiRequest<{ user: AuthUser }>('/auth/profile', { token, method: 'PATCH', body }),

  teachers: (token: string) =>
    apiRequest<{ teachers: Array<{ teacherId: string; username: string; displayName: string }> }>(
      '/auth/teachers',
      { token },
    ),

  catalogueMeta: (token: string) => apiRequest<CatalogueMeta>('/catalogue/meta', { token }),

  resources: (
    token: string,
    q: { subjectId?: string; topicId?: string; contentPolicy?: string } = {},
  ) => {
    const params = new URLSearchParams()
    if (q.subjectId) params.set('subjectId', q.subjectId)
    if (q.topicId) params.set('topicId', q.topicId)
    if (q.contentPolicy) params.set('contentPolicy', q.contentPolicy)
    const qs = params.toString()
    return apiRequest<{ n: number; resources: CanonicalResource[] }>(
      `/catalogue/resources${qs ? `?${qs}` : ''}`,
      { token },
    )
  },

  questions: (
    token: string,
    q: { subjectId?: string; topicId?: string; includeKeys?: boolean } = {},
  ) => {
    const params = new URLSearchParams()
    if (q.subjectId) params.set('subjectId', q.subjectId)
    if (q.topicId) params.set('topicId', q.topicId)
    if (q.includeKeys) params.set('includeKeys', 'true')
    const qs = params.toString()
    return apiRequest<{ n: number; questions: Array<Record<string, unknown>> }>(
      `/catalogue/questions${qs ? `?${qs}` : ''}`,
      { token },
    )
  },

  reviewQuestion: (
    token: string,
    questionId: string,
    version: string,
    body: { decision: string; reviewEvidence?: string },
  ) =>
    apiRequest(`/catalogue/questions/${questionId}/versions/${version}/review`, {
      token,
      body,
    }),

  progress: (token: string, studentId: string) =>
    apiRequest<ProgressResponse>(`/learning/progress/${studentId}`, { token, timeoutMs: 45000 }),

  twin: (token: string, studentId: string) =>
    apiRequest<TwinResponse>(`/learning/digital-twin/${studentId}`, { token }),

  recommendations: (
    token: string,
    studentId: string,
    q: {
      subjectId?: string
      policyMode?: string
      catalogueMode?: string
      contentPolicy?: string
      limit?: number
    } = {},
  ) => {
    const params = new URLSearchParams()
    if (q.subjectId) params.set('subjectId', q.subjectId)
    if (q.policyMode) params.set('policyMode', q.policyMode)
    if (q.catalogueMode) params.set('catalogueMode', q.catalogueMode)
    if (q.contentPolicy) params.set('contentPolicy', q.contentPolicy)
    if (q.limit) params.set('limit', String(q.limit))
    const qs = params.toString()
    return apiRequest<RecommendationsResponse>(
      `/learning/recommendations/${studentId}${qs ? `?${qs}` : ''}`,
      { token, timeoutMs: 45000 },
    )
  },

  assignQuiz: (
    token: string,
    studentId: string,
    body: {
      subjectId: string
      topicId: string
      nQuestions?: number
      contentPolicy?: string
      language?: string
      curriculumVersion?: string
      catalogueMode?: string
    },
  ) =>
    apiRequest<AssignmentView & { questions: AssignmentView['questions'] }>(
      `/learning/quiz/${studentId}/assign`,
      {
        token,
        body: {
          catalogueMode: 'canonical',
          curriculumVersion: CURRICULUM,
          language: 'en',
          nQuestions: 5,
          contentPolicy: 'published_practice',
          ...body,
        },
      },
    ),

  quizHistory: (
    token: string,
    studentId: string,
    q: { subjectId?: string; status?: string; limit?: number; skip?: number } = {},
  ) => {
    const params = new URLSearchParams()
    if (q.subjectId) params.set('subjectId', q.subjectId)
    if (q.status) params.set('status', q.status)
    if (q.limit) params.set('limit', String(q.limit))
    if (q.skip) params.set('skip', String(q.skip))
    const qs = params.toString()
    return apiRequest<{ total: number; limit: number; skip: number; assignments: QuizHistoryRow[] }>(
      `/learning/quiz/${studentId}/history${qs ? `?${qs}` : ''}`,
      { token },
    )
  },

  startOnboarding: (token: string, studentId: string) =>
    apiRequest<{ status: string; assignment: AssignmentView | null; resumed?: boolean }>(
      `/learning/onboarding/${studentId}/start`,
      { token, method: 'POST' },
    ),

  getAssignment: (token: string, studentId: string, assignmentId: string) =>
    apiRequest<AssignmentView>(`/learning/quiz/${studentId}/assignments/${assignmentId}`, {
      token,
    }),

  submitAssignment: (
    token: string,
    studentId: string,
    assignmentId: string,
    responses: Array<{ questionId: string; response: string }>,
  ) =>
    apiRequest<Record<string, unknown>>(
      `/learning/quiz/${studentId}/assignments/${assignmentId}/submit`,
      { token, body: { responses } },
    ),

  chatAsk: (
    token: string,
    studentId: string,
    body: {
      question: string
      subject_id?: string
      language?: string
      corpus_mode?: string
      conversation_history?: Array<Record<string, unknown>>
      includeDigitalTwin?: boolean
      use_generation?: boolean
    },
  ) =>
    apiRequest<ChatResponse>(`/ml/chat/${studentId}/ask`, {
      token,
      body: { corpus_mode: 'domain', language: 'en', ...body },
    }),

  consultationsStudent: (token: string, studentId: string) =>
    apiRequest<{ consultations: Consultation[] }>(`/consultations/student/${studentId}`, {
      token,
    }),

  consultationsTeacher: (token: string, teacherId: string) =>
    apiRequest<{ consultations: Consultation[] }>(`/consultations/teacher/${teacherId}`, {
      token,
    }),

  requestConsultation: (
    token: string,
    body: {
      teacherId: string
      subjectId?: string
      requestedSlotStart: string
      requestedSlotEnd: string
    },
  ) => apiRequest<{ consultation: Consultation }>('/consultations', { token, body }),

  patchConsultation: (token: string, consultationId: string, state: string) =>
    apiRequest<{ consultation: Consultation }>(`/consultations/${consultationId}/state`, {
      token,
      method: 'PATCH',
      body: { state },
    }),

  notifications: (token: string) =>
    apiRequest<{ notifications: NotificationItem[] }>('/learning/notifications/me', { token }),

  markNotificationRead: (token: string, notificationId: string) =>
    apiRequest<{ notification: NotificationItem }>(
      `/learning/notifications/${notificationId}/read`,
      { token, body: {} },
    ),

  peerGroupsMine: (token: string) =>
    apiRequest<{
      groups: Array<{
        groupId: string
        name: string
        subjectId: string
        topicId?: string
        maxMembers?: number
        myRole?: string
        requireApproval?: boolean
      }>
    }>('/learning/peer-groups/mine', { token }),

  peerGroupsCreate: (
    token: string,
    body: {
      name: string
      subjectId: string
      topicId?: string
      maxMembers?: number
      requireApproval?: boolean
    },
  ) => apiRequest('/learning/peer-groups', { token, body }),

  peerJoinRequest: (token: string, groupId: string) =>
    apiRequest(`/learning/peer-groups/${groupId}/join-request`, { token, body: {} }),

  peerJoinRequests: (token: string, groupId: string) =>
    apiRequest<{
      joinRequests: Array<{ requestId: string; studentId: string; status: string }>
    }>(`/learning/peer-groups/${groupId}/join-requests`, { token }),

  peerApproveJoin: (token: string, groupId: string, requestId: string) =>
    apiRequest(`/learning/peer-groups/${groupId}/join-requests/${requestId}/approve`, {
      token,
      body: {},
    }),

  mlReady: (token: string) => apiRequest<Record<string, unknown>>('/ml/ready', { token }),

  behaviourCluster: (token: string, body: Record<string, number>) =>
    apiRequest<Record<string, unknown>>('/ml/behaviour/cluster', { token, body }),

  riskPredict: (token: string, body: Record<string, unknown>) =>
    apiRequest<Record<string, unknown>>('/ml/risk/predict', { token, body }),

  correctnessPredict: (token: string, body: Record<string, number>) =>
    apiRequest<Record<string, unknown>>('/ml/correctness/predict', { token, body }),

  topicClassify: (token: string, text: string) =>
    apiRequest<Record<string, unknown>>('/ml/topic/classify', { token, body: { text } }),

  rankScore: (
    token: string,
    body: {
      student_id: string
      stu_open_rate?: number
      candidates: Array<{ resource_id: string; difficulty: number; topic_id?: string }>
    },
  ) => apiRequest<Record<string, unknown>>('/ml/recommendations/score', { token, body }),
}

export { CURRICULUM }
