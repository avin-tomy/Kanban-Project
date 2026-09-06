const express = require('express');
const router = express.Router();
const Column = require('../models/Column');
const Card = require('../models/Card');
const TeamMember = require('../models/TeamMember');
const { requireAuth } = require('../middleware/auth');
const { requireColumnAccess, requireCardAccess } = require('../middleware/teamAccess');

// POST /columns/:columnId/cards — create a card inside a column
router.post('/columns/:columnId/cards', requireAuth, requireColumnAccess, async (req, res) => {
  const column = req.column;

  const { title, description } = req.body;
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required and must be a string' });
  }

  const count = await Card.countDocuments({ columnId: column._id });
  const card = await Card.create({
    boardId: column.boardId,
    columnId: column._id,
    title,
    description: description || '',
    position: count,
  });
  req.app.get('io').to(`board:${column.boardId}`).emit('board:changed', { boardId: column.boardId, kind: 'card-created' });
  res.status(201).location(`/cards/${card._id}`).json(card);
});

// GET /columns/:columnId/cards — list cards in a column
router.get('/columns/:columnId/cards', requireAuth, requireColumnAccess, async (req, res) => {
  const cards = await Card.find({ columnId: req.params.columnId }).sort({ position: 1 });
  res.status(200).json(cards);
});

// PATCH /cards/:id — partial update: edit text, or MOVE the card by changing
// columnId/position. Moving a card is just "change which column it belongs to" —
// no separate "move" endpoint needed, because the card's column is just a field.
router.patch('/cards/:id', requireAuth, requireCardAccess, async (req, res) => {
  const card = req.card;

  const { title, description, columnId, position, assigneeId, dueDate, status } = req.body;
  if (columnId !== undefined && columnId !== String(card.columnId)) {
    // A card can only move within its own board — changing columnId to a
    // column on another board would let it cross a team boundary one PATCH
    // at a time, bypassing the access checks the rest of the API enforces.
    const targetColumn = await Column.findById(columnId);
    if (!targetColumn || String(targetColumn.boardId) !== String(card.boardId)) {
      return res.status(400).json({ error: 'columnId must belong to a column on the same board as this card' });
    }
  }
  if (assigneeId !== undefined && assigneeId !== null) {
    // Can only assign to someone who's actually a member of this board's
    // team — otherwise a card could point at a user with no access to it.
    const isMember = await TeamMember.exists({ teamId: req.board.teamId, userId: assigneeId });
    if (!isMember) {
      return res.status(400).json({ error: 'assigneeId must be a member of this board\'s team' });
    }
  }
  if (dueDate !== undefined && dueDate !== null && Number.isNaN(new Date(dueDate).getTime())) {
    return res.status(400).json({ error: 'dueDate must be a valid date or null' });
  }
  if (status !== undefined && !['not_started', 'working', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be one of not_started, working, completed' });
  }
  if (title !== undefined) card.title = title;
  if (description !== undefined) card.description = description;
  if (columnId !== undefined) card.columnId = columnId;
  if (position !== undefined) card.position = position;
  if (assigneeId !== undefined) card.assigneeId = assigneeId;
  if (dueDate !== undefined) card.dueDate = dueDate;
  if (status !== undefined) card.status = status;
  await card.save();
  req.app.get('io').to(`board:${card.boardId}`).emit('board:changed', { boardId: card.boardId, kind: 'card-updated' });
  res.status(200).json(card);
});

// DELETE /cards/:id
router.delete('/cards/:id', requireAuth, requireCardAccess, async (req, res) => {
  const boardId = req.card.boardId;
  await req.card.deleteOne();
  req.app.get('io').to(`board:${boardId}`).emit('board:changed', { boardId, kind: 'card-deleted' });
  res.status(204).send();
});

module.exports = router;
