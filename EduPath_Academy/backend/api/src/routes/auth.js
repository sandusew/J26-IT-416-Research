const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { authRequired } = require('../middleware/auth');
const { publicUser, signUser, registerStudent, updateProfile } = require('../services/account');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username_password_required' });
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  return res.json({ token: signUser(user), user: publicUser(user) });
});

router.post('/register', async (req, res) => {
  const out = await registerStudent(req.body || {});
  return res.status(out.status).json(out.body);
});

router.get('/me', authRequired, async (req, res) => {
  const user = await User.findById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'not_found' });
  return res.json({ user: publicUser(user) });
});

router.patch('/profile', authRequired, async (req, res) => {
  const out = await updateProfile(req.user.sub, req.body || {});
  return res.status(out.status).json(out.body);
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
