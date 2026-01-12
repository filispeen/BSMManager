import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import extractZip from "extract-zip";

const BEATSAVER_URL = "https://beatsaver.com";
const PLAYLIST_CDN_PREFIX = "https://r2cdn.beatsaver.com";
const HASH_REGEX = /^[a-f0-9]{40}$/i;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
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

  const removeLoginListItem = () => {
    const loginLink = document.querySelector('a[href="/login"]');
    if (!loginLink) {
      return;
    }
    const item = loginLink.closest("li");
    if (item) {
      item.remove();
    }
  };

  const cleanup = () => {
    removeOneClick();
    removeLoginListItem();
  };

  cleanup();

  const observer = new MutationObserver(cleanup);
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
const INSTALLED_MAPS_STYLE = `
#__bsmInstalledPanel {
  position: fixed;
  top: var(--bsm-nav-height, 56px);
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  color: #f5f7fa;
  z-index: 2147483646;
  display: none;
  overflow: hidden;
  padding: 16px 20px 24px;
  font-family: inherit;
}
#__bsmInstalledPanel .bsm-installed-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
#__bsmInstalledPanel .bsm-installed-title {
  font-size: 18px;
  font-weight: 600;
}
#__bsmInstalledPanel .bsm-installed-count {
  margin-left: 8px;
  opacity: 0.7;
  font-weight: 400;
}
#__bsmInstalledPanel .bsm-installed-actions {
  display: flex;
  gap: 8px;
}
#__bsmInstalledPanel .btn {
  display: inline-block;
  font-weight: 400;
  text-align: center;
  vertical-align: middle;
  cursor: pointer;
  user-select: none;
  background-color: transparent;
  border: 1px solid transparent;
  padding: 0.375rem 0.75rem;
  font-size: 0.9375rem;
  line-height: 1.5;
  border-radius: 0.25rem;
  transition: color 0.15s ease-in-out, background-color 0.15s ease-in-out,
    border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
}
#__bsmInstalledPanel .btn:hover {
  filter: brightness(1.05);
}
#__bsmInstalledPanel .btn-info {
  color: #222;
  background-color: #3498db;
  border-color: #3498db;
}
#__bsmInstalledPanel .btn-secondary {
  color: #ddd;
  background-color: #444;
  border-color: #444;
}
#__bsmInstalledPanel .bsm-list-message {
  width: 100%;
  padding: 8px 10px;
  opacity: 0.7;
}
`;
const INSTALLED_MAPS_SCRIPT = `
(() => {
  const ensureStyles = () => {
    if (document.getElementById("__bsmInstalledStyles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "__bsmInstalledStyles";
    style.textContent = ${JSON.stringify(INSTALLED_MAPS_STYLE)};
    (document.head || document.documentElement).appendChild(style);
  };

  const applyPanelBaseStyles = (panel) => {
    panel.style.position = "fixed";
    panel.style.left = "0";
    panel.style.right = "0";
    panel.style.bottom = "0";
    panel.style.background = "rgba(0, 0, 0, 0.7)";
    panel.style.color = "#f5f7fa";
    panel.style.zIndex = "2147483646";
    panel.style.overflow = "hidden";
    panel.style.padding = "16px 20px 24px";
    panel.style.fontFamily = "inherit";
  };

  const updatePanelOffset = (panel, header, list) => {
    const nav = document.querySelector("nav");
    const height = nav ? Math.round(nav.getBoundingClientRect().height) : 56;
    panel.style.setProperty("--bsm-nav-height", height + "px");
    panel.style.top = height + "px";

    if (header && list) {
      const panelHeight = window.innerHeight - height;
      const panelStyles = window.getComputedStyle(panel);
      const paddingTop = parseFloat(panelStyles.paddingTop) || 0;
      const paddingBottom = parseFloat(panelStyles.paddingBottom) || 0;
      const headerHeight = header.getBoundingClientRect().height;
      const available =
        panelHeight - paddingTop - paddingBottom - headerHeight - 8;
      list.style.maxHeight = Math.max(160, Math.floor(available)) + "px";
      list.style.overflowY = "auto";
      list.style.overflowX = "hidden";
    }
  };

  const init = () => {
    if (document.getElementById("__bsmInstalledPanel")) {
      return true;
    }

    const navList =
      document.querySelector("nav ul") ||
      document.querySelector("header nav ul") ||
      document.querySelector("ul.navbar-nav");

    if (!navList) {
      return false;
    }

    ensureStyles();

    const exampleLink = navList.querySelector("a");
    const exampleItem = exampleLink ? exampleLink.closest("li") : null;

    const li = document.createElement("li");
    if (exampleItem && exampleItem.className) {
      li.className = exampleItem.className;
    }

    const link = document.createElement("a");
    link.id = "__bsmInstalledLink";
    link.textContent = "Installed";
    link.href = "#installed";
    if (exampleLink && exampleLink.className) {
      link.className = exampleLink.className;
    }

    li.appendChild(link);
    const helpLink =
      navList.querySelector('a[href="/help"]') ||
      navList.querySelector('a[href="/help/"]') ||
      navList.querySelector('a[href^="/help"]') ||
      navList.querySelector('a[title="Help"]');
    let helpItem = helpLink ? helpLink.closest("li") : null;
    if (!helpItem) {
      const candidates = navList.querySelectorAll("a");
      for (const candidate of candidates) {
        const label = candidate.textContent
          ? candidate.textContent.trim().toLowerCase()
          : "";
        if (label.startsWith("help")) {
          helpItem = candidate.closest("li");
          break;
        }
      }
    }
    if (helpItem && helpItem.parentNode === navList) {
      navList.insertBefore(li, helpItem);
    } else {
      navList.appendChild(li);
    }

    const panel = document.createElement("div");
    panel.id = "__bsmInstalledPanel";
    applyPanelBaseStyles(panel);
    updatePanelOffset(panel);

    const header = document.createElement("div");
    header.className = "bsm-installed-header";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "12px";
    header.style.marginBottom = "12px";

    const title = document.createElement("div");
    title.className = "bsm-installed-title";

    const titleText = document.createElement("span");
    titleText.textContent = "Installed Maps";

    const count = document.createElement("span");
    count.id = "__bsmInstalledCount";
    count.className = "bsm-installed-count";
    count.textContent = "0";

    title.appendChild(titleText);
    title.appendChild(count);

    const spacer = document.createElement("div");
    spacer.style.flex = "1";

    const actions = document.createElement("div");
    actions.className = "bsm-installed-actions";
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const refresh = document.createElement("button");
    refresh.textContent = "Refresh";
    refresh.className = "btn btn-info";

    const close = document.createElement("button");
    close.textContent = "Close";
    close.className = "btn btn-secondary";

    header.appendChild(title);
    header.appendChild(count);
    header.appendChild(spacer);
    actions.appendChild(refresh);
    actions.appendChild(close);
    header.appendChild(actions);

    const list = document.createElement("div");
    list.id = "__bsmInstalledList";
    list.className = "search-results";

    panel.appendChild(header);
    panel.appendChild(list);
    document.body.appendChild(panel);

    let isVisible = false;
    const setVisible = (visible) => {
      isVisible = visible;
      panel.style.display = visible ? "block" : "none";
    };
    setVisible(false);

    const createBadge = (label) => {
      const diffClasses = {
        Easy: "badge-success",
        Normal: "badge-info",
        Hard: "badge-warning",
        Expert: "badge-danger",
        "Expert+": "badge-purple",
      };
      const badge = document.createElement("span");
      const diffClass = diffClasses[label] || "badge-secondary";
      badge.className = "badge rounded-pill " + diffClass;

      const modeIcon = document.createElement("img");
      modeIcon.alt = "Standard";
      modeIcon.className = "mode";
      modeIcon.title = label + " Standard";
      modeIcon.width = 16;
      modeIcon.height = 16;
      modeIcon.src = "/static/icons/standard.svg";
      badge.appendChild(modeIcon);
      badge.appendChild(document.createTextNode(label));
      return badge;
    };

    const createAdditionalSpan = (label, iconClass) => {
      const span = document.createElement("span");
      span.appendChild(document.createTextNode(label));
      if (iconClass) {
        const icon = document.createElement("i");
        icon.className = iconClass;
        icon.setAttribute("aria-hidden", "true");
        span.appendChild(icon);
      }
      return span;
    };

    const setListMessage = (message) => {
      list.textContent = "";
      const msg = document.createElement("div");
      msg.className = "bsm-list-message";
      msg.textContent = message;
      list.appendChild(msg);
    };

    const createBeatmapCard = (map) => {
      const beatmap = document.createElement("div");
      beatmap.className = "beatmap";

      const card = document.createElement("div");
      card.className = "card colored";

      const color = document.createElement("div");
      color.className = "color";
      color.title = "";

      const content = document.createElement("div");
      content.className = "content";

      const coverBlock = document.createElement("div");
      const audio = document.createElement("div");
      audio.className = "audio-progress";
      audio.innerHTML =
        '<i class="fas fa-play"></i><div class="pie"><div class="left-size half-circle"></div><div class="right-size half-circle"></div></div>';
      coverBlock.appendChild(audio);

      const cover = document.createElement("img");
      cover.className = "cover";
      cover.width = 100;
      cover.height = 100;
      cover.alt = "Cover Image";
      cover.loading = "lazy";
      if (map.coverImage) {
        cover.src = map.coverImage;
      } else {
        cover.style.background = "rgba(255, 255, 255, 0.08)";
      }
      coverBlock.appendChild(cover);

      const ratingWrap = document.createElement("div");

      const vote = document.createElement("small");
      vote.className = "text-center vote";

      const up = document.createElement("div");
      up.className = "u";
      up.style.flex = "0 1 0%";

      const mid = document.createElement("div");
      mid.className = "o";
      mid.style.flex = "1 1 0%";

      const down = document.createElement("div");
      down.className = "d";
      down.style.flex = "0 1 0%";

      vote.appendChild(up);
      vote.appendChild(mid);
      vote.appendChild(down);

      const percentage = document.createElement("div");
      percentage.className = "percentage";
      percentage.textContent = "50%";
      percentage.title = "0/0";

      ratingWrap.appendChild(vote);
      ratingWrap.appendChild(percentage);
      coverBlock.appendChild(ratingWrap);

      const info = document.createElement("div");
      info.className = "info";

      const titleLink = document.createElement("a");
      titleLink.href = "#";
      titleLink.textContent = map.songName || map.folderName || "Unknown";
      titleLink.addEventListener("click", (event) => event.preventDefault());
      info.appendChild(titleLink);

      const authorLine = document.createElement("p");
      const authorParts = [];
      if (map.songAuthorName) {
        authorParts.push(map.songAuthorName);
      }
      if (map.levelAuthorName) {
        authorParts.push(map.levelAuthorName);
      }
      if (authorParts.length === 0) {
        authorLine.textContent = "Unknown";
      } else {
        for (const [index, name] of authorParts.entries()) {
          if (index > 0) {
            authorLine.appendChild(document.createTextNode(", "));
          }
          const authorLink = document.createElement("a");
          authorLink.href = "#";
          authorLink.textContent = name;
          authorLink.addEventListener("click", (event) => event.preventDefault());
          authorLine.appendChild(authorLink);
        }
      }
      info.appendChild(authorLine);

      const diffs = document.createElement("div");
      diffs.className = "diffs";
      if (Array.isArray(map.difficulties) && map.difficulties.length > 0) {
        const order = {
          Easy: 0,
          Normal: 1,
          Hard: 2,
          Expert: 3,
          "Expert+": 4,
        };
        const sorted = [...map.difficulties].sort((a, b) => {
          const left = order[a] ?? 99;
          const right = order[b] ?? 99;
          if (left !== right) {
            return left - right;
          }
          return a.localeCompare(b);
        });
        for (const diff of sorted) {
          diffs.appendChild(createBadge(diff));
        }
      }
      info.appendChild(diffs);

      const ranked = document.createElement("div");
      ranked.className = "ranked-statuses";
      info.appendChild(ranked);

      const additional = document.createElement("div");
      additional.className = "additional";
      if (map.folderName) {
        additional.appendChild(createAdditionalSpan(map.folderName, "fas fa-key"));
      }
      if (map.beatsPerMinute) {
        const bpmSpan = document.createElement("span");
        bpmSpan.appendChild(
          document.createTextNode(String(Math.round(map.beatsPerMinute)))
        );
        const bpmIcon = document.createElement("img");
        bpmIcon.alt = "Metronome";
        bpmIcon.width = 12;
        bpmIcon.height = 12;
        bpmIcon.src = "/static/icons/metronome.svg";
        bpmSpan.appendChild(bpmIcon);
        additional.appendChild(bpmSpan);
      }

      const links = document.createElement("div");
      links.className = "links";

      const deleteLink = document.createElement("a");
      deleteLink.href = "#";
      deleteLink.title = "Delete";
      deleteLink.setAttribute("aria-label", "Delete");

      const deleteText = document.createElement("span");
      deleteText.className = "dd-text";
      deleteText.textContent = "Delete";

      const deleteIcon = document.createElement("i");
      deleteIcon.className = "fas fa-trash text-danger";
      deleteIcon.setAttribute("aria-hidden", "true");

      deleteLink.appendChild(deleteText);
      deleteLink.appendChild(deleteIcon);

      deleteLink.addEventListener("click", async (event) => {
        event.preventDefault();
        if (!window.bsm || typeof window.bsm.deleteInstalledMap !== "function") {
          return;
        }
        const name = map.songName || map.folderName || "this map";
        if (!window.confirm('Delete "' + name + '"?')) {
          return;
        }
        deleteLink.style.pointerEvents = "none";
        const result = await window.bsm.deleteInstalledMap(map.folderName);
        if (result && result.ok) {
          beatmap.remove();
          const current = Number(count.textContent) || 0;
          const next = Math.max(0, current - 1);
          count.textContent = String(next);
          if (next === 0) {
            setListMessage("No installed maps found.");
          }
        } else {
          console.warn("Delete failed:", result && result.error);
          deleteLink.style.pointerEvents = "";
        }
      });

      links.appendChild(deleteLink);

      content.appendChild(coverBlock);
      content.appendChild(info);
      content.appendChild(additional);
      content.appendChild(links);

      card.appendChild(color);
      card.appendChild(content);
      beatmap.appendChild(card);
      return beatmap;
    };

    const renderList = async () => {
      setListMessage("Loading...");
      count.textContent = "0";
      if (!window.bsm || typeof window.bsm.getInstalledMaps !== "function") {
        setListMessage("List is unavailable.");
        return;
      }
      let maps = [];
      try {
        maps = await window.bsm.getInstalledMaps();
      } catch (err) {
        setListMessage("Failed to load list.");
        return;
      }
      if (!Array.isArray(maps) || maps.length === 0) {
        setListMessage("No installed maps found.");
        return;
      }
      count.textContent = String(maps.length);

      list.textContent = "";
      for (const map of maps) {
        list.appendChild(createBeatmapCard(map));
      }
    };

    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (isVisible) {
        setVisible(false);
        return;
      }
      setVisible(true);
      updatePanelOffset(panel, header, list);
      renderList();
    });

    refresh.addEventListener("click", () => {
      renderList();
    });

    close.addEventListener("click", () => {
      setVisible(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setVisible(false);
      }
    });

    window.addEventListener("resize", () => {
      updatePanelOffset(panel, header, list);
    });

    return true;
  };

  if (!init()) {
    const observer = new MutationObserver(() => {
      if (init()) {
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
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

function formatDifficultyLabel(name) {
  if (!name) {
    return "";
  }
  if (name === "ExpertPlus") {
    return "Expert+";
  }
  return name;
}

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

async function readCoverImageData(folderPath, coverImageFilename) {
  const candidates = [];
  if (coverImageFilename) {
    candidates.push(coverImageFilename);
  }
  candidates.push("cover.jpg", "cover.png", "cover.jpeg", "cover.webp");

  for (const name of candidates) {
    const coverPath = path.join(folderPath, name);
    try {
      const data = await fs.promises.readFile(coverPath);
      const mime = coverMimeType(name);
      return `data:${mime};base64,${data.toString("base64")}`;
    } catch {
      // Try next candidate.
    }
  }

  return "";
}

async function readInfoDat(folderPath) {
  const candidates = ["info.dat", "Info.dat"];
  for (const name of candidates) {
    const infoPath = path.join(folderPath, name);
    try {
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

      return {
        songName: songName || null,
        songAuthorName: songAuthorName || null,
        levelAuthorName: levelAuthorName || null,
        beatsPerMinute: beatsPerMinute || null,
        coverImageFilename: coverImageFilename || null,
        difficulties,
      };
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

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
    const coverImage = info
      ? await readCoverImageData(folderPath, info.coverImageFilename)
      : "";
    maps.push({
      folderName,
      songName: info && info.songName ? info.songName : folderName,
      songAuthorName: info && info.songAuthorName ? info.songAuthorName : "",
      levelAuthorName: info && info.levelAuthorName ? info.levelAuthorName : "",
      beatsPerMinute: info && info.beatsPerMinute ? info.beatsPerMinute : null,
      difficulties: info && info.difficulties ? info.difficulties : [],
      coverImage,
    });
  }

  maps.sort((a, b) =>
    a.songName.localeCompare(b.songName, "en", { sensitivity: "base" })
  );
  return maps;
}

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
  return true;
}

function parsePlaylistFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const data = JSON.parse(raw);
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

function downloadFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, url).toString();
        response.resume();
        resolve(downloadFile(redirectUrl, destination, onProgress));
        return;
      }

      if (status !== 200) {
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
        fileStream.destroy();
        reject(err);
      });

      fileStream.on("error", (err) => {
        response.destroy();
        fs.promises.unlink(destination).catch(() => {});
        reject(err);
      });

      fileStream.on("finish", () => {
        fileStream.close(resolve);
      });

      response.pipe(fileStream);
    });

    request.on("error", reject);
  });
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

async function downloadPlaylist(playlistPath, state, win, options = {}) {
  const { clearProgress = true } = options;
  const playlist = parsePlaylistFile(playlistPath);
  const hashes = playlist.hashes;
  if (hashes.length === 0) {
    return { title: playlist.title, total: 0, completed: 0 };
  }

  let completed = 0;
  let succeeded = 0;
  const failed = [];
  setWindowProgress(win, 0, false);

  for (const hash of hashes) {
    const zipName = `${hash}.zip`;
    const savePath = path.join(state.customLevelsPath, zipName);
    const extractPath = path.join(state.customLevelsPath, hash);
    fs.mkdirSync(extractPath, { recursive: true });

    try {
      const url = `${PLAYLIST_CDN_PREFIX}/${hash}.zip`;
      await downloadFile(url, savePath, (received, total) => {
        if (total > 0) {
          const overall = (completed + received / total) / hashes.length;
          setWindowProgress(win, overall, false);
          return;
        }
        setWindowProgress(win, 1, true);
      });

      await extractZip(savePath, { dir: extractPath });
      await fs.promises.unlink(savePath);
      succeeded += 1;
    } catch (err) {
      failed.push({ hash, error: err });
      console.warn(`Playlist download failed for ${hash}:`, err);
      await fs.promises.unlink(savePath).catch(() => {});
      try {
        const entries = await fs.promises.readdir(extractPath);
        if (entries.length === 0) {
          await fs.promises.rmdir(extractPath);
        }
      } catch {
        // Ignore cleanup errors.
      }
    } finally {
      completed += 1;
      setWindowProgress(win, completed / hashes.length, false);
    }
  }

  if (clearProgress) {
    setWindowProgress(win, -1, false);
  }
  return {
    title: playlist.title,
    total: hashes.length,
    completed,
    succeeded,
    failed,
  };
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
  webContents.executeJavaScript(INSTALLED_MAPS_SCRIPT, true).catch((err) => {
    console.error("Failed to inject installed maps panel:", err);
  });
}

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

async function loadElectron() {
  if (!process.versions.electron) {
    throw new Error('Run with Electron: "npx electron ." or "npm start".');
  }

  return await import("electron");
}

async function main() {
  const { app, BrowserWindow, Menu, dialog, session, ipcMain } =
    await loadElectron();
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
