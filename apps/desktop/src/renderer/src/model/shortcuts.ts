import { GAME_LOOK_NAMES, LOOK_NAMES } from "@ambientlight/core";
import type { LookSet, ShortcutAction, ShortcutStatus, Toast } from "../../../shared/api";
import { brightnessText } from "./format";
import { lookDetail, lookLabel } from "./looks";

const SET_LABELS: Record<LookSet, string> = { film: "Film", game: "Game" };

const ACTION_LABELS: Record<Exclude<ShortcutAction, `look${number}`>, string> = {
  nextLook: "Next look",
  previousLook: "Previous look",
  noLook: "No look",
  switchSet: "Switch between film and game looks",
  toggleSync: "Start or stop sync",
  brighter: "Brighter (next 10 %)",
  dimmer: "Dimmer (next 10 %)",
};

/** The label of a set's `n`th look (1-based, the chips' order), or undefined past the end. */
function lookName(set: LookSet, n: number): string | undefined {
  if (set === "game") {
    const name = GAME_LOOK_NAMES[n - 1];
    return name === undefined ? undefined : lookLabel({ set, name });
  }
  const name = LOOK_NAMES[n - 1];
  return name === undefined ? undefined : lookLabel({ set, name });
}

/** What a shortcut does, for the Shortcuts dialog: "Look 1: Horror · game: Horror". */
export function shortcutLabel(action: ShortcutAction): string {
  const match = /^look(\d)$/.exec(action);
  if (!match) return ACTION_LABELS[action as keyof typeof ACTION_LABELS];
  const n = Number(match[1]);
  const film = lookName("film", n) ?? "none";
  const game = lookName("game", n) ?? "none";
  return `Look ${n}: ${film} · game: ${game}`;
}

export const STATUS_TEXT: Record<ShortcutStatus, string> = {
  on: "On",
  off: "Off",
  taken: "Taken by another program",
  invalid: "Not keys the app understands",
};

/** The popup's two lines after a shortcut. */
export function toastText(toast: Toast): { title: string; detail?: string } {
  switch (toast.kind) {
    case "look":
      return toast.look
        ? { title: `Look: ${lookLabel(toast.look)}`, detail: `${SET_LABELS[toast.look.set]} · ${lookDetail(toast.look)}` }
        : { title: "No look", detail: `Plain screen sync · keys pick ${toast.set} looks` };
    case "set":
      return { title: `${SET_LABELS[toast.set]} looks`, detail: `Next, previous and number keys now pick ${toast.set} looks` };
    case "sync":
      return { title: toast.on ? "Sync on" : "Sync off" };
    case "brightness":
      return { title: "Brightness", detail: brightnessText(toast.value, toast.cap) };
    case "error":
      return { title: "The shortcut didn't work", detail: toast.message };
  }
}
