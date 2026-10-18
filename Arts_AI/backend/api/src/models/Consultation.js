const mongoose = require('mongoose');

const ConsultationSchema = new mongoose.Schema(
  {
    consultationId: { type: String, required: true, unique: true },
    studentId: { type: String, required: true },
    teacherId: { type: String, required: true },
    subjectId: { type: String },
    requestedSlotStart: { type: Date, required: true },
    requestedSlotEnd: { type: Date, required: true },
    state: {
      type: String,
      enum: ['requested', 'approved', 'cancelled', 'completed', 'declined'],
      default: 'requested',
    },
    meetingUrl: { type: String, default: null },
    providerMeetingId: { type: String, default: null },
    meetingProvider: { type: String, default: null },
    meetingIntegrationStatus: {
      type: String,
      enum: ['unconfigured', 'configured', 'failed'],
      default: 'unconfigured',
    },
    notes: { type: String },
    notifications: [{ type: Object }],
    dataOrigin: { type: String, default: 'synthetic_operational' },
  },
  { timestamps: true }
);
ConsultationSchema.index(
  { teacherId: 1, requestedSlotStart: 1, requestedSlotEnd: 1 },
  {
    unique: true,
    partialFilterExpression: { state: { $in: ['requested', 'approved'] } },
  }
);

module.exports = mongoose.model('Consultation', ConsultationSchema);
