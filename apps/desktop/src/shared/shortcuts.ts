// The global shortcut keys and their defaults, shared by the main process and the renderer's browser preview.
import type { ShortcutAction } from "./api";

/** Every action, in the order the Shortcuts dialog and `shortcuts.json` list them. */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  "nextLook",
  "previousLook",
  "noLook",
  "look1",
  "look2",
  "look3",
  "look4",
  "look5",
  "look6",
  "look7",
  "look8",
  "switchSet",
  "toggleSync",
  "brighter",
  "dimmer",
];

export type ShortcutKeys = Record<ShortcutAction, string | null>;

/**
 * Electron accelerators. Ctrl+Alt with arrows is avoided: Intel graphics drivers use it to rotate the screen.
 * `=` and `-` are the keys left of Backspace (`Plus` would need Shift).
 */
export const DEFAULT_SHORTCUTS: Readonly<ShortcutKeys> = Object.freeze({
  nextLook: "Ctrl+Alt+L",
  previousLook: "Ctrl+Alt+Shift+L",
  noLook: "Ctrl+Alt+0",
  look1: "Ctrl+Alt+1",
  look2: "Ctrl+Alt+2",
  look3: "Ctrl+Alt+3",
  look4: "Ctrl+Alt+4",
  look5: "Ctrl+Alt+5",
  look6: "Ctrl+Alt+6",
  look7: "Ctrl+Alt+7",
  look8: "Ctrl+Alt+8",
  switchSet: "Ctrl+Alt+G",
  toggleSync: "Ctrl+Alt+S",
  brighter: "Ctrl+Alt+=",
  dimmer: "Ctrl+Alt+-",
});
