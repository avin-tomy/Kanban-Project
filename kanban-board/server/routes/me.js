const express = require('express');
const router = express.Router();
const Card = require('../models/Card');
const Board = require('../models/Board');
const Column = require('../models/Column');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const { requireAuth } = require('../middleware/auth');

// GET /me/assigned-cards — every card assigned to the current user, across
// every team they belong to (not just the currently selected one) — this is
// a personal "what's on my plate" view, so it deliberately ignores the
// team-scoping the rest of the API uses. Sorted so overdue/soonest-due cards
// lead, with undated cards trailing at the end.
router.get('/assigned-cards', requireAuth, async (req, res) => {
  const memberships = await TeamMember.find({ userId: req.userId });
  const teamIds = memberships.map(m => m.teamId);

  const boards = await Board.find({ teamId: { $in: teamIds } });
  const boardIds = boards.map(b => b._id);

  const cards = await Card.find({ assigneeId: req.userId, boardId: { $in: boardIds } });

  const teams = await Team.find({ _id: { $in: teamIds } });
  const teamById = new Map(teams.map(t => [String(t._id), t]));
  const boardById = new Map(boards.map(b => [String(b._id), b]));

  const columnIds = [...new Set(cards.map(c => String(c.columnId)))];
  const columns = await Column.find({ _id: { $in: columnIds } });
  const columnById = new Map(columns.map(c => [String(c._id), c]));

  const enriched = cards.map(c => {
    const board = boardById.get(String(c.boardId));
    const team = board ? teamById.get(String(board.teamId)) : null;
    const column = columnById.get(String(c.columnId));
    return {
      ...c.toObject(),
      boardName: board?.name ?? 'Unknown board',
      teamId: board?.teamId ?? null,
      teamName: team?.name ?? 'Unknown team',
      columnName: column?.name ?? 'Unknown column',
    };
  });

  // Sorted in JS rather than via Mongo's sort so undated cards land at the
  // end regardless of driver-specific null ordering — dated cards ascending
  // (soonest/most overdue first), then everything without a due date.
  const dated = enriched.filter(c => c.dueDate).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const undated = enriched.filter(c => !c.dueDate);

  res.status(200).json([...dated, ...undated]);
});

module.exports = router;
