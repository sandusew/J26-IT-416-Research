const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const { QuizAssignment } = require('../models/Catalogue');
const { frozenOnboardingQuestions, ONBOARDING_VERSION } = require('./onboardingBank');

function publicAssignment(assignment) {
  if (!assignment) return null;
  const plain = assignment.toObject ? assignment.toObject() : { ...assignment };
  return {
    assignmentId: plain.assignmentId,
    studentId: plain.studentId,
    subjectId: plain.subjectId,
    topicId: plain.topicId,
    status: plain.status,
    purpose: plain.purpose || 'practice',
    score: plain.status === 'submitted' ? plain.score : undefined,
    maxMarks: plain.maxMarks,
    submittedAt: plain.submittedAt,
    createdAt: plain.createdAt,
    questions: (plain.questions || []).map(({ correctAnswerOrRubric, ...rest }) => rest),
    answerKeysIncluded: false,
    provenance: plain.dataOrigin,
    note: 'These are AI-authored onboarding questions. They are not official papers, not teacher-validated, and are not scored as syllabus-topic mastery.',
  };
}

async function startOrResumeOnboarding(studentId) {
  const user = await User.findOne({ studentId });
  if (!user || user.role !== 'student') return { status: 404, body: { error: 'student_not_found' } };
  if ((user.onboardingStatus || 'not_required') === 'not_required') {
    return { status: 409, body: { error: 'onboarding_not_required' } };
  }
  if (user.onboardingStatus === 'completed') {
    await QuizAssignment.updateMany(
      { studentId, purpose: 'onboarding', status: { $in: ['assigned', 'submitting'] } },
      { $set: { status: 'cancelled' } },
    );
    const done = user.onboardingAssignmentId
      ? await QuizAssignment.findOne({ assignmentId: user.onboardingAssignmentId, studentId })
      : null;
    return { status: 200, body: { status: 'completed', assignment: done ? publicAssignment(done) : null } };
  }
  const open = await QuizAssignment.findOne({
    studentId,
    purpose: 'onboarding',
    status: { $in: ['assigned', 'submitting'] },
  }).sort({ createdAt: 1 });
  if (open) {
    user.onboardingStatus = 'in_progress';
    user.onboardingAssignmentId = open.assignmentId;
    await user.save();
    return { status: 200, body: { status: 'in_progress', assignment: publicAssignment(open), resumed: true } };
  }
  const claim = await User.findOneAndUpdate(
    {
      studentId,
      onboardingStatus: { $in: ['not_started', 'in_progress'] },
      $or: [{ onboardingAssignmentId: null }, { onboardingAssignmentId: { $exists: false } }],
    },
    { $set: { onboardingStatus: 'in_progress', onboardingAssignmentId: 'pending' } },
    { new: true },
  );
  if (!claim) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const raced = await QuizAssignment.findOne({
        studentId,
        purpose: 'onboarding',
        status: { $in: ['assigned', 'submitting'] },
      }).sort({ createdAt: 1 });
      if (raced) {
        return { status: 200, body: { status: 'in_progress', assignment: publicAssignment(raced), resumed: true } };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const latestUser = await User.findOne({ studentId });
    if (latestUser?.onboardingStatus === 'completed') {
      return { status: 200, body: { status: 'completed', assignment: null } };
    }
    return { status: 409, body: { error: 'onboarding_start_conflict' } };
  }
  const questions = frozenOnboardingQuestions();
  const assignmentId = `onb_${uuidv4().slice(0, 10)}`;
  const assignment = await QuizAssignment.create({
    assignmentId,
    studentId,
    curriculumVersion: ONBOARDING_VERSION,
    subjectId: 'onboarding',
    topicId: 'onboarding_general',
    language: 'en',
    catalogueMode: 'canonical',
    purpose: 'onboarding',
    status: 'assigned',
    questions,
    maxMarks: questions.reduce((sum, q) => sum + (q.maxMarks || 1), 0),
    isTestFixture: false,
    dataOrigin: 'ai_authored_onboarding',
  });
  await User.updateOne(
    { studentId },
    { $set: { onboardingStatus: 'in_progress', onboardingAssignmentId: assignmentId } },
  );
  return { status: 201, body: { status: 'in_progress', assignment: publicAssignment(assignment), resumed: false } };
}

module.exports = { startOrResumeOnboarding, publicAssignment };
