/* uiuxaudit desktop shell — Electron main process (CommonJS).
 * Loads the shared web UI and exposes the zero-token pipeline over IPC:
 *   ua:convert → headless Chromium capture (requires a chromium binary)
 *   ua:verify  → Figma REST read-back comparison
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const core = require("./core-node.cjs");

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    backgroundColor: "#0e1116",
    title: "uiuxaudit",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "web", "index.html"));
  return win;
}

ipcMain.handle("ua:convert", async (_ev, opts) => {
  try {
    const doc = await core.captureUrl(opts.url, {
      slug: opts.name,
      viewportWidth: opts.viewportWidth,
      viewportHeight: opts.viewportHeight,
      projectDir: opts.projectDir,
    });
    return { ok: true, doc };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("ua:verify", async (_ev, opts) => {
  try {
    const report = await core.verifyCapture(opts);
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("ua:chromiumPath", async () => {
  try {
    return { ok: true, path: core.resolveChromiumBinary() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
