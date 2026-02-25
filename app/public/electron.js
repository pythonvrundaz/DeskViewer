// electron.js
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut } = require("electron");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1000, height: 700,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadURL("http://localhost:3000");
}

ipcMain.handle("GET_SOURCES", async () => {
  try {
    win?.hide();
    await new Promise((r) => setTimeout(r, 300));
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
    });
    win?.show();
    return sources
      .filter((s) => !s.name.toLowerCase().includes("deskviewer"))
      .map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  } catch (e) { win?.show(); return []; }
});

ipcMain.handle("MINIMIZE_WIN",    () => win?.hide());
ipcMain.handle("RESTORE_WIN",     () => win?.show());
ipcMain.handle("GET_SCREEN_SIZE", () => {
  const b = screen.getPrimaryDisplay().bounds;
  console.log("🖥️ Screen size:", b.width, "x", b.height);
  return { width: b.width, height: b.height };
});

ipcMain.on("minimize-to-taskbar", () => { if (win) win.minimize(); });

// ── Global shortcut capture ───────────────────────────────────────────────────
ipcMain.on("set-global-capture", (_, enabled) => {
  try { globalShortcut.unregisterAll(); } catch {}
  if (!enabled) { console.log("🔓 Shortcuts released"); return; }

  const combos = [
    ["Alt+Tab",       { keyCode: "Tab", ctrl: false, shift: false, alt: true,  meta: false }],
    ["Alt+Shift+Tab", { keyCode: "Tab", ctrl: false, shift: true,  alt: true,  meta: false }],
    ["Alt+F4",        { keyCode: "F4",  ctrl: false, shift: false, alt: true,  meta: false }],
    // NOTE: "Super" alone is INVALID on Windows — DO NOT add it, causes crash
  ];

  for (const [combo, payload] of combos) {
    try {
      globalShortcut.register(combo, () => win?.webContents.send("global-keydown", payload));
    } catch (e) {
      console.warn("Could not register:", combo, e.message);
    }
  }
  console.log("🔒 Shortcuts captured");
});

app.on("will-quit", () => { try { globalShortcut.unregisterAll(); } catch {} });

// ── nut-js ────────────────────────────────────────────────────────────────────
let mouse, keyboard, Button, Key;
try {
  const nut        = require("@nut-tree-fork/nut-js");
  mouse            = nut.mouse;
  keyboard         = nut.keyboard;
  Button           = nut.Button;
  Key              = nut.Key;
  mouse.config.mouseSpeed     = 2000;
  keyboard.config.autoDelayMs = 0;
  console.log("✅ nut-js loaded");
} catch (e) {
  console.error("❌ nut-js failed:", e.message);
}

// ── COORDINATE SCALING FIX ────────────────────────────────────────────────────
// Viewer sends coords in STREAM resolution (e.g. 1280x720)
// nut-js moves mouse in ACTUAL SCREEN resolution (e.g. 1920x1080)
// Without scaling: taskbar clicks land at wrong Y position (e.g. y=700 instead of y=1060)
// Fix: scale stream coords → screen coords on the host side

let screenW = 1920;
let screenH = 1080;
let streamW = 1280; // updated when first mousemove received
let streamH = 720;

// Detect screen size at startup
app.whenReady().then(() => {
  const b = screen.getPrimaryDisplay().bounds;
  screenW = b.width;
  screenH = b.height;
  console.log(`🖥️ Host screen: ${screenW}x${screenH}`);
});

// Scale stream coords to screen coords
const toScreen = (x, y) => {
  // Auto-detect stream resolution from first few mouse events
  // Stream coords should never exceed stream resolution
  // We infer stream size from the max coords we receive
  // But safer: just scale based on known capture resolution
  // The stream is captured at max 1920x1080, min 1280x720
  // We use screen size as the target since that's what nut-js uses
  const scaleX = screenW / streamW;
  const scaleY = screenH / streamH;
  return {
    x: Math.round(Math.max(0, Math.min(x * scaleX, screenW - 1))),
    y: Math.round(Math.max(0, Math.min(y * scaleY, screenH - 1))),
  };
};

// Viewer sends stream resolution when control starts — use this for exact scaling
ipcMain.on("stream-resolution", (_, { width, height }) => {
  streamW = width;
  streamH = height;
  console.log(`📐 Stream resolution updated: ${streamW}x${streamH}, screen: ${screenW}x${screenH}`);
  console.log(`   Scale factors: X=${(screenW/streamW).toFixed(3)} Y=${(screenH/streamH).toFixed(3)}`);
});

// ── Mouse handlers ────────────────────────────────────────────────────────────
ipcMain.on("mousemove", async (_, { x, y }) => {
  try {
    // Update stream resolution estimate from coords
    // (coords near edges tell us the stream size)
    if (x > streamW * 0.9) streamW = Math.max(streamW, Math.round(x / 0.9));
    if (y > streamH * 0.9) streamH = Math.max(streamH, Math.round(y / 0.9));
    const s = toScreen(x, y);
    await mouse?.setPosition({ x: s.x, y: s.y });
  } catch {}
});

ipcMain.on("click", async (_, { button, x, y }) => {
  try {
    if (!mouse) return;
    const s = toScreen(x, y);
    console.log(`🖱️ click stream(${x},${y}) → screen(${s.x},${s.y})`);
    await mouse.setPosition({ x: s.x, y: s.y });
    const btn = button === 2 ? Button.RIGHT : button === 1 ? Button.MIDDLE : Button.LEFT;
    await mouse.click(btn);
  } catch (e) { console.error("click:", e.message); }
});

ipcMain.on("mousedown", async (_, { button, x, y }) => {
  try {
    if (!mouse) return;
    const s = toScreen(x, y);
    await mouse.setPosition({ x: s.x, y: s.y });
    const btn = button === 2 ? Button.RIGHT : button === 1 ? Button.MIDDLE : Button.LEFT;
    await mouse.pressButton(btn);
  } catch (e) { console.error("mousedown:", e.message); }
});

ipcMain.on("mouseup", async (_, { button }) => {
  try {
    if (!mouse) return;
    const btn = button === 2 ? Button.RIGHT : button === 1 ? Button.MIDDLE : Button.LEFT;
    await mouse.releaseButton(btn);
  } catch (e) { console.error("mouseup:", e.message); }
});

ipcMain.on("dblclick", async (_, { x, y }) => {
  try {
    if (!mouse) return;
    const s = toScreen(x, y);
    await mouse.setPosition({ x: s.x, y: s.y });
    await mouse.doubleClick(Button.LEFT);
  } catch (e) { console.error("dblclick:", e.message); }
});

ipcMain.on("scroll", async (_, { scroll, x, y }) => {
  try {
    if (!mouse) return;
    const s = toScreen(x, y);
    await mouse.setPosition({ x: s.x, y: s.y });
    if (scroll > 0) await mouse.scrollDown(3);
    else            await mouse.scrollUp(3);
  } catch (e) { console.error("scroll:", e.message); }
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

    if (keyCode.length === 1 && mods.length === 0) {
      await keyboard.type(keyCode);
      return;
    }
    const keyName = KEY_MAP[keyCode] ?? (keyCode.length === 1 ? keyCode.toUpperCase() : null);
    if (!keyName) return;
    const nutKey = Key[keyName];
    if (nutKey === undefined) return;
    await keyboard.pressKey(...mods, nutKey);
    await keyboard.releaseKey(...mods, nutKey);
  } catch (e) { console.error("keydown:", e.message); }
});

ipcMain.on("keyup", () => {});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });