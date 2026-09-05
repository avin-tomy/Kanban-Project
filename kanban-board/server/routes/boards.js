const express = require('express');
const router = express.Router();
const Board = require('../models/Board');
const Column = require('../models/Column');
const Card = require('../models/Card');
const { requireBoardAccess, requireTeamMembership } = require('../middleware/teamAccess');

// GET /teams/:teamId/boards — list boards for a team
router.get('/teams/:teamId/boards', requireTeamMembership(), async (req, res) => {
  const boards = await Board.find({ teamId: req.team._id }).sort({ createdAt: -1 });
  res.status(200).json(boards);
});

// POST /teams/:teamId/boards — create a new board within a team
router.post('/teams/:teamId/boards', requireTeamMembership(), async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required and must be a string' });
  }
  const board = await Board.create({ name, teamId: req.team._id });
  req.app.get('io').to(`team:${req.team._id}`).emit('board-list:changed', { teamId: req.team._id, kind: 'board-created' });
  res.status(201).location(`/boards/${board._id}`).json(board);
});

// GET /boards/:id — a single board resource
router.get('/boards/:id', requireBoardAccess, async (req, res) => {
  res.status(200).json(req.board);
});

// GET /boards/:id/full — an AGGREGATE representation: the board plus its
// columns and cards, nested, in one response. This isn't a 1:1 mirror of a
// single DB collection — it's a view assembled for the frontend's convenience.
// (Ties back to "representation != underlying resource storage" from REST basics.)
router.get('/boards/:id/full', requireBoardAccess, async (req, res) => {
  const board = req.board;

  const columns = await Column.find({ boardId: board._id }).sort({ position: 1 });
  const cards = await Card.find({ boardId: board._id }).sort({ position: 1 });

  const columnsWithCards = columns.map(col => ({
    ...col.toObject(),
    cards: cards.filter(c => String(c.columnId) === String(col._id)),
  }));

  res.status(200).json({ ...board.toObject(), columns: columnsWithCards });
});

// DELETE /boards/:id — deleting a board cascades to its columns and cards,
// since they can't meaningfully exist without their parent board.
router.delete('/boards/:id', requireBoardAccess, async (req, res) => {
  const board = req.board;

  await Card.deleteMany({ boardId: board._id });
  await Column.deleteMany({ boardId: board._id });
  await board.deleteOne();
  req.app.get('io').to(`team:${board.teamId}`).emit('board-list:changed', { teamId: board.teamId, kind: 'board-deleted' });
  res.status(204).send();
});

module.exports = router;
