import { upload } from "./api.js";
import * as S from "./state.js";

/** Detect whether a dropped or pasted file is an image, video, or audio. */
export function detectKind(file) {
  if (!file) return null;
  const type = file.type || "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  const ext = (file.name || "").split(".").pop().toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "jxl"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext)) return "audio";
  return null;
}

/** Upload media files to ComfyUI input and attach them contextually. */
export async function handleMediaFiles(files, targetContext) {
  if (!files?.length || !targetContext) return;
  const validFiles = [];
  for (const file of files) {
    const kind = detectKind(file);
    if (kind) validFiles.push({ file, kind });
  }
  if (!validFiles.length) return;

  const uploaded = [];
  for (const { file, kind } of validFiles) {
    try {
      const res = await upload(file);
      uploaded.push({ path: res.path, name: res.name, kind });
    } catch (err) {
      console.error("[MiniMax Creator] Upload failed:", err);
    }
  }
  if (!uploaded.length) return;

  // 1. Dropped on Director Node chat
  if (typeof targetContext.sendMessage === "function") {
    for (const item of uploaded) {
      const target = targetContext.getTargetNode?.();
      if (target?.mmcBody) {
        const handle = target.mmcBody.attachPoolFromMention?.(item);
        if (handle) {
          targetContext.inputBox.value = (targetContext.inputBox.value || "") + ` @${handle} `;
          targetContext.flashNotice?.(`Attached @${handle} to project.`);
        }
      }
    }
    return;
  }

  // 2. Dropped on Timeline Studio
  if (typeof targetContext.handleTimelineTrackDrop === "function") {
    for (const item of uploaded) {
      targetContext.handleTimelineTrackDrop(item);
    }
    return;
  }

  // 3. Dropped on CreatorEditor instance
  if (typeof targetContext.attachAssets === "function") {
    await targetContext.attachAssets(uploaded);
  } else if (typeof targetContext.attachPoolFromMention === "function") {
    for (const asset of uploaded) {
      targetContext.attachPoolFromMention(asset);
    }
  } else if (targetContext.state?.refs && Array.isArray(targetContext.state.refs)) {
    for (const asset of uploaded) {
      if (asset.kind === "image") {
        targetContext.state.refs.push({
          handle: S.nextPreStageHandle(targetContext.state),
          filename: asset.path,
        });
      }
    }
    targetContext.commit?.();
  }
}

/** Attach Drag & Drop listeners to a node's DOM root element. */
export function setupDragAndDrop(root, editor) {
  if (!root || !editor) return;
  let dragCounter = 0;

  root.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragCounter++;
    root.classList.add("mmc-drag-drop-active");
  });

  root.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  root.addEventListener("dragleave", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      root.classList.remove("mmc-drag-drop-active");
    }
  });

  root.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    root.classList.remove("mmc-drag-drop-active");
    const files = Array.from(e.dataTransfer.files);
    await handleMediaFiles(files, editor);
  });
}