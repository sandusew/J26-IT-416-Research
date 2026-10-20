const jwt = require('jsonwebtoken');
const config = require('../config');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }
    return next();
  };
}

/**
 * Learner records are limited to the owning student or an admin.
 * Teachers do not gain access by guessing a student id.
 */
function requireOwnership(paramKey = 'studentId') {
  return (req, res, next) => {
    const target = req.params[paramKey] || req.body[paramKey] || req.query[paramKey];
    if (!target) return res.status(400).json({ error: 'missing_student_id' });
    if (req.user.role === 'admin') return next();
    if (req.user.role === 'student' && req.user.studentId === target) return next();
    return res.status(403).json({ error: 'forbidden_ownership' });
  };
}

module.exports = { authRequired, requireRole, requireOwnership };
