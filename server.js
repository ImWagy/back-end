const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://hustruhurlumhej.dk", 
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;


let onlineUsers = 0;

io.on("connection", (socket) => {
  console.log("Ny forbindelse:", socket.id);

 
  socket.on("newUser", (username) => {
    socket.username = username;
    onlineUsers++;
    io.emit("userCount", onlineUsers);
    console.log(`${username} er nu online. Brugere online: ${onlineUsers}`);
  });


  socket.on("chatMessage", (data) => {
    console.log(`Besked fra ${data.username}: ${data.message}`);
   
    socket.broadcast.emit("chatMessage", data);
  });


  socket.on("disconnect", () => {
    if(socket.username) {
      onlineUsers--;
      io.emit("userCount", onlineUsers);
      console.log(`${socket.username} har forladt chatten. Brugere online: ${onlineUsers}`);
    }
  });
});


server.listen(PORT, () => {
  console.log(`Server kører på port ${PORT}`);
});
