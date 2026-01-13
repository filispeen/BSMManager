import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import extractZip from "extract-zip";
import pLimit from "p-limit";

const require = createRequire(import.meta.url);

import {
  BEATSAVER_URL,
  PLAYLIST_CDN_PREFIX,
  HASH_REGEX,
  PARALLEL_DOWNLOADS,
  DOWNLOAD_TIMEOUT_MS,
} from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const SCRIPTS_PATH = path.join(__dirname, "scripts");
const ASSETS_PATH = path.join(__dirname, "assets");

// Cache for info.dat files (key: folderPath, value: { mtime, data })
const infoDatCache = new Map();

/**
 * Load script content from file
 * @param {string} filename
 * @returns {string}
 */
function loadScript(filename) {
  return fs.readFileSync(path.join(SCRIPTS_PATH, filename), "utf8");
}

/**
 * Load CSS content from file
 * @param {string} filename
 * @returns {string}
 */
function loadStyle(filename) {
  return fs.readFileSync(path.join(ASSETS_PATH, filename), "utf8");
}

// Load scripts at startup
const ONE_CLICK_CLEANER_SCRIPT = loadScript("one-click-cleaner.js");
const PROGRESS_BAR_SCRIPT = loadScript("progress-bar.js");
const INSTALLED_MAPS_STYLE = loadStyle("installed-maps.css");
const INSTALLED_MAPS_SCRIPT_TEMPLATE = loadScript("installed-maps.js");
const INSTALLED_MAPS_SCRIPT = INSTALLED_MAPS_SCRIPT_TEMPLATE.replace(
  "__INSTALLED_MAPS_STYLE__",
  JSON.stringify(INSTALLED_MAPS_STYLE)
);

/**
 * Get config file path
 * @param {Electron.App} app
 * @returns {string}
 */
function configPath(app) {
  return path.join(app.getPath("userData"), "config.json");
}

/**
 * Read config from file
 * @param {Electron.App} app
 * @returns {object}
 */
