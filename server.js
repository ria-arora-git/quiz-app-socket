const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? [
          "https://quizz-arena.vercel.app", 
          "https://your-frontend-domain.vercel.app"
        ]
      : ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [
        "https://quizz-arena.vercel.app", 
        "https://your-frontend-domain.vercel.app"
      ]
    : ["http://localhost:3000", "http://localhost:3001"],
  credentials: true
}));

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

const quizSessions = new Map();
const roomParticipants = new Map();

io.on('connection', (socket) => {
  console.log(`🟢 Client connected: ${socket.id} from ${socket.handshake.address}`);

  socket.on('join-room', (data) => {
    try {
      const { roomId, userId, userName } = data;
      
      if (!roomId || !userId) {
        socket.emit('error', { message: 'Room ID and User ID are required' });
        return;
      }

      socket.rooms.forEach(room => {
        if (room !== socket.id) {
          socket.leave(room);
        }
      });

      socket.join(roomId);
      
      if (!roomParticipants.has(roomId)) {
        roomParticipants.set(roomId, new Map());
      }
      
      roomParticipants.get(roomId).set(socket.id, {
        userId,
        userName: userName || `User ${userId}`,
        socketId: socket.id,
        joinedAt: new Date()
      });

      const participants = Array.from(roomParticipants.get(roomId).values());
      
      console.log(`📥 ${socket.id} joined room ${roomId}`);
      console.log(`📊 Broadcasting ${participants.length} participants to room ${roomId}`);

      io.to(roomId).emit('participants-update', {
        participants,
        count: participants.length
      });

      socket.emit('room-joined', {
        roomId,
        participantCount: participants.length,
        participants
      });

    } catch (error) {
      console.error('❌ Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  socket.on('start-quiz', (data) => {
    try {
      const { roomId, quizData } = data;
      
      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      quizSessions.set(roomId, {
        ...quizData,
        startedAt: new Date(),
        currentQuestion: 0
      });

      console.log(`🚀 Quiz started in room ${roomId}`);
      
      io.to(roomId).emit('quiz-started', {
        roomId,
        quiz: quizSessions.get(roomId)
      });

    } catch (error) {
      console.error('❌ Error starting quiz:', error);
      socket.emit('error', { message: 'Failed to start quiz' });
    }
  });

  socket.on('submit-answer', (data) => {
    try {
      const { roomId, questionId, answer, userId } = data;
      
      console.log(`📝 Answer submitted in room ${roomId}: ${userId} answered ${answer}`);
      
      socket.to(roomId).emit('answer-received', {
        userId,
        questionId,
        answer,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('❌ Error submitting answer:', error);
      socket.emit('error', { message: 'Failed to submit answer' });
    }
  });

  socket.on('next-question', (data) => {
    try {
      const { roomId, questionIndex } = data;
      
      if (quizSessions.has(roomId)) {
        const session = quizSessions.get(roomId);
        session.currentQuestion = questionIndex;
        quizSessions.set(roomId, session);
      }

      console.log(`➡️ Next question in room ${roomId}: ${questionIndex}`);
      
      io.to(roomId).emit('question-changed', {
        roomId,
        questionIndex,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('❌ Error changing question:', error);
      socket.emit('error', { message: 'Failed to change question' });
    }
  });

  socket.on('end-quiz', (data) => {
    try {
      const { roomId, results } = data;
      
      console.log(`🏁 Quiz ended in room ${roomId}`);
      
      io.to(roomId).emit('quiz-ended', {
        roomId,
        results,
        endedAt: new Date()
      });

      quizSessions.delete(roomId);

    } catch (error) {
      console.error('❌ Error ending quiz:', error);
      socket.emit('error', { message: 'Failed to end quiz' });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔴 Client disconnected: ${socket.id}, reason: ${reason}`);
    
    roomParticipants.forEach((participants, roomId) => {
      if (participants.has(socket.id)) {
        participants.delete(socket.id);
        
        const updatedParticipants = Array.from(participants.values());
        io.to(roomId).emit('participants-update', {
          participants: updatedParticipants,
          count: updatedParticipants.length
        });
        
        console.log(`📊 Broadcasting ${updatedParticipants.length} participants to room ${roomId}`);
        
        if (participants.size === 0) {
          roomParticipants.delete(roomId);
          quizSessions.delete(roomId);
        }
      }
    });
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Quiz Socket.IO server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
