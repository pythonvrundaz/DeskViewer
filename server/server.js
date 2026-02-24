// server.js
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const { ExpressPeerServer } = require("peer");
const socketIo = require("socket.io");

app.set("trust proxy", 1);

// Required: ngrok blocks requests without the ngrok-skip-browser-warning header
// This middleware adds it to all responses
app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

const peerServer = ExpressPeerServer(server, { debug: true, proxied: true });
app.use("/peerjs", peerServer);

peerServer.on("connection", (c) => console.log("PeerJS connected:", c.getId()));
peerServer.on("disconnect", (c) => console.log("PeerJS disconnected:", c.getId()));

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Allow both — ngrok sometimes downgrades websocket to polling
  transports: ["websocket", "polling"],
  allowEIO3: true,  // backwards compatibility
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join",               (room)               => { console.log("Joined:", room); socket.join(room); });
  socket.on("remotedisconnected", ({ remoteId })        => io.to("User" + remoteId).emit("remotedisconnected"));
  socket.on("callrejected",       ({ remoteId })        => io.to("User" + remoteId).emit("callrejected"));

  socket.on("mousemove", ({ remoteId, event }) => io.to("User" + remoteId).emit("mousemove", event));
  socket.on("mousedown", ({ remoteId, event }) => io.to("User" + remoteId).emit("mousedown", event));
  socket.on("mouseup",   ({ remoteId, event }) => io.to("User" + remoteId).emit("mouseup",   event));
  socket.on("click",     ({ remoteId, event }) => io.to("User" + remoteId).emit("click",     event));
  socket.on("dblclick",  ({ remoteId, event }) => io.to("User" + remoteId).emit("dblclick",  event));
  socket.on("scroll",    ({ remoteId, event }) => io.to("User" + remoteId).emit("scroll",    event));
  socket.on("keydown",   ({ remoteId, event }) => io.to("User" + remoteId).emit("keydown",   event));
  socket.on("keyup",     ({ remoteId, event }) => io.to("User" + remoteId).emit("keyup",     event));

  socket.on("requestcontrol", ({ userId, remoteId }) => io.to("User" + remoteId).emit("controlrequested", { from: userId }));
  socket.on("releasecontrol", ({ userId, remoteId }) => io.to("User" + remoteId).emit("controlreleased",  { from: userId }));

  socket.on("disconnect", () => console.log("Socket disconnected:", socket.id));
});

server.listen(5000, "0.0.0.0", () => {
  console.log("✅ Server on port 5000");
  console.log("   Run: ngrok http 5000");
});