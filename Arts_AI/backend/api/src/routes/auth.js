const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username_password_required' });
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const token = jwt.sign(
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
  return res.json({
    token,
    user: {
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      studentId: user.studentId,
      teacherId: user.teacherId,
      isSyntheticFixture: user.isSyntheticFixture,
    },
  });
});

router.get('/me', authRequired, async (req, res) => {
  const user = await User.findById(req.user.sub).select('-passwordHash');
  return res.json({ user });
});

/** Directory of teachers for consultation booking — no secrets. */
router.get('/teachers', authRequired, async (_req, res) => {
  const teachers = await User.find({ role: 'teacher' })
    .select('username displayName teacherId role')
    .lean();
  return res.json({
    teachers: teachers
      .filter((t) => t.teacherId)
      .map((t) => ({
        teacherId: t.teacherId,
        username: t.username,
        displayName: t.displayName || t.username,
      })),
  });
});

module.exports = router;
