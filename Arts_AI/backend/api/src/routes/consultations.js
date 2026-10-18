const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Consultation = require('../models/Consultation');
const { Notification } = require('../models/PeerGroup');
const meetingProvider = require('../services/meetingProvider');
const { authRequired, requireRole, requireOwnership } = require('../middleware/auth');

const router = express.Router();

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

async function ensureStudentNotification(doc, state) {
  const noteId = `ntf_con_${doc.consultationId}_${state}`;
  try {
    await Notification.create({
      notificationId: noteId,
      userId: doc.studentId,
      type: `consultation_${state}`,
      payload: {
        consultationId: doc.consultationId,
        teacherId: doc.teacherId,
        subjectId: doc.subjectId,
        meetingUrl: doc.meetingUrl || null,
        state,
      },
    });
    return { ok: true };
  } catch (e) {
    if (e && e.code === 11000) return { ok: true, duplicate: true };
    return { ok: false };
  }
}

router.post('/', authRequired, requireRole('student', 'admin'), async (req, res) => {
  const { teacherId, subjectId, requestedSlotStart, requestedSlotEnd, studentId } = req.body || {};
  const sid = req.user.role === 'student' ? req.user.studentId : studentId;
  if (!sid || !teacherId || !requestedSlotStart || !requestedSlotEnd) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const start = new Date(requestedSlotStart);
  const end = new Date(requestedSlotEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) {
    return res.status(400).json({ error: 'invalid_slot' });
  }

  const existing = await Consultation.find({
    teacherId,
    state: { $in: ['requested', 'approved'] },
  });
  for (const c of existing) {
    if (overlaps(start, end, c.requestedSlotStart, c.requestedSlotEnd)) {
      return res.status(409).json({ error: 'booking_conflict' });
    }
  }

  const meetingReady = meetingProvider.readiness();
  const meetingIntegrationStatus = meetingReady.status === 'ready' ? 'configured' : 'unconfigured';
  let doc;
  try {
    doc = await Consultation.create({
    consultationId: `con_${uuidv4().slice(0, 10)}`,
    studentId: sid,
    teacherId,
    subjectId,
    requestedSlotStart: start,
    requestedSlotEnd: end,
    state: 'requested',
    meetingUrl: null, // never fabricate
    providerMeetingId: null,
    meetingProvider: meetingReady.provider,
    meetingIntegrationStatus,
    notifications: [{ type: 'student_request_recorded', at: new Date().toISOString() }],
    dataOrigin: 'synthetic_operational',
  });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ error: 'booking_conflict' });
    throw e;
  }
  return res.status(201).json({ consultation: doc });
});

router.patch('/:consultationId/state', authRequired, async (req, res) => {
  const { state } = req.body || {};
  const doc = await Consultation.findOne({ consultationId: req.params.consultationId });
  if (!doc) return res.status(404).json({ error: 'not_found' });

  const role = req.user.role;
  if (role === 'student' && doc.studentId !== req.user.studentId) {
    return res.status(403).json({ error: 'forbidden_ownership' });
  }
  if (role === 'teacher' && doc.teacherId !== req.user.teacherId) {
    return res.status(403).json({ error: 'forbidden_ownership' });
  }
  if (!['student', 'teacher', 'admin'].includes(role)) {
    return res.status(403).json({ error: 'forbidden_role_for_transition' });
  }
  if (doc.state === state) {
    const note = await ensureStudentNotification(doc, state);
    if (!note.ok) {
      return res.status(503).json({
        error: 'notification_pending',
        consultationId: doc.consultationId,
      });
    }
    return res.json({ consultation: doc, idempotent: true });
  }
  const allowed = {
    requested: {
      approved: ['teacher', 'admin'],
      declined: ['teacher', 'admin'],
      cancelled: ['student', 'teacher', 'admin'],
    },
    approved: {
      completed: ['teacher', 'admin'],
      cancelled: ['student', 'teacher', 'admin'],
    },
  };
  if (!allowed[doc.state] || !allowed[doc.state][state]) {
    return res.status(400).json({ error: `illegal_transition_${doc.state}_to_${state}` });
  }
  if (!allowed[doc.state][state].includes(role)) {
    return res.status(403).json({ error: 'forbidden_role_for_transition' });
  }
  if (state === 'approved') {
    // Idempotency: do not create a second remote meeting if one already exists
    if (doc.providerMeetingId && doc.meetingUrl) {
      doc.notifications.push({
        type: 'meeting_already_exists_skipped_create',
        at: new Date().toISOString(),
        providerMeetingId: doc.providerMeetingId,
      });
    } else {
    const created = await meetingProvider.createMeeting({
      consultationId: doc.consultationId,
      teacherId: doc.teacherId,
      studentId: doc.studentId,
      start: doc.requestedSlotStart,
      end: doc.requestedSlotEnd,
      subjectId: doc.subjectId,
    });
    if (created.ok) {
      doc.meetingUrl = created.meetingUrl;
      doc.providerMeetingId = created.providerMeetingId;
      doc.meetingProvider = created.provider;
      doc.meetingIntegrationStatus = 'configured';
      doc.notifications.push({
        type: 'meeting_created',
        at: new Date().toISOString(),
        provider: created.provider,
      });
    } else {
      // Do not mark approval as having a meeting; keep URL null
      doc.meetingUrl = null;
      doc.providerMeetingId = null;
      doc.meetingIntegrationStatus =
        created.error && created.error.includes('not_selected') ? 'unconfigured' : 'failed';
      doc.notifications.push({
        type: 'approved_but_meeting_create_failed',
        at: new Date().toISOString(),
        error: created.error,
      });
    }
    }
  }
  if (state === 'cancelled' && doc.providerMeetingId) {
    const cancelled = await meetingProvider.cancelMeeting(doc.providerMeetingId);
    doc.notifications.push({
      type: cancelled.ok ? 'meeting_cancelled_remote' : 'meeting_cancel_remote_failed',
      at: new Date().toISOString(),
      detail: cancelled.error || null,
    });
  }
  doc.state = state;
  doc.notifications.push({ type: `state_${state}`, at: new Date().toISOString() });
  await doc.save();
  const note = await ensureStudentNotification(doc, state);
  if (!note.ok) {
    return res.status(503).json({
      error: 'notification_pending',
      consultationId: doc.consultationId,
      consultation: doc,
    });
  }
  return res.json({ consultation: doc });
});

router.get('/student/:studentId', authRequired, requireOwnership('studentId'), async (req, res) => {
  const list = await Consultation.find({ studentId: req.params.studentId }).sort({ createdAt: -1 });
  return res.json({ consultations: list });
});

/** Teacher inbox — own consultations only (admin may pass any teacherId). */
router.get('/teacher/:teacherId', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  const tid = req.params.teacherId;
  if (req.user.role === 'teacher' && req.user.teacherId !== tid) {
    return res.status(403).json({ error: 'forbidden_ownership' });
  }
  const list = await Consultation.find({ teacherId: tid }).sort({ createdAt: -1 });
  return res.json({ consultations: list });
});

module.exports = router;
