const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { requireBoardAccess } = require('../middleware/teamAccess');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// GET /boards/:boardId/activity — everything logged on this board in the
// last 7 days, newest first (an activity feed reads top-down as "what just
// happened", unlike Notes' chat-style oldest-first).
router.get('/boards/:boardId/activity', requireAuth, requireBoardAccess, async (req, res) => {
  const since = new Date(Date.now() - SEVEN_DAYS_MS);
  const activities = await Activity.find({ boardId: req.board._id, createdAt: { $gte: since } }).sort({ createdAt: -1 });

  const actorIds = [...new Set(activities.map(a => String(a.actorId)))];
  const actors = await User.find({ _id: { $in: actorIds } });
  const nameById = new Map(actors.map(u => [String(u._id), u.name]));

  const withNames = activities.map(a => ({
    ...a.toObject(),
    actorName: nameById.get(String(a.actorId)) || 'Unknown',
  }));
  res.status(200).json(withNames);
});

module.exports = router;
