// Self-contained dictionary mapping.
// Falls back cleanly to English verbatim strings if a translation is absent.

const ja = {};
const ko = {};
const zh = {};

const DICTIONARIES = {
  ja,
  ko,
  zh,
  "zh-TW": zh,
  "zh-CN": zh,
  "ja-JP": ja,
  "ko-KR": ko,
};

/**
 * Gets the current locale dictionary from ComfyUI settings or browser language.
 */
function dictionary() {
  let locale;
  try {
    locale = globalThis.app?.extensionManager?.setting?.get?.("Comfy.Locale");
  } catch {
    locale = null;
  }
  locale ||= (typeof navigator !== "undefined" && navigator.language) || "en";
  return DICTIONARIES[locale] ?? DICTIONARIES[locale.split("-")[0]] ?? null;
}

/**
 * Translation helper that interpolates {param} tags.
 * Falls back to the English key text if no translation entry exists.
 *
 * @param {string} text The source text / dictionary key.
 * @param {object} [params] Parameters to replace inside {slot} placeholders.
 */
export function t(text, params) {
  if (!text) return "";
  const translated = dictionary()?.[text] ?? text;
  if (!params) return translated;
  return translated.replace(/\{(\w+)\}/g, (slot, name) =>
    name in params ? String(params[name]) : slot
  );
}