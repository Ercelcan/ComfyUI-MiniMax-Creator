export function stopAllMediaGlobally(except = null) {
  try {
    document.querySelectorAll("video, audio").forEach((m) => {
      if (m !== except) {
        try {
          m.muted = true;
          m.pause();
          if (m.src) {
            m.currentTime = 0;
          }
        } catch {}
      }
    });
  } catch {}
}

export function registerGlobalMediaHandler() {
  if (globalThis.__mmc_media_handler_installed) return;
  globalThis.__mmc_media_handler_installed = true;

  document.addEventListener("play", (event) => {
    const target = event.target;
    if (target && (target.tagName === "VIDEO" || target.tagName === "AUDIO")) {
      stopAllMediaGlobally(target);
    }
  }, true);
}

registerGlobalMediaHandler();

export function formatTimecode(seconds, fps = 24) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  const frames = Math.floor((seconds % 1) * fps);
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return {
    timecode: `${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`,
    framesText: `F${frames}`,
    display: `${pad(mins)}:${pad(secs)}.${pad(ms, 3)} / F${frames}`,
  };
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const rest = seconds - mins * 60;
  return `${mins}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("aria-") && typeof value === "boolean") {
      node.setAttribute(key, String(value));
      continue;
    }
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key === "value" && ("value" in node)) node.value = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function drawFrame(canvas, video, maxHeight = 720) {
  if (!canvas || !video?.videoWidth) return;
  const scale = Math.min(1, maxHeight / video.videoHeight);
  const width = Math.max(2, Math.round(video.videoWidth * scale));
  const height = Math.max(2, Math.round(video.videoHeight * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.getContext("2d").drawImage(video, 0, 0, width, height);
}

export function svg(paths, size = 22) {
  const holder = document.createElement("span");
  holder.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="display:inline-block;vertical-align:middle;">${paths}</svg>`;
  return holder.firstElementChild;
}

export const ICONS = {
  image: `<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>`,
  video: `<rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="M16 10.5L22 7v10l-6-3.5z"/>`,
  audio: `<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/>`,
  music: `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
  effect: `<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/>`,
  frameIn: `<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 12h8M12 8v8"/>`,
  frameOut: `<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 12h8"/>`,
  model: `<circle cx="12" cy="12" r="9"/><path d="M12 7a5 5 0 015 5 3 3 0 01-3 3h-1.5a1.5 1.5 0 000 3H12a8 8 0 110-11z"/>`,
  weights: `<path d="M12 3l8 4.2-8 4.2-8-4.2z"/><path d="M4 12l8 4.2 8-4.2"/><path d="M4 16.6l8 4.2 8-4.2"/>`,
  res: `<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/>`,
  play: `<path d="M8 5.5l11 6.5-11 6.5z"/>`,
  pause: `<path d="M8 5v14M16 5v14"/>`,
  scissors: `<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><path d="M8 7.4L20 18M8 16.6L20 6"/>`,
  dice: `<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2"/><circle cx="15.5" cy="15.5" r="1.2"/><circle cx="12" cy="12" r="1.2"/>`,
  sliders: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`,
  link: `<path d="M9 12h6"/><path d="M11 8H8a4 4 0 000 8h3M13 8h3a4 4 0 010 8h-3"/>`,
  steps: `<path d="M4 19h4v-5h4V9h4V4h4"/>`,
  bolt: `<path d="M13 2L4.5 13.5H11L9.5 22 19.5 10H13z"/>`,
  timeline: `<path d="M3 12h18"/><rect x="3" y="8" width="7" height="8" rx="2"/><rect x="13" y="8" width="8" height="8" rx="2"/>`,
  brain: `<path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>`,
  chevron: `<path d="M6 9l6 6 6-6"/>`,
  star: `<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.9z"/>`,
  folder: `<path d="M3 7.5A2.5 2.5 0 015.5 5h3.8l2 2.2h7.2A2.5 2.5 0 0121 9.7v6.8a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 16.5z"/>`,
  gallery: `<rect x="3" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8"/>`,
  gear: `<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>`,
  camera: `<path d="M14.5 4h-5L7.5 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3.5l-2-3z"/><circle cx="12" cy="13" r="3"/>`,
  magic: `<path d="M15 4l-2 3 2 3-3-2-3 2 2-3-2-3 3 2zM6 10l-1.5 2 1.5 2-2-1.5-2 1.5 1.5-2-1.5-2 2 1.5zM20 18l-1 1.5 1 1.5-1.5-1-1.5 1 1-1.5-1-1.5 1.5 1z"/>`,
  skipStart: `<path d="M6 5v14M18 5l-9 7 9 7V5z"/>`,
  stepBack: `<path d="M15 6l-6 6 6 6"/>`,
  stepForward: `<path d="M9 6l6 6-6 6"/>`,
  skipEnd: `<path d="M18 5v14M6 5l9 7-9 7V5z"/>`,
  markIn: `<path d="M8 5v14M8 5h6M8 19h6"/>`,
  markOut: `<path d="M16 5v14M16 5h-6M16 19h-6"/>`,
  magnet: `<path d="M6 4v7a6 6 0 0012 0V4M6 8h4M14 8h4"/>`,
  razor: `<path d="M4 4l16 16M9 4l11 11M4 9l11 11"/>`,
  lock: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>`,
  unlock: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>`,
  edit: `<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
  trash: `<path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>`,
  loop: `<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 01-4 4H3"/>`,
  volume: `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/>`,
  volumeMute: `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`,
  download: `<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>`,
  broom: `<path d="M3 21l8-8M14 4l6 6-7 7-6-6 7-7zM18 10l2 2M15 7l2 2"/>`,
};

export function icon(name, size = 22) {
  return svg(ICONS[name] || ICONS.camera, size);
}

export function floatAbove(node) {
  node.style.zIndex = String(1400 + document.querySelectorAll(".mmc-overlay").length * 10 + 5);
}

export function dismissable(node, onClose) {
  floatAbove(node);
  const away = (event) => {
    if (!node.contains(event.target)) close();
  };
  const key = (event) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
  };
  function close() {
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", key, true);
    node.remove();
    onClose?.();
  }
  setTimeout(() => {
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
  }, 0);
  return close;
}

export function mountOverlay(overlay, onEscape) {
  overlay.style.zIndex = String(1400 + document.querySelectorAll(".mmc-overlay").length * 10);
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    const open = document.querySelectorAll(".mmc-overlay");
    if (open[open.length - 1] !== overlay) return;
    event.stopPropagation();
    onEscape();
  };
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  return () => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
}

export function placeNear(popover, anchor, { above = true } = {}) {
  let lastLeft = null;
  let lastTop = null;
  const getAnchor = typeof anchor === "function" ? anchor : () => anchor;

  const place = () => {
    const target = getAnchor();
    if (!target || !target.isConnected) {
      if (lastLeft !== null && lastTop !== null) {
        popover.style.left = `${lastLeft}px`;
        popover.style.top = `${lastTop}px`;
      }
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      if (lastLeft !== null && lastTop !== null) {
        popover.style.left = `${lastLeft}px`;
        popover.style.top = `${lastTop}px`;
      }
      return;
    }
    const box = popover.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8));
    const top = above && rect.top - box.height - 8 > 8
      ? rect.top - box.height - 8
      : Math.min(rect.bottom + 8, window.innerHeight - box.height - 8);
    lastLeft = left;
    lastTop = Math.max(8, top);
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(8, top)}px`;
  };
  place();
  const observer = new ResizeObserver(() => {
    if (!popover.isConnected) { observer.disconnect(); return; }
    place();
  });
  observer.observe(popover);
}