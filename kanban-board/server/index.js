require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const { requireAuth } = require('./middleware/auth');
const TeamMember = require('./models/TeamMember');
const Board = require('./models/Board');
const User = require('./models/User');

const authRouter = require('./routes/auth');
const teamsRouter = require('./routes/teams');
const boardsRouter = require('./routes/boards');
const columnsRouter = require('./routes/columns');
const cardsRouter = require('./routes/cards');
const notesRouter = require('./routes/notes');
const meRouter = require('./routes/me');

const app = express();
const corsOptions = { origin: process.env.CLIENT_ORIGIN || '*' };
app.use(cors(corsOptions));
app.use(express.json());

app.use('/auth', authRouter);
app.use('/teams', requireAuth, teamsRouter);
app.use('/me', requireAuth, meRouter);
// boards/columns/cards apply requireAuth per-route (inside each router) rather
// than here, because they're mounted at '/' alongside static file serving and
// the SPA fallback below — a blanket middleware at this mount point would run
// for every request in the app, not just the ones these routers actually handle.
app.use('/', boardsRouter);
app.use('/', columnsRouter);
app.use('/', cardsRouter);
app.use('/', notesRouter);

// In production, this same service also serves the built React app, so the
// client and API share one origin/deployment (no separate static host, no
// cross-origin requests). client/dist only exists after `vite build` has
// run — locally that's opt-in, so this is skipped entirely if it's missing
// rather than erroring on every unmatched route during normal dev.
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // Anything not matched by an API route or a static file falls through to
  // index.html, so client-side navigation/refresh keeps working.
  app.use((req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: corsOptions });
app.set('io', io);

// Socket connections authenticate the same way REST requests do — a valid
// JWT, verified with the same secret — just carried in the handshake instead
// of an Authorization header. The user is looked up once per connection (not
// per event) so presence broadcasts below have a name to show without an
// extra DB round-trip each time.
io.use(async (socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return next(new Error('unauthorized'));
    socket.userId = user._id.toString();
    socket.userName = user.name;
    socket.userEmail = user.email;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

// boardId -> Map<socketId, {userId, name}> — who currently has each board
// open. Keyed by socket (not userId) so the same person in two tabs is
// tracked correctly (closing one tab shouldn't remove them if the other is
// still open); dedupeByUser collapses that back down to one entry per person
// for display.
const boardPresence = new Map();

function dedupeByUser(entries) {
  const byUserId = new Map();
  for (const entry of entries) byUserId.set(entry.userId, entry);
  return [...byUserId.values()];
}

function broadcastPresence(boardId) {
  const entries = boardPresence.get(boardId);
  const users = entries ? dedupeByUser([...entries.values()]) : [];
  io.to(`board:${boardId}`).emit('board:presence', { boardId, users });
}

io.on('connection', (socket) => {
  // Tracked so disconnect can clean up presence on every board this socket
  // had open, without needing to know the ids up front.
  socket.joinedBoardIds = new Set();

  // A valid JWT only proves who the socket is; joining a room still requires
  // checking that user actually belongs to the team/board being requested —
  // otherwise anyone with an account could eavesdrop on any team's changes.
  socket.on('join:team', async (teamId) => {
    if (await TeamMember.exists({ teamId, userId: socket.userId })) socket.join(`team:${teamId}`);
  });
  socket.on('leave:team', (teamId) => socket.leave(`team:${teamId}`));

  socket.on('join:board', async (boardId) => {
    const board = await Board.findById(boardId);
    if (board && await TeamMember.exists({ teamId: board.teamId, userId: socket.userId })) {
      socket.join(`board:${boardId}`);
      socket.joinedBoardIds.add(boardId);
      if (!boardPresence.has(boardId)) boardPresence.set(boardId, new Map());
      boardPresence.get(boardId).set(socket.id, { userId: socket.userId, name: socket.userName, email: socket.userEmail });
      broadcastPresence(boardId);
    }
  });

  socket.on('leave:board', (boardId) => {
    socket.leave(`board:${boardId}`);
    socket.joinedBoardIds.delete(boardId);
    boardPresence.get(boardId)?.delete(socket.id);
    broadcastPresence(boardId);
  });

  socket.on('disconnect', () => {
    for (const boardId of socket.joinedBoardIds) {
      boardPresence.get(boardId)?.delete(socket.id);
      broadcastPresence(boardId);
    }
  });
});

const PORT = process.env.PORT || 4000;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB Atlas');
    httpServer.listen(PORT, () => console.log(`Kanban API listening on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
