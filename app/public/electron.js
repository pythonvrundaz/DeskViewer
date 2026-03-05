// electron.js
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut } = require("electron");

let win;
let controlActive = false; // tracks whether remote control is on (viewer side)
let sessionActive = false;      // tracks whether THIS PC is HOSTING a session


// ── Re-register shortcuts only when window is focused & control is active ─────
function registerShortcuts() {
  try { globalShortcut.unregisterAll(); } catch {}
  if (!controlActive) return;
  [
    ["Alt+Tab",       { keyCode:"Tab", ctrl:false, shift:false, alt:true,  meta:false }],
    ["Alt+Shift+Tab", { keyCode:"Tab", ctrl:false, shift:true,  alt:true,  meta:false }],
    ["Alt+F4",        { keyCode:"F4",  ctrl:false, shift:false, alt:true,  meta:false }],
  ].forEach(([combo, payload]) => {
    try { globalShortcut.register(combo, () => win?.webContents.send("global-keydown", payload)); }
    catch(e) { console.warn("Shortcut skip:", combo, e.message); }
  });
  console.log("🔒 Shortcuts registered");
}

function releaseShortcuts() {
  try { globalShortcut.unregisterAll(); } catch {}
  console.log("🔓 Shortcuts released");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000, height: 700,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadURL("http://localhost:3000");

  // MINIMIZE:
  // Allow the window to minimize freely — both from remote control and from host.
  // BUT: when minimized during an active session, the stream source is gone.
  // Tell the renderer so it can notify the viewer cleanly.
  win.on("minimize", () => {
    releaseShortcuts();
    win.webContents.send("window-minimized");
    if (sessionActive) {
      // Tell renderer: host window minimized while session active
      // Renderer will notify viewer that host minimized DeskViewer
      win.webContents.send("host-window-minimized");
      console.log("🔽 Host window minimized during active session");
    }
  });

  win.on("restore", () => {
    registerShortcuts();
    win.webContents.send("window-restored", { controlActive });
    if (sessionActive) {
      win.webContents.send("host-window-restored");
    }
  });

  win.on("focus", () => {
    registerShortcuts();
    win.webContents.send("window-restored", { controlActive });
  });

  // BLUR: release shortcuts when user clicks into another app (without minimizing)
  // This lets Alt+Tab etc. work normally in other apps
  win.on("blur", () => {
    releaseShortcuts();
  });
}

// Host session state — App.js notifies us when hosting starts/ends
// This lets us block minimize while the host's screen is being streamed
ipcMain.on("session-started", () => { sessionActive = true;  console.log("🟢 Session started — minimize blocked"); });
ipcMain.on("session-ended",   () => { sessionActive = false; console.log("🔴 Session ended — minimize allowed");  });

ipcMain.on("maximize-for-viewing", () => win?.maximize());
ipcMain.on("minimize-to-taskbar",  () => win?.minimize());

ipcMain.handle("MINIMIZE_WIN",    () => win?.hide());
ipcMain.handle("RESTORE_WIN",     () => win?.show());
ipcMain.handle("GET_SCREEN_SIZE", () => {
  const d = screen.getPrimaryDisplay();
  return { width: d.bounds.width, height: d.bounds.height, scaleFactor: d.scaleFactor };
});

ipcMain.handle("GET_SOURCES", async () => {
  try {
    win?.hide();
    await new Promise(r => setTimeout(r, 300));
    const sources = await desktopCapturer.getSources({
      types: ["screen","window"],
      thumbnailSize: { width: 320, height: 180 },
    });
    win?.show();
    return sources
      .filter(s => !s.name.toLowerCase().includes("deskviewer"))
      .map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  } catch(e) { win?.show(); return []; }
});

// ── Global shortcut capture — called by renderer when control toggles ─────────
ipcMain.on("set-global-capture", (_, enabled) => {
  controlActive = enabled;
  if (enabled) {
    registerShortcuts();
  } else {
    releaseShortcuts();
  }
});

app.on("will-quit", () => releaseShortcuts());

// ── nut-js ────────────────────────────────────────────────────────────────────
let mouse, keyboard, Button, Key;
try {
  const nut = require("@nut-tree-fork/nut-js");
  mouse    = nut.mouse;    keyboard = nut.keyboard;
  Button   = nut.Button;   Key      = nut.Key;
  mouse.config.mouseSpeed     = 2000;
  keyboard.config.autoDelayMs = 0;
  console.log("✅ nut-js loaded");
} catch(e) { console.error("❌ nut-js:", e.message); }

// ── COORDINATE SCALING ────────────────────────────────────────────────────────
let streamW = 0;
let streamH = 0;

app.whenReady().then(() => {
  createWindow();
  const d = screen.getPrimaryDisplay();
  streamW = Math.round(d.bounds.width  * d.scaleFactor);
  streamH = Math.round(d.bounds.height * d.scaleFactor);
  console.log(`🖥️  Host: ${d.bounds.width}x${d.bounds.height} logical | DPI: ${d.scaleFactor} | Physical: ${streamW}x${streamH}`);
});

