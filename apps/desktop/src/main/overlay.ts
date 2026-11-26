import { BrowserWindow, screen } from "electron";
import { CHANNELS, type Toast } from "../shared/api";

const WIDTH = 360;
const HEIGHT = 84;
/** Gap between the popup and the bottom of the screen's work area (above the taskbar). */
const MARGIN = 56;
const SHOW_MS = 1500;

/**
 * The small popup that says what a shortcut did. It never takes focus, so the film or game in front keeps
 * playing, and it ignores the mouse. Made on first use, then hidden between popups. It shows over windowed and
 * borderless full-screen apps, not over exclusive full screen.
 */
export class Overlay {
  private readonly preload: string;
  private readonly load: (win: BrowserWindow) => Promise<void>;
  private win: BrowserWindow | undefined;
  private loaded: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  /** `load` puts the renderer's overlay view in the window. */
  constructor(preload: string, load: (win: BrowserWindow) => Promise<void>) {
    this.preload = preload;
    this.load = load;
  }

  async show(toast: Toast): Promise<void> {
    if (this.destroyed) return;
    const win = this.window();
    await this.loaded;
    if (win.isDestroyed()) return;
    win.webContents.send(CHANNELS.toast, toast);
    // Bottom center of the primary display, which is the one the sync captures.
    const area = screen.getPrimaryDisplay().workArea;
    win.setBounds({
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: area.y + area.height - HEIGHT - MARGIN,
      width: WIDTH,
      height: HEIGHT,
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.showInactive();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!win.isDestroyed()) win.hide();
    }, SHOW_MS);
  }

  /**
   * Call when the main window closes: a hidden popup would otherwise keep the app from quitting. Final: later
   * toasts are ignored, so a key pressed while quitting can't open it again.
   */
  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = undefined;
  }

  private window(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      thickFrame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      // Opaque, the card color: transparent windows on Windows have quirks, and gray doesn't sway the bulb.
      backgroundColor: "#17181b",
      title: "I'm bien light",
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.setIgnoreMouseEvents(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    this.loaded = this.load(win).catch((error: unknown) => console.error(error));
    this.win = win;
    return win;
  }
}
