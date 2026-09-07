const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');

const RECENT_LIMIT = 30;

// GET /notifications — the current user's most recent notifications, newest
// first, plus how many are unread (so the bell's badge count and the
// dropdown's contents come from one round trip instead of two).
router.get('/', async (req, res) => {
  const items = await Notification.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(RECENT_LIMIT);
  const unreadCount = await Notification.countDocuments({ userId: req.userId, read: false });

  const actorIds = [...new Set(items.map(n => String(n.actorId)))];
  const actors = await User.find({ _id: { $in: actorIds } });
  const nameById = new Map(actors.map(u => [String(u._id), u.name]));

  const withNames = items.map(n => ({ ...n.toObject(), actorName: nameById.get(String(n.actorId)) || 'Unknown' }));
  res.status(200).json({ items: withNames, unreadCount });
});

// POST /notifications/read-all — clears the badge in one call instead of a
// PATCH per item.
router.post('/read-all', async (req, res) => {
  await Notification.updateMany({ userId: req.userId, read: false }, { read: true });
  res.status(204).send();
});

// PATCH /notifications/:id — mark a single notification read, e.g. when it's clicked.
router.patch('/:id', async (req, res) => {
  const notification = await Notification.findOne({ _id: req.params.id, userId: req.userId });
  if (!notification) return res.status(404).json({ error: 'Notification not found' });

  if (req.body.read !== undefined) notification.read = !!req.body.read;
  await notification.save();
  res.status(200).json(notification);
});

// DELETE /notifications/:id — dismiss a single notification. Not for a team
// invite: that one only goes away by being accepted or declined (or by the
// inviter canceling it — see utils/notify.js's unnotify), since dismissing
// it here would just hide something still awaiting a response.
router.delete('/:id', async (req, res) => {
  const notification = await Notification.findOne({ _id: req.params.id, userId: req.userId });
  if (!notification) return res.status(404).json({ error: 'Notification not found' });
  if (notification.type === 'team_invited') {
    return res.status(400).json({ error: 'Accept or decline the invitation instead of clearing it' });
  }

  await notification.deleteOne();
  res.status(204).send();
});

// DELETE /notifications — clear everything except pending team invites, for
// the same reason a single one can't be cleared above.
router.delete('/', async (req, res) => {
  await Notification.deleteMany({ userId: req.userId, type: { $ne: 'team_invited' } });
  res.status(204).send();
});

module.exports = router;
