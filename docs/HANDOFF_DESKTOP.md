# Handoff: desktop front end (2026-11-23)

Where the Windows desktop app stands and what comes next, written so a new session (for example one on the user's
PC) can continue. The facts also live in the docs listed below; if they disagree, the docs win.

## Context

A cloud session planned and started the Windows desktop app (Electron) for AmbientLight. The next part has to happen
on the user's PC: the real bulb, GDI capture and the Windows firewall exist only there. This document is
everything a new session needs to continue. All of it is also committed in the repo's docs.

- **Branch:** `ccr-89d32679-dhyf40`. Three commits on top of `7de875d`, plus this handoff:
  1. `38fba7f` docs: plan, wireframes and UI design
  2. `dd9ffb8` feat: shared Node package, `SyncSession` and `identifyBulb`
  3. `96980ee` feat: desktop app demo flow (Electron, Windows)
- **Deadlines:**
  - **Thu 2026-11-26:** demo video of one flow.
  - **Sat 2026-12-12:** MVP for the live demo. Freeze on 12-11.
- **Targets: Windows PC and Android only.** No macOS, Linux or iOS work (this is in `CLAUDE.md`).

## Start on the PC

```powershell
cd C:\AI_Sandbox\Project\AmbientLight
git fetch origin ccr-89d32679-dhyf40
git checkout ccr-89d32679-dhyf40
npm install          # downloads Electron 45.2.3 (~100 MB) the first time
npm run check        # build + typecheck + 209 tests, must be green
npm run desktop      # the app; first start copies ambientlight.config.json from the repo root
```

The first time it searches the network, allow Electron on **Private networks** in the Windows firewall prompt.

## What to read first (in the repo)

| Doc | What it holds |
| --- | --- |
| `docs/UI_DESIGN.md` | Screens, design tokens, what backs each control, Google Stitch brief, AI design tools, what's built so far |
| `docs/ARCHITECTURE.md` | `packages/node`, `SyncSession`, the `apps/desktop` process model and IPC, decision 15 (capture) |
| `docs/ROADMAP.md` | Phase 4 checklist with milestones (Electron section) |
| `docs/DEVELOPMENT.md` | "The desktop app": scripts, tsconfig split, mock API, running Electron on Linux for tests |
| `docs/REFERENCE_NOTES.md` | "UI study (2026-11-23)": patterns from the references and from Hue Sync, Govee and Nanoleaf |
| `README.md` | "Desktop app (Windows)": what a user can do now |

**Wireframes** of all 8 screens, clickable and commentable:
<https://claude.ai/artifact/9de8MxMAdW5DoCv6J7tHWN> (private, opened by its owner). The screens are Home, Find bulbs,
Bulbs, Tuning, Setup wizard, Diagnostics, About and the tray menu. The wireframe is the spec.

## Decisions already made (don't reopen without a reason)

1. **Capture = the CLI's GDI helper** (32 ms per frame, 20 FPS, both measured), running in the Electron main process.
   `desktopCapturer` is unmeasured. It becomes a benchmark spike after Nov 26 and replaces GDI only if it wins.
   Neither works on Android, which will need Kotlin `MediaProjection`.
2. **Dark neutral gray UI, and the only color shown is the light itself**, because the window is captured while
   visible. "Minimize while syncing" is on by default; it becomes "hide" once the tray exists.
3. **Stack:** electron-vite 6, React 19, Tailwind 4, Vite 8, Electron 45.2.3, versions pinned exactly. There is no
   shadcn/ui: plain Tailwind components were enough. The font is Segoe UI (the Windows system font), not Inter.
4. **Process model:** the main process (`AppController` → `SyncSession` → GDI + UDP) does all the work. The sandboxed
   renderer only draws and talks through the typed `window.ambient` API (preload). It gets at most 10 frame views a
   second.
5. **Settings** live in `%APPDATA%\AmbientLight\ambientlight.config.json`, or the path in `AMBIENTLIGHT_CONFIG`. The
   first start copies the CLI's config. `saveConfigFile` writes only values that differ from the defaults.
6. **No `sharp` in the desktop app.** It isn't needed (it only serves the CLI's slow fallback); saving a PNG later
   uses Electron's `nativeImage`.
7. **Expected failures are values:** title lookups return `TitleError` codes, and the app words its own advice.
8. **Quitting always restores the bulbs:** `before-quit` waits for `AppController.shutdown()`.

## Code map

- `packages/core/src/sync/session.ts`: `SyncSession`. It reads the bulbs, runs the engine, applies `update()` while
  running and restores on `stop()`; calls are queued.
