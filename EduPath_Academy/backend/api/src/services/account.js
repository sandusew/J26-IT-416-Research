const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config');

const SUBJECT_IDS = ['sub_history', 'sub_geography', 'sub_political', 'sub_economics'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    studentId: user.studentId || null,
    teacherId: user.teacherId || null,
    email: user.email || null,
    school: user.school || null,
    grade: user.grade || null,
    subjectIds: Array.isArray(user.subjectIds) ? user.subjectIds : [],
    onboardingStatus: user.onboardingStatus || 'not_required',
    isSyntheticFixture: !!user.isSyntheticFixture,
    createdAt: user.createdAt || null,
  };
}

function signUser(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      username: user.username,
      studentId: user.studentId,
      teacherId: user.teacherId,
    },
    config.jwtSecret,
    { expiresIn: '12h' }
  );
}

function normalizeStudentId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function validateRegistration(body) {
  const studentId = normalizeStudentId(body.studentId);
  const displayName = String(body.displayName || body.fullName || '').trim();
  const school = String(body.school || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const confirmPassword = body.confirmPassword;
  const grade = body.grade == null || body.grade === '' ? null : String(body.grade).trim();
  const subjectIds = Array.isArray(body.subjectIds) ? body.subjectIds.map(String) : [];
  const errors = [];
  if (!/^[a-z0-9_]{3,32}$/.test(studentId)) {
    errors.push('student_id must be 3–32 letters, numbers, or underscores');
  }
  if (displayName.length < 2 || displayName.length > 80) errors.push('full name must be 2–80 characters');
  if (school.length < 2 || school.length > 120) errors.push('school must be 2–120 characters');
  if (!EMAIL_RE.test(email) || email.length > 120) errors.push('email is invalid');
  if (password.length < 8 || password.length > 72) errors.push('password must be 8–72 characters');
  if (confirmPassword != null && confirmPassword !== password) errors.push('passwords do not match');
  if (grade && !['12', '13'].includes(grade)) errors.push('grade must be 12 or 13');
  if (subjectIds.some((id) => !SUBJECT_IDS.includes(id))) errors.push('unknown subject');
  return { errors, studentId, displayName, school, email, password, grade, subjectIds };
}

async function registerStudent(body) {
  const parsed = validateRegistration(body);
  if (parsed.errors.length) {
    return { status: 400, body: { error: 'invalid_registration', details: parsed.errors } };
  }
  const passwordHash = await bcrypt.hash(parsed.password, 10);
  try {
    const user = await User.create({
      username: parsed.studentId,
      passwordHash,
      role: 'student',
      displayName: parsed.displayName,
      studentId: parsed.studentId,
      email: parsed.email,
      school: parsed.school,
      grade: parsed.grade,
      subjectIds: parsed.subjectIds,
      onboardingStatus: 'not_started',
      isSyntheticFixture: false,
      dataOrigin: 'self_registered_student',
    });
    return {
      status: 201,
      body: { token: signUser(user), user: publicUser(user), loginIdentifier: 'studentId' },
    };
  } catch (err) {
    if (err && err.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'account';
      return { status: 409, body: { error: 'duplicate_account', field: key } };
    }
    throw err;
  }
}

async function updateProfile(userId, body) {
  const user = await User.findById(userId);
  if (!user) return { status: 404, body: { error: 'not_found' } };
  if (body.role || body.username || body.studentId || body.password || body.passwordHash) {
    return { status: 400, body: { error: 'protected_field', note: 'Role, login id, and password cannot be changed here' } };
  }
  if (body.displayName != null) {
    const name = String(body.displayName).trim();
    if (name.length < 2 || name.length > 80) return { status: 400, body: { error: 'invalid_name' } };
    user.displayName = name;
  }
  if (body.school != null) {
    const school = String(body.school).trim();
    if (school.length < 2 || school.length > 120) return { status: 400, body: { error: 'invalid_school' } };
    user.school = school;
  }
  if (body.grade != null) {
    const grade = String(body.grade).trim();
    if (grade && !['12', '13'].includes(grade)) return { status: 400, body: { error: 'invalid_grade' } };
    user.grade = grade || null;
  }
  if (body.subjectIds != null) {
    if (!Array.isArray(body.subjectIds) || body.subjectIds.some((id) => !SUBJECT_IDS.includes(String(id)))) {
      return { status: 400, body: { error: 'invalid_subjects' } };
    }
    user.subjectIds = body.subjectIds.map(String);
  }
  if (body.email != null) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { status: 400, body: { error: 'invalid_email' } };
    user.email = email;
  }
  try {
    await user.save();
  } catch (err) {
    if (err && err.code === 11000) return { status: 409, body: { error: 'duplicate_account', field: 'email' } };
    throw err;
  }
  return { status: 200, body: { user: publicUser(user) } };
}

module.exports = {
  SUBJECT_IDS,
  publicUser,
  signUser,
  normalizeStudentId,
  validateRegistration,
  registerStudent,
  updateProfile,
};
