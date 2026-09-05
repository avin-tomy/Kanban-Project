const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const Board = require('../models/Board');
const Column = require('../models/Column');
const Card = require('../models/Card');
const { requireTeamMembership, requireTeamOwner } = require('../middleware/teamAccess');

// POST /teams — create a team; the creator becomes its owner and first member.
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required and must be a string' });
  }

  const team = await Team.create({ name, ownerId: req.userId });
  await TeamMember.create({ teamId: team._id, userId: req.userId });
  res.status(201).location(`/teams/${team._id}`).json(team);
});

// GET /teams — teams the current user belongs to (owner or member alike).
router.get('/', async (req, res) => {
  const memberships = await TeamMember.find({ userId: req.userId });
  const teams = await Team.find({ _id: { $in: memberships.map(m => m.teamId) } }).sort({ createdAt: 1 });
  const withOwnerFlag = teams.map(team => ({
    ...team.toObject(),
    isOwner: String(team.ownerId) === String(req.userId),
  }));
  res.status(200).json(withOwnerFlag);
});

// GET /teams/:teamId/members — member list, visible to any team member.
router.get('/:teamId/members', requireTeamMembership(), async (req, res) => {
  const memberships = await TeamMember.find({ teamId: req.team._id });
  const users = await User.find({ _id: { $in: memberships.map(m => m.userId) } });
  const members = users.map(u => ({
    _id: u._id,
    name: u.name,
    email: u.email,
    isOwner: String(u._id) === String(req.team.ownerId),
  }));
  res.status(200).json(members);
});

// POST /teams/:teamId/members — add a member by email; owner-only.
router.post('/:teamId/members', requireTeamOwner(), async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required and must be a string' });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    return res.status(404).json({ error: 'No account found for that email — ask them to sign up first.' });
  }

  const existing = await TeamMember.findOne({ teamId: req.team._id, userId: user._id });
  if (existing) return res.status(409).json({ error: 'That person is already a member of this team' });

  await TeamMember.create({ teamId: req.team._id, userId: user._id });
  req.app.get('io').to(`team:${req.team._id}`).emit('team:membership-changed', { teamId: req.team._id, kind: 'member-added' });
  res.status(201).json({ _id: user._id, name: user.name, email: user.email, isOwner: false });
});

// DELETE /teams/:teamId/members/:userId — remove a member; owner-only, can't remove self.
router.delete('/:teamId/members/:userId', requireTeamOwner(), async (req, res) => {
  if (String(req.params.userId) === String(req.team.ownerId)) {
    return res.status(400).json({ error: 'The team owner cannot be removed' });
  }

  await TeamMember.deleteOne({ teamId: req.team._id, userId: req.params.userId });
  req.app.get('io').to(`team:${req.team._id}`).emit('team:membership-changed', { teamId: req.team._id, kind: 'member-removed' });
  res.status(204).send();
});

// DELETE /teams/:teamId — owner-only; cascades through every board in the team.
router.delete('/:teamId', requireTeamOwner(), async (req, res) => {
  const boards = await Board.find({ teamId: req.team._id });
  for (const board of boards) {
    await Card.deleteMany({ boardId: board._id });
    await Column.deleteMany({ boardId: board._id });
    await board.deleteOne();
  }
  await TeamMember.deleteMany({ teamId: req.team._id });
  await req.team.deleteOne();
  res.status(204).send();
});

module.exports = router;
