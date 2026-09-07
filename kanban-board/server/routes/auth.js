const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function toPublicUser(user) {
  return { _id: user._id, email: user.email, name: user.name };
}

// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required and must be a string' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password is required and must be at least 8 characters' });
  }
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required and must be a string' });
  }

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, passwordHash, name });
  res.status(201).json({ token: signToken(user), user: toPublicUser(user) });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  const genericError = { error: 'Invalid email or password' };
  if (!user) return res.status(401).json(genericError);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json(genericError);

  res.status(200).json({ token: signToken(user), user: toPublicUser(user) });
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.status(200).json(toPublicUser(user));
});

// POST /auth/forgot-password — always responds the same way regardless of
// whether the email has an account, so this can't be used to check which
// addresses are registered. A fresh request overwrites any earlier token,
// so only the most recently requested link ever works.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required and must be a string' });
  }

  const genericResponse = { message: 'If an account exists for that email, a password reset link has been sent.' };
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) return res.status(200).json(genericResponse);

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordTokenHash = hashToken(rawToken);
  user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await user.save();

  const resetLink = `${process.env.CLIENT_ORIGIN}/reset-password?token=${rawToken}`;

  // No email service is wired up yet — this is where a real send call
  // would go. Logging it (and, outside production, handing it back in the
  // response) keeps the feature fully testable without one.
  console.log(`Password reset requested for ${user.email}: ${resetLink}`);
  if (process.env.NODE_ENV !== 'production') {
    genericResponse.devResetLink = resetLink;
  }
  res.status(200).json(genericResponse);
});

// POST /auth/reset-password — single-use: the token is cleared as soon as
// it's spent, whether or not this request succeeds in the middle of it, so
// a stolen-but-already-used link can't be replayed.
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password is required and must be at least 8 characters' });
  }

  const user = await User.findOne({ resetPasswordTokenHash: hashToken(token), resetPasswordExpires: { $gt: new Date() } });
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

  user.passwordHash = await bcrypt.hash(password, 10);
  user.resetPasswordTokenHash = null;
  user.resetPasswordExpires = null;
  await user.save();

  // Signs them straight in rather than sending them to log in with the
  // password they just entered a moment ago — same convenience signup already gives.
  res.status(200).json({ token: signToken(user), user: toPublicUser(user) });
});

module.exports = router;
