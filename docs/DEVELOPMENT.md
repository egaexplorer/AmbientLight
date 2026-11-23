# Development guide

## Setup

Clone the repository, then:

```powershell
cd AmbientLight
npm install
npm run check   # build + type-check tests + run tests
```

Requires Node.js 22.12+ (24 LTS recommended, see `.nvmrc`). `sharp` (used by the `screenshot-desktop` capture
fallback) downloads a prebuilt native binary during `npm install`. If that fails behind a proxy, see the sharp
install docs. The default Windows capture needs no npm package: its helper is compiled on first use with the
`csc.exe` that ships with Windows.

To time capture on your machine, run `npm run sync -- -v` (each line shows `capture N ms`), or put a few
`await capturer.capture()` calls of `GdiCapturer` / `DesktopCapturer` in a scratch `.mts` script and run it with
`npx tsx --conditions=development`.

`package-lock.json` is committed, and CI installs with `npm ci`. Commit lockfile changes along with any
dependency change.

## Scripts (repository root)

| Script | Description |
| --- | --- |
| `npm run build` | `tsc -b`: builds `packages/core`, `packages/node`, then `apps/pc-cli` into their `dist/` folders; then bundles the desktop app into `apps/desktop/out` |
| `npm run clean` | Removes build output |
| `npm test` | Runs all `*.test.ts` with Node's built-in test runner (via `tsx`) |
| `npm run typecheck` | Type-checks source and tests together (`tsconfig.tests.json`, then the desktop app's two tsconfigs) |
| `npm run check` | build + typecheck + test (what CI runs) |
| `npm run desktop` | Starts the desktop app from source (see below) |
| `npm run discover` / `check-bulb` / `state` / `on` / `off` / `displays` / `color` / `once` / `sync` / `rain` / `help` | Run the CLI from source (`check-bulb` runs the CLI's `check` command; `npm run check` is the build + test script) |

Pass CLI flags after `--`: `npm run sync -- --bulb 192.168.1.50 -v`.
To run the compiled CLI instead: `npm run build`, then `node apps/pc-cli/dist/main.js sync`.

## The desktop app

```powershell
npm run desktop                        # electron-vite dev: the app with hot reload of the UI
npm run build -w @ambientlight/desktop # bundles main, preload and renderer into apps/desktop/out
npm run typecheck -w @ambientlight/desktop
```

- **Electron's binary** (~100 MB) isn't always fetched by `npm install`: with npm 12 on the user's PC it wasn't.
  Electron 45 then downloads it on the first start, or run `node node_modules/electron/install.js` beforehand.
  npm 12 also blocks esbuild's `postinstall` (`npm install-scripts ls`); the build works without it.
- Two tsconfigs: `tsconfig.node.json` (main, preload, shared, tests) and `tsconfig.web.json` (renderer: DOM, JSX).
  The root `tsconfig.tests.json` leaves `apps/desktop` out; the root `typecheck` and `build` scripts run the
  desktop's own.
- Imports in the desktop app have no `.js` suffix (Bundler resolution); electron-vite bundles them.
- **UI work without Windows or a bulb:** the renderer uses `src/renderer/src/mock-api.ts` when `window.ambient` is
  missing. Build, then serve `apps/desktop/out/renderer` with any static server (e.g. `python -m http.server`) and
  open it in a browser.
- **The real app on Linux** (an agent's container): `node node_modules/electron/install.js` fetches Electron if
  `ELECTRON_SKIP_BINARY_DOWNLOAD` skipped it, and Playwright's `_electron.launch` with `--no-sandbox` under
  `xvfb-run` drives it. Screen capture needs Windows, so such a run can check everything but the GDI capture.
- CI sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1`: tests and the build don't start Electron.
- Use the fake bulb below with `AMBIENTLIGHT_CONFIG` pointing at a scratch config whose `bulbs` is `["127.0.0.1"]`.

### Measuring the desktop app on the real bulb

The Home screen's numbers are fine for a glance; for exact ones, log every frame and drive the app without clicking.
An agent's shell on the user's PC reaches the bulb (2026-11-23), so it can run all of this itself.

```powershell
$env:AMBIENTLIGHT_VERBOSE = "1"   # every frame in this terminal, like `sync -v`
npm run dev -w @ambientlight/desktop -- --remoteDebuggingPort 9222
```

```powershell
node apps/desktop/scripts/drive.mjs eval "window.ambient.discover()"
node apps/desktop/scripts/drive.mjs measure 60 none   # Start, 60 s, Stop; fps, capture, errors
npm run state                                          # did Stop restore the bulb?
```

- `drive.mjs` evaluates in the renderer over the DevTools protocol, so it calls the same `window.ambient` API as the
  buttons. `eval "window.close()"` closes the window as its close button does (quit, restore).
- Frame views are throttled, so take capture times from the verbose log (`capture 31.6 ms`), not from views.
  Its color fields are those of `npm run state`, so a line compares directly with `npm run once`'s "reports" line.
- **Color check:** show a still picture full screen (anything on top of it is captured too), sync a few seconds,
  stop, then run `npm run once` on the same picture. After the smoothing settles, the last logged frame should equal
  what the bulb reports. Add `--look horror` to `once` after `setLook({ name: "horror" })` in the app.
- The debugging port listens on 127.0.0.1 only; leave it off for normal use.

## How the workspace is wired

- **npm workspaces:** `packages/core`, `packages/node`, `apps/pc-cli` and `apps/desktop`. `@ambientlight/node` (the Node.js adapters
  the CLI and the desktop app share) depends on `@ambientlight/core`; the CLI depends on both. npm links them locally.
- **TypeScript project references:** the root `tsconfig.json` references all three, `packages/node` references
  `packages/core`, and `apps/pc-cli` references both. Shared compiler options live in `tsconfig.base.json` (strict,
  `NodeNext`, ES2023).
- **`development` export condition:** `@ambientlight/core` and `@ambientlight/node` export `./src/index.ts` under the
  `development` condition and `./dist/index.js` otherwise. Dev scripts and tests run `tsx --conditions=development`, so
  edits to the core apply immediately without a build. The compiler (`customConditions`) resolves it the
  same way.

## Conventions

- ESM everywhere (`"type": "module"`). Relative imports use the **`.js` suffix** (`./light.js`), as NodeNext requires.
- `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`: use `import type` for types.
- **The core stays platform-agnostic.** Don't import `node:*` and don't use `Buffer`, `console`, or DOM APIs.
  Timers go through `platform/timers.ts`. The core's `"types": []` makes violations fail to compile.
- Platform-specific code lives in `apps/*` behind the core's interfaces (`UdpSocket`, `ScreenCapturer`, `ColorSink`).
- Line endings are LF (enforced by `.gitattributes` and `.editorconfig`).

## Tests

- Framework: `node:test` + `node:assert/strict`, run through `tsx` (no extra test dependency).
- Tests live in `<package>/test/*.test.ts` (`packages/core`, `packages/node`, `apps/pc-cli`). Core fakes are in
  `packages/core/test/helpers.ts`: `FakeSocket`
  (in-memory UDP with scripted replies), `FakeCapturer`, `FakeClock`, `RecordingSink`, `solidFrame`.
- Tests need no bulb, screen, or network.
- Run a single file: `npx tsx --conditions=development --test packages/core/test/color.test.ts`.
- The GDI capture helper needs a real screen, so tests cover only its byte-stream handling (`FrameAssembler`).
  After changing `packages/node/native/gdi-capture.cs` or `gdi-capture.ts`, check capture time and colors by hand with
  `sync -v`.

## Testing film looks

- Tests inject `fetch` and a temporary cache, so they need no network.
- Try a look without the real bulb: `npm run sync -- --look horror --bulb 127.0.0.1` with the fake bulb below.
- When tuning `FILM_LOOKS`, measure on real frames, not only flat test colors: those hid that scifi looked like
  romance. Open films work (Sintel, Big Buck Bunny, Tears of Steel: CC BY 3.0, thumbnails every 30 s on
  archive.org). Internet Archive lists Sintel's frames twice (stereo and surround), so count distinct seconds.
- Keep live probes under 10 Wikipedia requests a minute, and stop on a 429. Delete
  `%LOCALAPPDATA%\AmbientLight\titles` to repeat a lookup.

## Testing the rain signal

- `npm run rain -- --simulate <level>` runs made-up data through the real rules and AI. With the fake bulb below, add
  `--bulb 127.0.0.1` so the real bulb stays untouched.
- Tests inject `fetch`, so they need no network, key or quota.
- For a live red, pick a village inside a currently active warning from <https://www.bmkg.go.id/alerts/nowcast/id>.
- A 400 (Gemini) or 401 (Groq) after "AI gagal" means the key is wrong; a 404 probably means the model id in
  `apps/pc-cli/src/advisor.ts` was retired; a 429 means the free quota is used up. The rules keep working in all cases.

## Debugging a scene

When the light looks wrong on a particular shot, save the pixels the analysis saw (a 64×36 lossless PNG). Pause on
the shot, run this, and switch to the full-screen video before the 5 seconds are up, so that the terminal and the
player's controls aren't captured:

```powershell
Start-Sleep 5; npm run once -- --save-frame "$env:TEMP\lamp.png"
```

`once` also sends that color to the bulb and prints the screen average, the hue source, and what was sent. A
relative path starts in the folder you ran npm from. Saved frames show whatever was on screen, so keep them out
of git.

Phone footage of the screen can show *when* the light changes, but it can't measure the screen's color. Measured
on 2026-11-22 with the same paused shots (average of the screen):

| Shot | Saved frame | Phone photo |
| --- | --- | --- |
| Wall lamps | `23,18,16` (near-black brown) | `64,81,91` (blue) |
| Doorway | `32,35,25` (dark olive) | `79,105,113` (teal) |

**The saved frame is the right one.** A Win+PrtSc screenshot of the doorway averages `31,35,25` (GDI frame
`32,35,25`, mean difference 1.9 of 255), and shown full screen it looks the same as the video in Edge to the user.
So nothing recolors the video after capture. To check another scene or player, repeat exactly that: screenshot,
compare by eye on the same display, compare its average with the saved frame.

A scene can still *feel* different from its pixels (the user reads this olive-gray as white with a little blue
teal), possibly because eyes and cameras adapt to the bulb's light. Treat that as a wish for the mapping, not as
a capture error.

## Trying it without a bulb

A tiny fake bulb is handy when you change protocol code:

```js
// fake-bulb.mjs (run with: node fake-bulb.mjs, then: npm run sync -- --bulb 127.0.0.1 -v)
import dgram from "node:dgram";
const s = dgram.createSocket("udp4");
s.on("message", (msg, r) => {
  console.log(msg.toString());
  const { method } = JSON.parse(msg.toString());
  const result = method === "getPilot" ? { state: true, sceneId: 0, temp: 2700, dimming: 60 } : { success: true };
  s.send(JSON.stringify({ method, env: "pro", result }), r.port, r.address);
});
s.bind(38899, "127.0.0.1");
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `discover` finds nothing | Allow Node.js through Windows Defender Firewall (Private). Make sure the PC and bulb share a subnet (guest Wi‑Fi and mesh "IoT" networks often isolate devices). Turn on "Allow local communication" in the WiZ app. |
| `color` works but `sync` says the state can't be read | Same firewall issue (inbound replies are blocked). Sync still works; only restore-on-exit is skipped. |
| First `once`/`sync` on Windows takes ~0.3 s longer | The `"gdi"` capture compiles its helper (`packages/node/native/gdi-capture.cs`) into `%LOCALAPPDATA%\AmbientLight\gdi-capture-<hash>.exe` on first use. Later runs reuse it; changing the source builds a new one. Delete the folder to force a rebuild. |
| `Couldn't compile the screen capture helper` / `Can't find the C# compiler` | The `"gdi"` capture needs `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (part of Windows 10/11). Use `--capture screenshot-desktop` meanwhile. |
| `Screen capture is unavailable` | Only the `screenshot-desktop` fallback uses `sharp`. Re-run `npm install` so it fetches its native binary for your platform. |
| `No film called ... found` | Use the full title, add the year, use `--series` for a TV series, or `--look <name>`. |
| `Wikipedia is limiting requests` | Wait as long as it says, or use `--look`. Titles that worked before come from the cache. |
| Low FPS in `sync -v` | Capture time is the limit. With `"capture": "gdi"` it is ~20–35 ms; `screenshot-desktop` takes ~370 ms per frame on Windows (it compiles its helper on every frame). |
| `'screenCapture_1.3.3.bat' is not recognized` (screenshot-desktop) | The environment variable `NoDefaultCurrentDirectoryInExePath` is set (some agent and CI shells set it), so `cmd.exe` won't run the `.bat` that screenshot-desktop starts by bare name from its folder. Unset it for that command, or use the `"gdi"` capture, which starts its helper by full path. |
