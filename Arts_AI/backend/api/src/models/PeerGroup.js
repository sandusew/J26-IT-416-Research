const mongoose = require('mongoose');

const PeerGroupSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    subjectId: { type: String, required: true },
    topicId: { type: String },
    createdByStudentId: { type: String, required: true },
    maxMembers: { type: Number, default: 20 },
    memberCount: { type: Number },
    requireApproval: { type: Boolean, default: false },
    dataOrigin: { type: String, default: 'synthetic_operational' },
  },
  { timestamps: true }
);

const GroupMembershipSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, index: true },
    studentId: { type: String, required: true, index: true },
    role: { type: String, default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
GroupMembershipSchema.index({ groupId: 1, studentId: 1 }, { unique: true });

const NotificationSchema = new mongoose.Schema(
  {
    notificationId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    payload: { type: Object, default: {} },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = {
  PeerGroup: mongoose.model('PeerGroup', PeerGroupSchema),
  GroupMembership: mongoose.model('GroupMembership', GroupMembershipSchema),
  Notification: mongoose.model('Notification', NotificationSchema),
};
