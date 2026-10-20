const mongoose = require('mongoose');

const ChatInteractionSchema = new mongoose.Schema(
  {
    interactionId: { type: String, required: true, unique: true },
    studentId: { type: String, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    citations: [{ type: Object }],
    modelVersion: { type: String },
    insufficientEvidence: { type: Boolean, default: false },
    corpusMode: { type: String, default: 'domain' },
    corpusVersion: { type: String },
    feedback: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChatInteraction', ChatInteractionSchema);
