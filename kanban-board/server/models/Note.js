const mongoose = require('mongoose');

// No own _id needed — reactions are only ever addressed by (emoji, userId)
// as a pair, never individually.
const reactionSchema = new mongoose.Schema({
  emoji: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });

const noteSchema = new mongoose.Schema({
  boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  reactions: { type: [reactionSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('Note', noteSchema);
