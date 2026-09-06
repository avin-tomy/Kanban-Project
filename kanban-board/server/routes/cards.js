const express = require('express');
const router = express.Router();
const Column = require('../models/Column');
const Card = require('../models/Card');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { requireColumnAccess, requireCardAccess, requireManagerRole, requireOwnerRole } = require('../middleware/teamAccess');
const logActivity = require('../utils/activityLog');

const STATUS_LABELS = { not_started: 'Not started', working: 'Working', completed: 'Completed' };

// POST /columns/:columnId/cards — create a card inside a column. Owner or
// co-owner only.
router.post('/columns/:columnId/cards', requireAuth, requireColumnAccess, requireManagerRole, async (req, res) => {
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
  await logActivity(req.app, column.boardId, req.userId, `created card "${title}" in "${column.name}"`);
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

  // A plain member's access is scoped to exactly one thing: flipping the
  // status of a card assigned to them. Anything else — editing any other
  // field, or touching a card that isn't theirs — is owner/co-owner only.
  if (req.role === 'member') {
    const onlyStatus = Object.keys(req.body).every(key => key === 'status');
    if (!onlyStatus) {
      return res.status(403).json({ error: 'Members can only change the status of cards assigned to them' });
    }
    if (String(card.assigneeId || '') !== String(req.userId)) {
      return res.status(403).json({ error: 'You can only change the status of cards assigned to you' });
    }
  }

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
  if (dueDate !== undefined && dueDate !== null) {
    if (Number.isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ error: 'dueDate must be a valid date or null' });
    }
    // Compared as calendar-day strings (not Date arithmetic) for the same
    // reason as the client's dueDateStatus: avoids a timezone shift making a
    // same-day due date look like it's before the card was created.
    const dueDateStr = new Date(dueDate).toISOString().slice(0, 10);
    const createdDateStr = card.createdAt.toISOString().slice(0, 10);
    if (dueDateStr < createdDateStr) {
      return res.status(400).json({ error: 'dueDate cannot be before the card was created' });
    }
  }
  if (status !== undefined && !['not_started', 'working', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be one of not_started, working, completed' });
  }

  // Diffed against the card's current values BEFORE they're overwritten
  // below, so each activity line reads like "assigned X to Bob" rather than
  // firing even when a field is PATCHed to the value it already had.
  const activityLines = [];
  if (title !== undefined && title !== card.title) {
    activityLines.push(`renamed card "${card.title}" to "${title}"`);
  }
  if (description !== undefined && description !== card.description) {
    activityLines.push(`updated the description of "${card.title}"`);
  }
  if (assigneeId !== undefined && String(assigneeId || '') !== String(card.assigneeId || '')) {
    if (assigneeId) {
      const assignee = await User.findById(assigneeId);
      activityLines.push(`assigned "${card.title}" to ${assignee ? assignee.name : 'someone'}`);
    } else {
      activityLines.push(`unassigned "${card.title}"`);
    }
  }
  if (dueDate !== undefined) {
    const oldDate = card.dueDate ? card.dueDate.toISOString().slice(0, 10) : null;
    const newDate = dueDate ? new Date(dueDate).toISOString().slice(0, 10) : null;
    if (oldDate !== newDate) {
      activityLines.push(newDate ? `set due date of "${card.title}" to ${newDate}` : `cleared due date of "${card.title}"`);
    }
  }
  if (status !== undefined && status !== card.status) {
    activityLines.push(`changed status of "${card.title}" to ${STATUS_LABELS[status]}`);
  }

  if (title !== undefined) card.title = title;
  if (description !== undefined) card.description = description;
  if (columnId !== undefined) card.columnId = columnId;
  if (position !== undefined) card.position = position;
  if (assigneeId !== undefined) {
    card.assigneeId = assigneeId;
    card.assignedAt = assigneeId ? new Date() : null;
  }
  if (dueDate !== undefined) card.dueDate = dueDate;
  if (status !== undefined) card.status = status;
  await card.save();
  for (const detail of activityLines) {
    await logActivity(req.app, card.boardId, req.userId, detail);
  }
  req.app.get('io').to(`board:${card.boardId}`).emit('board:changed', { boardId: card.boardId, kind: 'card-updated' });
  res.status(200).json(card);
});

// DELETE /cards/:id — owner-only
router.delete('/cards/:id', requireAuth, requireCardAccess, requireOwnerRole, async (req, res) => {
  const boardId = req.card.boardId;
  const title = req.card.title;
  await req.card.deleteOne();
  await logActivity(req.app, boardId, req.userId, `deleted card "${title}"`);
  req.app.get('io').to(`board:${boardId}`).emit('board:changed', { boardId, kind: 'card-deleted' });
  res.status(204).send();
});

module.exports = router;
