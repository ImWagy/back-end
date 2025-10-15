const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(express.json());

const JWT_SECRET = 'superhemmelig_nøgle'; // Skift til en rigtig hemmelig i produktion

// Simpel in-memory "database" til brugere og beskeder (skift til rigtig DB i produktion)
const users = [];
const messages = [];

// Hjælpefunktion: find bruger
function findUser(username) {
  return users.find(u => u.username === username);
}

// REGISTER
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Manglende brugernavn eller password');

  if (findUser(username)) return res.status(400).send('Brugernavn allerede i brug');

  const hashedPassword = await bcrypt.hash(password, 10);
  users.push({ username, password: hashedPassword });
  res.status(201).send('Bruger oprettet');
});

// LOGIN
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Manglende brugernavn eller password');

  const user = findUser(username);
  if (!user) return res.status(401).send('Forkert brugernavn eller password');

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).send('Forkert brugernavn eller password');

  // Lav JWT token
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });

  res.json({ token });
});

// Middleware til at validere JWT token fra Socket.io auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Ikke autoriseret'));

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Ugyldigt token'));
    socket.username = decoded.username;
    next();
  });
});

// Socket.io events
io.on('connection', (socket) => {
  console.log(`Bruger forbundet: ${socket.username} (${socket.id})`);

  // Send aktuel online brugerantal til alle
  io.emit('userCount', io.engine.clientsCount);

  // Send eksisterende beskeder til ny bruger
  socket.emit('chatHistory', messages);

  // Når bruger sender besked
  socket.on('chatMessage', (data) => {
    const message = {
      username: socket.username,
      message: data.message,
      timestamp: Date.now(),
    };
    messages.push(message);
    io.emit('chatMessage', message);
  });

  // Når bruger skriver
  socket.on('typing', () => {
    socket.broadcast.emit('userTyping', socket.username);
  });

  // Når bruger disconnecter
  socket.on('disconnect', () => {
    console.log(`Bruger afbrudt: ${socket.username}`);
    io.emit('userCount', io.engine.clientsCount);
  });
});

// REST endpoint til at hente alle beskeder (brug ved side-load)
app.get('/messages', (req, res) => {
  res.json(messages);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server kører på port ${PORT}`);
});
