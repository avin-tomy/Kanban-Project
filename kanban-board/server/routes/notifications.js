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

module.exports = router;
