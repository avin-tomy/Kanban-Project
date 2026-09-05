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

    const member = await TeamMember.exists({ teamId: team._id, userId: req.userId });
    if (!member) return res.status(403).json({ error: 'Not a member of this team' });

    req.team = team;
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
    next();
  };
}

// Boards don't carry teamId directly on the resource being fetched in every
// route (columns/cards only carry boardId/columnId), so each resource shape
// gets its own resolver that walks up to the owning board, then checks
// membership on that board's team.
async function checkBoardMembership(boardId, userId) {
  const board = await Board.findById(boardId);
  if (!board) return { status: 404, error: 'Board not found' };

  const member = await TeamMember.exists({ teamId: board.teamId, userId });
  if (!member) return { status: 403, error: "Not a member of this board's team" };

  return { board };
}

// For routes keyed by a board id, under either :id or :boardId.
function requireBoardAccess(req, res, next) {
  const boardId = req.params.boardId || req.params.id;
  checkBoardMembership(boardId, req.userId).then(result => {
    if (result.error) return res.status(result.status).json({ error: result.error });
    req.board = result.board;
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
    next();
  }).catch(next);
}

module.exports = {
  requireTeamMembership,
  requireTeamOwner,
  requireBoardAccess,
  requireColumnAccess,
  requireCardAccess,
  requireNoteAccess,
};
