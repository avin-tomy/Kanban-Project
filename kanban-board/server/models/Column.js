const mongoose = require('mongoose');

const columnSchema = new mongoose.Schema({
  boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
  name: { type: String, required: true },
  // Explicit ordering field — columns don't have a natural order in the DB,
  // so we track it ourselves rather than relying on insertion/creation order.
  position: { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Column', columnSchema);
