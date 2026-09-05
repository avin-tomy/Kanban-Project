const express = require('express');
const router = express.Router();
const Column = require('../models/Column');
const Card = require('../models/Card');
const { requireColumnAccess, requireCardAccess } = require('../middleware/teamAccess');

// POST /columns/:columnId/cards — create a card inside a column
router.post('/columns/:columnId/cards', requireColumnAccess, async (req, res) => {
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
router.get('/columns/:columnId/cards', requireColumnAccess, async (req, res) => {
  const cards = await Card.find({ columnId: req.params.columnId }).sort({ position: 1 });
  res.status(200).json(cards);
});

// PATCH /cards/:id — partial update: edit text, or MOVE the card by changing
// columnId/position. Moving a card is just "change which column it belongs to" —
// no separate "move" endpoint needed, because the card's column is just a field.
router.patch('/cards/:id', requireCardAccess, async (req, res) => {
  const card = req.card;

  const { title, description, columnId, position } = req.body;
  if (columnId !== undefined && columnId !== String(card.columnId)) {
    // A card can only move within its own board — changing columnId to a
    // column on another board would let it cross a team boundary one PATCH
    // at a time, bypassing the access checks the rest of the API enforces.
    const targetColumn = await Column.findById(columnId);
    if (!targetColumn || String(targetColumn.boardId) !== String(card.boardId)) {
      return res.status(400).json({ error: 'columnId must belong to a column on the same board as this card' });
    }
  }
  if (title !== undefined) card.title = title;
  if (description !== undefined) card.description = description;
  if (columnId !== undefined) card.columnId = columnId;
  if (position !== undefined) card.position = position;
  await card.save();
  req.app.get('io').to(`board:${card.boardId}`).emit('board:changed', { boardId: card.boardId, kind: 'card-updated' });
  res.status(200).json(card);
});

// DELETE /cards/:id
router.delete('/cards/:id', requireCardAccess, async (req, res) => {
  const boardId = req.card.boardId;
  await req.card.deleteOne();
  req.app.get('io').to(`board:${boardId}`).emit('board:changed', { boardId, kind: 'card-deleted' });
  res.status(204).send();
});

module.exports = router;
