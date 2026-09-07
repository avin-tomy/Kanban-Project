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

module.exports = notify;
