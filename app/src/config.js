// config.js — DeskViewer client configuration
//
// ── LOCAL DEVELOPMENT ─────────────────────────────────────────────────────────
// Run server on port 5000, PeerJS embedded under /peerjs on same port.
//   node server.js
//
// ── NGROK / PRODUCTION ────────────────────────────────────────────────────────
// Replace SERVER_URL with your ngrok URL (no trailing slash):
//   const SERVER_URL = "https://xxxx-xx-xx.ngrok-free.app";
// PeerJS path stays "/peerjs", secure: true, port: 443.

const IS_DEV = !process.env.NODE_ENV || process.env.NODE_ENV === "development";

// ── Change this one line to switch between local and ngrok ────────────────────
const SERVER_URL = IS_DEV
  ? "http://localhost:5000"
  : "https://laevorotatory-painstakingly-lorraine.ngrok-free.dev";   // ← replace when deploying

// Parse host and determine if secure
const url      = new URL(SERVER_URL);
const IS_HTTPS = url.protocol === "https:";

const CONFIG = {
  // Socket.IO
  SOCKET_URL: SERVER_URL,

  // PeerJS — must point to the SAME server (embedded under /peerjs)
  // In production (https), port must be 443 and secure must be true
  PEER_HOST:   url.hostname,
  PEER_PORT:   IS_HTTPS ? 443 : parseInt(url.port || "5000", 10),
  PEER_PATH:   "/peerjs",
  PEER_SECURE: IS_HTTPS,
};

export default CONFIG;