const { QuizAssignment } = require('../models/Catalogue');

const SUBJECT_FOR_PREFIX = [
  ['hist_', 'sub_history'],
  ['geo_', 'sub_geography'],
  ['pol_', 'sub_political'],
  ['eco_', 'sub_economics'],
];

function subjectForTopic(topicId) {
  if (!topicId) return null;
  const hit = SUBJECT_FOR_PREFIX.find(([prefix]) => String(topicId).startsWith(prefix));
  return hit ? hit[1] : null;
}

function historyRow(doc) {
  const submitted = doc.status === 'submitted';
  const maxMarks = Number(doc.maxMarks) || 0;
  const score = submitted && doc.score != null ? Number(doc.score) : null;
  return {
    assignmentId: doc.assignmentId,
    title: doc.purpose === 'onboarding' ? 'Initial assessment' : `${doc.subjectId || 'Practice'} · ${doc.topicId || 'topic'}`,
    subjectId: doc.subjectId,
    topicId: doc.topicId,
    purpose: doc.purpose || 'practice',
    status: doc.status,
    assignedAt: doc.createdAt,
    submittedAt: submitted ? doc.submittedAt : null,
    score,
    maxMarks: submitted ? maxMarks : null,
    percent: submitted && maxMarks > 0 && score != null ? Math.round((score / maxMarks) * 1000) / 10 : null,
    nQuestions: (doc.questions || []).length,
    canContinue: doc.status === 'assigned',
  };
}

async function listQuizHistory({ studentId, subjectId, status, limit = 20, skip = 0 }) {
  const query = { studentId };
  if (status) query.status = status;
  else query.status = { $ne: 'cancelled' };
  if (subjectId) query.subjectId = subjectId;
  const bounded = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const offset = Math.max(Number(skip) || 0, 0);
  const [total, rows] = await Promise.all([
    QuizAssignment.countDocuments(query),
    QuizAssignment.find(query).sort({ createdAt: -1 }).skip(offset).limit(bounded).lean(),
  ]);
  return {
    studentId,
    total,
    limit: bounded,
    skip: offset,
    assignments: rows.map(historyRow),
  };
}

function practiceAccuracy(attempts) {
  const authentic = attempts.filter(
    (a) => !a.isTestFixture && a.topicId !== 'onboarding_general',
  );
  const maxMarks = authentic.reduce((sum, a) => sum + (Number(a.maxMarks) || 0), 0);
  const score = authentic.reduce((sum, a) => sum + (Number(a.score) || 0), 0);
  return {
    kind: 'practice_accuracy',
    score,
    maxMarks,
    ratio: maxMarks > 0 ? score / maxMarks : null,
    nAttempts: authentic.length,
    note: 'Share of marks on recorded practice questions. This is not syllabus completion or validated mastery.',
  };
}

module.exports = { subjectForTopic, listQuizHistory, practiceAccuracy, historyRow };
