export type Role = 'student' | 'teacher' | 'admin'

export interface AuthUser {
  username: string
  role: Role
  displayName?: string
  studentId?: string | null
  teacherId?: string | null
  email?: string | null
  school?: string | null
  grade?: string | null
  subjectIds?: string[]
  onboardingStatus?: 'not_required' | 'not_started' | 'in_progress' | 'completed'
  isSyntheticFixture?: boolean
  createdAt?: string | null
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

export interface CatalogueMeta {
  curriculumVersion?: string
  nQuestions?: number
  nResources?: number
  coverage?: {
    authenticApprovedQuestions?: number
    authenticApprovedResources?: number
    publishedPracticeQuestions?: number
    publishedPracticeResources?: number
    teacherReviewedQuestions?: number
    teacherReviewedResources?: number
    note?: string
  }
  defaultContentPolicy?: string
  note?: string
}

export interface CanonicalResource {
  resourceId: string
  version: string
  subjectId: string
  topicIds?: string[]
  title?: string
  bodyText?: string
  language?: string
  resourceType?: string
  difficulty?: number
  sourceDocumentIdOrUrl?: string
  contentOrigin?: string
  humanReviewStatus?: string
  reviewStatus?: string
  learnerAvailability?: string
  permissionStatus?: string
  isTestFixture?: boolean
}

export interface QuizQuestion {
  questionId: string
  version?: string
  questionType?: string
  prompt: string
  options?: string[] | null
  maxMarks?: number
  contentOrigin?: string
  humanReviewStatus?: string
  provenanceLabels?: string[]
  explanation?: string
  correctAnswerOrRubric?: string
}

export interface AssignmentView {
  assignmentId: string
  status: string
  questions: QuizQuestion[]
  nQuestions?: number
  score?: number
  maxMarks?: number
  contentPolicy?: Record<string, unknown>
  topicId?: string
  subjectId?: string
}

export interface ProgressResponse {
  studentId: string
  progressSnapshots?: Array<Record<string, unknown>>
  nQuizAttempts?: number
  nAuthenticQuizAttempts?: number
  nPracticeQuestionAttempts?: number
  nCompletedPracticeQuizzes?: number
  nFixtureQuizAttempts?: number
  nDiagnosticsCompleted?: number
  practiceAccuracy?: {
    kind?: string
    score?: number
    maxMarks?: number
    ratio?: number | null
    nAttempts?: number
    note?: string
  }
  subjectPerformance?: Array<{
    subjectId: string
    topicsWithSnapshots?: number
    attempts?: number
    meanScore?: number | null
  }>
  note?: string
}

export interface QuizHistoryRow {
  assignmentId: string
  title?: string
  subjectId?: string
  topicId?: string
  purpose?: string
  status: string
  assignedAt?: string
  submittedAt?: string | null
  score?: number | null
  maxMarks?: number | null
  percent?: number | null
  nQuestions?: number
  canContinue?: boolean
}

export interface TwinResponse {
  profile?: Record<string, unknown> | null
  persistent?: boolean
}

export interface RecommendationItem {
  resourceId?: string
  topicId?: string
  title?: string
  score?: number
  reason?: string
  contentOrigin?: string
  humanReviewStatus?: string
  [key: string]: unknown
}

export interface RecommendationsResponse {
  recommendations: RecommendationItem[]
  policyMode?: string
  trainedScorerUsed?: boolean
  modelVersion?: string | null
  fallbackReason?: string | null
  catalogueMode?: string
  nEligible?: number
  note?: string
}

export interface ChatResponse {
  answer?: string
  answer_type?: string
  citations?: Array<{
    document_id?: string
    title?: string
    snippet?: string
    url?: string
    [key: string]: unknown
  }>
  insufficient_evidence?: boolean
  unsupported_language?: boolean
  corpus_mode?: string
  corpus_version?: string
  corpus_provenance?: string
  generation?: Record<string, unknown>
  model_version?: string
  note?: string
}

export interface Consultation {
  consultationId: string
  studentId: string
  teacherId: string
  subjectId?: string
  requestedSlotStart: string
  requestedSlotEnd: string
  state: string
  meetingUrl?: string | null
  meetingIntegrationStatus?: string
}

export interface NotificationItem {
  notificationId?: string
  type?: string
  payload?: Record<string, unknown>
  read?: boolean
  createdAt?: string
}

export interface ApiErrorBody {
  error?: string
  reason?: string
  note?: string
  detail?: unknown
  available?: number
  requested?: number
  message?: string
  details?: string[]
}

export class ApiError extends Error {
  status: number
  body: ApiErrorBody
  constructor(status: number, body: ApiErrorBody) {
    super(body.error || body.message || `http_${status}`)
    this.status = status
    this.body = body
  }
}