- `packages/core/src/wiz/identify.ts`: `identifyBulb`, the Blink button (white, off, twice, then restore).
- `packages/node/src/*`: Node adapters shared by the CLI and the desktop app:
  - `udp`, `gdi-capture` (+ `native/gdi-capture.cs`, `helperSource` option), `network`, `displays`
  - `config` (`applyConfigFile`, `saveConfigFile`, `syncOptionsFor`)
  - `film` (`lookForTitle`, `TitleError`), `errors` (`UserError`; the CLI's `CliError` is the same class)
- `apps/desktop/src/shared/api.ts`: the IPC contract (`AmbientApi`, `AppState`, `FrameView`, `CHANNELS`).
- `apps/desktop/src/main/`: Electron wiring, platform adapters and config location in `index.ts`; the rest is in
  `controller.ts`, `frame-view.ts` (hex colors, kelvin preview, fps) and `validate.ts` (IPC input checks).
- `apps/desktop/src/preload/index.ts`: built as CommonJS (`index.cjs`), which a sandboxed preload needs.
- `apps/desktop/src/renderer/src/`:
  - `App.tsx` (fixed sidebar, scrolling content), `screens/Home.tsx`, `screens/FindBulbs.tsx`, `components/ui.tsx`
  - `model/` (DOM-free text and look-chip helpers), `mock-api.ts` (a fake backend for browser previews)
- Tests: `packages/core/test/session.test.ts`, `packages/node/test/{config,film}.test.ts`,
  `apps/desktop/test/{controller,view}.test.ts`.

## Gotchas for the next session

- `apps/desktop` is excluded from the root `tsconfig.tests.json`. It has its own `tsconfig.node.json` and
  `tsconfig.web.json`, which the root `typecheck` script runs.
- Desktop imports have **no `.js` suffix** (Bundler resolution). The rest of the repo keeps NodeNext with `.js`.
- `electron.vite.config.ts` aliases `@ambientlight/core` and `@ambientlight/node` to their `src/`, so they are
  bundled. `screenshot-desktop` must stay external.
- In development the GDI helper source is found at `app.getAppPath()/../../packages/node/native/gdi-capture.cs`.
  Installed, it is `process.resourcesPath/gdi-capture.cs`, which the installer must ship as an `extraResources`
  entry.
- `productName: "AmbientLight"` in `apps/desktop/package.json` decides the `%APPDATA%` folder name.
- CI sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1`.
- `CLAUDE.md` rule: update the docs in the same change as the code, each fact in the doc that owns it.

## Next steps

### A. Today or tomorrow: test the demo flow on the real bulb (must pass before Wed night)

1. `npm run desktop`. Find bulbs, Blink: the bulb flashes twice and goes back.
2. Type `Pengabdi Setan`, press Find (expect the Horror look). Start sync with a video playing; untick "Minimize
   while syncing" to film the UI.
3. Check and record:
   - FPS about 20 and capture about 20–35 ms (compare with `npm run sync -- -v`)
   - the same color as `npm run once` on the same paused shot
   - the bulb restored on Stop **and** on closing the window
   - any error text
4. Fix what fails. Record the results in ROADMAP (tick the sub-item) and in ARCHITECTURE if anything was measured.
5. **Thu 11-26:** record the video. The CLI (`npm run sync -- --film "..."`) is the fallback.

### B. 11-27 → 12-10: MVP (wireframe screens; see the UI_DESIGN screen spec)

1. **Setup wizard:** WiZ app checklist, then find bulbs + `checkBulb` verdict, then display, then done.
2. **Bulbs page:** list, add by IP, rediscover, Blink, Check report (`checkBulb`), On/Off (`turnOn` / `turnOff`), remove.
3. **Tuning page:** groups Response, Color, Brightness, White. Each control has a reset to its default and a hint from
   the README tuning tips. Changes apply live through `SyncSession.update` (debounced). Advanced collapsed.
4. **Display picker** (`listDisplays` → `screen`, applied through `update({ capturer })`) and the **tray**:
   - menu: Start/Stop, Look, bulbs off, Open, Quit (restores)
   - close to tray; "hide while syncing"; start with Windows
5. **Diagnostics:** the 64×36 frame at 2/s while the page is open, live numbers, Save frame (`nativeImage`).
   **About:** Wikipedia and TVmaze CC BY-SA credit, privacy, references, license.
6. **CLI `runSync` on `SyncSession`**, so there is one code path. Also an `identify` CLI command (optional).
7. **desktopCapturer spike:** a hidden-window capturer and a benchmark against GDI (ms, FPS, CPU, memory, color
   difference). Record it in ARCHITECTURE decision 15.
8. **Installer:** electron-builder NSIS for Windows, icons, `gdi-capture.cs` as `extraResources`, `asarUnpack` for
   `screenshot-desktop`. Test a clean install and the firewall prompt for `AmbientLight.exe`.
9. 12-11: freeze and rehearse. **12-12: live demo.**

### C. After the demo

Presets (gaming / movie / ambient), letterbox detection, multi-zone, then Android: React Native reusing the core,
`SyncSession` and the renderer's `model/` helpers.

## Verification (each step)

- `npm run check` stays green (build, typecheck and tests, the desktop app included).
- UI changes: compare with the wireframe. A browser preview against `mock-api.ts` works too: build, then serve
  `apps/desktop/out/renderer`.
- Bulb behavior: run on the PC with the real bulb. Compare with the CLI (`npm run state`, `once`, `sync -v`).

## Paste-ready opening message for the new session

> Continue the AmbientLight Windows desktop app on branch `ccr-89d32679-dhyf40`. Read `CLAUDE.md` and
> `docs/HANDOFF_DESKTOP.md` first, then `docs/UI_DESIGN.md`, `docs/ROADMAP.md` (Phase 4, Electron), `docs/ARCHITECTURE.md` (apps/desktop, decision 15) and
> `docs/DEVELOPMENT.md` ("The desktop app"). The demo flow (Home + Find bulbs) is built and tested with fakes but not
> yet on the real bulb. First, help me run `npm run desktop` on this PC with my bulb and check: FPS about 20, capture
> 20–35 ms, the color matches `npm run once`, the bulb is restored on Stop and on closing the window. Fix what fails,
> update the docs, and commit to the same branch. Deadlines: demo video Thu 2026-11-26, MVP for the live demo Sat
> 2026-12-12. Targets are Windows and Android only.
