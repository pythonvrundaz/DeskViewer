// src/config.js
// ─────────────────────────────────────────────────────────────
// NGROK SETUP: Replace the URL below with your ngrok URL
// Run: ngrok http 5000
// You'll get something like: https://abc123.ngrok-free.app
// Paste that URL below (no trailing slash)
// ─────────────────────────────────────────────────────────────

const NGROK_URL = "https://laevorotatory-painstakingly-lorraine.ngrok-free.dev";

const CONFIG = {
  SOCKET_URL:  NGROK_URL,
  PEER_HOST:   NGROK_URL.replace("https://", "").replace("http://", ""),
  PEER_PORT:   443,          // ngrok uses 443 (HTTPS)
  PEER_PATH:   "/peerjs",
  PEER_SECURE: true,         // must be true for HTTPS (ngrok)
};

export default CONFIG;