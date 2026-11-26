import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyConfigFile,
  type AppConfig,
  broadcastAddresses,
  CONFIG_FILE_NAME,
  createLookTuner,
  createNodeUdpSocket,
  errorMessage,
  findConfigFile,
  GdiCapturer,
  loadConfigFile,
  loadEnvFileIn,
  type LookTuner,
  lookForTitle,
  saveConfigFile,
  UserError,
} from "@ambientlight/node";
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent, shell } from "electron";
import { CHANNELS } from "../shared/api";
import { AppController, type Platform } from "./controller";
import { frameLogLine } from "./frame-view";
import { checkBrightness, checkBulbList, checkIp, checkLook, checkTitle, checkTitleKind } from "./validate";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the settings live: `%APPDATA%\AmbientLight\ambientlight.config.json`, or `AMBIENTLIGHT_CONFIG` for
 * development. On the first start the CLI's config (found from where npm was started) is copied, so bulbs and
 * calibration carry over.
 */
function configPath(): string {
  const override = process.env.AMBIENTLIGHT_CONFIG;
  if (override) return path.resolve(override);
  return path.join(app.getPath("userData"), CONFIG_FILE_NAME);
}

function loadConfig(file: string): AppConfig {
  if (fs.existsSync(file)) return applyConfigFile(loadConfigFile(file));
  const cliConfig = findConfigFile(process.env.INIT_CWD ?? process.cwd());
  const config = applyConfigFile(cliConfig ? loadConfigFile(cliConfig) : undefined);
  return cliConfig ? saveConfigFile(file, config) : config;
}

/**
 * The AI that tunes a title's look, from a key in `.env`: next to the app's config, or in development also next to the
 * CLI's config (the repository root). A variable that is already set wins. `undefined` without a key.
 */
function createTuner(file: string): LookTuner | undefined {
  loadEnvFileIn(path.dirname(file));
  if (!app.isPackaged) {
    const cliConfig = findConfigFile(process.env.INIT_CWD ?? process.cwd());
    if (cliConfig) loadEnvFileIn(path.dirname(cliConfig));
  }
  return createLookTuner(process.env);
}

/** The C# source of the capture helper: next to the app when installed, in packages/node during development. */
function helperSource(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "gdi-capture.cs")
    : path.resolve(app.getAppPath(), "../../packages/node/native/gdi-capture.cs");
}

function createPlatform(file: string): Platform {
  const tuner = createTuner(file);
  return {
    loadConfig: () => loadConfig(file),
    saveConfig: (config) => saveConfigFile(file, config),
    createSocket: (options) => createNodeUdpSocket(options),
    createCapturer: (config) => {
      if (process.platform !== "win32") throw new UserError("Screen capture in the desktop app needs Windows.");
      return new GdiCapturer({
        screen: config.screen,
        width: config.sampleWidth,
        height: config.sampleHeight,
        helperSource: helperSource(),
      });
    },
    broadcastAddresses: () => broadcastAddresses(),
    lookForTitle: (kind, title) => lookForTitle(kind, title, fetch, undefined, tuner),
    now: () => performance.now(),
  };
}

let window: BrowserWindow | undefined;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 860,
    minHeight: 580,
    show: false,
    backgroundColor: "#111214",
    title: "I'm bien light",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Links (Wikipedia, TVmaze) open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(here, "../renderer/index.html"));
  return win;
}

/** Registers one IPC handler. User-facing errors keep their message; others are logged and summarized. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return await fn(...(args as A));
    } catch (error) {
      if (!(error instanceof UserError)) console.error(error);
      throw new Error(errorMessage(error));
    }
  });
}

function registerIpc(controller: AppController): void {
  handle(CHANNELS.getState, () => controller.getState());
  handle(CHANNELS.discover, () => controller.discover());
  handle(CHANNELS.identify, (ip: unknown) => controller.identify(checkIp(ip)));
  handle(CHANNELS.setBulbs, (ips: unknown) => controller.setBulbs(checkBulbList(ips)));
  handle(CHANNELS.findTitle, (kind: unknown, title: unknown) => controller.findTitle(checkTitleKind(kind), checkTitle(title)));
  handle(CHANNELS.setLook, (look: unknown) => controller.setLook(checkLook(look)));
  handle(CHANNELS.setBrightness, (value: unknown) => controller.setBrightness(checkBrightness(value)));
  handle(CHANNELS.startSync, () => controller.startSync());
  handle(CHANNELS.stopSync, () => controller.stopSync());
  handle(CHANNELS.minimizeWindow, () => window?.minimize());
}

// Electron names the settings folder after `productName`. The app was renamed from AmbientLight to I'm bien light;
// keep the old folder so bulbs, calibration and `.env` carry over. Must run before the single-instance lock.
app.setPath("userData", path.join(app.getPath("appData"), "AmbientLight"));

if (!app.requestSingleInstanceLock()) {
  // Two copies would fight over the same bulbs.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void app.whenReady().then(() => {
    const controller = new AppController(createPlatform(configPath()), {
      state: (state) => window?.webContents.send(CHANNELS.state, state),
      frame: (frame) => window?.webContents.send(CHANNELS.frame, frame),
      // Like `sync -v`: every frame in the terminal that started the app.
      ...(process.env.AMBIENTLIGHT_VERBOSE === "1" ? { report: (report) => console.log(frameLogLine(report)) } : {}),
    });
    registerIpc(controller);
    window = createWindow();
    window.on("closed", () => {
      window = undefined;
    });

    // Put the bulbs back before quitting, however the app is closed.
    let quitting = false;
    app.on("before-quit", (event) => {
      if (quitting) return;
      event.preventDefault();
      quitting = true;
      controller
        .shutdown()
        .catch((error: unknown) => console.error(error))
        .finally(() => app.exit(0));
    });
  });

  app.on("window-all-closed", () => app.quit());
}
