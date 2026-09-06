const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
  columnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Column', required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  position: { type: Number, required: true },
  assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedAt: { type: Date, default: null },
  dueDate: { type: Date, default: null },
  status: { type: String, enum: ['not_started', 'working', 'completed'], default: 'not_started' },
}, { timestamps: true });

module.exports = mongoose.model('Card', cardSchema);
