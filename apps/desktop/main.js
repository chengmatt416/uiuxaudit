/* uiuxaudit desktop shell — Electron main process (CommonJS).
 * Loads the shared web UI and exposes the zero-token pipeline over IPC:
 *   ua:convert → headless Chromium capture (requires a chromium binary)
 *   ua:verify  → Figma REST read-back comparison
 */
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const core = require("./core-node.cjs");

function createWindow() {
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#07080a",
    title: "uiuxaudit",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 18, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const menuTemplate = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload Workspace',
          accelerator: 'CmdOrCtrl+R',
          click: () => win.webContents.reload(),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[Desktop] Failed to load ${url}: ${code} (${desc})`);
  });

  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[Renderer L${level}] ${message} (${sourceId}:${line})`);
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
