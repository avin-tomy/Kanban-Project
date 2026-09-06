const Activity = require('../models/Activity');

// Every mutation route that wants to leave an activity trail calls this
// instead of writing `Activity.create` + the socket emit separately — keeps
// the two always in sync, the same reasoning as the board:changed emits.
async function logActivity(app, boardId, actorId, detail) {
  await Activity.create({ boardId, actorId, detail });
  app.get('io').to(`board:${boardId}`).emit('activity:changed', { boardId });
}

module.exports = logActivity;
