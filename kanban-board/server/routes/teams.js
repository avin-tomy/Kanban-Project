const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const Board = require('../models/Board');
const Column = require('../models/Column');
const Card = require('../models/Card');
const Note = require('../models/Note');
const Activity = require('../models/Activity');
const { requireTeamMembership, requireTeamOwner, requireTeamManager } = require('../middleware/teamAccess');

// POST /teams — create a team; the creator becomes its owner and first member.
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required and must be a string' });
  }

  const team = await Team.create({ name, ownerId: req.userId });
  await TeamMember.create({ teamId: team._id, userId: req.userId, role: 'owner' });
  res.status(201).location(`/teams/${team._id}`).json(team);
});

// GET /teams — teams the current user belongs to, with their own role on each.
router.get('/', async (req, res) => {
  const memberships = await TeamMember.find({ userId: req.userId });
  const roleByTeamId = new Map(memberships.map(m => [String(m.teamId), m.role]));
  const teams = await Team.find({ _id: { $in: memberships.map(m => m.teamId) } }).sort({ createdAt: 1 });
  const withRole = teams.map(team => ({
    ...team.toObject(),
    role: roleByTeamId.get(String(team._id)),
    isOwner: String(team.ownerId) === String(req.userId),
  }));
  res.status(200).json(withRole);
});

// GET /teams/:teamId/members — member list, visible to any team member.
router.get('/:teamId/members', requireTeamMembership(), async (req, res) => {
  const memberships = await TeamMember.find({ teamId: req.team._id });
  const roleByUserId = new Map(memberships.map(m => [String(m.userId), m.role]));
  const users = await User.find({ _id: { $in: memberships.map(m => m.userId) } });
  const members = users.map(u => ({
    _id: u._id,
    name: u.name,
    email: u.email,
    role: roleByUserId.get(String(u._id)),
    isOwner: String(u._id) === String(req.team.ownerId),
  }));

  // Owner first, then co-owners, then members — alphabetical by name within
  // each of those groups.
  const ROLE_RANK = { owner: 0, co_owner: 1, member: 2 };
  members.sort((a, b) => {
    const rankDiff = ROLE_RANK[a.role] - ROLE_RANK[b.role];
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });

  res.status(200).json(members);
});

// GET /teams/:teamId/members/search?q=... — suggest existing users to add,
// matched by a partial name/email search. Scoped to owner/co-owner (the same
// people who can actually add a member) so this can't be used as a general
// directory lookup by every authenticated user. Excludes people who are
// already on the team, and returns nothing for a query shorter than 2
// characters — long enough to avoid dumping most of the user base back on
// the first keystroke.
router.get('/:teamId/members/search', requireTeamManager(), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.status(200).json([]);

  const existingMemberIds = (await TeamMember.find({ teamId: req.team._id }, 'userId')).map(m => m.userId);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'i');

  const users = await User.find({
    _id: { $nin: existingMemberIds },
    $or: [{ name: pattern }, { email: pattern }],
  }).limit(8);

  res.status(200).json(users.map(u => ({ _id: u._id, name: u.name, email: u.email })));
});

// POST /teams/:teamId/members — add a member by email; owner or co-owner
// (adding isn't "deleting", so co-owners can do this too). New members
// start as plain 'member' — the owner can promote them afterward.
router.post('/:teamId/members', requireTeamManager(), async (req, res) => {
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

  await TeamMember.create({ teamId: req.team._id, userId: user._id, role: 'member' });
  req.app.get('io').to(`team:${req.team._id}`).emit('team:membership-changed', { teamId: req.team._id, kind: 'member-added' });
  res.status(201).json({ _id: user._id, name: user.name, email: user.email, role: 'member', isOwner: false });
});

// PATCH /teams/:teamId/members/:userId — promote/demote a member between
// 'co_owner' and 'member'. Owner or co-owner can promote a member to
// co-owner, but demoting a co-owner back to member is owner-only — a
// co-owner can hand out their own level of access but not take it away from
// a peer. The owner's own role can't be changed here — no ownership transfer.
router.patch('/:teamId/members/:userId', requireTeamManager(), async (req, res) => {
  const { role } = req.body;
  if (!['co_owner', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be co_owner or member' });
  }
  if (String(req.params.userId) === String(req.team.ownerId)) {
    return res.status(400).json({ error: "The team owner's role can't be changed" });
  }
  if (req.role === 'co_owner' && role === 'member') {
    return res.status(403).json({ error: 'Only the team owner can demote a co-owner' });
  }

  const membership = await TeamMember.findOne({ teamId: req.team._id, userId: req.params.userId });
  if (!membership) return res.status(404).json({ error: 'That user is not a member of this team' });

  membership.role = role;
  await membership.save();
  req.app.get('io').to(`team:${req.team._id}`).emit('team:membership-changed', { teamId: req.team._id, kind: 'role-changed' });
  res.status(200).json({ _id: req.params.userId, role });
});

// DELETE /teams/:teamId/members/:userId — remove a member; owner-only
// (removing someone is a deletion), can't remove self/the owner.
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
    await Note.deleteMany({ boardId: board._id });
    await Card.deleteMany({ boardId: board._id });
    await Column.deleteMany({ boardId: board._id });
    await Activity.deleteMany({ boardId: board._id });
    await board.deleteOne();
  }
  await TeamMember.deleteMany({ teamId: req.team._id });
  await req.team.deleteOne();
  res.status(204).send();
});

module.exports = router;
