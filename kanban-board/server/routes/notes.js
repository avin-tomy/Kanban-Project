const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { requireBoardAccess, requireNoteAccess } = require('../middleware/teamAccess');

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀'];

// GET /boards/:boardId/notes — every note on the board, oldest first (like a
// chat thread, newest at the bottom), visible to the whole team (not just
// the author) — this is a shared notes feed, not a private scratchpad.
router.get('/boards/:boardId/notes', requireAuth, requireBoardAccess, async (req, res) => {
  const notes = await Note.find({ boardId: req.board._id }).sort({ createdAt: 1 });

  // One lookup covers both authors and reactors — reaction pills show who
  // reacted on hover, so their names are needed here too.
  const userIds = new Set();
  notes.forEach(n => {
    userIds.add(String(n.authorId));
    n.reactions.forEach(r => userIds.add(String(r.userId)));
  });
  const users = await User.find({ _id: { $in: [...userIds] } });
  const nameById = new Map(users.map(u => [String(u._id), u.name]));

  const withNames = notes.map(n => ({
    ...n.toObject(),
    authorName: nameById.get(String(n.authorId)) || 'Unknown',
    reactions: n.reactions.map(r => ({ emoji: r.emoji, userId: r.userId, userName: nameById.get(String(r.userId)) || 'Unknown' })),
  }));
  res.status(200).json(withNames);
});

// POST /boards/:boardId/notes — add a note, attributed to whoever is posting.
router.post('/boards/:boardId/notes', requireAuth, requireBoardAccess, async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required and must be a non-empty string' });
  }

  const note = await Note.create({ boardId: req.board._id, authorId: req.userId, text: text.trim() });
  req.app.get('io').to(`board:${req.board._id}`).emit('notes:changed', { boardId: req.board._id, kind: 'note-created' });
  res.status(201).location(`/notes/${note._id}`).json(note);
});

// POST /notes/:id/reactions — toggle the current user's reaction with this
// emoji on this note: adds it if they haven't reacted with it yet, removes
// it if they have. Any team member can react, not just other people — "by
// other users" just means everyone can weigh in on everyone's notes.
router.post('/notes/:id/reactions', requireAuth, requireNoteAccess, async (req, res) => {
  const { emoji } = req.body;
  if (!REACTION_EMOJIS.includes(emoji)) {
    return res.status(400).json({ error: `emoji must be one of: ${REACTION_EMOJIS.join(' ')}` });
  }

  const note = req.note;
  const existingIndex = note.reactions.findIndex(r => r.emoji === emoji && String(r.userId) === String(req.userId));
  if (existingIndex !== -1) {
    note.reactions.splice(existingIndex, 1);
  } else {
    note.reactions.push({ emoji, userId: req.userId });
  }
  await note.save();

  req.app.get('io').to(`board:${note.boardId}`).emit('notes:changed', { boardId: note.boardId, kind: 'reaction-toggled' });
  res.status(200).json(note);
});

// DELETE /notes/:id — only the note's own author can delete it. Being a team
// member is enough to READ every note, but not enough to remove someone
// else's — that's a stricter check than the usual board-membership one, so
// it's done here rather than folded into requireNoteAccess.
router.delete('/notes/:id', requireAuth, requireNoteAccess, async (req, res) => {
  if (String(req.note.authorId) !== String(req.userId)) {
    return res.status(403).json({ error: 'You can only delete your own notes' });
  }

  const boardId = req.note.boardId;
  await req.note.deleteOne();
  req.app.get('io').to(`board:${boardId}`).emit('notes:changed', { boardId, kind: 'note-deleted' });
  res.status(204).send();
});

module.exports = router;
