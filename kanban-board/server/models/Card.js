const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
  columnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Column', required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  position: { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Card', cardSchema);
