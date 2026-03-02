// server.js
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const { ExpressPeerServer } = require("peer");
const socketIo = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, ngrok-skip-browser-warning");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());

// ── File upload storage ───────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, Date.now() + "_" + Buffer.from(file.originalname, "latin1").toString("utf8")),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

app.use("/uploads", express.static(uploadDir));

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({
    url: "/uploads/" + req.file.filename,
    name: req.file.originalname,
    size: req.file.size,
    type: req.file.mimetype,
  });
});

// ── PeerJS ────────────────────────────────────────────────────────────────────
const peerServer = ExpressPeerServer(server, { debug: true, proxied: true });
app.use("/peerjs", peerServer);
peerServer.on("connection", (c) => console.log("PeerJS connected:", c.getId()));
peerServer.on("disconnect", (c) => console.log("PeerJS disconnected:", c.getId()));

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join", (room) => { socket.join(room); console.log("Joined:", room); });

  // ── Session control ────────────────────────────────────────────────────────
  socket.on("remotedisconnected", ({ remoteId }) => io.to("User" + remoteId).emit("remotedisconnected"));
  socket.on("callrejected",       ({ remoteId }) => io.to("User" + remoteId).emit("callrejected"));

  // ── Remote control ─────────────────────────────────────────────────────────
  socket.on("mousemove",       ({ remoteId, event }) => io.to("User" + remoteId).emit("mousemove",       event));
  socket.on("mousedown",       ({ remoteId, event }) => io.to("User" + remoteId).emit("mousedown",       event));
  socket.on("mouseup",         ({ remoteId, event }) => io.to("User" + remoteId).emit("mouseup",         event));
  socket.on("dblclick",        ({ remoteId, event }) => io.to("User" + remoteId).emit("dblclick",        event));
  socket.on("scroll",          ({ remoteId, event }) => io.to("User" + remoteId).emit("scroll",          event));
  socket.on("keydown",         ({ remoteId, event }) => io.to("User" + remoteId).emit("keydown",         event));
  socket.on("keyup",           ({ remoteId, event }) => io.to("User" + remoteId).emit("keyup",           event));
  socket.on("stream-resolution",({ remoteId, event }) => io.to("User" + remoteId).emit("stream-resolution", event));
  socket.on("requestcontrol",  ({ userId, remoteId }) => io.to("User" + remoteId).emit("controlrequested", { from: userId }));
  socket.on("releasecontrol",  ({ userId, remoteId }) => io.to("User" + remoteId).emit("controlreleased",  { from: userId }));

  // ── Chat ───────────────────────────────────────────────────────────────────
  socket.on("chat-message", ({ remoteId, msg }) => {
    io.to("User" + remoteId).emit("chat-message", msg);
  });

  // ── Clipboard sync ─────────────────────────────────────────────────────────
  // One side copies text → emits "clipboard-sync" → server relays to other side.
  // Uses the same room pattern as all other events: "User" + remoteId.
  socket.on("clipboard-sync", ({ remoteId, text }) => {
    if (!remoteId || !text) return;
    io.to("User" + remoteId).emit("clipboard-sync", { text });
  });

  // ── Annotation canvas ──────────────────────────────────────────────────────
  // Viewer draws on canvas → emits PNG dataUrl → server relays to host.
  // dataUrl can be large (~50-200KB per frame) — only sent on pointer-up,
  // not continuously, so bandwidth is acceptable.
  socket.on("annotation-frame", ({ remoteId, userId, dataUrl }) => {
    if (!remoteId || !dataUrl) return;
    io.to("User" + remoteId).emit("annotation-frame", { userId, dataUrl });
  });

  socket.on("annotation-clear", ({ remoteId, userId }) => {
    if (!remoteId) return;
    io.to("User" + remoteId).emit("annotation-clear", { userId });
  });

  socket.on("disconnect", () => console.log("Socket disconnected:", socket.id));
});

server.listen(5000, "0.0.0.0", () => {
  console.log("✅ Server on port 5000");
  console.log("   Run: ngrok http 5000");
});