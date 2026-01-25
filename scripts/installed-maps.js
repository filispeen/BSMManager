(() => {
  const DEBOUNCE_DELAY = 100;
  const INSTALLED_MAPS_STYLE = `__INSTALLED_MAPS_STYLE__`;

  const ensureStyles = () => {
    if (document.getElementById("__bsmInstalledStyles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "__bsmInstalledStyles";
    style.textContent = INSTALLED_MAPS_STYLE;
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

    const sortSelect = document.createElement("select");
    sortSelect.className = "form-control";
    sortSelect.style.width = "auto";
    sortSelect.style.marginLeft = "8px";

    const sortOptionAZ = document.createElement("option");
    sortOptionAZ.value = "az";
    sortOptionAZ.textContent = "A-Z";
    sortOptionAZ.selected = true;

    const sortOptionDuration = document.createElement("option");
    sortOptionDuration.value = "duration";
    sortOptionDuration.textContent = "Duration";

    const sortOptionDate = document.createElement("option");
    sortOptionDate.value = "date";
    sortOptionDate.textContent = "Install date";

    sortSelect.appendChild(sortOptionAZ);
    sortSelect.appendChild(sortOptionDuration);
    sortSelect.appendChild(sortOptionDate);

    const invertButton = document.createElement("button");
    invertButton.className = "btn btn-primary";
    invertButton.style.marginLeft = "8px";
    invertButton.dataset.inverted = "false";
    invertButton.id = "__bsmInvertButton";

    const invertSymbol = document.createElement("i");
    invertSymbol.className = "fas fa-sort-amount-down";
    invertSymbol.setAttribute("aria-hidden", "true");

    invertButton.appendChild(invertSymbol);

    header.appendChild(title);
    header.appendChild(count);
    header.appendChild(spacer);
    actions.appendChild(refresh);
    actions.appendChild(close);
    actions.appendChild(sortSelect);
    actions.appendChild(invertButton);
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

    // Shared audio instance for all cards
    let currentAudio = null;
    let currentAudioElement = null;

    const difficultyOrderMap = new Map([
      ["Easy", 0],
      ["Normal", 1],
      ["Hard", 2],
      ["Expert", 3],
      ["Expert+", 4],
    ]);

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
        '<i class="fas fa-play"></i><div class="pie"><div class="left-size half-circle" style="transform: rotate(0deg);"></div><div class="right-size half-circle" style="display: none;"></div></div>';

      const updateProgress = () => {
        if (!currentAudio || currentAudio.paused) return;

        const progress =
          (currentAudio.currentTime / currentAudio.duration) * 100;
        const rotation = (progress / 100) * 360;

        const pie = audio.querySelector(".pie");
        const leftHalf = audio.querySelector(".left-size");
        const rightHalf = audio.querySelector(".right-size");

        if (rotation <= 180) {
          pie.style = "";
          leftHalf.style.transform = "rotate(0deg)";
          rightHalf.style.transform = `rotate(${rotation}deg)`;
        } else {
          pie.style = "clip-path: rect(0px 50px 100% 0%)";
          leftHalf.style.transform = `rotate(${rotation}deg)`;
          rightHalf.style.transform = "rotate(180deg)";
        }

        requestAnimationFrame(updateProgress);
      };

      const resetProgress = () => {
        const pie = audio.querySelector(".pie");
        const leftHalf = audio.querySelector(".left-size");
        const rightHalf = audio.querySelector(".right-size");

        pie.style.clipPath = "rect(0px, 50px, 100%, 25px)";
        leftHalf.style.transform = "rotate(0deg)";
        rightHalf.style.transform = "rotate(0deg)";
      };

      audio.onclick = (event) => {
        // Stop previous audio if playing
        if (currentAudio && currentAudioElement !== audio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudioElement.classList.remove("playing");
          const prevPie = currentAudioElement.querySelector(".pie");
          const prevLeft = currentAudioElement.querySelector(".left-size");
          const prevRight = currentAudioElement.querySelector(".right-size");
          prevPie.style.clipPath = "rect(0px, 50px, 100%, 25px)";
          prevLeft.style.transform = "rotate(0deg)";
          prevRight.style.transform = "rotate(0deg)";
        }

        audio.classList.toggle("playing");

        if (!currentAudio || currentAudioElement !== audio) {
          currentAudio = new Audio(
            `https://eu.cdn.beatsaver.com/${map.hash}.mp3`,
          );
          currentAudio.volume = 0.4;
          currentAudioElement = audio;

          currentAudio.addEventListener("ended", () => {
            audio.classList.remove("playing");
            currentAudio.currentTime = 0;
            resetProgress();
          });
        }

        if (!audio.classList.contains("playing")) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          resetProgress();
        } else {
          currentAudio.play();
          updateProgress();
        }
      };

      coverBlock.appendChild(audio);

      const cover = document.createElement("img");
      cover.className = "cover";
      cover.width = 100;
      cover.height = 100;
      cover.alt = "Cover Image";
      cover.loading = "lazy";
      if (map.coverImagePath) {
        cover.dataset.coverPath = map.coverImagePath;
        cover.style.background = "rgba(255, 255, 255, 0.08)";
        // Lazy load cover image
        const loadCover = async () => {
          if (window.bsm && typeof window.bsm.getCoverImage === "function") {
            try {
              const dataUrl = await window.bsm.getCoverImage(
                map.coverImagePath,
              );
              if (dataUrl) {
                cover.src = dataUrl;
              }
            } catch (err) {
              console.warn("Failed to load cover:", err);
            }
          }
        };
        // Use IntersectionObserver for lazy loading
        if ("IntersectionObserver" in window) {
          const observer = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  loadCover();
                  observer.unobserve(entry.target);
                }
              }
            },
            { rootMargin: "100px" },
          );
          observer.observe(cover);
        } else {
          loadCover();
        }
      } else {
        cover.style.background = "rgba(255, 255, 255, 0.08)";
      }
      coverBlock.appendChild(cover);

      /*const ratingWrap = document.createElement("div");

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
      coverBlock.appendChild(ratingWrap);*/

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
          authorLink.addEventListener("click", (event) =>
            event.preventDefault(),
          );
          authorLine.appendChild(authorLink);
        }
      }
      info.appendChild(authorLine);

      const diffs = document.createElement("div");
      diffs.className = "diffs";
      if (Array.isArray(map.difficulties) && map.difficulties.length > 0) {
        const sorted = [...map.difficulties].sort((a, b) => {
          const left = difficultyOrderMap.get(a) ?? 99;
          const right = difficultyOrderMap.get(b) ?? 99;
          return left !== right ? left - right : a.localeCompare(b);
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
        additional.appendChild(createAdditionalSpan(map.key, "fas fa-key"));
      }
      if (map.beatsPerMinute) {
        const bpmSpan = document.createElement("span");
        bpmSpan.appendChild(
          document.createTextNode(String(Math.round(map.beatsPerMinute))),
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

      const reDownloadLink = document.createElement("a");
      reDownloadLink.href = "#";
      reDownloadLink.title = "Sync";
      reDownloadLink.setAttribute("aria-label", "Re-download");

      const reDownloadText = document.createElement("span");
      reDownloadText.className = "dd-text";
      reDownloadText.textContent = "Sync";

      const reDownloadIcon = document.createElement("i");
      reDownloadIcon.className = "fas fa-cloud-download-alt text-info";
      reDownloadIcon.setAttribute("aria-hidden", "true");
      reDownloadLink.appendChild(reDownloadText);
      reDownloadLink.appendChild(reDownloadIcon);

      reDownloadLink.addEventListener("click", async (event) => {
        event.preventDefault();
        if (
          !window.bsm ||
          typeof window.bsm.deleteInstalledMap !== "function"
        ) {
          return;
        }

        reDownloadLink.style.pointerEvents = "none";
        const result = await window.bsm.reDownloadInstalledMap(map.folderName);
        if (result && result.ok) {
          beatmap.remove();
          refresh.click();
          reDownloadLink.style.pointerEvents = "";
        } else {
          console.warn("Sync failed:", result && result.error);
          reDownloadLink.style.pointerEvents = "";
        }
      });

      deleteLink.addEventListener("click", async (event) => {
        event.preventDefault();
        if (
          !window.bsm ||
          typeof window.bsm.deleteInstalledMap !== "function"
        ) {
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
      links.appendChild(reDownloadLink);

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

      const sortSelectElement = document.querySelector("select.form-control");
      const sortValue = sortSelectElement ? sortSelectElement.value : "az";
      const invertButtonElement = document.getElementById("__bsmInvertButton");
      const isInverted = invertButtonElement
        ? invertButtonElement.dataset.inverted === "true"
        : false;

      const sortMaps = (maps, sortValue, isInverted) => {
        switch (sortValue) {
          case "az":
            maps.sort((a, b) => {
              const nameA = a.songName || "";
              const nameB = b.songName || "";
              return isInverted
                ? nameB.localeCompare(nameA)
                : nameA.localeCompare(nameB);
            });
            break;
          case "duration":
            maps.sort((a, b) => {
              const durationA = a.songDuration || 0;
              const durationB = b.songDuration || 0;
              return isInverted ? durationA - durationB : durationB - durationA;
            });
            break;
          case "date":
            maps.sort((a, b) => {
              const dateA = a.installedAt || 0;
              const dateB = b.installedAt || 0;
              return isInverted ? dateA - dateB : dateB - dateA;
            });
            break;
          default:
            break;
        }
      };

      sortMaps(maps, sortValue, isInverted);

      list.textContent = "";
      for (const map of maps) {
        console.log("Rendering installed map:", map);
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

    const elems = [".nav-item", ".nav-link", ".navbar-brand"];
    elems.forEach((selector) => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((element) => {
        console.log("Adding click listener to:", element);
        if (
          element.id === "__bsmInstalledLink" ||
          element.textContent === "Installed"
        ) {
          return;
        }
        element.addEventListener("click", () => {
          close.click();
        });
      });
    });

    const sortSelectElement = document.querySelector("select.form-control");
    if (sortSelectElement) {
      sortSelectElement.addEventListener("change", () => {
        renderList();
      });
    }

    const invertButtonElement = document.getElementById("__bsmInvertButton");
    if (invertButtonElement) {
      invertButtonElement.addEventListener("click", () => {
        const isInverted = invertButtonElement.dataset.inverted === "true";
        invertButtonElement.dataset.inverted = isInverted ? "false" : "true";
        if (isInverted) {
          invertSymbol.className = "fas fa-sort-amount-down";
        } else {
          invertSymbol.className = "fas fa-sort-amount-up";
        }
        renderList();
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setVisible(false);
      }
    });

    let resizeTimeout;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        updatePanelOffset(panel, header, list);
      }, DEBOUNCE_DELAY);
    });

    return true;
  };

  if (!init()) {
    let initTimeout;
    const debouncedInit = () => {
      clearTimeout(initTimeout);
      initTimeout = setTimeout(() => {
        if (init()) {
          observer.disconnect();
        }
      }, DEBOUNCE_DELAY);
    };

    const observer = new MutationObserver(debouncedInit);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
