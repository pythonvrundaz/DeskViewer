// electron.js — Main process
// Place this file next to package.json (project root), NOT inside public/
//
// KEY BEHAVIOUR: When the user clicks the OS ✕ close button, we:
//   1. Intercept window-close (prevent-default)
//   2. Send "app-will-close" to the renderer via ipcMain
//   3. Wait for renderer to emit "remotedisconnected" via socket + "cleanup-done" IPC
//   4. Only then actually quit — so the other side always gets notified
//
// This ensures that closing the EXE via the title-bar ✕ button always:
//   • Sends "remotedisconnected" to the remote peer's socket room
//   • Closes the PeerJS call cleanly
//   • Returns the other side to the home screen

"use strict";

const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, clipboard } = require("electron");
const path  = require("path");
const isDev = require("electron-is-dev");

let mainWindow   = null;
let closeAllowed = false;   // flipped to true once renderer finishes cleanup
let cleanupTimer = null;    // safety timeout — force quit if renderer hangs

// ── Window factory ────────────────────────────────────────────────────────────
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width:  Math.min(1280, width),
    height: Math.min(800,  height),
    minWidth:  900,
    minHeight: 600,
    title: "DeskViewer",
    icon: path.join(__dirname, "public", "img", "deskviewer_logo_transparent.png"),
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: false,
      nodeIntegration:  true,
      webSecurity:      false,
    },
    // Hide the default title bar on Windows so we control it from React if needed
    // Set to false to keep native title bar (simpler, required for ✕ to work)
    frame: true,
  });

  // Load app
  const url = isDev
    ? "http://localhost:3000"
    : `file://${path.join(__dirname, "build", "index.html")}`;
  mainWindow.loadURL(url);

  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });

  // ── Intercept the OS ✕ close button ────────────────────────────────────────
  // We do NOT call mainWindow.destroy() immediately. Instead we tell the
  // renderer to notify the remote peer first, then wait for "cleanup-done".
  mainWindow.on("close", (e) => {
    if (closeAllowed) return; // renderer already finished — let it close
    e.preventDefault();       // stop the window from closing right now

    console.log("[electron] Window close intercepted — notifying renderer...");

    // Tell the renderer to: emit remotedisconnected, close call, then send cleanup-done
    mainWindow.webContents.send("app-will-close");

    // Safety: if renderer doesn't respond within 3 s, force quit anyway
    cleanupTimer = setTimeout(() => {
      console.warn("[electron] Cleanup timed out — force quitting");
      closeAllowed = true;
      mainWindow?.destroy();
    }, 3000);
  });

  mainWindow.on("minimize", () => mainWindow.webContents.send("window-minimized"));
  mainWindow.on("restore",  () => mainWindow.webContents.send("window-restored"));

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── IPC: renderer finished cleanup → now safe to quit ────────────────────────
// Sent by App.js onWillClose after socket.emit("remotedisconnected") + call.close()
ipcMain.on("cleanup-done", () => {
  console.log("[electron] Renderer cleanup done — closing window");
  clearTimeout(cleanupTimer);
  closeAllowed = true;
  mainWindow?.destroy();
});

// ── IPC: session lifecycle ─────────────────────────────────────────────────────
ipcMain.on("session-started", () => {
  console.log("[electron] Session started");
  // Register Escape globally so viewer can release control
  globalShortcut.register("Escape", () => {
    mainWindow?.webContents.send("global-keydown", { keyCode: "Escape" });
  });
});

ipcMain.on("session-ended", () => {
  console.log("[electron] Session ended");
  globalShortcut.unregisterAll();
});

// ── IPC: window management ────────────────────────────────────────────────────
ipcMain.on("minimize-to-taskbar", () => mainWindow?.minimize());

ipcMain.handle("MINIMIZE_WIN",  () => mainWindow?.minimize());
ipcMain.handle("RESTORE_WIN",   () => { mainWindow?.restore(); mainWindow?.focus(); });

ipcMain.on("maximize-for-viewing", () => {
  if (mainWindow && !mainWindow.isMaximized()) mainWindow.maximize();
});

// ── IPC: global keyboard capture (remote control) ─────────────────────────────
ipcMain.on("set-global-capture", (_, enable) => {
  if (enable) {
    // Capture all keys globally for remote control mode
    const keys = [
      "F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12",
      "Tab","CapsLock","Backspace","Delete","Insert","Home","End",
      "PageUp","PageDown","Left","Right","Up","Down","PrintScreen",
    ];
    keys.forEach(k => {
      try {
        globalShortcut.register(k, () => {
          mainWindow?.webContents.send("global-keydown", { keyCode: k });
        });
      } catch {}
    });
  } else {
    globalShortcut.unregisterAll();
  }
});

