const mongoose = require('mongoose');

// `detail` is a fully-rendered human-readable line (e.g. `assigned "Fix
// login bug" to Bob`), built once at write time from whatever names were
// current then — same reasoning as Note not re-deriving anything on read.
// Only the actor's own name is resolved at read time (like Note.authorName),
// since that's the one thing that should always reflect the account, not a
// snapshot.
const activitySchema = new mongoose.Schema({
  boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  detail: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Activity', activitySchema);
