// electron.js
// const { app, BrowserWindow, ipcMain, desktopCapturer } = require("electron");

// let win;

// function createWindow() {
//   win = new BrowserWindow({
//     width: 1000, height: 700,
//     autoHideMenuBar: true,
//     webPreferences: { nodeIntegration: true, contextIsolation: false },
//   });
//   win.loadURL("http://localhost:3000");
// }

// ipcMain.handle("GET_SOURCES", async () => {
//   try {
//     // MIRROR FIX: Hide the window BEFORE capturing sources
//     // so DeskViewer doesn't appear in the thumbnail or stream
//     win?.hide();
//     await new Promise((r) => setTimeout(r, 300)); // wait for hide animation

//     const sources = await desktopCapturer.getSources({
//       types: ["screen", "window"],
//       thumbnailSize: { width: 320, height: 180 },
//       fetchWindowIcons: true,
//     });

//     win?.show(); // restore immediately after capture

//     // Filter out DeskViewer's own window from the list
//     const filtered = sources.filter(
//       (s) => !s.name.toLowerCase().includes("deskviewer")
//     );

//     return filtered.map((s) => ({
//       id:    s.id,
//       name:  s.name,
//       thumb: s.thumbnail.toDataURL(),
//     }));
//   } catch (e) {
//     console.error("getSources error:", e);
//     win?.show();
//     return [];
//   }
// });

// ipcMain.handle("MINIMIZE_WIN", () => { win?.hide(); });   // hide instead of minimize
// ipcMain.handle("RESTORE_WIN",  () => { win?.show(); });

// // ── Robot.js ──────────────────────────────────────────────────────────────────
// let robot;
// try { robot = require("robotjs"); } catch (e) { console.warn("robotjs not available:", e.message); }

// ipcMain.on("mousemove", (_, { x, y }) => { try { robot?.moveMouse(x, y); } catch (e) {} });
// ipcMain.on("mousedown", (_, { button, x, y }) => {
//   try {
//     robot?.moveMouse(x, y);
//     const btn = button === 2 ? "right" : button === 1 ? "middle" : "left";
//     robot?.mouseToggle("down", btn);
//   } catch (e) {}
// });
// ipcMain.on("mouseup", (_, { button }) => {
//   try {
//     const btn = button === 2 ? "right" : button === 1 ? "middle" : "left";
//     robot?.mouseToggle("up", btn);
//   } catch (e) {}
// });
// ipcMain.on("dblclick", (_, { x, y }) => { try { robot?.moveMouse(x, y); robot?.mouseClick("left", true); } catch (e) {} });
// ipcMain.on("scroll",   (_, { scroll, x, y }) => { try { robot?.moveMouse(x, y); robot?.scrollMouse(0, scroll > 0 ? 3 : -3); } catch (e) {} });
// ipcMain.on("keydown",  (_, { keyCode, ctrl, shift, alt }) => {
//   try {
//     const modifiers = [];
//     if (ctrl)  modifiers.push("control");
//     if (shift) modifiers.push("shift");
//     if (alt)   modifiers.push("alt");
//     const keyMap = {
//       " ":"space","Enter":"enter","Backspace":"backspace","Tab":"tab",
//       "Escape":"escape","Delete":"delete","ArrowUp":"up","ArrowDown":"down",
//       "ArrowLeft":"left","ArrowRight":"right","Home":"home","End":"end",
//       "PageUp":"pageup","PageDown":"pagedown",
//       "F1":"f1","F2":"f2","F3":"f3","F4":"f4","F5":"f5","F6":"f6",
//       "F7":"f7","F8":"f8","F9":"f9","F10":"f10","F11":"f11","F12":"f12",
//     };
//     const mapped = keyMap[keyCode] || (keyCode.length === 1 ? keyCode.toLowerCase() : null);
//     if (mapped) robot?.keyTap(mapped, modifiers);
//   } catch (e) {}
// });
// ipcMain.on("keyup", () => {});

// app.whenReady().then(createWindow);
// app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
// app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// electron.js
const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require("electron");

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
  } catch (e) {
    win?.show();
    return [];
  }
});

ipcMain.handle("MINIMIZE_WIN",    () => { win?.hide(); });
ipcMain.handle("RESTORE_WIN",     () => { win?.show(); });
ipcMain.handle("GET_SCREEN_SIZE", () => {
  const b = screen.getPrimaryDisplay().bounds;
  return { width: b.width, height: b.height };
});