// ── IPC: mouse & keyboard events (host receives these from viewer) ────────────
const robot = (() => { try { return require("@nut-tree-fork/nut-js"); } catch { return null; } })();

ipcMain.on("mousemove", (_, { event }) => {
  if (!event || !mainWindow) return;
  const { x, y } = event;
  // Convert from viewer's video coords to host screen coords
  const { width, height } = screen.getPrimaryDisplay().bounds;
  const absX = Math.round(x * width);
  const absY = Math.round(y * height);
  // Use robot if available, else use screen.getCursorScreenPoint fallback
  if (robot?.mouse) {
    robot.mouse.setPosition({ x: absX, y: absY }).catch(() => {});
  }
});

ipcMain.on("mousedown", (_, data) => {
  if (robot?.mouse) robot.mouse.pressButton(data.button === 2 ? robot.Button.RIGHT : robot.Button.LEFT).catch(() => {});
});
ipcMain.on("mouseup", (_, data) => {
  if (robot?.mouse) robot.mouse.releaseButton(data.button === 2 ? robot.Button.RIGHT : robot.Button.LEFT).catch(() => {});
});
ipcMain.on("dblclick", () => {
  if (robot?.mouse) {
    robot.mouse.click(robot.Button.LEFT).catch(() => {});
    robot.mouse.click(robot.Button.LEFT).catch(() => {});
  }
});
ipcMain.on("scroll", (_, { scroll }) => {
  if (robot?.mouse) robot.mouse.scrollDown(Math.abs(scroll) > 0 ? 3 : -3).catch(() => {});
});
ipcMain.on("keydown", (_, { keyCode, ctrl, shift, alt }) => {
  if (robot?.keyboard) {
    // Build key combo
    const mods = [];
    if (ctrl)  mods.push(robot.Key.LeftControl);
    if (shift) mods.push(robot.Key.LeftShift);
    if (alt)   mods.push(robot.Key.LeftAlt);
    const key = mapKey(keyCode, robot);
    if (key) robot.keyboard.pressKey(...mods, key).catch(() => {});
  }
});
ipcMain.on("keyup", (_, { keyCode }) => {
  if (robot?.keyboard) {
    const key = mapKey(keyCode, robot);
    if (key) robot.keyboard.releaseKey(key).catch(() => {});
  }
});

// Key mapping helper
function mapKey(code, r) {
  if (!r?.Key) return null;
  const map = {
    "Enter": r.Key.Return, "Backspace": r.Key.Backspace, "Delete": r.Key.Delete,
    "Tab": r.Key.Tab, "Escape": r.Key.Escape, "Space": r.Key.Space,
    "ArrowLeft": r.Key.Left, "ArrowRight": r.Key.Right, "ArrowUp": r.Key.Up, "ArrowDown": r.Key.Down,
    "Home": r.Key.Home, "End": r.Key.End, "PageUp": r.Key.PageUp, "PageDown": r.Key.PageDown,
    "F1":r.Key.F1,"F2":r.Key.F2,"F3":r.Key.F3,"F4":r.Key.F4,"F5":r.Key.F5,"F6":r.Key.F6,
    "F7":r.Key.F7,"F8":r.Key.F8,"F9":r.Key.F9,"F10":r.Key.F10,"F11":r.Key.F11,"F12":r.Key.F12,
    "CapsLock": r.Key.CapsLock,
  };
  if (map[code]) return map[code];
  // Single character keys
  if (code.length === 1) {
    const k = r.Key[code.toUpperCase()];
    return k || null;
  }
  return null;
}

// ── IPC: screen sources ────────────────────────────────────────────────────────
ipcMain.handle("GET_SOURCES", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 300, height: 200 },
  });
  return sources.map(s => ({
    id:        s.id,
    name:      s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

// ── IPC: stream resolution hint ────────────────────────────────────────────────
ipcMain.on("stream-resolution", (_, { width, height }) => {
  if (!mainWindow) return;
  // Resize window to better match the stream aspect ratio
  try {
    const display = screen.getPrimaryDisplay().workAreaSize;
    const maxW = Math.min(width  || 1280, display.width);
    const maxH = Math.min(height || 720,  display.height);
    mainWindow.setSize(maxW, maxH, true);
    mainWindow.center();
  } catch {}
});

// ── IPC: clipboard ────────────────────────────────────────────────────────────
ipcMain.handle("WRITE_CLIPBOARD", (_, text) => {
  clipboard.writeText(text);
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});