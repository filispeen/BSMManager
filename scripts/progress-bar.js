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
