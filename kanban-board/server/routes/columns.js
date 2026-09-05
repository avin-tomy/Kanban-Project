const express = require('express');
const router = express.Router();
const Column = require('../models/Column');
const Card = require('../models/Card');
const { requireBoardAccess, requireColumnAccess } = require('../middleware/teamAccess');

// POST /boards/:boardId/columns — create a column inside a board.
// Nested under /boards because a column can't exist without a parent board —
// the URL reflects that ownership, same as /posts/9/comments earlier.
router.post('/boards/:boardId/columns', requireBoardAccess, async (req, res) => {
  const board = req.board;

  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required and must be a string' });
  }

  const count = await Column.countDocuments({ boardId: board._id });
  const column = await Column.create({ boardId: board._id, name, position: count });
  req.app.get('io').to(`board:${board._id}`).emit('board:changed', { boardId: board._id, kind: 'column-created' });
  res.status(201).location(`/columns/${column._id}`).json(column);
});

// GET /boards/:boardId/columns — list columns for a board
router.get('/boards/:boardId/columns', requireBoardAccess, async (req, res) => {
  const columns = await Column.find({ boardId: req.params.boardId }).sort({ position: 1 });
  res.status(200).json(columns);
});

// PATCH /columns/:id — partial update (rename, or reorder via position).
// A single top-level resource from here on — it doesn't need to be re-nested
// under /boards/:boardId, since its own id is already globally unique.
router.patch('/columns/:id', requireColumnAccess, async (req, res) => {
  const column = req.column;

  const { name, position } = req.body;
  if (name !== undefined) column.name = name;
  if (position !== undefined) column.position = position;
  await column.save();
  req.app.get('io').to(`board:${column.boardId}`).emit('board:changed', { boardId: column.boardId, kind: 'column-updated' });
  res.status(200).json(column);
});

// PUT /columns/:id/cards/order — replace the full ordering of cards in this
// column. Treats "a column's card order" as its own resource (a list), so a
// drag-and-drop move (reorder, or move-between-columns) is ONE write instead
// of one PATCH per affected card. Idempotent: sending the same array again
// produces the same end state. Cards not already in this column get their
// columnId reassigned here too, so this single call also covers cross-column
// moves — the source column needs no write at all, since removing an id from
// its list still leaves the rest in correct relative order.
router.put('/columns/:id/cards/order', requireColumnAccess, async (req, res) => {
  const column = req.column;

  const { cardIds } = req.body;
  if (!Array.isArray(cardIds)) {
    return res.status(400).json({ error: 'cardIds must be an array' });
  }

  // Every card being reordered must already belong to this column's board —
  // otherwise a member of one team could move a card they can name the id of
  // (but don't have access to) into their own board.
  const existingCards = await Card.find({ _id: { $in: cardIds } });
  if (existingCards.length !== cardIds.length || existingCards.some(c => String(c.boardId) !== String(column.boardId))) {
    return res.status(400).json({ error: 'All cardIds must belong to a card already on this board' });
  }

  await Card.bulkWrite(cardIds.map((cardId, index) => ({
    updateOne: {
      filter: { _id: cardId },
      update: { position: index, columnId: column._id, boardId: column.boardId },
    },
  })));

  const cards = await Card.find({ columnId: column._id }).sort({ position: 1 });
  req.app.get('io').to(`board:${column.boardId}`).emit('board:changed', { boardId: column.boardId, kind: 'cards-reordered' });
  res.status(200).json(cards);
});

// DELETE /columns/:id — cascades to its cards
router.delete('/columns/:id', requireColumnAccess, async (req, res) => {
  const column = req.column;

  await Card.deleteMany({ columnId: column._id });
  await column.deleteOne();
  req.app.get('io').to(`board:${column.boardId}`).emit('board:changed', { boardId: column.boardId, kind: 'column-deleted' });
  res.status(204).send();
});

module.exports = router;
