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
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
    win?.show();
    return sources.filter((s) => !s.name.toLowerCase().includes("deskviewer"))
                  .map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  } catch (e) { win?.show(); return []; }
});

ipcMain.handle("MINIMIZE_WIN",    () => win?.hide());
ipcMain.handle("RESTORE_WIN",     () => win?.show());
ipcMain.handle("GET_SCREEN_SIZE", () => {
  const b = screen.getPrimaryDisplay().bounds;
  console.log("Screen size:", b.width, b.height);
  return { width: b.width, height: b.height };
});

// ── Load nut-js ───────────────────────────────────────────────────────────────
let mouse, keyboard, Button, Key;
try {
  const nut = require("@nut-tree-fork/nut-js");
  mouse    = nut.mouse;
  keyboard = nut.keyboard;
  Button   = nut.Button;
  Key      = nut.Key;
  mouse.config.mouseSpeed     = 2000;
  keyboard.config.autoDelayMs = 0;
  console.log("✅ nut-js loaded. Button.LEFT =", Button.LEFT, "Key.Return =", Key.Return);
} catch (e) {
  console.error("❌ nut-js FAILED to load:", e.message);
  console.error("   Run: npm install @nut-tree-fork/nut-js");
}

// ── Mouse ─────────────────────────────────────────────────────────────────────
ipcMain.on("mousemove", async (_, { x, y }) => {
  try { await mouse?.setPosition({ x: Math.round(x), y: Math.round(y) }); }
  catch (e) { console.error("mousemove error:", e.message); }
});

ipcMain.on("click", async (_, { button, x, y }) => {
  console.log("🖱️ click received at", x, y, "button:", button);
  try {
    if (!mouse) { console.error("mouse is null — nut-js not loaded!"); return; }
    await mouse.setPosition({ x: Math.round(x), y: Math.round(y) });
    const btn = button === 2 ? Button.RIGHT : button === 1 ? Button.MIDDLE : Button.LEFT;
    console.log("   clicking with button:", btn);
    await mouse.click(btn);
    console.log("   ✅ click done");
  } catch (e) { console.error("click error:", e.message); }
});

ipcMain.on("mousedown", async (_, { button, x, y }) => {
  try {
    if (!mouse) return;
    await mouse.setPosition({ x: Math.round(x), y: Math.round(y) });
    const btn = button === 2 ? Button.RIGHT : button === 1 ? Button.MIDDLE : Button.LEFT;
    await mouse.pressButton(btn);
  } catch (e) { console.error("mousedown error:", e.message); }
});

ipcMain.on("mouseup", async (_, { button }) => {
  try {
    if (!mouse) return;
    const btn = button === 2 ? Button.RIGHT : button === 1 ? Button.MIDDLE : Button.LEFT;
    await mouse.releaseButton(btn);
  } catch (e) { console.error("mouseup error:", e.message); }
});

ipcMain.on("dblclick", async (_, { x, y }) => {
  console.log("🖱️ dblclick at", x, y);
  try {
    if (!mouse) return;
    await mouse.setPosition({ x: Math.round(x), y: Math.round(y) });
    await mouse.doubleClick(Button.LEFT);
  } catch (e) { console.error("dblclick error:", e.message); }
});

ipcMain.on("scroll", async (_, { scroll, x, y }) => {
  try {
    if (!mouse) return;
    await mouse.setPosition({ x: Math.round(x), y: Math.round(y) });
    if (scroll > 0) await mouse.scrollDown(3);
    else            await mouse.scrollUp(3);
  } catch (e) { console.error("scroll error:", e.message); }
});

// ── Keyboard ──────────────────────────────────────────────────────────────────
const KEY_MAP = {
  " ":"Space","Enter":"Return","Backspace":"Backspace","Tab":"Tab",
  "Escape":"Escape","Delete":"Delete","Insert":"Insert",
  "ArrowUp":"Up","ArrowDown":"Down","ArrowLeft":"Left","ArrowRight":"Right",
  "Home":"Home","End":"End","PageUp":"PageUp","PageDown":"PageDown",
  "F1":"F1","F2":"F2","F3":"F3","F4":"F4","F5":"F5","F6":"F6",
  "F7":"F7","F8":"F8","F9":"F9","F10":"F10","F11":"F11","F12":"F12",
  "CapsLock":"CapsLock",
};

ipcMain.on("keydown", async (_, { keyCode, ctrl, shift, alt, meta }) => {
  console.log("⌨️ keydown received:", keyCode, { ctrl, shift, alt });
  try {
    if (!keyboard) { console.error("keyboard is null — nut-js not loaded!"); return; }

    const mods = [];
    if (ctrl)  mods.push(Key.LeftControl);
    if (shift) mods.push(Key.LeftShift);
    if (alt)   mods.push(Key.LeftAlt);
    if (meta)  mods.push(Key.LeftSuper);

    // Single character, no modifiers → just type it
    if (keyCode.length === 1 && mods.length === 0) {
      console.log("   typing char:", keyCode);
      await keyboard.type(keyCode);
      return;
    }

    const keyName = KEY_MAP[keyCode] ?? (keyCode.length === 1 ? keyCode.toUpperCase() : null);
    if (!keyName) { console.log("   unmapped key:", keyCode); return; }

    const nutKey = Key[keyName];
    if (nutKey === undefined) { console.log("   Key not in enum:", keyName); return; }

    console.log("   pressing key:", keyName, "with mods:", mods.length);
    await keyboard.pressKey(...mods, nutKey);
    await keyboard.releaseKey(...mods, nutKey);
    console.log("   ✅ key done");
  } catch (e) { console.error("keydown error:", e.message); }
});

ipcMain.on("keyup", () => {});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });