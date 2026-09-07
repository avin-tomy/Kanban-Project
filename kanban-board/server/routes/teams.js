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
const notify = require('../utils/notify');

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

  // Explicit status so this sees pending invites too, not just accepted
  // members — otherwise re-inviting someone already invited would slip
  // through as a suggestion again.
  const existingMemberIds = (await TeamMember.find({ teamId: req.team._id, status: { $in: ['pending', 'accepted'] } }, 'userId')).map(m => m.userId);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'i');

  const users = await User.find({
    _id: { $nin: existingMemberIds },
    $or: [{ name: pattern }, { email: pattern }],
  }).limit(8);

  res.status(200).json(users.map(u => ({ _id: u._id, name: u.name, email: u.email })));
});

// POST /teams/:teamId/members — invite someone by email; owner or co-owner
// (adding isn't "deleting", so co-owners can do this too). Creates a
// *pending* row — they get no access to this team's boards until they
// accept the resulting invite notification (see POST /:teamId/accept
// below). New members start as plain 'member' once accepted — the owner
// can promote them afterward.
router.post('/:teamId/members', requireTeamManager(), async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required and must be a string' });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    return res.status(404).json({ error: 'No account found for that email — ask them to sign up first.' });
  }

  // Explicit status so this sees a pending invite too, not just an accepted
  // membership — otherwise the same person could be invited twice over.
  const existing = await TeamMember.findOne({ teamId: req.team._id, userId: user._id, status: { $in: ['pending', 'accepted'] } });
  if (existing) {
    return res.status(409).json({
      error: existing.status === 'pending' ? 'That person has already been invited' : 'That person is already a member of this team',
    });
  }

  await TeamMember.create({ teamId: req.team._id, userId: user._id, role: 'member', status: 'pending' });
  await notify(req.app, {
    userId: user._id,
    actorId: req.userId,
    type: 'team_invited',
    message: `invited you to join "${req.team.name}"`,
    teamId: req.team._id,
  });
  req.app.get('io').to(`team:${req.team._id}`).emit('team:membership-changed', { teamId: req.team._id, kind: 'invite-sent' });
  res.status(201).json({ _id: user._id, name: user.name, email: user.email });
});

// GET /teams/:teamId/invitations — pending invites, visible to whoever can
// manage membership (the same people who can send one). Kept separate from
// the member list above rather than mixed in with a "pending" flag, since a
// pending row has no role yet and would need special-casing throughout that
// list's rendering otherwise.
router.get('/:teamId/invitations', requireTeamManager(), async (req, res) => {
  const pending = await TeamMember.find({ teamId: req.team._id, status: 'pending' }).sort({ createdAt: 1 });
  const users = await User.find({ _id: { $in: pending.map(m => m.userId) } });
  const userById = new Map(users.map(u => [String(u._id), u]));
  const invitations = pending.map(m => {
    const u = userById.get(String(m.userId));
    return { _id: m.userId, name: u?.name ?? 'Unknown', email: u?.email ?? '' };
  });
  res.status(200).json(invitations);
});

// POST /teams/:teamId/accept — the invitee accepting their own pending
// invite. Not gated by requireTeamManager/requireTeamMembership — those
// both require an already-accepted row, which is exactly what doesn't
// exist yet here.
router.post('/:teamId/accept', async (req, res) => {
  const membership = await TeamMember.findOne({ teamId: req.params.teamId, userId: req.userId, status: 'pending' });
  if (!membership) return res.status(404).json({ error: 'No pending invitation to this team' });

  membership.status = 'accepted';
  await membership.save();

  const team = await Team.findById(req.params.teamId);
  await notify(req.app, {
    userId: team.ownerId,
    actorId: req.userId,
    type: 'invite_accepted',
    message: `accepted your invitation to join "${team.name}"`,
    teamId: team._id,
  });
  req.app.get('io').to(`team:${req.params.teamId}`).emit('team:membership-changed', { teamId: req.params.teamId, kind: 'member-added' });
  res.status(200).json({ teamId: req.params.teamId });
});

// DELETE /teams/:teamId/accept — declining an invite. No notify() call —
// unlike accepting, declining isn't something the inviter's badge needs to
// surface — but the socket event still fires, so an owner/co-owner with the
// Team Members page open sees the pending row disappear live either way.
router.delete('/:teamId/accept', async (req, res) => {
  const membership = await TeamMember.findOne({ teamId: req.params.teamId, userId: req.userId, status: 'pending' });
  if (!membership) return res.status(404).json({ error: 'No pending invitation to this team' });

  await membership.deleteOne();
  req.app.get('io').to(`team:${req.params.teamId}`).emit('team:membership-changed', { teamId: req.params.teamId, kind: 'invite-declined' });
  res.status(204).send();
});

// PATCH /teams/:teamId/members/:userId — promote/demote a member between
// 'co_owner' and 'member'. Owner or co-owner can promote a member to
// co-owner, but demoting a co-owner back to member is owner-only — a
// co-owner can hand out their own level of access but not take it away from
// a peer. The owner's own role can't be changed here — that's a distinct,
// more consequential action handled by POST /:teamId/transfer-ownership below.
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
  await notify(req.app, {
    userId: req.params.userId,
    actorId: req.userId,
    type: 'role_changed',
    message: `changed your role to ${role === 'co_owner' ? 'Co-owner' : 'Member'} on "${req.team.name}"`,
    teamId: req.team._id,
  });
  req.app.get('io').to(`team:${req.team._id}`).emit('team:membership-changed', { teamId: req.team._id, kind: 'role-changed' });
  res.status(200).json({ _id: req.params.userId, role });
});

// POST /teams/:teamId/transfer-ownership — owner-only. The target must
// already be a member; the schema allows exactly one 'owner' per team, so
// the previous owner is automatically demoted to co-owner as part of the
// same transfer rather than left as a second owner.
router.post('/:teamId/transfer-ownership', requireTeamOwner(), async (req, res) => {
  const { userId } = req.body;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (String(userId) === String(req.team.ownerId)) {
    return res.status(400).json({ error: 'That person already owns this team' });
  }

  const membership = await TeamMember.findOne({ teamId: req.team._id, userId });
  if (!membership) return res.status(400).json({ error: 'userId must be a member of this team' });

  const previousOwnerId = req.team.ownerId;
  req.team.ownerId = userId;
  await req.team.save();
  membership.role = 'owner';
  await membership.save();
  await TeamMember.updateOne({ teamId: req.team._id, userId: previousOwnerId }, { role: 'co_owner' });

  await notify(req.app, {
    userId,
    actorId: req.userId,
    type: 'ownership_transferred',
    message: `made you the owner of "${req.team.name}"`,
    teamId: req.team._id,
  });
  req.app.get('io').to(`team:${req.team._id}`).emit('team:membership-changed', { teamId: req.team._id, kind: 'ownership-transferred' });
  res.status(200).json({ ownerId: userId });
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

// DELETE /teams/:teamId/leave — any member can remove themselves; the owner
// can't (same "owner can't be removed" rule as above) since a team always
// needs exactly one — they'd need to transfer ownership first.
router.delete('/:teamId/leave', requireTeamMembership(), async (req, res) => {
  if (String(req.userId) === String(req.team.ownerId)) {
    return res.status(400).json({ error: 'Transfer ownership before leaving this team' });
  }

  await TeamMember.deleteOne({ teamId: req.team._id, userId: req.userId });
  req.app.get('io').to(`team:${req.team._id}`).emit('team:membership-changed', { teamId: req.team._id, kind: 'member-left' });
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