// ── Load @nut-tree-fork/nut-js ────────────────────────────────────────────────
let mouse, keyboard, Button, Key;
try {
  const nut = require("@nut-tree-fork/nut-js");
  mouse    = nut.mouse;
  keyboard = nut.keyboard;
  Button   = nut.Button;
  Key      = nut.Key;
  mouse.config.mouseSpeed     = 2000;
  keyboard.config.autoDelayMs = 0;
  console.log("✅ @nut-tree-fork/nut-js loaded successfully");
} catch (e) {
  console.warn("⚠️  nut-js not loaded:", e.message);
  console.warn("    Run: npm install @nut-tree-fork/nut-js");
}

// ── Mouse move (throttled by viewer already) ──────────────────────────────────
ipcMain.on("mousemove", async (_, { x, y }) => {
  try { await mouse?.setPosition({ x: Math.round(x), y: Math.round(y) }); } catch {}
});

// ── Mouse click ───────────────────────────────────────────────────────────────
ipcMain.on("click", async (_, { button, x, y }) => {
  try {
    await mouse?.setPosition({ x: Math.round(x), y: Math.round(y) });
    const btn = button === 2 ? Button.RIGHT : button === 1 ? Button.MIDDLE : Button.LEFT;
    await mouse?.click(btn);
  } 
  catch (e) {
    console.error("click error:", e.message); 
  }
});

ipcMain.on("mousedown", async (_, { button, x, y }) => {
  try {
    await mouse?.setPosition({ x: Math.round(x), y: Math.round(y) });
    const btn = button === 2 ? Button.RIGHT : button === 1 ? Button.MIDDLE : Button.LEFT;
    await mouse?.pressButton(btn);
  } 
  catch (e) { 
    console.error("mousedown error:", e.message); 
  }
});

ipcMain.on("mouseup", async (_, { button }) => {
  try {
    const btn = button === 2 ? Button.RIGHT : button === 1 ? Button.MIDDLE : Button.LEFT;
    await mouse?.releaseButton(btn);
  } 
  catch (e) { 
    console.error("mouseup error:", e.message); 
  }
});

ipcMain.on("dblclick", async (_, { x, y }) => {
  try {
    await mouse?.setPosition({ x: Math.round(x), y: Math.round(y) });
    await mouse?.doubleClick(Button.LEFT);
  } catch (e) { console.error("dblclick error:", e.message); }
});

// ── Scroll ────────────────────────────────────────────────────────────────────
ipcMain.on("scroll", async (_, { scroll, x, y }) => {
  try {
    await mouse?.setPosition({ x: Math.round(x), y: Math.round(y) });
    if (scroll > 0) await mouse?.scrollDown(3);
    else            await mouse?.scrollUp(3);
  } 
  catch (e) { 
    console.error("scroll error:", e.message); 
  }
});

// ── Keyboard ──────────────────────────────────────────────────────────────────
// Maps browser key names → nut-js Key enum names
const KEY_MAP = {
  // Special
  " ": "Space", "Enter": "Return", "Backspace": "Backspace", "Tab": "Tab",
  "Escape": "Escape", "Delete": "Delete", "Insert": "Insert",
  // Arrows
  "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right",
  // Navigation
  "Home": "Home", "End": "End", "PageUp": "PageUp", "PageDown": "PageDown",
  // F keys
  "F1":"F1","F2":"F2","F3":"F3","F4":"F4","F5":"F5","F6":"F6",
  "F7":"F7","F8":"F8","F9":"F9","F10":"F10","F11":"F11","F12":"F12",
  // Other
  "CapsLock": "CapsLock", "PrintScreen": "Print", "Pause": "Pause",
};

ipcMain.on("keydown", async (_, { keyCode, ctrl, shift, alt, meta }) => {
  try {
    if (!keyboard) return;
    console.log("⌨️  keydown:", keyCode, { ctrl, shift, alt });

    // Build modifier list
    const mods = [];
    if (ctrl)  mods.push(Key.LeftControl);
    if (shift) mods.push(Key.LeftShift);
    if (alt)   mods.push(Key.LeftAlt);
    if (meta)  mods.push(Key.LeftSuper);

    // Single printable character with no modifiers — just type it
    if (keyCode.length === 1 && mods.length === 0) {
      await keyboard.type(keyCode);
      return;
    }

    // Look up special key
    const keyName = KEY_MAP[keyCode] ?? (keyCode.length === 1 ? keyCode.toUpperCase() : null);
    if (!keyName) { console.log("unmapped key:", keyCode); return; }

    const nutKey = Key[keyName];
    if (!nutKey) { console.log("Key not in enum:", keyName); return; }

    // Press modifiers + key together
    if (mods.length > 0) {
      await keyboard.pressKey(...mods, nutKey);
      await keyboard.releaseKey(...mods, nutKey);
    } else {
      await keyboard.pressKey(nutKey);
      await keyboard.releaseKey(nutKey);
    }
  } catch (e) { console.error("keydown error:", e.message); }
});

ipcMain.on("keyup", () => {}); // handled in keydown

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });