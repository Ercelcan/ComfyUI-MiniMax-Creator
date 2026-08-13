// The turbo switch: one pill that throws an H3 distillation LoRA onto the run.
//
// Thrown on, it does three things at once — adds the chosen LoRA to the
// ordinary stack, saves the sampler row and re-sets it to what the turbo LoRAs
// were tuned against (euler + beta; H3's joint audio warbles on res_multistep
// at these step counts), and drops the steps to the picked quality. Thrown off,
// it removes the entry and puts the row back exactly as it stood.
//
// The LoRA itself is a normal entry the whole way: the manager's card, the
// chip's ✕ and the strength slider all work on it, which is the point — the
// switch is a shortcut into the stack, not a second stack. `sync` is the other
// half of that bargain: when the entry is removed or disabled anywhere else,
// the switch notices on the next commit and gives the sampler row back.

import { el, icon } from "./dom.js";
import { openChoicePopover } from "./pills.js";
import { listLoras } from "./api.js";
import * as S from "./state.js";
import { t } from "./i18n.js";

// The LoRA names, for the two pickers here. The manager's listing carries
// cards and sidecars; a choice popover only needs the names.
let names = null;

export function loadLoraNames(onReady) {
  if (names) { onReady?.(); return; }
  listLoras({ folder: "" }).then((body) => {
    names = (body.loras ?? []).map((row) => row.name);
    onReady?.();
  }).catch(() => { names = []; });
}

export const loraNames = () => names ?? [];

/** Whether a filename says it is a distillation LoRA. Every released H3 family
 *  does — "turbo" in larryvrh's, lightx2v's and Kijai's names alike — so the
 *  picker leads with these and keeps the character LoRAs out of the way. */
const looksTurbo = (name) => /turbo|distill/i.test(name);

const SHOW_ALL = "— show all —";

/** The lora-less choice: some turbo checkpoints ship with the distillation
 *  merged into the weights, and those want the step drop with no LoRA at all. */
export const NO_LORA = "— no LoRA · merged checkpoint —";

/**
 * The turbo file list, filtered to names that say turbo, with the full folder
 * one press away. A wrongly-named distill is reachable, not hidden — and when
 * nothing matches the filter at all, the full list is what opens.
 */
function openTurboChoice(anchor, { value, onPick, includeNone = false, all = false }) {
  const matched = loraNames().filter(looksTurbo);
  const showAll = all || !matched.length;
  const listed = showAll ? loraNames() : matched;
  openChoicePopover(anchor, {
    title: showAll ? t("Turbo LoRA — all files") : t("Turbo LoRA"),
    options: [
      ...(includeNone ? [typeof includeNone === "string" ? t(includeNone) : t("— none —")] : []),
      ...listed,
      // Only when it would add something: a filter that matched everything has
      // nothing more to show.
      ...(showAll || matched.length === loraNames().length ? [] : [t(SHOW_ALL)]),
    ],
    value,
    onPick: (picked) => {
      if (picked === t(SHOW_ALL)) {
        openTurboChoice(anchor, { value, onPick, includeNone, all: true });
        return;
      }
      onPick(picked);
    },
  });
}

/** The entry the switch owns, if it is in the stack at all. */
const entryOf = (container) => (container.turbo?.lora ? S.findLora(container, container.turbo.lora) : null);

/** Engaged means present *and* enabled: the manager's quick-disable counts as
 *  switching off, because that is what it is for.
 *
 *  With no file chosen there is nothing to reconcile against — that is the
 *  merged-checkpoint mode, where the distillation is baked into the weights
 *  the user picked and the switch only owns the sampler row. */
const engaged = (container) => {
  if (!container.turbo?.lora) return true;
  const entry = entryOf(container);
  return !!entry && entry.enabled !== false && Math.round((Number(entry.strength) || 0) * 100) !== 0;
};

/** Widget IO, as the editor and the timeline body both provide it:
 *  `value(name, fallback)` and `set(name, value)` over the real ComfyUI widgets. */

function throwOn(container, { value, set }) {
  const turbo = container.turbo;
  // No file is the merged-checkpoint mode: the distillation is already in the
  // weights, so the switch touches nothing but the sampler row.
  if (turbo.lora) {
    const entry = entryOf(container);
    if (entry) {
      entry.enabled = true;
      if (Math.round((Number(entry.strength) || 0) * 100) === 0) entry.strength = S.turboStrength(turbo.lora);
    } else {
      const added = S.addLora(container, turbo.lora, []);
      if (added) added.strength = S.turboStrength(turbo.lora);
    }
  }
  // Saved once per throw, not per quality change: the row being remembered is
  // the pre-turbo one, and draft → good in between should not overwrite it.
  if (!turbo.on) {
    turbo.saved = {
      steps: Number(value("steps", S.TURBO_RESET.steps)),
      sampler_name: String(value("sampler_name", S.TURBO_RESET.sampler_name)),
      scheduler: String(value("scheduler", S.TURBO_RESET.scheduler)),
    };
  }
  turbo.on = true;
  set("steps", S.TURBO_STEPS[turbo.quality] ?? S.TURBO_STEPS.medium);
  set("sampler_name", S.TURBO_SAMPLER);
  set("scheduler", S.TURBO_SCHEDULER);
}

function throwOff(container, { set }, { removeEntry = true } = {}) {
  const turbo = container.turbo;
  if (removeEntry && turbo.lora) S.removeLora(container, turbo.lora);
  const saved = turbo.saved ?? S.TURBO_RESET;
  set("steps", saved.steps);
  set("sampler_name", saved.sampler_name);
  set("scheduler", saved.scheduler);
  turbo.on = false;
  turbo.saved = null;
}

/**
 * Reconcile the switch with the stack, on every commit.
 *
 * The entry can leave the stack without the pill being touched — the chip's ✕,
 * the manager's card, a strength dragged to zero — and each of those means
 * "turbo off", so the sampler row has to come back too. The one asymmetry: an
 * entry re-enabled by hand does not throw the switch, because nothing was saved
 * and silently rewriting the steps under someone editing a card is worse than
 * leaving the pill for them to press.
 */
export function sync(container, widgetIO) {
  if (container.turbo?.on && !engaged(container)) {
    throwOff(container, widgetIO, { removeEntry: false });
    return true;
  }
  return false;
}

/** Swap which file the switch reaches for — from the weights popover. Engaged,
 *  the entries swap with it so the run never carries both distills at once.
 *  Swapping to *none* keeps the switch thrown: that is the statement "my
 *  checkpoint is already distilled", not "slow back down". */
export function setTurboLora(container, name, widgetIO) {
  const turbo = container.turbo;
  const was = turbo.lora;
  if (name === was) return;
  turbo.lora = name;
  if (!turbo.on) return;
  if (was) S.removeLora(container, was);
  if (name) throwOn(container, widgetIO);
}

const QUALITY_TITLE = {
  draft: "4 steps — the fast look. Softer detail; heavy motion can smear.",
  medium: "6 steps — the comfort zone the turbo LoRAs were tuned for.",
  good: "8 steps — about as close to a native 20-step render as a distill gets. "
      + "Past 8 they over-sharpen rather than improve.",
};

/**
 * The switch and, while it is on, the quality stops. Drawn on the sampler row
 * with the other accelerators, because that is what it is — and lit the same
 * way, because a render with it on is not a native render.
 *
 * @param {object} spec
 * @param {object} spec.container   a state or a timeline: `.loras`, `.turbo`
 * @param {(name, fallback) => any} spec.value
 * @param {(name, value) => void} spec.set
 * @param {() => void} spec.onCommit  serialize the container after a change
 */
