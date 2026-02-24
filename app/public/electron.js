// // electron.js
// const path = require("path");
// const { app, BrowserWindow } = require("electron");
// const robot = require("robotjs");
// const { desktopCapturer, ipcMain } = require("electron");

// let win;
// function createWindow() {
//   win = new BrowserWindow({
//     width: 600,
//     height: 600,
//     icon: __dirname + "/img/deskviewer_logo_256.png",
//     autoHideMenuBar: true,
//     webPreferences: {
//       nodeIntegration: true,
//       contextIsolation: false,
//     },
//   });

  
//   win
//     .loadURL("http://localhost:3000")

//     //win.loadURL(`file://${path.join(__dirname, "../build/index.html")}`)
//     .then(() => {
//       console.log("Window loaded, URL: " + win.webContents.getURL());
//       desktopCapturer
//         .getSources({ types: ["screen"] })
//         .then(async (sources) => {
//           for (const source of sources) {
//             // TODO: Add if condition for multiple sources
//             console.log("Sources available: " + source.id);
//             console.log("Source id sent: " + source.id);
//             win.webContents.send("SET_SOURCE", source.id);
//           }
//         });
//     });
// }

// app.whenReady().then(createWindow);

// app.on("window-all-closed", () => {
//   if (process.platform !== "darwin") {
//     app.quit();
//   }
// });

// app.on("activate", () => {
//   if (BrowserWindow.getAllWindows().length === 0) {
//     createWindow();
//   }
// });

// // --------- HANDLE KEYBOARD AND MOUSE EVENTS -------

// //robot.moveMouseSmooth(100, 180);
// //robot.mouseClick();
// //robot.scrollMouse(0, -200);
// //robot.keyTap("command")

// ipcMain.on("mousemove", (event, args) => {
//   //console.log(`Mousemove: x=${args.x} y=${args.y}`);
//   //robot.moveMouseSmooth(args.x, args.y);
// });

// ipcMain.on("mousedown", (event, args) => {
//   //console.log(`Mouse down: ${args.button}`);
//   //robot.mouseClick();
// });

// ipcMain.on("scroll", (event, args) => {
//   //console.log(`Scroll: ${args.scroll}`);
//   //robot.scrollMouse(0, args.scroll);
// });

// ipcMain.on("keydown", (event, args) => {
//   //console.log(`Key pressed: ${args.keyCode}`);
//   //robot.keyTap("command");
// });


// electron.js
const { app, BrowserWindow, ipcMain, desktopCapturer } = require("electron");

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
    // MIRROR FIX: Hide the window BEFORE capturing sources
    // so DeskViewer doesn't appear in the thumbnail or stream
    win?.hide();
    await new Promise((r) => setTimeout(r, 300)); // wait for hide animation

    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });

    win?.show(); // restore immediately after capture

    // Filter out DeskViewer's own window from the list
    const filtered = sources.filter(
      (s) => !s.name.toLowerCase().includes("deskviewer")
    );

    return filtered.map((s) => ({
      id:    s.id,
      name:  s.name,
      thumb: s.thumbnail.toDataURL(),
    }));
  } catch (e) {
    console.error("getSources error:", e);
    win?.show();
    return [];
  }
});

ipcMain.handle("MINIMIZE_WIN", () => { win?.hide(); });   // hide instead of minimize
ipcMain.handle("RESTORE_WIN",  () => { win?.show(); });

// ── Robot.js ──────────────────────────────────────────────────────────────────
let robot;
try { robot = require("robotjs"); } catch (e) { console.warn("robotjs not available:", e.message); }

ipcMain.on("mousemove", (_, { x, y }) => { try { robot?.moveMouse(x, y); } catch (e) {} });
ipcMain.on("mousedown", (_, { button, x, y }) => {
  try {
    robot?.moveMouse(x, y);
    const btn = button === 2 ? "right" : button === 1 ? "middle" : "left";
    robot?.mouseToggle("down", btn);
  } catch (e) {}
});
ipcMain.on("mouseup", (_, { button }) => {
  try {
    const btn = button === 2 ? "right" : button === 1 ? "middle" : "left";
    robot?.mouseToggle("up", btn);
  } catch (e) {}
});
ipcMain.on("dblclick", (_, { x, y }) => { try { robot?.moveMouse(x, y); robot?.mouseClick("left", true); } catch (e) {} });
ipcMain.on("scroll",   (_, { scroll, x, y }) => { try { robot?.moveMouse(x, y); robot?.scrollMouse(0, scroll > 0 ? 3 : -3); } catch (e) {} });
ipcMain.on("keydown",  (_, { keyCode, ctrl, shift, alt }) => {
  try {
    const modifiers = [];
    if (ctrl)  modifiers.push("control");
    if (shift) modifiers.push("shift");
    if (alt)   modifiers.push("alt");
    const keyMap = {
      " ":"space","Enter":"enter","Backspace":"backspace","Tab":"tab",
      "Escape":"escape","Delete":"delete","ArrowUp":"up","ArrowDown":"down",
      "ArrowLeft":"left","ArrowRight":"right","Home":"home","End":"end",
      "PageUp":"pageup","PageDown":"pagedown",
      "F1":"f1","F2":"f2","F3":"f3","F4":"f4","F5":"f5","F6":"f6",
      "F7":"f7","F8":"f8","F9":"f9","F10":"f10","F11":"f11","F12":"f12",
    };
    const mapped = keyMap[keyCode] || (keyCode.length === 1 ? keyCode.toLowerCase() : null);
    if (mapped) robot?.keyTap(mapped, modifiers);
  } catch (e) {}
});
ipcMain.on("keyup", () => {});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });