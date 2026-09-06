const Board = require('../models/Board');
const Column = require('../models/Column');
const Card = require('../models/Card');
const Note = require('../models/Note');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');

// Nested directly under /teams/:teamId/... — just needs team membership.
function requireTeamMembership(paramName = 'teamId') {
  return async (req, res, next) => {
    const team = await Team.findById(req.params[paramName]);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const member = await TeamMember.findOne({ teamId: team._id, userId: req.userId });
    if (!member) return res.status(403).json({ error: 'Not a member of this team' });

    req.team = team;
    req.role = member.role;
    next();
  };
}

// Same, but only the team's owner may proceed (membership management, team deletion).
function requireTeamOwner(paramName = 'teamId') {
  return async (req, res, next) => {
    const team = await Team.findById(req.params[paramName]);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    if (String(team.ownerId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Only the team owner can do this' });
    }

    req.team = team;
    req.role = 'owner';
    next();
  };
}

// Owner or co-owner — "can do anything except deleting things": creating
// boards/columns/cards, editing any field, managing members (but not
// removing them, and not changing roles — those stay owner-only).
function requireTeamManager(paramName = 'teamId') {
  return async (req, res, next) => {
    const team = await Team.findById(req.params[paramName]);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const member = await TeamMember.findOne({ teamId: team._id, userId: req.userId });
    if (!member || !['owner', 'co_owner'].includes(member.role)) {
      return res.status(403).json({ error: 'Only the team owner or a co-owner can do this' });
    }

    req.team = team;
    req.role = member.role;
    next();
  };
}

// Boards don't carry teamId directly on the resource being fetched in every
// route (columns/cards only carry boardId/columnId), so each resource shape
// gets its own resolver that walks up to the owning board, then checks
// membership on that board's team. Every resolver also attaches the caller's
// role on that team, since most mutation routes need it to decide what a
// member vs. co-owner vs. owner is allowed to do.
async function checkBoardMembership(boardId, userId) {
  const board = await Board.findById(boardId);
  if (!board) return { status: 404, error: 'Board not found' };

  const member = await TeamMember.findOne({ teamId: board.teamId, userId });
  if (!member) return { status: 403, error: "Not a member of this board's team" };

  return { board, role: member.role };
}

// For routes keyed by a board id, under either :id or :boardId.
function requireBoardAccess(req, res, next) {
  const boardId = req.params.boardId || req.params.id;
  checkBoardMembership(boardId, req.userId).then(result => {
    if (result.error) return res.status(result.status).json({ error: result.error });
    req.board = result.board;
    req.role = result.role;
    next();
  }).catch(next);
}

// For routes keyed by a column id, under either :id or :columnId.
function requireColumnAccess(req, res, next) {
  const columnId = req.params.columnId || req.params.id;
  Column.findById(columnId).then(async column => {
    if (!column) return res.status(404).json({ error: 'Column not found' });
    const result = await checkBoardMembership(column.boardId, req.userId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    req.column = column;
    req.board = result.board;
    req.role = result.role;
    next();
  }).catch(next);
}

// Cards already denormalize boardId, so this is a single hop.
function requireCardAccess(req, res, next) {
  Card.findById(req.params.id).then(async card => {
    if (!card) return res.status(404).json({ error: 'Card not found' });
    const result = await checkBoardMembership(card.boardId, req.userId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    req.card = card;
    req.board = result.board;
    req.role = result.role;
    next();
  }).catch(next);
}

// Notes denormalize boardId too, so this is also a single hop, same as cards.
function requireNoteAccess(req, res, next) {
  Note.findById(req.params.id).then(async note => {
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const result = await checkBoardMembership(note.boardId, req.userId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    req.note = note;
    req.board = result.board;
    req.role = result.role;
    next();
  }).catch(next);
}

// Route handlers that only owners/co-owners may reach at all (board/column
// creation, non-status card edits) still need requireBoardAccess /
// requireColumnAccess run first to resolve req.role — this just adds the
// role gate on top of that resolved role.
function requireManagerRole(req, res, next) {
  if (!['owner', 'co_owner'].includes(req.role)) {
    return res.status(403).json({ error: 'Only the team owner or a co-owner can do this' });
  }
  next();
}

// Deleting things (boards, columns, cards, team) is owner-only — co-owners
// can do everything else, so this is a narrower gate than requireManagerRole.
function requireOwnerRole(req, res, next) {
  if (req.role !== 'owner') {
    return res.status(403).json({ error: 'Only the team owner can do this' });
  }
  next();
}

module.exports = {
  requireTeamMembership,
  requireTeamOwner,
  requireTeamManager,
  requireBoardAccess,
  requireColumnAccess,
  requireCardAccess,
  requireNoteAccess,
  requireManagerRole,
  requireOwnerRole,
};