async function readConfig(app) {
  try {
    const raw = await fs.promises.readFile(configPath(app), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Write config to file
 * @param {Electron.App} app
 * @param {object} config
 */
async function writeConfig(app, config) {
  await fs.promises.writeFile(configPath(app), JSON.stringify(config, null, 2));
}

/**
 * Prompt user to select Beat Saber root folder
 * @param {Electron.Dialog} dialog
 * @returns {Promise<string|null>}
 */
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

/**
 * Ensure CustomLevels path exists
 * @param {Electron.App} app
 * @param {Electron.Dialog} dialog
 * @param {object} options
 * @returns {Promise<string|null>}
 */
async function ensureCustomLevelsPath(app, dialog, options = {}) {
  const { forcePrompt = false } = options;
  const config = await readConfig(app);
  let root = forcePrompt ? null : config.beatSaberRoot;

  if (!root) {
    root = await promptForRoot(dialog);
    if (!root) {
      return null;
    }
  } else {
    try {
      await fs.promises.access(root);
    } catch {
      root = await promptForRoot(dialog);
      if (!root) {
        return null;
      }
    }
  }

  const levelsPath = path.join(root, "Beat Saber_Data", "CustomLevels");
  await fs.promises.mkdir(levelsPath, { recursive: true });

  config.beatSaberRoot = root;
  await writeConfig(app, config);

  return levelsPath;
}

/**
 * Format difficulty label
 * @param {string} name
 * @returns {string}
 */
function formatDifficultyLabel(name) {
  if (!name) {
    return "";
  }
  if (name === "ExpertPlus") {
    return "Expert+";
  }
  return name;
}

/**
 * Extract difficulties from info.dat data
 * @param {object} data
 * @returns {string[]}
 */
function extractDifficulties(data) {
  const sets =
    data._difficultyBeatmapSets ||
    data.difficultyBeatmapSets ||
    data._beatmapCharacteristicDatas ||
    [];
  const difficulties = [];

  for (const set of sets) {
    const diffs = set._difficultyBeatmaps || set.difficultyBeatmaps || [];
    for (const diff of diffs) {
      const name = formatDifficultyLabel(diff._difficulty || diff.difficulty);
      if (name) {
        difficulties.push(name);
      }
    }
  }

  return [...new Set(difficulties)];
}

/**
 * Get MIME type for cover image
 * @param {string} filename
 * @returns {string}
 */
function coverMimeType(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  return "application/octet-stream";
}

/**
 * Get cover image path (for lazy loading)
 * @param {string} folderPath
 * @param {string|null} coverImageFilename
 * @returns {Promise<string>}
 */
async function getCoverImagePath(folderPath, coverImageFilename) {
  const candidates = [];
  if (coverImageFilename) {
    candidates.push(coverImageFilename);
  }
  candidates.push("cover.jpg", "cover.png", "cover.jpeg", "cover.webp");

  for (const name of candidates) {
    const coverPath = path.join(folderPath, name);
    try {
      await fs.promises.access(coverPath);
      return coverPath;
    } catch {
      // Try next candidate.
    }
  }

  return "";
}

/**
 * Read cover image data as base64 data URL
 * @param {string} coverPath
 * @returns {Promise<string>}
 */
async function readCoverImageData(coverPath) {
  if (!coverPath) {
    return "";
  }
  try {
    const data = await fs.promises.readFile(coverPath);
    const mime = coverMimeType(coverPath);
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

/**
 * Read info.dat file with caching
 * @param {string} folderPath
 * @returns {Promise<object|null>}
 */
async function readInfoDat(folderPath) {
  const candidates = ["info.dat", "Info.dat"];

  for (const name of candidates) {
    const infoPath = path.join(folderPath, name);
    try {
      const stat = await fs.promises.stat(infoPath);
      const mtime = stat.mtimeMs;

      // Check cache
      const cached = infoDatCache.get(infoPath);
      if (cached && cached.mtime === mtime) {
        return cached.data;
      }

      const raw = await fs.promises.readFile(infoPath, "utf8");
      const data = JSON.parse(raw.replace(/^\uFEFF/, ""));
      const songName =
        data._songName ||
        data.songName ||
        (data.song ? data.song.songName : null) ||
        (data._song ? data._song._songName : null) ||
        (data.song ? data.song.title : null);
      const songAuthorName =
        data._songAuthorName ||
        data.songAuthorName ||
        (data.song ? data.song.songAuthorName : null) ||
        (data._song ? data._song._songAuthorName : null) ||
        (data.song ? data.song.author : null);
      const levelAuthorName =
        data._levelAuthorName ||
        data.levelAuthorName ||
        (data.song ? data.song.levelAuthorName : null) ||
        (data._song ? data._song._levelAuthorName : null) ||
        (data.song ? data.song.mapper : null);
      const beatsPerMinute =
        data._beatsPerMinute ||
        data.beatsPerMinute ||
        (data.song ? data.song.bpm : null);
      const coverImageFilename =
        data._coverImageFilename ||
        data.coverImageFilename ||
        data.coverImage ||
        (data.song ? data.song.coverImageFilename : null) ||
        (data._song ? data._song._coverImageFilename : null);
      const difficulties = extractDifficulties(data);

      const result = {
        songName: songName || null,
        songAuthorName: songAuthorName || null,
        levelAuthorName: levelAuthorName || null,
        beatsPerMinute: beatsPerMinute || null,
        coverImageFilename: coverImageFilename || null,
        difficulties,
      };

      // Store in cache
      infoDatCache.set(infoPath, { mtime, data: result });

      return result;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

/**
 * List installed maps (with lazy loading for covers)
 * @param {string} customLevelsPath
 * @returns {Promise<object[]>}
 */
async function listInstalledMaps(customLevelsPath) {
  let entries;
  try {
    entries = await fs.promises.readdir(customLevelsPath, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  const maps = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const folderName = entry.name;
    const folderPath = path.join(customLevelsPath, folderName);
    const info = await readInfoDat(folderPath);
    const coverImagePath = info
      ? await getCoverImagePath(folderPath, info.coverImageFilename)
      : "";
    maps.push({
      folderName,
      songName: info && info.songName ? info.songName : folderName,
      songAuthorName: info && info.songAuthorName ? info.songAuthorName : "",
      levelAuthorName: info && info.levelAuthorName ? info.levelAuthorName : "",
      beatsPerMinute: info && info.beatsPerMinute ? info.beatsPerMinute : null,
      difficulties: info && info.difficulties ? info.difficulties : [],
      coverImagePath, // Path instead of base64 for lazy loading
    });
  }

  maps.sort((a, b) =>
    a.songName.localeCompare(b.songName, "en", { sensitivity: "base" })
  );
  return maps;
}

/**
 * Delete installed map
 * @param {string} customLevelsPath
 * @param {string} folderName
 * @returns {Promise<boolean>}
 */
async function deleteInstalledMap(customLevelsPath, folderName) {
  if (!folderName || typeof folderName !== "string") {
    throw new Error("Invalid folder name.");
  }

  const safeName = path.basename(folderName);
  if (safeName !== folderName) {
    throw new Error("Invalid folder name.");
  }

  const targetPath = path.resolve(customLevelsPath, safeName);
  const basePath = path.resolve(customLevelsPath);
  if (!targetPath.startsWith(`${basePath}${path.sep}`)) {
    throw new Error("Invalid path.");
  }

  await fs.promises.rm(targetPath, { recursive: true, force: true });

  // Clear cache for this folder
  const infoDatPath = path.join(targetPath, "info.dat");
  const infoDatPathAlt = path.join(targetPath, "Info.dat");
  infoDatCache.delete(infoDatPath);
  infoDatCache.delete(infoDatPathAlt);

  return true;
}

/**
 * Parse playlist file
 * @param {string} filePath
 * @returns {{ title: string, hashes: string[] }}
 */
async function parsePlaylistFile(filePath) {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const data = JSON.parse(raw.replace(/^\uFEFF/, ""));
  const songs = Array.isArray(data.songs) ? data.songs : [];

  const hashes = [];
  for (const song of songs) {
    if (!song || typeof song.hash !== "string") {
      continue;
    }
    const hash = song.hash.trim().toLowerCase();
    if (HASH_REGEX.test(hash)) {
      hashes.push(hash);
    }
  }

  const title =
    typeof data.playlistTitle === "string" && data.playlistTitle.trim()
      ? data.playlistTitle.trim()
      : path.basename(filePath, path.extname(filePath));

  return { title, hashes: [...new Set(hashes)] };
}

/**
 * Download file with timeout support
 * @param {string} url
 * @param {string} destination
 * @param {function} onProgress
 * @returns {Promise<void>}
 */
function downloadFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      request.destroy();
      reject(new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS}ms`));
    }, DOWNLOAD_TIMEOUT_MS);

    const request = https.get(url, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        clearTimeout(timeoutId);
        const redirectUrl = new URL(response.headers.location, url).toString();
        response.resume();
        resolve(downloadFile(redirectUrl, destination, onProgress));
        return;
      }

      if (status !== 200) {
        clearTimeout(timeoutId);
        response.resume();
        reject(new Error(`Download failed: ${status}`));
        return;
      }

      const totalBytes = Number(response.headers["content-length"]) || 0;
      let receivedBytes = 0;
      const fileStream = fs.createWriteStream(destination);

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (onProgress) {
          onProgress(receivedBytes, totalBytes);
        }
      });

      response.on("error", (err) => {
        clearTimeout(timeoutId);
        fileStream.destroy();
        reject(err);
      });

      fileStream.on("error", (err) => {
        clearTimeout(timeoutId);
        response.destroy();
        fs.promises.unlink(destination).catch(() => {});
        reject(err);
      });

      fileStream.on("finish", () => {
        clearTimeout(timeoutId);
        fileStream.close(resolve);
      });

      response.pipe(fileStream);
    });

    request.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Generate progress update script
 * @param {number} value
 * @param {boolean} indeterminate
 * @returns {string}
 */
function progressUpdateScript(value, indeterminate) {
  const safeValue = Number.isFinite(value) ? value : -1;
  const mode = indeterminate ? "true" : "false";
  return `if (window.__bsmSetProgress) { window.__bsmSetProgress(${safeValue}, ${mode}); }`;
}

/**
 * Set window progress bar
 * @param {Electron.BrowserWindow} win
 * @param {number} value
 * @param {boolean} indeterminate
 */
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

/**
 * Download single map from playlist
 * @param {string} hash
 * @param {object} state
 * @param {object} progressState
 * @returns {Promise<{ success: boolean, hash: string, error?: Error }>}
 */
async function downloadSingleMap(hash, state, progressState) {
  const zipName = `${hash}.zip`;
  const savePath = path.join(state.customLevelsPath, zipName);
  const extractPath = path.join(state.customLevelsPath, hash);

  try {
    await fs.promises.mkdir(extractPath, { recursive: true });

    const url = `${PLAYLIST_CDN_PREFIX}/${hash}.zip`;
    await downloadFile(url, savePath, (received, total) => {
      if (total > 0) {
        progressState.bytesReceived.set(hash, received);
        progressState.bytesTotal.set(hash, total);
      }
    });

    await extractZip(savePath, { dir: extractPath });
    await fs.promises.unlink(savePath);

    return { success: true, hash };
  } catch (err) {
    await fs.promises.unlink(savePath).catch(() => {});
    try {
      const entries = await fs.promises.readdir(extractPath);
      if (entries.length === 0) {
        await fs.promises.rmdir(extractPath);
      }
    } catch {
      // Ignore cleanup errors.
    }
    return { success: false, hash, error: err };
  }
}

/**
 * Download playlist with parallel downloads
 * @param {string} playlistPath
 * @param {object} state
 * @param {Electron.BrowserWindow} win
 * @param {object} options
 * @returns {Promise<object>}
 */
async function downloadPlaylist(playlistPath, state, win, options = {}) {
  const { clearProgress = true } = options;
  const playlist = await parsePlaylistFile(playlistPath);
  const hashes = playlist.hashes;
  if (hashes.length === 0) {
    return { title: playlist.title, total: 0, completed: 0 };
  }

  const limit = pLimit(PARALLEL_DOWNLOADS);
  const progressState = {
    bytesReceived: new Map(),
    bytesTotal: new Map(),
    completed: 0,
  };

  setWindowProgress(win, 0, false);

  // Progress update interval
  const progressInterval = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(progressInterval);
      return;
    }

    let totalReceived = 0;
    let totalExpected = 0;

    for (const hash of hashes) {
      const received = progressState.bytesReceived.get(hash) || 0;
      const total = progressState.bytesTotal.get(hash) || 0;
      totalReceived += received;
      totalExpected += total;
    }

    // Calculate overall progress based on completed items and current downloads
    const completedProgress = progressState.completed / hashes.length;
    const currentProgress =
      totalExpected > 0
        ? (totalReceived / totalExpected) * (1 / hashes.length)
        : 0;
    const overall = Math.min(completedProgress + currentProgress, 1);

    setWindowProgress(win, overall, false);
  }, 100);

  const results = await Promise.all(
    hashes.map((hash) =>
      limit(async () => {
        const result = await downloadSingleMap(hash, state, progressState);
        progressState.completed += 1;
        progressState.bytesReceived.delete(hash);
        progressState.bytesTotal.delete(hash);
        return result;
      })
    )
  );

  clearInterval(progressInterval);

  const succeeded = results.filter((r) => r.success).length;
  const failed = results
    .filter((r) => !r.success)
    .map((r) => ({ hash: r.hash, error: r.error }));

  if (failed.length > 0) {
    console.warn(
      `Playlist download: ${failed.length} failed:`,
      failed.map((f) => f.hash)
    );
  }

  if (clearProgress) {
    setWindowProgress(win, -1, false);
  }

  return {
    title: playlist.title,
    total: hashes.length,
    completed: hashes.length,
    succeeded,
    failed,
  };
}

/**
 * Setup download handlers
 * @param {Electron.Session} session
 * @param {object} state
 * @param {Electron.BrowserWindow} win
 */
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

    item.on("updated", (updateEvent, downloadState) => {
      if (downloadState === "progressing") {
        updateProgressBar();
      }
    });

    item.once("done", async (doneEvent, downloadState) => {
      try {
        if (downloadState !== "completed") {
          return;
        }

        const ext = path.extname(filename).toLowerCase();
        if (ext === ".bplist") {
          try {
            await downloadPlaylist(savePath, state, win, {
              clearProgress: false,
            });
          } catch (err) {
            console.error("Playlist import failed:", err);
          } finally {
            await fs.promises.unlink(savePath).catch(() => {});
          }
          return;
        }

        if (ext !== ".zip") {
          return;
        }

        const baseName = path.basename(filename, ext);
        const extractPath = path.join(customLevelsPath, baseName);
        await fs.promises.mkdir(extractPath, { recursive: true });

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

/**
 * Inject page helper scripts
 * @param {Electron.WebContents} webContents
 */
function injectPageHelpers(webContents) {
  webContents.executeJavaScript(ONE_CLICK_CLEANER_SCRIPT, true).catch((err) => {
    console.error("Failed to inject One-Click cleaner:", err);
  });
  webContents.executeJavaScript(PROGRESS_BAR_SCRIPT, true).catch((err) => {
    console.error("Failed to inject progress bar:", err);
  });
  webContents.executeJavaScript(INSTALLED_MAPS_SCRIPT, true).catch((err) => {
    console.error("Failed to inject installed maps panel:", err);
  });
}

/**
 * Create main browser window
 * @param {typeof Electron.BrowserWindow} BrowserWindow
 * @returns {Electron.BrowserWindow}
 */
function createWindow(BrowserWindow) {
  const win = new BrowserWindow({
    width: 1319,
    height: 793,
    show: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(BEATSAVER_URL);

  const injectHelpers = () => injectPageHelpers(win.webContents);
  win.webContents.on("did-finish-load", injectHelpers);
  win.webContents.on("did-navigate-in-page", injectHelpers);

  return win;
}

/**
 * Build application menu
 * @param {typeof Electron.Menu} Menu
 * @param {Electron.App} app
 * @param {Electron.Dialog} dialog
 * @param {object} state
 * @param {Electron.BrowserWindow} win
 */
function buildMenu(Menu, app, dialog, state, win) {
  const setBeatSaberFolder = async () => {
    const newPath = await ensureCustomLevelsPath(app, dialog, {
      forcePrompt: true,
    });
    if (newPath) {
      state.customLevelsPath = newPath;
      if (!win.isDestroyed()) {
        win.webContents
          .executeJavaScript(PROGRESS_BAR_SCRIPT, true)
          .catch(() => {
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

/**
 * Main application entry point
 */
async function main() {
  if (!process.versions.electron) {
    throw new Error('Run with Electron: "npx electron ." or "npm start".');
  }

  const {
    app,
    BrowserWindow,
    Menu,
    dialog,
    session,
    ipcMain,
  } = require("electron");
  await app.whenReady();

  const state = { customLevelsPath: null };
  state.customLevelsPath = await ensureCustomLevelsPath(app, dialog);
  if (!state.customLevelsPath) {
    app.quit();
    return;
  }

  ipcMain.handle("bsm:listInstalledMaps", async () => {
    if (!state.customLevelsPath) {
      return [];
    }
    return await listInstalledMaps(state.customLevelsPath);
  });

  ipcMain.handle("bsm:deleteInstalledMap", async (event, folderName) => {
    if (!state.customLevelsPath) {
      return { ok: false, error: "CustomLevels not set." };
    }
    try {
      await deleteInstalledMap(state.customLevelsPath, folderName);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Handler for lazy loading cover images
  ipcMain.handle("bsm:getCoverImage", async (event, coverPath) => {
    if (!coverPath || typeof coverPath !== "string") {
      return "";
    }
    // Security check: ensure path is within customLevelsPath
    const resolvedPath = path.resolve(coverPath);
    const basePath = path.resolve(state.customLevelsPath);
    if (!resolvedPath.startsWith(`${basePath}${path.sep}`)) {
      return "";
    }
    return await readCoverImageData(coverPath);
  });

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
