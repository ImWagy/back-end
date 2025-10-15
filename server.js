const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const allowedOrigins = ["https://hustruhurlumhej.dk", "http://hustruhurlumhej.dk"];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = "DIT_HEMMELIGE_SECRET"; // Skift til noget sikkert

// Middleware
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

// ------------------ MySQL connection ------------------
const db = mysql.createPool({
  host: "mysql20.unoeuro.com",
  user: "hustruhurlumhej_dk",
  password: "gc6af9BwEmDGd24xkRer",
  database: "hustruhurlumhej_dk_db"
});

// ------------------ REST ENDPOINTS ------------------

// Register
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Missing username or password");

  const hashed = await bcrypt.hash(password, 10);

  try {
    await db.query(
      // ADDED avatar_url default NULL
      "INSERT INTO users (username, password_hash, avatar_url) VALUES (?, ?, NULL)",
      [username, hashed]
    );
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
  const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]);

  if (rows.length === 0) return res.status(401).send("Invalid credentials");

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).send("Invalid credentials");

  // ADDED: send avatar_url in JWT payload and response
  const token = jwt.sign(
    { id: user.id, username: user.username, avatar_url: user.avatar_url },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
  res.json({ token, username: user.username, avatar_url: user.avatar_url });
});

// ------------------ SOCKET.IO ------------------
let onlineUsers = {};

// Simple in-memory cache for username -> avatar_url to reduce DB calls
const avatarCache = {};

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
  io.emit("userCount", Object.keys(onlineUsers).length);

  // Cache avatar_url for this user
  avatarCache[username] = socket.user.avatar_url || null;

  // --- Typing status ---
  socket.on("typing", () => {
    socket.broadcast.emit("userTyping", username);
  });

  socket.on("chatMessage", async (data) => {
    try {
      // Gem besked i DB
      await db.query("INSERT INTO messages (username, message) VALUES (?, ?)", [username, data.message]);

      // Find avatar_url fra cache eller DB fallback
      let avatar_url = avatarCache[username];
      if (avatar_url === undefined) {
        // Hent fra DB hvis ikke i cache
        const [rows] = await db.query("SELECT avatar_url FROM users WHERE username = ?", [username]);
        avatar_url = rows.length > 0 ? rows[0].avatar_url : null;
        avatarCache[username] = avatar_url;
      }

      io.emit("chatMessage", { username, message: data.message, avatar_url });
    } catch (err) {
      console.error("Fejl ved indsættelse af besked:", err);
    }
  });

  socket.on("disconnect", () => {
    delete onlineUsers[socket.id];
    io.emit("userCount", Object.keys(onlineUsers).length);
  });
});

// ------------------ START SERVER ------------------
server.listen(PORT, () => console.log(`Server kører på port ${PORT}`));

//------------------- ENDPOINT --------------------
app.get("/messages", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM messages ORDER BY timestamp ASC LIMIT 100");
    res.json(rows);
  } catch (err) {
    console.error("Fejl ved hentning af beskeder:", err);
    res.status(500).send("Database error");
  }
});
