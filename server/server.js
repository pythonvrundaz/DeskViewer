// server.js  — DeskViewer signalling + relay server
// Everything runs on ONE port (default 5000):
//   Socket.IO  → ws://host:5000          (signalling + relay)
//   PeerJS     → http://host:5000/peerjs (WebRTC signalling)
//   File upload→ http://host:5000/upload
//
// Run:    node server.js
// Deps:   npm install express socket.io peer multer cors

"use strict";

const express      = require("express");
const http         = require("http");
const { Server }   = require("socket.io");
const { ExpressPeerServer } = require("peer");   // embedded, same port
const multer       = require("multer");
const path         = require("path");
const fs           = require("fs");
const cors         = require("cors");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 5000;
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Express ───────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

// ── PeerJS — embedded on same http server under /peerjs ──────────────────────
// This is critical: PeerJS MUST share the same port as Socket.IO so that
// ngrok (or any single-port tunnel) exposes both on one URL.
// Client config must be:
//   host: "your-ngrok-domain.ngrok-free.app"  (no port)
//   port: 443
//   path: "/peerjs"
//   secure: true
const peerServer = ExpressPeerServer(server, {
  path:            "/peerjs",
  allow_discovery: false,
  proxied:         true,
});
app.use("/peerjs", peerServer);

peerServer.on("connection",    c => console.log(`[peer] +  ${c.getId()}`));
peerServer.on("disconnect",    c => console.log(`[peer] -  ${c.getId()}`));

// ── File upload ───────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename:    (_, f,  cb) => cb(null, `${Date.now()}-${f.originalname}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 20 * 1024 * 1024,
  // Aggressive ping to detect dead connections fast
  pingTimeout:  10000,
  pingInterval: 5000,
});

// uid → Set of socket.ids (one user may have multiple tabs — we handle all)
const uidToSockets = new Map();

const addSocket = (uid, socketId) => {
  if (!uidToSockets.has(uid)) uidToSockets.set(uid, new Set());
  uidToSockets.get(uid).add(socketId);
};
const removeSocket = (uid, socketId) => {
  uidToSockets.get(uid)?.delete(socketId);
  if (uidToSockets.get(uid)?.size === 0) uidToSockets.delete(uid);
};

// Relay an event to every socket belonging to a uid
const relay = (event, targetUid, payload, senderSocketId) => {
  const room = `User${targetUid}`;
  const roomSockets = io.sockets.adapter.rooms.get(room);
  if (!roomSockets || roomSockets.size === 0) {
    console.warn(`[relay] "${event}" → uid=${targetUid} — NO listeners (offline?)`);
    return false;
  }
  // Don't echo back to sender
  io.to(room).except(senderSocketId).emit(event, payload);
  console.log(`[relay] "${event}" → uid=${targetUid} (${roomSockets.size} socket(s))`);
  return true;
};

io.on("connection", socket => {
  let myUid = null;

  // ── JOIN ─────────────────────────────────────────────────────────────────
  socket.on("join", roomName => {
    socket.join(roomName);
    myUid = roomName.replace(/^User/, "");
    addSocket(myUid, socket.id);
    console.log(`[socket] join  uid=${myUid}  socketId=${socket.id}`);
  });

  // ── REMOTE DISCONNECTED ───────────────────────────────────────────────────
  // This is the critical event. Fired by either side when:
  //   • Disconnect button clicked
  //   • EXE ✕ close button (via electron.js "app-will-close" → onWillClose)
  //   • Viewer cancels while waiting
  socket.on("remotedisconnected", ({ remoteId } = {}) => {
    if (!remoteId) {
      console.warn(`[socket] remotedisconnected — missing remoteId (uid=${myUid})`);
      return;
    }
    console.log(`[socket] remotedisconnected  from=${myUid} → to=${remoteId}`);
    relay("remotedisconnected", remoteId, {}, socket.id);
  });

  // ── CALL REJECTED ─────────────────────────────────────────────────────────
  socket.on("callrejected", ({ remoteId } = {}) => {
    if (!remoteId) return;
    console.log(`[socket] callrejected  from=${myUid} → to=${remoteId}`);
    relay("callrejected", remoteId, {}, socket.id);
  });

  // ── CONTROL EVENTS (viewer → host) ────────────────────────────────────────
  ["mousemove","mousedown","mouseup","dblclick","scroll","keydown","keyup","stream-resolution"].forEach(ev => {
    socket.on(ev, data => {
      if (!data?.remoteId) return;
      relay(ev, data.remoteId, data, socket.id);
    });
  });

  // ── CHAT ──────────────────────────────────────────────────────────────────
  socket.on("chat-message", ({ remoteId, msg } = {}) => {
    if (!remoteId || !msg) return;
    relay("chat-message", remoteId, msg, socket.id);
  });

  // ── ANNOTATIONS ───────────────────────────────────────────────────────────
  socket.on("annotation-frame", ({ remoteId, ...rest } = {}) => {
    if (!remoteId) return;
    relay("annotation-frame", remoteId, { remoteId, ...rest }, socket.id);
  });

  // ── CLIPBOARD ─────────────────────────────────────────────────────────────
  socket.on("clipboard-sync", ({ remoteId, text } = {}) => {
    if (!remoteId) return;
    relay("clipboard-sync", remoteId, { text }, socket.id);
  });

  // ── SOCKET DISCONNECT (network drop / app crash / tab close) ──────────────
  // When a socket disconnects unexpectedly (without sending "remotedisconnected"),
  // we broadcast remotedisconnected to the remote peer IF we know their uid.
  // We look it up from a session pair registry that we maintain here.
  socket.on("disconnect", reason => {
    console.log(`[socket] disconnect  uid=${myUid}  reason=${reason}`);
    if (myUid) {
      removeSocket(myUid, socket.id);
      // If this peer had an active session partner, notify them
      const partnerId = sessionPairs.get(myUid);
      if (partnerId) {
        console.log(`[socket] notifying partner ${partnerId} of unexpected disconnect`);
        relay("remotedisconnected", partnerId, {}, socket.id);
        sessionPairs.delete(myUid);
        sessionPairs.delete(partnerId);
      }
    }
  });

  // ── SESSION PAIR TRACKING ─────────────────────────────────────────────────
  // Track who is in session with whom so we can notify on unexpected disconnect.
  // Client emits "session-pair" when a call is established.
  socket.on("session-pair", ({ myId, remoteId } = {}) => {
    if (!myId || !remoteId) return;
    sessionPairs.set(myId, remoteId);
    sessionPairs.set(remoteId, myId);
    console.log(`[socket] session pair: ${myId} ↔ ${remoteId}`);
  });

  socket.on("session-unpair", ({ myId } = {}) => {
    if (!myId) return;
    const partnerId = sessionPairs.get(myId);
    if (partnerId) sessionPairs.delete(partnerId);
    sessionPairs.delete(myId);
  });
});

// uid → partner uid (for unexpected disconnect notification)
const sessionPairs = new Map();

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n✅ DeskViewer server running on port ${PORT}`);
  console.log(`   Socket.IO : http://localhost:${PORT}`);
  console.log(`   PeerJS    : http://localhost:${PORT}/peerjs`);
  console.log(`   Uploads   : ${UPLOAD_DIR}\n`);
});