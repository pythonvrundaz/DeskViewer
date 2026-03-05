// server.js  — DeskViewer signalling + relay server
// Run with:  node server.js
// Requires:  npm install express socket.io peer multer cors
//
// HOW DISCONNECT NOTIFICATION WORKS:
//   1. Client A closes EXE or clicks Disconnect
//   2. Client A's socket emits:  remotedisconnected  { remoteId: "1234567890" }
//   3. THIS SERVER receives it and does:
//        io.to("User1234567890").emit("remotedisconnected")
//   4. Client B (whose uid is 1234567890) receives it → goes to home screen
//
// Each client joins a room named "User<their-uid>" on connect (via the "join" event).
// This is the lookup key used for all point-to-point relays.

"use strict";

const express   = require("express");
const http      = require("http");
const { Server} = require("socket.io");
const { PeerServer } = require("peer");
const multer    = require("multer");
const path      = require("path");
const fs        = require("fs");
const cors      = require("cors");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT      = process.env.PORT      || 5000;
const PEER_PORT = process.env.PEER_PORT || 9000;
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Express + Socket.IO ───────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 20 * 1024 * 1024,   // 20 MB for file messages
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

// ── File upload ───────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename:    (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({
    url:  `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    type: req.file.mimetype,
  });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
// roomMap: uid → socket.id  (for debugging / logging)
const roomMap = new Map();

io.on("connection", (socket) => {
  let myUid = null;   // set when client emits "join"

  console.log(`[socket] connected  ${socket.id}`);

  // ── JOIN — client registers their uid as a room ───────────────────────────
  // Client emits: join("User1234567890")
  socket.on("join", (roomName) => {
    socket.join(roomName);
    myUid = roomName.replace(/^User/, "");
    roomMap.set(myUid, socket.id);
    console.log(`[socket] ${socket.id} joined room ${roomName}  uid=${myUid}`);
  });

  // ── RELAY HELPER — emit an event to the room of a specific uid ────────────
  const relay = (event, targetUid, payload) => {
    const room = `User${targetUid}`;
    const count = io.sockets.adapter.rooms.get(room)?.size ?? 0;
    if (count === 0) {
      console.warn(`[relay] ${event} → room ${room} has NO listeners (peer offline?)`);
      return false;
    }
    io.to(room).emit(event, payload);
    console.log(`[relay] ${event} → ${room} (${count} socket(s))`);
    return true;
  };

  // ── REMOTE DISCONNECTED ───────────────────────────────────────────────────
  // CRITICAL: This is the event that tells the other side to go back to home.
  // Fired when:
  //   • Either side clicks Disconnect button
  //   • Either side closes the EXE via the ✕ button
  //   • Viewer cancels while waiting
  // Payload: { remoteId: "uid-of-the-other-person" }
  socket.on("remotedisconnected", ({ remoteId } = {}) => {
    if (!remoteId) {
      console.warn(`[socket] remotedisconnected from ${socket.id} — missing remoteId`);
      return;
    }
    console.log(`[socket] remotedisconnected: uid=${myUid} notifying uid=${remoteId}`);
    relay("remotedisconnected", remoteId, {});
  });

  // ── CALL REJECTED ─────────────────────────────────────────────────────────
  // Host rejected the call, or host cancelled source picker
  // Payload: { remoteId: "uid-of-the-viewer" }
  socket.on("callrejected", ({ remoteId } = {}) => {
    if (!remoteId) return;
    console.log(`[socket] callrejected: host=${myUid} → viewer=${remoteId}`);
    relay("callrejected", remoteId, {});
  });

  // ── MOUSE / KEYBOARD relay (viewer → host) ────────────────────────────────
  const controlEvents = ["mousemove","mousedown","mouseup","dblclick","scroll","keydown","keyup","stream-resolution"];
  controlEvents.forEach(event => {
    socket.on(event, (data) => {
      if (!data?.remoteId) return;
      relay(event, data.remoteId, data);
    });
  });

  // ── CHAT relay (bidirectional) ─────────────────────────────────────────────
  socket.on("chat-message", ({ remoteId, msg } = {}) => {
    if (!remoteId || !msg) return;
    relay("chat-message", remoteId, msg);
  });

  // ── ANNOTATION relay ──────────────────────────────────────────────────────
  socket.on("annotation-frame", ({ remoteId, ...rest } = {}) => {
    if (!remoteId) return;
    relay("annotation-frame", remoteId, { remoteId, ...rest });
  });

  // ── CLIPBOARD sync relay ──────────────────────────────────────────────────
  socket.on("clipboard-sync", ({ remoteId, text } = {}) => {
    if (!remoteId) return;
    relay("clipboard-sync", remoteId, { text });
  });

  // ── HANDLE UNEXPECTED DISCONNECT (tab crash, network drop, process kill) ──
  // If a client's socket drops without sending remotedisconnected,
  // we infer their session partner from roomMap and notify them.
  // NOTE: We don't track session pairs server-side here, so this is best-effort.
  // The PeerJS connection closing will also trigger call.on("close") on the other side.
  socket.on("disconnect", (reason) => {
    console.log(`[socket] disconnected  ${socket.id}  uid=${myUid}  reason=${reason}`);
    if (myUid) roomMap.delete(myUid);
  });
});

// ── PeerJS server (WebRTC signalling) ─────────────────────────────────────────
const peerServer = PeerServer({
  port:   PEER_PORT,
  path:   "/peerjs",
  allow_discovery: true,
});

peerServer.on("connection",    (client) => console.log(`[peer] connected    ${client.getId()}`));
peerServer.on("disconnect",    (client) => console.log(`[peer] disconnected ${client.getId()}`));

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n✅ DeskViewer server running`);
  console.log(`   Socket.IO : http://localhost:${PORT}`);
  console.log(`   PeerJS    : http://localhost:${PEER_PORT}/peerjs`);
  console.log(`   Uploads   : ${UPLOAD_DIR}\n`);
});