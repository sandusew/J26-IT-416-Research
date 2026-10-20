# Edupath Academy account flow

New students register at `/register`. The student ID is stored in lowercase and is the login username. Email and student ID must be unique. The server always assigns the student role. Registration does not check a school roster or send a verification email.

After registration the student takes a six-question AI-authored onboarding quiz at `/onboarding`. Those questions are not official papers and are stored under topic `onboarding_general`, so the score is not written as History, Geography, Political Science, or Economics mastery. Existing demo accounts stay `onboardingStatus=not_required` and are not sent through this quiz.

The initial learning period is 21 days from the account `createdAt` timestamp. It is only a label on the Twin payload. It is not the OULAD model’s days 0–13 window, and quiz marks are not converted into OULAD features. Practice quizzes continue to update the observed Twin after day 21.

Recommendations on the dashboard use the existing prerequisite rule for published practice resources. The label says rule-based. Academic Risk is a practice-average indicator: under 40% high, under 70% medium, otherwise low, and no attempts means unknown.

Quiz history is `GET /learning/quiz/:studentId/history`. Continue is offered only while an assignment is still `assigned`. A second onboarding start reuses the open assignment. Submitting one cancels any other open onboarding assignment. Cancelled rows are omitted from the default history list.

Practice accuracy and completed-quiz counts exclude `onboarding_general`. The initial assessment stays on the profile and in quiz history. It is not a subject score and it does not create an academic-risk band.