ipcMain.on("stream-resolution", (_, { width, height }) => {
  streamW = width; streamH = height;
  const d = screen.getPrimaryDisplay();
  console.log(`📐 Stream: ${streamW}x${streamH} | Scale X:${(d.bounds.width/streamW).toFixed(4)} Y:${(d.bounds.height/streamH).toFixed(4)}`);
});

const toLogical = (x, y) => {
  const d  = screen.getPrimaryDisplay().bounds;
  const sw = streamW || Math.round(d.width  * screen.getPrimaryDisplay().scaleFactor);
  const sh = streamH || Math.round(d.height * screen.getPrimaryDisplay().scaleFactor);
  return {
    x: Math.round(Math.max(0, Math.min(x * (d.width  / sw), d.width  - 1))),
    y: Math.round(Math.max(0, Math.min(y * (d.height / sh), d.height - 1))),
  };
};

// ── Mouse ─────────────────────────────────────────────────────────────────────
ipcMain.on("mousemove", async (_, { x, y }) => {
  try { const p = toLogical(x,y); await mouse?.setPosition({ x:p.x, y:p.y }); } catch {}
});

ipcMain.on("click", async (_, { button, x, y }) => {
  try {
    if (!mouse) return;
    const p   = toLogical(x, y);
    const btn = button===2 ? Button.RIGHT : button===1 ? Button.MIDDLE : Button.LEFT;
    await mouse.setPosition({ x:p.x, y:p.y });
    await mouse.click(btn);
  } catch(e) { console.error("click:", e.message); }
});

ipcMain.on("mousedown", async (_, { button, x, y }) => {
  try {
    if (!mouse) return;
    const p   = toLogical(x, y);
    const btn = button===2 ? Button.RIGHT : button===1 ? Button.MIDDLE : Button.LEFT;
    await mouse.setPosition({ x:p.x, y:p.y });
    await mouse.pressButton(btn);
  } catch(e) { console.error("mousedown:", e.message); }
});

ipcMain.on("mouseup", async (_, { button }) => {
  try {
    if (!mouse) return;
    const btn = button===2 ? Button.RIGHT : button===1 ? Button.MIDDLE : Button.LEFT;
    await mouse.releaseButton(btn);
  } catch(e) { console.error("mouseup:", e.message); }
});

ipcMain.on("dblclick", async (_, { x, y }) => {
  try {
    if (!mouse) return;
    const p = toLogical(x, y);
    await mouse.setPosition({ x:p.x, y:p.y });
    await mouse.doubleClick(Button.LEFT);
  } catch(e) { console.error("dblclick:", e.message); }
});

ipcMain.on("scroll", async (_, { scroll, x, y }) => {
  try {
    if (!mouse) return;
    const p = toLogical(x, y);
    await mouse.setPosition({ x:p.x, y:p.y });
    if (scroll > 0) await mouse.scrollDown(3); else await mouse.scrollUp(3);
  } catch(e) { console.error("scroll:", e.message); }
});

// ── Keyboard ──────────────────────────────────────────────────────────────────
const KEY_MAP = {
  " ":"Space","Enter":"Return","Backspace":"Backspace","Tab":"Tab",
  "Escape":"Escape","Delete":"Delete","Insert":"Insert",
  "ArrowUp":"Up","ArrowDown":"Down","ArrowLeft":"Left","ArrowRight":"Right",
  "Home":"Home","End":"End","PageUp":"PageUp","PageDown":"PageDown",
  "F1":"F1","F2":"F2","F3":"F3","F4":"F4","F5":"F5","F6":"F6",
  "F7":"F7","F8":"F8","F9":"F9","F10":"F10","F11":"F11","F12":"F12",
  "CapsLock":"CapsLock","Meta":"LeftSuper",
};

ipcMain.on("keydown", async (_, { keyCode, ctrl, shift, alt, meta }) => {
  try {
    if (!keyboard) return;
    const mods = [];
    if (ctrl)  mods.push(Key.LeftControl);
    if (shift) mods.push(Key.LeftShift);
    if (alt)   mods.push(Key.LeftAlt);
    if (meta)  mods.push(Key.LeftSuper);
    if (keyCode.length === 1 && mods.length === 0) { await keyboard.type(keyCode); return; }
    const keyName = KEY_MAP[keyCode] ?? (keyCode.length === 1 ? keyCode.toUpperCase() : null);
    if (!keyName) return;
    const nutKey = Key[keyName];
    if (nutKey === undefined) return;
    await keyboard.pressKey(...mods, nutKey);
    await keyboard.releaseKey(...mods, nutKey);
  } catch(e) { console.error("keydown:", e.message); }
});

ipcMain.on("keyup", () => {});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });