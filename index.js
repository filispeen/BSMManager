import fs from "node:fs";
import path from "node:path";
import extractZip from "extract-zip";

const BEATSAVER_URL = "https://beatsaver.com";
const ONE_CLICK_CLEANER_SCRIPT = `
(() => {
  if (window.__bsmOneClickCleaner) {
    return;
  }
  window.__bsmOneClickCleaner = true;

  const removeOneClick = () => {
    const links = document.querySelectorAll('a[title="One-Click"]');
    for (const link of links) {
      link.remove();
    }
  };

  removeOneClick();

  const observer = new MutationObserver(removeOneClick);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
`;
const PROGRESS_BAR_SCRIPT = `
(() => {
  if (window.__bsmProgressBar) {
    return;
  }
  window.__bsmProgressBar = true;

  const style = document.createElement("style");
  style.textContent =
    "@keyframes bsm-progress-move { from { background-position: 0 0; } to { background-position: 60px 0; } }";
  if (document.head) {
    document.head.appendChild(style);
  }

  const bar = document.createElement("div");
  bar.id = "__bsmProgressBar";
  bar.style.position = "fixed";
  bar.style.left = "0";
  bar.style.right = "0";
  bar.style.bottom = "0";
  bar.style.height = "6px";
  bar.style.background = "rgba(0, 0, 0, 0.15)";
  bar.style.zIndex = "2147483647";
  bar.style.pointerEvents = "none";
  bar.style.opacity = "0";
  bar.style.transition = "opacity 120ms ease";

  const fill = document.createElement("div");
  fill.id = "__bsmProgressBarFill";
  fill.style.height = "100%";
  fill.style.width = "0%";
  fill.style.background = "#2fb3ff";
  fill.style.transition = "width 120ms ease";
  bar.appendChild(fill);

  document.body.appendChild(bar);
  document.body.style.paddingBottom = "6px";

  const setDeterminate = (value) => {
    fill.style.animation = "none";
    fill.style.background = "#2fb3ff";
    fill.style.backgroundSize = "auto";
    fill.style.opacity = "1";
    fill.style.width =
      Math.max(0, Math.min(100, Math.round(value * 100))) + "%";
  };

  const setIndeterminate = () => {
    fill.style.width = "100%";
    fill.style.opacity = "0.85";
    fill.style.background =
      "linear-gradient(90deg, rgba(47, 179, 255, 0.2) 0%, rgba(47, 179, 255, 0.9) 50%, rgba(47, 179, 255, 0.2) 100%)";
    fill.style.backgroundSize = "60px 100%";
    fill.style.animation = "bsm-progress-move 1s linear infinite";
  };

  window.__bsmSetProgress = (value, indeterminate) => {
    if (!bar.isConnected) {
      return;
    }
    if (value == null || value < 0) {
      bar.style.opacity = "0";
      fill.style.width = "0%";
      fill.style.animation = "none";
      return;
    }
    bar.style.opacity = "1";
    if (indeterminate) {
      setIndeterminate();
      return;
    }
    setDeterminate(value);
  };
})();
`;

function configPath(app) {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(app) {
  try {
    const raw = fs.readFileSync(configPath(app), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeConfig(app, config) {
  fs.writeFileSync(configPath(app), JSON.stringify(config, null, 2));
}

async function promptForRoot(dialog) {
  const ask = await dialog.showMessageBox({
    type: "question",
    buttons: ["Select folder", "Exit"],
    defaultId: 0,
    cancelId: 1,
    message: "Select Beat Saber root folder",
    detail: "Pick the folder where Beat Saber.exe is located.",
  });
  if (ask.response !== 0) {
    return null;
  }

  const picked = await dialog.showOpenDialog({
    title: "Beat Saber root folder",
    properties: ["openDirectory"],
  });

  if (picked.canceled || picked.filePaths.length === 0) {
    return null;
  }

  return picked.filePaths[0];
}

async function ensureCustomLevelsPath(app, dialog, options = {}) {
  const { forcePrompt = false } = options;
  const config = readConfig(app);
  let root = forcePrompt ? null : config.beatSaberRoot;

  if (!root || !fs.existsSync(root)) {
    root = await promptForRoot(dialog);
    if (!root) {
      return null;
    }
  }

  const levelsPath = path.join(root, "Beat Saber_Data", "CustomLevels");
  fs.mkdirSync(levelsPath, { recursive: true });

  config.beatSaberRoot = root;
  writeConfig(app, config);

  return levelsPath;
}

function progressUpdateScript(value, indeterminate) {
  const safeValue = Number.isFinite(value) ? value : -1;
  const mode = indeterminate ? "true" : "false";
  return `if (window.__bsmSetProgress) { window.__bsmSetProgress(${safeValue}, ${mode}); }`;
}

function setWindowProgress(win, value, indeterminate) {
  if (win.isDestroyed()) {
    return;
  }

  if (value == null || value < 0) {
    win.setProgressBar(-1);
    win.webContents
      .executeJavaScript(progressUpdateScript(-1, false), true)
      .catch(() => {});
    return;
  }

  if (indeterminate) {
    win.setProgressBar(2);
    win.webContents
      .executeJavaScript(progressUpdateScript(1, true), true)
      .catch(() => {});
    return;
  }

  const clamped = Math.min(Math.max(value, 0), 1);
  win.setProgressBar(clamped);
  win.webContents
    .executeJavaScript(progressUpdateScript(clamped, false), true)
    .catch(() => {});
}

function setupDownloads(session, state, win) {
  let activeDownloads = 0;

  session.defaultSession.on("will-download", (event, item) => {
    activeDownloads += 1;

    const customLevelsPath = state.customLevelsPath;
    if (!customLevelsPath) {
      item.cancel();
      activeDownloads = Math.max(0, activeDownloads - 1);
      if (activeDownloads === 0) {
        setWindowProgress(win, -1, false);
      }
      return;
    }

    const filename = item.getFilename();
    const savePath = path.join(customLevelsPath, filename);
    item.setSavePath(savePath);

    const updateProgressBar = () => {
      const totalBytes = item.getTotalBytes();
      if (totalBytes > 0) {
        const received = item.getReceivedBytes();
        setWindowProgress(win, received / totalBytes, false);
        return;
      }

      setWindowProgress(win, 1, true);
    };

    updateProgressBar();

    item.on("updated", (updateEvent, state) => {
      if (state === "progressing") {
        updateProgressBar();
      }
    });

    item.once("done", async (doneEvent, state) => {
      try {
        if (state !== "completed") {
          return;
        }

        const ext = path.extname(filename).toLowerCase();
        if (ext !== ".zip") {
          return;
        }

        const baseName = path.basename(filename, ext);
        const extractPath = path.join(customLevelsPath, baseName);
        fs.mkdirSync(extractPath, { recursive: true });

        try {
          await extractZip(savePath, { dir: extractPath });
          await fs.promises.unlink(savePath);
        } catch (err) {
          console.error("Failed to extract zip:", err);
        }
      } finally {
        activeDownloads = Math.max(0, activeDownloads - 1);
        if (activeDownloads === 0 && !win.isDestroyed()) {
          setWindowProgress(win, -1, false);
        }
      }
    });
  });
}

function injectPageHelpers(webContents) {
  webContents.executeJavaScript(ONE_CLICK_CLEANER_SCRIPT, true).catch((err) => {
    console.error("Failed to inject One-Click cleaner:", err);
  });
  webContents.executeJavaScript(PROGRESS_BAR_SCRIPT, true).catch((err) => {
    console.error("Failed to inject progress bar:", err);
  });
}

function createWindow(BrowserWindow) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
  });

  win.loadURL(BEATSAVER_URL);

  const injectHelpers = () => injectPageHelpers(win.webContents);
  win.webContents.on("did-finish-load", injectHelpers);
  win.webContents.on("did-navigate-in-page", injectHelpers);

  return win;
}

function buildMenu(Menu, app, dialog, state, win) {
  const setBeatSaberFolder = async () => {
    const newPath = await ensureCustomLevelsPath(app, dialog, {
      forcePrompt: true,
    });
    if (newPath) {
      state.customLevelsPath = newPath;
      if (!win.isDestroyed()) {
        win.webContents.executeJavaScript(PROGRESS_BAR_SCRIPT, true).catch(() => {
          return;
        });
      }
    }
  };

  const template = [
    {
      label: "File",
      submenu: [
        { label: "Set Beat Saber Folder...", click: setBeatSaberFolder },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function loadElectron() {
  if (!process.versions.electron) {
    throw new Error('Run with Electron: "npx electron ." or "npm start".');
  }

  return await import("electron");
}

async function main() {
  const { app, BrowserWindow, Menu, dialog, session } = await loadElectron();
  await app.whenReady();

  const state = { customLevelsPath: null };
  state.customLevelsPath = await ensureCustomLevelsPath(app, dialog);
  if (!state.customLevelsPath) {
    app.quit();
    return;
  }

  const win = createWindow(BrowserWindow);
  setupDownloads(session, state, win);
  buildMenu(Menu, app, dialog, state, win);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
