import { globalShortcut } from "electron";
import type { ShortcutAction, ShortcutStatus, ShortcutsView } from "../shared/api";
import { SHORTCUT_ACTIONS } from "../shared/shortcuts";
import { readShortcutFile } from "./shortcuts";

/**
 * Registers the keys from `shortcuts.json` with Windows, so they work while another app or game has focus. A key
 * another program already holds can't be registered; the Shortcuts dialog shows which.
 */
export class GlobalShortcuts {
  private readonly file: string;
  private readonly onPress: (action: ShortcutAction) => void;
  private current: ShortcutsView;

  constructor(file: string, onPress: (action: ShortcutAction) => void) {
    this.file = file;
    this.onPress = onPress;
    this.current = { file, error: null, keys: [] };
  }

  /** Reads the file and registers every key again. */
  apply(): ShortcutsView {
    globalShortcut.unregisterAll();
    const { keys, error } = readShortcutFile(this.file);
    this.current = {
      file: this.file,
      error,
      keys: SHORTCUT_ACTIONS.map((action) => ({ action, accelerator: keys[action], status: this.register(action, keys[action]) })),
    };
    return this.current;
  }

  view(): ShortcutsView {
    return this.current;
  }

  dispose(): void {
    globalShortcut.unregisterAll();
  }

  private register(action: ShortcutAction, accelerator: string | null): ShortcutStatus {
    if (accelerator === null) return "off";
    try {
      // false: another program (or Windows) holds these keys.
      return globalShortcut.register(accelerator, () => this.onPress(action)) ? "on" : "taken";
    } catch {
      // Electron throws on text it can't read as keys.
      return "invalid";
    }
  }
}
