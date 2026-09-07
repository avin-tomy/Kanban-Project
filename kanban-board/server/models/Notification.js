const mongoose = require('mongoose');

// `message` is a fully-rendered human-readable line, built once at write
// time — same reasoning as Activity.detail. teamId/boardId are carried
// along purely so the client can jump straight to the right place when a
// notification is clicked, not for any access check (the recipient's own
// membership is what actually gates what they can open).
const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['card_assigned', 'team_invited', 'invite_accepted', 'invite_declined', 'ownership_transferred', 'role_changed', 'removed_from_team'],
    required: true,
  },
  message: { type: String, required: true },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', default: null },
  read: { type: Boolean, default: false },
}, { timestamps: true });

// The one query pattern this is ever read by: a user's own notifications, newest first.
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
