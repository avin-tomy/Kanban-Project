const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../utils/email');
const { createSession, revokeSession, revokeAllSessions } = require('../utils/session');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// `sid` is the Redis-backed session id (see utils/session.js) that makes
// this specific token revocable — without it, logout could only ever be a
// client-side localStorage clear, and a copied token would keep working
// until it happened to expire on its own 7 days later.
function signToken(user, sid) {
  return jwt.sign({ sub: user._id.toString(), sid }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Every socket already sits in its own `user:<id>` room, and carries the
// session id it authenticated with (see index.js) — so a revoked session's
// live connection(s) can be found and dropped immediately, rather than
// working until they happen to reconnect and get rejected then.
function disconnectSessions(io, userId, sids) {
  const sidSet = new Set(sids);
  for (const socketId of io.sockets.adapter.rooms.get(`user:${userId}`) || []) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && sidSet.has(socket.sessionId)) socket.disconnect(true);
  }
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function toPublicUser(user) {
  return { _id: user._id, email: user.email, name: user.name, emailVerified: user.emailVerified };
}

// Issues a fresh verification token for `user`, saves it, and emails it —
// shared by signup (first send) and /auth/resend-verification (any resend).
// Send failures are logged but not thrown: verification is soft-enforced,
// so nothing downstream depends on this succeeding synchronously.
async function issueVerificationEmail(user) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  user.verifyEmailTokenHash = hashToken(rawToken);
  user.verifyEmailExpires = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
  await user.save();

  const verifyLink = `${process.env.CLIENT_ORIGIN}/verify-email?token=${rawToken}`;
  try {
    await sendVerificationEmail(user.email, verifyLink);
  } catch (e) {
    console.error(`Failed to send verification email to ${user.email}:`, e.message);
  }
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
  await issueVerificationEmail(user);
  const sid = await createSession(user._id);
  res.status(201).json({ token: signToken(user, sid), user: toPublicUser(user) });
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

  const sid = await createSession(user._id);
  res.status(200).json({ token: signToken(user, sid), user: toPublicUser(user) });
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

  try {
    await sendPasswordResetEmail(user.email, resetLink);
  } catch (e) {
    // Swallowed rather than surfaced: a send failure (e.g. Resend's sandbox
    // sender rejecting a recipient other than the account owner) must not
    // produce a different response than the "no such account" case above,
    // or the endpoint becomes an email-enumeration oracle.
    console.error(`Failed to send password reset email to ${user.email}:`, e.message);
  }
  res.status(200).json(genericResponse);
});

// POST /auth/change-password — for a logged-in user who knows their current
// password (as opposed to /auth/reset-password, for someone who's locked
// out and proves identity via the emailed token instead).
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'currentPassword is required' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword is required and must be at least 8 characters' });
  }

  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.status(200).json({ message: 'Password changed successfully' });
});

// POST /auth/resend-verification — for a logged-in user whose original
// verification email expired, went to spam, or was never received.
router.post('/resend-verification', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.emailVerified) return res.status(400).json({ error: 'Email is already verified' });

  await issueVerificationEmail(user);
  res.status(200).json({ message: 'Verification email sent' });
});

// POST /auth/verify-email — no auth required: the emailed link is the proof
// of identity here, and may be opened on a different device/session than
// the one that's signed in (or none at all).
router.post('/verify-email', async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }

  const user = await User.findOne({ verifyEmailTokenHash: hashToken(token), verifyEmailExpires: { $gt: new Date() } });
  if (!user) return res.status(400).json({ error: 'This verification link is invalid or has expired.' });

  user.emailVerified = true;
  user.verifyEmailTokenHash = null;
  user.verifyEmailExpires = null;
  await user.save();

  // The link is typically opened in a fresh tab (from an email client), not
  // the tab where the user is actually signed in and might be looking at
  // the "verify your email" banner — that tab has no other way to learn
  // this happened, so tell its socket directly rather than leaving it stale
  // until its next full reload.
  req.app.get('io').to(`user:${user._id}`).emit('user:email-verified');
  res.status(200).json({ message: 'Email verified successfully' });
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
  const sid = await createSession(user._id);
  res.status(200).json({ token: signToken(user, sid), user: toPublicUser(user) });
});

// POST /auth/logout — revokes just the session this token carries. A copied
// token stops working the instant this returns, rather than staying valid
// until its 7-day expiry; any live socket connection on this session is
// dropped too (see disconnectSessions above).
router.post('/logout', requireAuth, async (req, res) => {
  await revokeSession(req.sessionId, req.userId);
  disconnectSessions(req.app.get('io'), req.userId, [req.sessionId]);
  res.status(204).send();
});

// POST /auth/logout-all — revokes every session this account has, including
// the one making this request, for when a token/device may be compromised
// rather than just ending the current visit.
router.post('/logout-all', requireAuth, async (req, res) => {
  const revokedSids = await revokeAllSessions(req.userId);
  disconnectSessions(req.app.get('io'), req.userId, revokedSids);
  res.status(204).send();
});

module.exports = router;
