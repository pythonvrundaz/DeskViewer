// // server.js
// const express = require("express");
// const app = express();
// const socketIo = require("socket.io");
// const server = require("http").createServer(app);

// // --------- UNCOMMENT THIS IF YOU WANT TO USE A PEER SERVER ------------
// const ExpressPeerServer = require("peer").ExpressPeerServer;
// app.use("/peerjs",ExpressPeerServer(server, {debug: true}) );

// const io = socketIo(server, {
//   cors: {
//     origin: "*",
//   },
// });

// io.on("connection", function (socket) {
//   socket.on("join", function (data) {
//     console.log("User joined " + data);
//     // Create a room for client
//     socket.join(data);
//   });

//   socket.on("remotedisconnected", ({ remoteId }) => {
//     io.to("User" + remoteId).emit("remotedisconnected");
//   });

//   // ------ HANDLE MOUSE AND KEY EVENTS --------
//   socket.on("mousemove", ({ userId, remoteId, event }) => {
//     io.to("User" + remoteId).emit("mousemove", event);
//   });

//   socket.on("mousedown", ({ userId, remoteId, event }) => {
//     io.to("User" + remoteId).emit("mousedown", event);
//   });

//   socket.on("scroll", ({ userId, remoteId, event }) => {
//     io.to("User" + remoteId).emit("scroll", event);
//   });

//   socket.on("keydown", ({ userId, remoteId, event }) => {
//     io.to("User" + remoteId).emit("keydown", event);
//   });

//   // socket.on("event", ({ userId, remoteId, event }) => {
//   //   // Detect when user presses keys on his computer and tell the changes to other user
//   //   console.log(`Event sent by ${userId} to ${remoteId}`);

//   //   io.to("User"+remoteId).emit("action", event);
//   //   //socket.broadcast.emit("action", event);
//   // });
// });

// // server.listen(5000, '0.0.0.0', () => {
  
// server.listen(5000, () => {
//   console.log("Server started");
// });

// ---------------------------------------------------------------------------------------------------------------------------------

// server.js
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const { ExpressPeerServer } = require("peer");
const socketIo = require("socket.io");

app.set("trust proxy", 1);

const peerServer = ExpressPeerServer(server, { debug: true, proxied: true });
app.use("/peerjs", peerServer);

peerServer.on("connection", (c) => console.log("PeerJS connected:", c.getId()));
peerServer.on("disconnect", (c) => console.log("PeerJS disconnected:", c.getId()));

const io = socketIo(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join",               (room)               => { console.log("Joined:", room); socket.join(room); });
  socket.on("remotedisconnected", ({ remoteId })        => io.to("User" + remoteId).emit("remotedisconnected"));
  socket.on("callrejected",       ({ remoteId })        => io.to("User" + remoteId).emit("callrejected"));

  // Mouse events
  socket.on("mousemove", ({ remoteId, event }) => io.to("User" + remoteId).emit("mousemove", event));
  socket.on("mousedown", ({ remoteId, event }) => io.to("User" + remoteId).emit("mousedown", event));
  socket.on("mouseup",   ({ remoteId, event }) => io.to("User" + remoteId).emit("mouseup",   event));
  socket.on("click",     ({ remoteId, event }) => io.to("User" + remoteId).emit("click",     event));
  socket.on("dblclick",  ({ remoteId, event }) => io.to("User" + remoteId).emit("dblclick",  event));
  socket.on("scroll",    ({ remoteId, event }) => io.to("User" + remoteId).emit("scroll",    event));

  // Keyboard events
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