/** AI-authored onboarding practice. Not official papers and not teacher-validated. */
const ONBOARDING_VERSION = 'onboarding_v1';

const ONBOARDING_QUESTIONS = [
  {
    questionId: 'onb_v1_q1',
    version: ONBOARDING_VERSION,
    questionType: 'mcq',
    prompt: 'Which city is the commercial capital of Sri Lanka?',
    options: ['Kandy', 'Colombo', 'Galle', 'Jaffna'],
    correctAnswerOrRubric: 'Colombo',
    maxMarks: 1,
  },
  {
    questionId: 'onb_v1_q2',
    version: ONBOARDING_VERSION,
    questionType: 'mcq',
    prompt: 'A map scale tells you how distance on the map relates to distance on the ground. Which subject uses map scale most directly?',
    options: ['Geography', 'Music', 'Art', 'Dance'],
    correctAnswerOrRubric: 'Geography',
    maxMarks: 1,
  },
  {
    questionId: 'onb_v1_q3',
    version: ONBOARDING_VERSION,
    questionType: 'mcq',
    prompt: 'Opportunity cost means the value of the next best alternative you give up. This idea belongs to which field?',
    options: ['Economics', 'Geology', 'Literature', 'Drama'],
    correctAnswerOrRubric: 'Economics',
    maxMarks: 1,
  },
  {
    questionId: 'onb_v1_q4',
    version: ONBOARDING_VERSION,
    questionType: 'true_false',
    prompt: 'A constitution sets out the basic rules for how a country is governed.',
    options: ['True', 'False'],
    correctAnswerOrRubric: 'True',
    maxMarks: 1,
  },
  {
    questionId: 'onb_v1_q5',
    version: ONBOARDING_VERSION,
    questionType: 'mcq',
    prompt: 'Primary sources in history are best described as:',
    options: [
      'Records from the time being studied',
      'Only textbooks written this year',
      'Any website',
      'A classmate’s guess',
    ],
    correctAnswerOrRubric: 'Records from the time being studied',
    maxMarks: 1,
  },
  {
    questionId: 'onb_v1_q6',
    version: ONBOARDING_VERSION,
    questionType: 'mcq',
    prompt: 'Which of these is a reason to check more than one source before trusting a claim?',
    options: [
      'Sources can disagree or leave out facts',
      'Every source is always wrong',
      'Reading one source is not allowed',
      'Facts never change',
    ],
    correctAnswerOrRubric: 'Sources can disagree or leave out facts',
    maxMarks: 1,
  },
];

function frozenOnboardingQuestions() {
  return ONBOARDING_QUESTIONS.map((q) => ({
    ...q,
    contentOrigin: 'ai_authored_onboarding',
    humanReviewStatus: 'unreviewed',
    isTestFixture: false,
  }));
}

module.exports = { ONBOARDING_VERSION, ONBOARDING_QUESTIONS, frozenOnboardingQuestions };
