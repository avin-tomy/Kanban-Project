const Notification = require('../models/Notification');
const User = require('../models/User');

// Every mutation route that should alert someone calls this instead of
// writing Notification.create + the socket emit separately — same reasoning
// as logActivity. Every connected socket auto-joins its own `user:<id>`
// room on connect (see index.js), so no client-side join is needed here.
async function notify(app, { userId, actorId, type, message, teamId = null, boardId = null }) {
  if (String(userId) === String(actorId)) return; // never notify yourself
  const notification = await Notification.create({ userId, actorId, type, message, teamId, boardId });

  // GET /notifications joins actorName in at read time (see routes/notifications.js);
  // a live socket delivery has no such follow-up read, so it has to be
  // resolved and included here instead, or the name renders blank until
  // the next full refetch.
  const actor = await User.findById(actorId);
  const payload = { ...notification.toObject(), actorName: actor ? actor.name : 'Unknown' };
  app.get('io').to(`user:${userId}`).emit('notification:new', payload);
  return notification;
}

// Withdraws a notification that's no longer valid — right now that's just a
// canceled team invite, before the recipient has acted on it. Deletes the
// notification itself (rather than leaving it to error out if clicked) and
// tells their live session to drop it from the bell too.
async function unnotify(app, { userId, type, teamId }) {
  const notification = await Notification.findOneAndDelete({ userId, type, teamId });
  if (notification) {
    app.get('io').to(`user:${userId}`).emit('notification:removed', { _id: notification._id });
  }
}

module.exports = notify;
module.exports.unnotify = unnotify;
