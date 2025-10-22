const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "https://hustruhurlumhej.dk",
  "http://hustruhurlumhej.dk",
  "https://back-end-production-52e4.up.railway.app",
  "https://back-end-production-52e4.up.railway.app/"
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = "DIT_HEMMELIGE_SECRET"; // Change this to something secure

// ------------------ Middleware ------------------
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error("CORS policy violation"), false);
    }
    return callback(null, true);
  },
  methods: ["GET", "POST"]
}));
app.use(express.json());

// ------------------ MySQL Connection ------------------
const db = mysql.createPool({
  host: "mysql20.unoeuro.com",
  user: "hustruhurlumhej_dk",
  password: "gc6af9BwEmDGd24xkRer",
  database: "hustruhurlumhej_dk_db"
});

// ------------------ ENDPOINTS ------------------

// Register
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Missing username or password");

  const hashed = await bcrypt.hash(password, 10);

  try {
    await db.query("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hashed]);
    res.status(201).send("User created");
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).send("Username already exists");
    console.error(e);
    res.status(500).send("Database error");
  }
});

// Login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  // Get the user's public IP address from headers (X-Forwarded-For for real IP)
  const userIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;

  const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
  if (rows.length === 0) return res.status(401).send("Invalid credentials");

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).send("Invalid credentials");

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "12h" });

  // Store the IP address in the database
  try {
    await db.query("UPDATE users SET last_ip = ? WHERE id = ?", [userIp, user.id]);
  } catch (err) {
    console.error("Error updating IP address:", err);
  }

  res.json({ token, username: user.username, ip: userIp }); // Send the IP along with the token
});

// Hent tidligere beskeder
app.get("/messages", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT username, message, created_at FROM messages ORDER BY id ASC LIMIT 100");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Fejl ved hentning af beskeder");
  }
});

// ------------------ SOCKET.IO ------------------
let onlineUsers = {};

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    next();
  } catch (e) {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  const username = socket.user.username;
  onlineUsers[socket.id] = username;

  // Opdater antal online brugere
  io.emit("userCount", Object.keys(onlineUsers).length);

  console.log(`${username} forbundet`);

  // Modtag besked
  socket.on("chatMessage", async (data) => {
    const msg = data.message.trim();
    if (!msg) return;

    // Gem i databasen
    try {
      await db.query("INSERT INTO messages (username, message) VALUES (?, ?)", [username, msg]);
    } catch (err) {
      console.error("Fejl ved gemning af besked:", err);
    }

    // Send ud til alle
    io.emit("chatMessage", { username, message: msg });
  });

  // Typing event
  socket.on("typing", () => {
    socket.broadcast.emit("userTyping", username);
  });

  // Disconnect
  socket.on("disconnect", () => {
    delete onlineUsers[socket.id];
    io.emit("userCount", Object.keys(onlineUsers).length);
    console.log(`${username} afbrød forbindelsen`);
  });
});

// ------------------ START SERVER ------------------
server.listen(PORT, () => console.log(`Server kører på port ${PORT}`));
