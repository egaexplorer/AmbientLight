import fs from "node:fs";
import path from "node:path";
import { GAME_LOOK_NAMES, LOOK_NAMES } from "@ambientlight/core";
import { errorMessage, RANGES, UserError } from "@ambientlight/node";
import type { AppState, LookChoice, LookSet, ShortcutAction, Toast } from "../shared/api";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, type ShortcutKeys } from "../shared/shortcuts";

// What the global shortcuts do, without Electron, so tests can run it. `shortcut-keys.ts` registers the keys.

export const SHORTCUTS_FILE_NAME = "shortcuts.json";

/** Brightness keys move to the next multiple of this. */
export const BRIGHTNESS_STEP = 10;

const MAX_ACCELERATOR = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads `shortcuts.json`: an object of action → Electron accelerator ("Ctrl+Alt+L"), or null to turn a key off.
 * Missing actions keep their default. Unknown actions, other values and two actions on the same keys are rejected,
 * so a typo doesn't fail silently.
 */
export function parseShortcutFile(text: string, source: string): ShortcutKeys {
  let value: unknown;
  try {
    // Notepad may save a byte order mark.
    value = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    throw new UserError(`${source} isn't valid JSON (${errorMessage(error)})`);
  }
  if (!isRecord(value)) throw new UserError(`${source}: expected a JSON object`);

  const keys: ShortcutKeys = { ...DEFAULT_SHORTCUTS };
  for (const [key, raw] of Object.entries(value)) {
    if (!(SHORTCUT_ACTIONS as readonly string[]).includes(key)) {
      throw new UserError(`${source}: unknown shortcut "${key}"; the names are ${SHORTCUT_ACTIONS.join(", ")}`);
    }
    if (raw !== null && (typeof raw !== "string" || raw.trim() === "" || raw.length > MAX_ACCELERATOR)) {
      throw new UserError(`${source}: "${key}" must be keys like "Ctrl+Alt+L", or null to turn it off`);
    }
    keys[key as ShortcutAction] = raw === null ? null : raw.trim();
  }

  const seen = new Map<string, ShortcutAction>();
  for (const action of SHORTCUT_ACTIONS) {
    const accelerator = keys[action];
    if (accelerator === null) continue;
    const id = accelerator.toLowerCase().replace(/\s+/g, "");
    const other = seen.get(id);
    if (other) throw new UserError(`${source}: "${other}" and "${action}" both use ${accelerator}`);
    seen.set(id, action);
  }
  return keys;
}

export function shortcutFileText(keys: Readonly<ShortcutKeys>): string {
  return `${JSON.stringify(keys, null, 2)}\n`;
}

/**
 * The keys from `file`. A missing file is written with the defaults, so there is something to edit. A broken file
 * gives the defaults and says why.
 */
export function readShortcutFile(file: string): { keys: ShortcutKeys; error: string | null } {
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, shortcutFileText(DEFAULT_SHORTCUTS));
      return { keys: { ...DEFAULT_SHORTCUTS }, error: null };
    }
    return { keys: parseShortcutFile(fs.readFileSync(file, "utf8"), path.basename(file)), error: null };
  } catch (error) {
    return { keys: { ...DEFAULT_SHORTCUTS }, error: `${errorMessage(error)}. The default keys apply until it's fixed.` };
  }
}

function lookIn(set: LookSet, index: number): LookChoice | undefined {
  if (set === "game") {
    const name = GAME_LOOK_NAMES[index];
    return name === undefined ? undefined : { set: "game", name };
  }
  const name = LOOK_NAMES[index];
  return name === undefined ? undefined : { set: "film", name };
}

function lookCount(set: LookSet): number {
  return set === "game" ? GAME_LOOK_NAMES.length : LOOK_NAMES.length;
}

/** The `n`th look of a set (1-based, in the chips' order), or undefined past the end. */
export function lookAt(set: LookSet, n: number): LookChoice | undefined {
  return n >= 1 ? lookIn(set, n - 1) : undefined;
}

/**
 * The look one step from `current`, in the chips' order of `set` (No look first), wrapping around. From a look of
 * the other set, "next" goes to the set's first look and "previous" to its last.
 */