export function turboPills({ container, value, set, onCommit }) {
  const turbo = container.turbo;
  const on = turbo.on && engaged(container);
  const short = (name) => name.split("/").pop().replace(/\.[^.]+$/, "");
  const pills = [];

  // So the first press has a list to offer rather than a spinner: cached after
  // the first fetch, and only started at all while no file is picked yet.
  if (!turbo.lora) loadLoraNames();

  pills.push(el("div", { class: `mmc-pill mmc-pill-group${on ? " accel-on" : ""}` }, [
    el("button", {
      class: "mmc-turbo-main",
      title: on
        ? turbo.lora
          ? t("Turbo — running on {lora} at {steps} steps, euler + beta. "
            + "Switching off removes the LoRA and puts the sampler row back.",
            { lora: turbo.lora, steps: value("steps", "?") })
          : t("Turbo — {steps} steps, euler + beta, no LoRA: the checkpoint is "
            + "taken to be a merged distill. Switching off puts the sampler row back.",
            { steps: value("steps", "?") })
        : turbo.lora
          ? t("Turbo off. On, it adds {lora}, drops the steps to the picked quality and "
            + "switches the sampler to euler + beta — H3's soundtrack warbles on "
            + "res_multistep at turbo step counts.", { lora: turbo.lora })
          : t("Turbo off. The first press picks which distillation LoRA it engages — or none, "
            + "for a checkpoint with the distillation already merged in."),
      onclick: (event) => {
        if (turbo.on) {
          throwOff(container, { value, set });
          onCommit();
        } else if (turbo.lora || turbo.merged) {
          throwOn(container, { value, set });
          onCommit();
        } else {
          // No file picked yet: the first press is the picking. Engaging on the
          // spot rather than sending anyone to the weights popover — the pill
          // was pressed to go faster, not to configure something. "No LoRA" is
          // a real answer: merged turbo checkpoints carry their distillation
          // in the weights, and the user picking it is trusted to know that.
          openTurboChoice(event.currentTarget, {
            includeNone: NO_LORA,
            value: "",
            onPick: (picked) => {
              if (picked === t(NO_LORA)) turbo.merged = true;
              else turbo.lora = picked;
              throwOn(container, { value, set });
              onCommit();
            },
          });
        }
      },
    }, [icon("bolt", 16), el("span", {
      text: on ? t("turbo · {name}", { name: turbo.lora ? short(turbo.lora) : t("merged") }) : t("turbo off"),
    })]),
    // Which file, as its own control — the seed pill's shape: the big half
    // throws the switch, the small half changes what it throws. Only once
    // there is something to change; before that the big half is the picker.
    ...(turbo.lora ? [el("button", {
      class: "mmc-step mmc-turbo-pick",
      title: t("Pick a different turbo LoRA — now {lora}.", { lora: turbo.lora })
           + (on ? " " + t("Swapped in place: the run never carries both distills at once.") : ""),
      onclick: (event) => openTurboChoice(event.currentTarget, {
        includeNone: true,
        value: turbo.lora,
        onPick: (picked) => {
          setTurboLora(container, picked === t("— none —") ? "" : picked, { value, set });
          onCommit();
        },
      }),
    }, [icon("chevron", 14)])] : []),
  ]));

  // Only while it is doing something, like the spectrum blend: off, the
  // qualities are a setting for a feature not in use.
  if (on) {
    const steps = Number(value("steps", 0));
    pills.push(el("div", { class: "mmc-pill mmc-turbo-seg" }, S.TURBO_QUALITIES.map((quality) => el("button", {
      class: "mmc-turbo-opt",
      // Pressed is derived from the real steps widget, so a hand-edited step
      // count un-presses all three rather than one of them lying about it.
      "aria-pressed": steps === S.TURBO_STEPS[quality],
      title: t(QUALITY_TITLE[quality]),
      onclick: () => {
        turbo.quality = quality;
        set("steps", S.TURBO_STEPS[quality]);
        onCommit();
      },
    }, [
      el("span", { text: t(quality === "medium" ? "med" : quality) }),
      el("span", { class: "mmc-pill-sub", text: String(S.TURBO_STEPS[quality]) }),
    ]))));
  }

  return pills;
}

/**
 * The weights-popover row: which file the switch reaches for. Listed with the
 * files because it is the same kind of decision — made once when the LoRA is
 * downloaded — and `openChoicePopover`d like every other row there.
 */
export function turboRow({ container, widgetIO, onChange }) {
  const NONE = "— none —";
  const turbo = container.turbo;
  return el("div", { class: "mmc-weight-row" }, [
    el("span", { class: "mmc-weight-name", text: t("Turbo LoRA") }),
    el("button", {
      class: `mmc-weight-file${turbo.lora ? "" : " empty"}`,
      title: t("The distillation LoRA the turbo pill engages, from models/loras.\n\n"
           + "larryvrh's v4 EMA runs at strength 1.0; the lightx2v distill at about 0.6 — "
           + "the switch sets that from the filename, and the LoRA manager's slider "
           + "overrides it. Steps and sampler are the pill's business, not this row's.\n\n"
           + "'none' also fits a checkpoint with the distillation merged into the weights: "
           + "the pill then only drops the steps and swaps the sampler."),
      text: turbo.lora || (turbo.merged ? t("no LoRA · merged checkpoint") : t("not set")),
      onclick: (event) => openTurboChoice(event.currentTarget, {
        includeNone: true,
        value: turbo.lora || t(NONE),
        onPick: (picked) => {
          if (picked === t(NONE)) turbo.merged = false;
          setTurboLora(container, picked === t(NONE) ? "" : picked, widgetIO);
          onChange();
        },
      }),
    }),
  ]);
}
