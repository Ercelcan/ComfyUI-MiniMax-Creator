import { css as base } from "./styles/base.js";
import { css as stage } from "./styles/stage.js";
import { css as editor } from "./styles/editor.js";
import { css as popovers } from "./styles/popovers.js";
import { css as picker } from "./styles/picker.js";
import { css as loras } from "./styles/loras.js";
import { css as overlays } from "./styles/overlays.js";
import { css as settings } from "./styles/settings.js";
import { css as timeline } from "./styles/timeline.js";
import { css as refine } from "./styles/refine.js";
import { css as prestage } from "./styles/prestage.js";
import { css as director } from "./styles/director.js";

const CSS = [
  base,
  stage,
  editor,
  popovers,
  picker,
  loras,
  overlays,
  settings,
  timeline,
  refine,
  prestage,
  director,
].join("");

export function installStyles() {
  if (document.getElementById("mmc-styles")) return;
  const tag = document.createElement("style");
  tag.id = "mmc-styles";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}