export function stepLook(current: LookChoice | null, set: LookSet, step: 1 | -1): LookChoice | null {
  const count = lookCount(set);
  // Position 0 is No look, 1…count the looks.
  let position: number;
  if (current === null) position = 0;
  else if (current.set !== set) return step === 1 ? lookIn(set, 0)! : lookIn(set, count - 1)!;
  else position = (set === "game" ? (GAME_LOOK_NAMES as readonly string[]) : LOOK_NAMES).indexOf(current.name) + 1;
  const next = (position + step + count + 1) % (count + 1);
  return next === 0 ? null : lookIn(set, next - 1)!;
}

/** The brightness one key press away: the next multiple of BRIGHTNESS_STEP up or down, within 10–100. */
export function stepBrightness(value: number, step: 1 | -1): number {
  const [min, max] = RANGES.brightness;
  const next = step === 1 ? (Math.floor(value / BRIGHTNESS_STEP) + 1) * BRIGHTNESS_STEP : (Math.ceil(value / BRIGHTNESS_STEP) - 1) * BRIGHTNESS_STEP;
  return Math.min(max, Math.max(min, next));
}

/** What the shortcuts need from the app; `AppController` has it all. */
export interface ShortcutTarget {
  getState(): AppState;
  isRunning(): boolean;
  setLook(look: LookChoice | null): Promise<AppState>;
  setBrightness(value: number): Promise<AppState>;
  startSync(): Promise<AppState>;
  stopSync(): Promise<AppState>;
}

function sameName(a: LookChoice | null, b: LookChoice | null): boolean {
  return a === null || b === null ? a === b : a.set === b.set && a.name === b.name;
}

/** Runs the global shortcuts against the app and says what happened through `toast`. */
export class ShortcutActions {
  private readonly target: ShortcutTarget;
  private readonly toast: (toast: Toast) => void;
  private set: LookSet = "film";
  /** The look in use when the set was last decided. */
  private seen: LookChoice | null = null;
  private busy = false;

  constructor(target: ShortcutTarget, toast: (toast: Toast) => void) {
    this.target = target;
    this.toast = toast;
  }

  /**
   * The set the keys pick from. A look picked anywhere (a chip, a title, a key) brings its set along; "switchSet"
   * changes it until the next pick. With No look it stays the last one, film at first.
   */
  activeSet(): LookSet {
    const look = this.target.getState().look;
    if (look && !sameName(look, this.seen)) this.set = look.set;
    this.seen = look;
    return this.set;
  }

  /**
   * Runs one shortcut. A press while the previous one is still running is dropped, so a held key or a double
   * toggle can't pile up engine restarts. Resolves false when dropped.
   */
  async run(action: ShortcutAction): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      this.toast(await this.perform(action));
    } catch (error) {
      if (!(error instanceof UserError)) console.error(error);
      this.toast({ kind: "error", message: errorMessage(error) });
    } finally {
      this.busy = false;
    }
    return true;
  }

  private async perform(action: ShortcutAction): Promise<Toast> {
    const set = this.activeSet();
    const state = this.target.getState();
    switch (action) {
      case "nextLook":
        return this.pick(stepLook(state.look, set, 1), set);
      case "previousLook":
        return this.pick(stepLook(state.look, set, -1), set);
      case "noLook":
        return this.pick(null, set);
      case "switchSet":
        this.set = set === "film" ? "game" : "film";
        return { kind: "set", set: this.set };
      case "toggleSync":
        if (this.target.isRunning()) {
          await this.target.stopSync();
          return { kind: "sync", on: false };
        }
        await this.target.startSync();
        return { kind: "sync", on: true };
      case "brighter":
      case "dimmer": {
        const value = stepBrightness(state.brightness, action === "brighter" ? 1 : -1);
        const next = value === state.brightness ? state : await this.target.setBrightness(value);
        return { kind: "brightness", value: next.brightness, cap: next.brightnessCap };
      }
      default: {
        const n = Number(action.slice("look".length));
        const look = lookAt(set, n);
        if (!look) throw new UserError(`There are only ${lookCount(set)} ${set} looks, so look ${n} isn't one.`);
        return this.pick(look, set);
      }
    }
  }

  private async pick(look: LookChoice | null, set: LookSet): Promise<Toast> {
    const state = await this.target.setLook(look);
    this.seen = state.look;
    return { kind: "look", look: state.look, set };
  }
}
