require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const { requireAuth } = require('./middleware/auth');
const TeamMember = require('./models/TeamMember');
const Board = require('./models/Board');

const authRouter = require('./routes/auth');
const teamsRouter = require('./routes/teams');
const boardsRouter = require('./routes/boards');
const columnsRouter = require('./routes/columns');
const cardsRouter = require('./routes/cards');

const app = express();
const corsOptions = { origin: process.env.CLIENT_ORIGIN || '*' };
app.use(cors(corsOptions));
app.use(express.json());

app.use('/auth', authRouter);
app.use('/teams', requireAuth, teamsRouter);
app.use('/', requireAuth, boardsRouter);
app.use('/', requireAuth, columnsRouter);
app.use('/', requireAuth, cardsRouter);

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: corsOptions });
app.set('io', io);

// Socket connections authenticate the same way REST requests do — a valid
// JWT, verified with the same secret — just carried in the handshake instead
// of an Authorization header.
io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
    socket.userId = payload.sub;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
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
    }
  });
  socket.on('leave:board', (boardId) => socket.leave(`board:${boardId}`));
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
