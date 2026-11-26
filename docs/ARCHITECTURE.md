# Architecture

AmbientLight is a TypeScript monorepo. One platform-agnostic **core** holds the WiZ protocol and the whole
color pipeline. Each platform (PC CLI, Electron, React Native) only supplies two small adapters:
a way to **capture the screen** and a way to **send UDP packets**.

## Pipeline

```mermaid
flowchart LR
  subgraph Platform adapter
    CAP[ScreenCapturer<br/>GDI helper / screenshot-desktop + sharp<br/>desktopCapturer / MediaProjection]
    UDP[UdpSocket<br/>node:dgram / react-native-udp]
  end
  subgraph "@ambientlight/core"
    AVG[analyzeFrame<br/>linear-light mean +<br/>dominant hue family]
    EMA[EmaSmoother<br/>reset on scene cuts]
    CAL[calibrate<br/>hue/brightness split,<br/>saturation + gamma,<br/>white LEDs for grays,<br/>hue + w for pale colors]
    GATE{changed ≥ minChange<br/>or keep-alive due?}
    WIZ[WizLight.setColor<br/>setPilot JSON]
  end
  BULB((WiZ bulb<br/>UDP 38899))

  CAP -->|PixelFrame 64×36| AVG --> EMA --> CAL --> GATE -->|yes| WIZ --> UDP --> BULB
  GATE -->|no| SKIP[skip]
```

`SyncEngine` drives this loop at the configured FPS (default 20, the rate measured to work on the user's WiZ bulb).

### Latency budget

Measured on the user's PC (Windows 11, one 1920×1080 display at 125 % scaling, 64×36 frames), 2026-11-21:

| Stage | Before | Now |
| --- | --- | --- |
| Capture | 367 ms p50 / 408 ms p95 (`screenshot-desktop`), 685 ms with `screen` set | 32 ms p50 / 35 ms p95 (`"capture": "gdi"`); 260 ms once for the first compile + start |
| Frame rate | ~2.7 FPS at `fps` 10 (capture-bound); 8.8 FPS once capture was fast (timer drift) | 10.0 at `fps` 10; **20.0 at `fps` 20**, now the default (capture 24–41 ms over a ~23-minute run on the real bulb, which kept up) |
| Smoothing | 90 % of a change after ~330 ms (`smoothing` 0.5); only hue jumps > 60° snapped | ~190 ms (`smoothing` 0.7); scene cuts (`sceneCut`) and hue jumps show at once |
| Analysis, `setPilot` send | well under 1 ms | unchanged |
| Wi-Fi + bulb | not measured end to end; `npm run check-bulb` shows the reply time | — |

On average a change on screen waits half a frame interval (25 ms at 20 FPS, 50 ms at 10) before it is captured, plus
the capture itself. `minChange` keeps the bulb from being flooded: in that ~23-minute run, 14 % of the frames
(4,081 of 28,344) were sent. No `setPilot` parameter makes the bulb apply a color faster ([WIZ_PROTOCOL.md](WIZ_PROTOCOL.md#practical-limits)).

## Packages

### `packages/core` (`@ambientlight/core`)

| Module | Responsibility |
| --- | --- |
| `wiz/constants.ts` | Port 38899, dimming 10–100, broadcast address |
| `wiz/protocol.ts` | `setPilot` / `getPilot` JSON encoding, value sanitizing, reply parsing, `pilotToRestoreParams` |
| `wiz/socket.ts` | `UdpSocket` interface implemented by each platform |
| `wiz/light.ts` | `WizLight`: one bulb. `setColor`/`setPilot` (fire-and-forget), `request` (reply matched by IP + method, one retransmit after 400 ms), `getPilot`, `getSystemConfig`, `getModelConfig`, `setPilotConfirmed`, `turnOn`, `turnOff` |
| `wiz/device.ts` | `SystemConfig`/`ModelConfig` types, `bulbKindFromModule` (color, tunable white, dimmable white, plug) |
| `wiz/identify.ts` | `identifyBulb`: flashes one bulb (white LEDs, then off, twice) and restores its previous state |
| `wiz/check.ts` | `checkBulb`: reachability, model, firmware, signed-firmware detection, test color and restore; shared by the CLI and future apps |
| `wiz/discovery.ts` | `discoverBulbs`: broadcast `getPilot`, collect replies |
| `color/average.ts` | `analyzeFrame`: plain mean of a `PixelFrame` in linear light (brightness) plus a vivid-weighted mean of the dominant hue family (hue); `averageColor` returns the plain mean. RGB/RGBA/BGR(A), optional sampling step. `frameChange`: mean absolute channel difference of two frames (scene-cut detection) |
| `color/calibration.ts` | `calibrate`: turns a screen color into WiZ `{r,g,b,c,w,dimming}` (pale colors as hue + white LEDs), or `{temp,dimming}` for near-gray colors; `previewRgb` shows the color a `WizColor` makes |
| `color/looks.ts` | `FILM_LOOKS`, `lookForGenres` (genre words → look), `applyLook` (look on top of the user's calibration), `scaleBrightness` (the brightness setting: 70 = `DESIGN_BRIGHTNESS` = as designed), `turnHue` (small, bounded hue lean) |
| `color/game-looks.ts` | `GAME_LOOKS` (a film look's colors plus a `pace`), `gameLookForGenres`, `applyPace` (fast/calm move `smoothing` and `sceneCut`) |
| `color/look-tuning.ts` | `LookTuning` (brightness, warmth, vividness: steps −2…2), `TUNING_WORDS` (the words an AI picks, one per step), `stepOf`, `tuneLook` (a film or game look nudged in fixed steps, within the bulb's ranges), `tuningWords` |
| `color/smoothing.ts` | `EmaSmoother`, `colorDistance` |
| `sync/engine.ts` | `SyncEngine`: the capture → process → transmit loop on fixed frame times; resets the smoothers on scene cuts |
| `sync/session.ts` | `SyncSession`: one sync run for an app. Reads the bulbs' states, runs a `SyncEngine`, restarts it with new options or another capturer while running (`update`), restores the bulbs on `stop`. Calls are queued, so a double click can't interleave them |
| `sync/types.ts` | `ScreenCapturer` and `ColorSink` interfaces |
| `weather/rain.ts` | `assessRain`: turns a `WeatherSnapshot` (alerts, forecast, airport report) into a `RainLevel` and the facts behind it. No I/O |
| `platform/timers.ts` | `setTimeout` and the clock without Node.js or DOM typings |

**Rule:** the core must not import `node:*` modules or use Node.js/DOM-only globals. Its `tsconfig.json`
sets `"types": []` so the compiler enforces this. That's what lets the React Native app reuse it.

### `packages/node` (`@ambientlight/node`)

The Node.js adapters that the CLI and the desktop app share (moved out of `apps/pc-cli` on 2026-11-23). Nothing here
prints to the terminal or reads command-line flags. Errors meant for the user are `UserError`s (the CLI's
`CliError` is the same class).

| File | Responsibility |
| --- | --- |
| `udp.ts` | `UdpSocket` over `node:dgram` (ephemeral port, optional broadcast) |
| `gdi-capture.ts` | `GdiCapturer` (`"capture": "gdi"`, the Windows default): compiles `native/gdi-capture.cs` once into `%LOCALAPPDATA%\AmbientLight\gdi-capture-<hash>.exe`, keeps it running, and reads one 64×36 BGRA frame per request over stdin/stdout. `FrameAssembler` splits the byte stream into frames. A bundled app passes the `.cs` path as `helperSource` |
| `native/gdi-capture.cs` | The helper (C# 5, compiled by the `csc.exe` that ships with Windows): per-monitor DPI-aware, `BitBlt` of the display into a bitmap allocated once, `StretchBlt` with `HALFTONE` (area average, measured within 0.5 of the true mean) down to the frame size. Resends the last frame while the secure desktop (UAC, lock screen) blocks capture |
| `network.ts` | Subnet broadcast addresses for every LAN adapter (reliable discovery on Windows) |
| `config.ts` | `ambientlight.config.json`: `AppConfig`, defaults, ranges, validation, `applyConfigFile` (defaults ← file), `checkConfigLimits`, `saveConfigFile` (validates, then writes through a temporary file), `syncOptionsFor` (config + film or game look → `SyncEngine` options) |
| `film.ts` | `findTitle` / `lookForTitle`: one Wikipedia (film, game) or TVmaze (series) request, exact-title pickers (`pickFilm`, `pickGame`, `pickSeries`), title cache with the summary (`summaryText`). Failures are `TitleError`s with a `code` (`offline`, `rate-limited`, `not-found` with `similar` titles, `no-genre`, …) so each app words its own advice. With a `LookTuner`, `lookForTitle` has the look tuned by AI (decision 17) and caches the answer |
| `ai.ts` | `createAiClient`: one chat-completions POST to Gemini or Groq (whichever key is set), JSON schema, timeout, errors without the key. `loadEnvFileIn` reads `.env`. Shared by the look tuner and the rain advice |
| `look-ai.ts` | `createLookTuner` (prompt and schema for a look tuning), `checkTuning` (accepts only `TUNING_WORDS` and a short reason) |
| `displays.ts` | `listDisplays` through screenshot-desktop, without sharp |
| `errors.ts` | `UserError`, `errorMessage` |

### `apps/pc-cli` (`@ambientlight/pc-cli`)

| File | Responsibility |
| --- | --- |
| `capture.ts` | `DesktopCapturer` (`"capture": "screenshot-desktop"`, the fallback): `screenshot-desktop` JPEG → `sharp` resize to 64×36 raw RGB; `listDisplays` for the `displays` command (its ids work for both backends) |
| `cli.ts` / `config.ts` | Argument parsing; `resolveConfig`: defaults ← file ← flags (the file handling is in `@ambientlight/node`) |
| `commands.ts` | `discover`, `state`, `displays`, `color`, `once` (reads the bulb back after sending, optionally saves the frame), `sync` |
| `check.ts` | `check` (`npm run check-bulb`): runs `checkBulb` on each bulb and prints the report |
| `frame-file.ts` | `saveFramePng`: writes the analyzed frame as a PNG for `once --save-frame` |
| `film.ts` | `--film`, `--series`, `--look`, `--game`, `--game-look` → a look (`chooseLook`), and the text that describes it |
| `weather.ts` | `WeatherClient`: fetches and validates BMKG forecast, BMKG CAP alerts (cached per file) and METAR |
| `advisor.ts` | Optional AI advice through `createAiClient` (`@ambientlight/node`), checked against what the rules allow |
| `rain.ts` | The `rain` command: 2-minute loop, signal colors, simulations, keep-alive, restore on exit |
| `log.ts` | Live status line with a true-color swatch |

### `apps/desktop` (`@ambientlight/desktop`, Windows)

An Electron app built with electron-vite (React, Tailwind). The workspace packages are bundled from their TypeScript
sources; `screenshot-desktop` stays external because it runs files from its own folder.

```mermaid
flowchart LR
  subgraph Renderer["Renderer (React, sandboxed)"]
    UI[Home, Find bulbs]
  end
  subgraph Main["Main process (Node.js)"]
    CTRL[AppController]
    SESS[SyncSession]
    GDI[GdiCapturer]
    UDP[UdpSocket]
  end
  UI -- "window.ambient (preload, invoke)" --> CTRL
  CTRL -- "ambient:state, ambient:frame (≤ 10/s)" --> UI
  CTRL --> SESS --> GDI
  SESS --> UDP --> BULB((WiZ bulb))
```

| File | Responsibility |
| --- | --- |
| `src/shared/api.ts` | The IPC contract: `AmbientApi` (what `window.ambient` offers), `AppState`, `FrameView`, channel names |
| `src/main/index.ts` | Electron: single-instance lock, the window (`contextIsolation`, `sandbox`, no Node.js in the renderer, links open in the browser), IPC handlers, config location, restore before quitting |
| `src/main/controller.ts` | `AppController`: config, film or game look (with its AI tuning), discovery, Blink, one `SyncSession`; publishes state changes and frame views. Electron, the network and capture come in through a `Platform`, so tests use fakes |
| `src/main/frame-view.ts` | `FrameReport` → `FrameView` (hex colors, the bulb's color with white LEDs drawn at their temperature, fps, share sent), at most one per 100 ms. The capture time is the mean of every frame since the previous view: a frame passes the 100 ms gate more often when its own capture was slow, so its time alone read ~9 ms high. `frameLogLine`: one line per frame for `AMBIENTLIGHT_VERBOSE=1` |
| `src/main/validate.ts` | Checks every IPC argument (IPv4 addresses, at most 16 bulbs, known looks, title length). A look from the renderer loses any AI tuning: tunings only come from a lookup in the main process |
| `src/preload/index.ts` | `contextBridge` → `window.ambient`; built as CommonJS, which a sandboxed preload needs |
| `src/renderer/src` | The React UI; `model/` holds DOM-free helpers (look chips, status and error text) that a React Native app could reuse; `mock-api.ts` stands in for the main process in a plain browser |

Decisions:

- **The engine runs in the main process,** next to UDP and the capture helper. The renderer only draws: it gets at
  most 10 frame views a second, so a busy UI can't slow the sync.
- **Settings:** `%APPDATA%\AmbientLight\ambientlight.config.json` (or `AMBIENTLIGHT_CONFIG`), the same format as the
  CLI's. The first start copies the CLI's config. `saveConfigFile` writes only values that differ from the defaults,
  so tuned defaults still reach existing users.
- **Quitting always restores:** `before-quit` waits for `AppController.shutdown()` (stop the session, send each bulb
  its saved state) before the app exits, whether the user pressed Stop, closed the window or quit.
- **Expected failures are values, not exceptions:** a title lookup returns its `TitleError` code and Blink returns
  `ok: false`, so the renderer words them itself. Unexpected errors are logged in the main process.

## Design decisions

1. **Average in linear light.** Screens emit light linearly in physical terms. A half-white, half-black
   frame averages to sRGB ≈188, not 128, which matches the room brightness you'd expect.
2. **Split hue from brightness.** WiZ treats `r,g,b` as the color mix and `dimming` as brightness.
   `calibrate` normalizes the color to full value (brightest channel = 255) and maps screen brightness
   onto `minDimming..maxDimming`. A dark red scene therefore gives a dim red, not a muddy brown.
   Colors look dim on the bulb, so for them the bottom of that range can rise to `colorBaseBrightness`
   (default 10 = off). Raising `minDimming` instead would also light the room on black and gray screens. The lift
   has two ramps. It fades in over saturation 0.20–0.35 (with the default `whiteSaturation`), so it is zero wherever
   white mode can switch and switching doesn't jump. It also fades in over screen brightness 0.04–0.08 (from
   `blackThreshold`), so black and near-black noise stay dark. The top of the range doesn't move.
3. **Saturation boost and gamma.** Averaging many pixels washes colors toward gray. Both knobs bring the
   color back. Defaults (1.3 / 1.6) are a starting point for Phase 3 calibration.
4. **Hue from vivid pixels, brightness from the whole screen.** `analyzeFrame` returns two averages. In the
   color one, a pixel counts `1 + colorWeighting × 9 × (saturation × brightness)²` times, so a video in part of
   the screen sets the hue while a small icon on a white page doesn't. `dimming` comes from the plain average.
5. **Dominant color, not a mix of hues.** Averaging different hues gives a color that isn't on screen: red +
   green turns orange, blue + orange turns lavender, many colors turn a pale peach. With `colorMode: "dominant"`
   (the default), `analyzeFrame` sorts colorful pixels (chroma, i.e. max − min channel, ≥ 0.12) into 36 hue bins
   of 10°. Each pixel votes with its chroma, so both area and vividness count. The 50° window with the most votes
   is the dominant hue family; only its pixels and the neutral ones (gray, white, black) are averaged. Close hues
   (red and orange) still blend, and white areas still wash the color out, so a small icon on a white page stays
   white. The previous frame's hue family wins unless another one has 1.3× its votes (`HUE_STICKINESS`), so two
   similar-sized colors don't make the light jump between them. `colorMode: "average"` mixes everything instead.
   When the dominant hue does jump more than 60° between frames (`SCENE_CUT_HUE`), `SyncEngine` treats it as a
   scene cut and resets both smoothers, so the new color and brightness show at once. `EmaSmoother` blends in
   RGB, and a fade between hues that far apart passes a muddy color (red → green: olive, shown as brownish
   yellow); up to 60° it stays vivid (red → yellow passes orange). A frame whose pixels changed by `sceneCut`
   (40) or more on average (`frameChange`, 0–255 per channel) is a scene cut too, so hard cuts in brightness
   (a dark scene cutting to a bright one) or within one hue family snap as well (idea from MihirGupta07/wiz-sync,
   which snaps above 40). A red → orange change of the whole screen (43) already counts; motion inside a scene
   stays well below. 40 is a starting point for Phase 3 tuning; `sync -v` marks cut frames.
6. **White LEDs for grays.** WiZ bulbs mix RGB white from their red, green and blue LEDs, and it looks
   lavender (a bulb told `rgb(255,254,255)` shows as `#FF00FF` in the WiZ app, which reads only the hue from
   `r,g,b` and the paleness from the white LEDs; see decision 7). Below `whiteSaturation` (0.15,
   after the boost) `calibrate` returns `temp` instead, and `WizLight.setColor` sends `{temp, dimming}`. A color
   must rise 0.05 above the threshold to leave white mode again, so scenes near it don't flicker between modes.
7. **Pale colors as hue + white LEDs.** The WiZ app sends a pale color as the pure hue on `r,g,b` (smallest
   channel 0) plus the white LEDs, and reads saturation back from them. A pale color mixed from the RGB LEDs alone
   looks pink: `rgb(255,188,133)` (a peach) lit the bulb magenta, and the app reported it as `#FF7300`. So
   `calibrate` encodes colors as the app does (one exception, below), fitted to 11 readings of the app's own colors
   ([WIZ_PROTOCOL.md](WIZ_PROTOCOL.md#pale-colors-hue-on-rgb-paleness-on-the-white-leds)): the hue level rises
   with saturation, white stays at `paleWhite` (140) up to saturation 0.5 and then fades out, and the white is
   tinted by the hue (warm for red, cold for blue). `c` and `w` are always sent, 0 for saturated colors, so no
   white lingers from the previous frame. `previewRgb` undoes the encoding for logs. `paleWhite: 0` restores
   the RGB-only mix.
   **Exception: muted greens** (`mutedGreenCorrection`). The app's tint depends only on the hue, and
   `saturationBoost` plus `gamma` raise the saturation first, so a measured doorway shot (`32,35,25`: saturation
   0.29, about 5400 K, a slightly green white) became saturation 0.52 on 67 % warm white and lit the room yellow.
   For such scenes `calibrate` moves boost and gamma back to 1 and the white to the cold LEDs, which is the light
   the user picked on the bulb. White mode and `dimming` are decided before it, so neither changes. It fades by
   three limits, each there to protect something:

   | Limit | Full effect | No effect | Protects |
   | --- | --- | --- | --- |
   | Hue | 65–150° | below 50°, above 170° | orange, skin, beige, gold; teal and blue |
   | Saturation before the boost | up to 0.35 | from 0.5 | grass, vivid colors |
   | Screen brightness | up to 0.5 | from 0.7 | bright pages (mint, pale yellow), daylight scenes |

   It is a rule on the average color, because the app can't recognize a shot. Matching just that one color failed:
   in 6 of 15 simulated camera moves (crops) the same shot fell out of the range and turned yellow again. The
   saturation fade is 0.15 wide to keep steps at 16 or less (of 255) per 0.01 of saturation.
8. **No backlog, newest frame wins.** The loop handles one frame at a time and sleeps until the next fixed frame
   time (`start + n × interval`). Windows rounds timers up to ~16 ms, so sleeping `interval − elapsed` after each
   frame made every frame late and gave 8.8 instead of 10 FPS; with fixed frame times a late wake-up shortens the
   next wait. If a frame overruns its slot (slow capture), the next one starts at once, without a burst to catch
   up, so the frame rate drops gracefully instead of queuing stale colors. A bulb that is behind is never flooded.
   Smoothing is time-based: `EmaSmoother` scales each step by the time since the previous frame (`smoothing` is
   the share covered per 100 ms), so a slow capture or another `fps` doesn't change how fast the light follows.
9. **Change threshold plus keep-alive.** Frames that barely changed aren't sent, which spares the bulb's
   processor. Because UDP can drop packets, the current color is re-sent every `keepAliveMs` anyway.
10. **Restore on exit.** `sync` reads each bulb's state with `getPilot` before starting. When it stops, it
   restores that state (scene, white temperature, or color, plus brightness).
11. **Monorepo wiring.** npm workspaces and TypeScript project references are used. The core's
   `package.json` has a `"development"` export condition that points at `src/index.ts`. Dev scripts run
   `tsx --conditions=development`, so the CLI runs from source without building the core first. The
   normal build (`tsc -b`) uses `dist/`.
12. **A capture helper that stays running.** Node.js can't call the Windows screen APIs itself; it needs a native
   addon or a helper process. `screenshot-desktop` 1.15 uses a helper process but writes it into a new temp
   folder for every frame. So every frame starts `cmd.exe`, searches for `csc.exe`, compiles the C# helper, starts
   .NET, copies the screen, encodes a full-size JPEG to disk, and Node reads and decodes it (367 ms). The actual
   screen copy is a small part of that. `GdiCapturer` compiles its own helper once (cached by a hash of the
   source, so a source change rebuilds it), starts it once, and asks for frames over a pipe. The helper shrinks
   the frame in GDI, so ~9 KB cross the pipe instead of a JPEG. That leaves the `BitBlt` of the desktop (~30 ms
   at 1080p), which costs the same from C#, C++ or Rust. The helper declares itself per-monitor DPI-aware, so at
   125 % scaling it copies all 1920×1080 physical pixels. node-screenshots (an in-process Rust addon doing the
   same GDI copy) was the alternative. It needs a new native dependency, copies the full 8 MB frame into
   JavaScript, and XCap doesn't set DPI awareness, so it may capture the wrong area at 125 %. If GDI ever isn't
   enough, DXGI Desktop Duplication with a GPU downscale (HyperHDR, Lightpack) is the next step
   ([ROADMAP.md](ROADMAP.md#later-ideas)).
   The helper's byte order was checked on 2026-11-22: a full-screen pure blue window arrived as `[255,0,0,0]`
   (BGRX) and was analyzed as hue 240.
13. **Film looks change the calibration, plus a bounded hue turn.** Settings alone never change the hue, and blending
   in a genre color broke colors (sky → white, hues off by up to 179°). So `applyLook` derives a calibration, and
   `turnHue` runs between smoothing and `calibrate` (scene-cut detection keeps seeing the screen's own hue). The turn
   peaks at 20° for colors 60° from the look's hue and is gone from 120°; with a wider reach a warm look turned teal
   green and the scifi look turned warm scenes red. It fades out on muted greens (decision 7). The color base shrinks
   with a lowered `maxDimming`, or all scenes would get the same brightness.
   **Brightness setting (2026-11-23).** `syncOptionsFor` scales the result with `scaleBrightness(…, brightness / 70)`.
   The user picked the rule: 70 is the look as designed and the scale is linear on both sides, so the setting
   always does something under a dim look and can brighten it past its design (Horror 45 % → 64 % at 100). A cap
   that only lowers (the lower of the two wins) would leave the slider dead above 45 under Horror. The color base
   moves with the cap, as in `applyLook`.
14. **One request per title, never a guess.** Wikimedia allows 10 requests a minute to clients without contact details,
   and a Wikidata lookup (several requests) hit that limit within seconds. One Wikipedia search returns the first
   sentences of 10 candidates, which name the main genre ("is a 2017 Indonesian supernatural horror film") and other
   names of the film. Only an exact match is accepted, because the top search result for "Wednesday" was "Big
   Wednesday". The lookup happens before the bulb is touched and is cached.
15. **The desktop app captures with the GDI helper, not `desktopCapturer` (2026-11-23).** The targets are Windows
   and Android only. Neither backend works on Android, which needs the planned Kotlin `MediaProjection` module;
   what Android shares is everything behind `ScreenCapturer`. Compared for Windows:

   | | GDI helper (decision 12) | `desktopCapturer` stream | `desktopCapturer.getSources` thumbnails |
   | --- | --- | --- | --- |
   | How | `BitBlt` + `StretchBlt HALFTONE` to 64×36 in a helper that stays running, 9 KB over a pipe | Chromium's screen capturer → `MediaStream` → `<video>`/`VideoFrame` → `drawImage` at 64×36 on the GPU → `getImageData`, in a hidden renderer, then IPC to the main process | One `getSources` call per frame |
   | Capture | **32 ms p50, 35 ms p95 (measured)**; in the desktop app 32 / 36 ms (27 / 37 with its window minimized) | Frames are pushed, so a capture returns the newest one; a few ms of own work (estimate) | Electron's docs call thumbnails expensive: each call enumerates and renders the sources (estimate: too slow for 20 FPS) |
   | Frame rate | **20.0 held for 23 min (measured)**; 20.0 in the desktop app | The bulb's 20 FPS stays the limit, so the possible gain is up to ~30 ms less latency, not more FPS | Likely under 10 |
   | Color | Area average **within 0.5 of the true mean (measured)** | Risk: a 30× downscale in `drawImage` may sample instead of average (depends on Chromium's filter), giving noisy colors | Unknown |
   | Lock screen, UAC | Resends the last frame | The stream can end and must be restarted | Unknown |
   | Packaging | The `.cs` source ships with the app; compiled once by Windows' own `csc.exe` (~260 ms) | Nothing to compile; needs a hidden window with `backgroundThrottling: false` and a display-media permission handler | Same as the stream |

   Only the GDI column is measured, so the desktop app starts with it. On the user's PC on 2026-11-23 the app (Electron
   main process) held 20.0 FPS (1,198 frames in 60 s), and its colors equaled `npm run once` exactly on 8 of 8
   checks. In the same session plain Node timed the helper at 25 ms p50 / 36 ms p95, so the app may add a few
   milliseconds to the median while its window redraws; the 95th percentile is the same. A benchmark on the user's PC decides whether
   `desktopCapturer` replaces it ([ROADMAP.md](ROADMAP.md#phase-4-desktop-app-electron-and-android-port-react-native-)).
   The desktop app doesn't load `sharp`: it only serves the CLI's `screenshot-desktop` fallback (~2.7 FPS) and PNG
   saving, which Electron's `nativeImage` covers, and a native module would need unpacking in the installer.
16. **Game looks are film colors plus a pace (2026-11-24).** Games differ from each other less in mood than in how
   fast the screen changes, and the eight film looks' colors are already measured (decision 13). So a game look is
   `{ ...FILM_LOOKS.x, pace }` (`color/game-looks.ts`), picked by the user (2026-11-24) over separate game colors that
   no one has tuned. The pace only moves the user's own response settings its way (`applyPace`), as a look only
   lowers `maxDimming`: fast sets `smoothing` to at least 0.95 (90 % of a change after ~77 ms instead of ~190 ms;
   at 20 FPS a one-frame flash reaches the bulb at ~78 %) and `sceneCut` to at most 25 (a guess, unmeasured). The
   user chose 0.95 over 1.0 (no smoothing), which would send every muzzle flash and blinking HUD element at full
   strength; `--smoothing 1` still gives 1.0. On the real bulb, 0.95 felt right to the user (Monster Hunter Rise,
   2026-11-24). Calm sets `smoothing` to at most 0.4 (~450 ms) for menus and maps.
   The lookup is the film lookup (decision 14) with another sentence rule: the first sentence must call the subject
   a game ("is a 2022 action role-playing game"), stay inside that sentence (a publisher's article mentions games
   in the next one), and not be about a board, tabletop or dice game, a game series, or a person. Capture needs
   nothing new: the GDI helper (decision 12) captured Monster Hunter Rise live in borderless and in exclusive full
   screen (2026-11-24, [ROADMAP.md](ROADMAP.md#film-looks-)), though the capture took ~49 ms instead of ~38 ms
   while the game ran.
17. **An AI nudges a title's look in fixed steps (2026-11-24).** The genre rules can't tell two horror films apart, but
   a title's summary can. So with a Gemini or Groq key, `lookForTitle` sends the summary (Wikipedia's introduction or
   TVmaze's summary, both CC BY-SA), the title, its genre words and the genre look's numbers, and the AI answers with a
   reason and one word per control:

   ```mermaid
   flowchart LR
     TITLE[Title] --> LOOKUP[Wikipedia / TVmaze]
     LOOKUP -->|genre words| RULES[lookForGenres]
     RULES --> BASE[Genre look]
     LOOKUP -->|summary| AI[AI model, optional]
     BASE -->|numbers| AI
     AI --> GUARD[checkTuning]
     GUARD -->|steps −2…2| TUNE[tuneLook]
     BASE --> TUNE
     TUNE --> SYNC[syncOptionsFor]
   ```

   - **Words, not numbers.** The AI picks from five words per control ("dimmer", "much warmer"); `TUNING_WORDS` maps them
     to steps and `TUNING_STEP_SIZES` to numbers (brightness cap ±10 and color base ±5, white ∓800 K, saturation
     ±15 %), so the code decides how far a step goes. The schema uses string enums because support for integer enums in
     Gemini's OpenAI-compatible endpoint is uncertain; `checkTuning` rejects any other value anyway, like
     `checkAdvice` in the rain signal.
   - **Three controls, chosen by the user (2026-11-24): brightness, warmth, vividness.** The hue lean stays the
     genre's. Hue is where looks went wrong before (scifi looked like romance, decision 13), and no tuned hue was
     measured on frames. Steps are large because a few % of dimming is invisible on the user's bulb. Warmth only
     shows in white and gray scenes, since `whiteTemp` is only used there.
   - **Wait, then sync.** The lookup already finishes before the bulb is touched, so the AI is waited for (10 s at
     most) instead of switching the look mid-sync; the CLI's `SyncEngine` path stays as it was. On any failure the
     genre look is used and `aiError` says why.
   - **Cached once per title and look** (`look-tuning:v<TUNING_VERSION>:<url>:<set>:<name>`), so a rehearsed demo gets
     the same light, free quotas are spared, and a changed genre look is asked again. Title cache entries from before
     summaries were kept are looked up again once, and still used if that lookup fails.
   - **The AI never sees the screen or the user's settings,** only public facts about the title.

## Rain signal

A prototype of an option that is on hold ([ROADMAP.md](ROADMAP.md#option-rain-signal-on-hold)).

```mermaid
flowchart LR
  BMKG[BMKG alerts and forecast] --> RULES[assessRain]
  METAR[METAR airport report] --> RULES
  RULES -->|color at once| BULB((WiZ bulb))
  RULES -->|facts and allowed levels| AI[AI model, optional]
  PLAN[User's plan] --> AI
  AI --> GUARD[checkAdvice]
  GUARD -->|allowed color and one sentence| BULB
```

1. **Rules before AI.** The bulb gets the rule color before the AI is called, so a slow or failing model can't delay
   a warning. `checkAdvice` then rejects levels outside `ALLOWED` and invented times.
2. **Never green on missing data.** Any failed or stale source gives `unknown`, except that a known danger still
   shows red. A changed alert format throws instead of reading as "no alerts".
3. **Polygons, not titles.** An alert titled "Jakarta" covered Depok, Bogor and South Tangerang but neither test point in central
   Jakarta, so every alert in the list is read and matched by polygon and time. Files are cached, which keeps the
   requests under BMKG's 60 per minute.
4. **No SDK.** Both AI providers take the same single POST, so `fetch` is enough and the provider follows the key
   (`createAiClient` in `@ambientlight/node`, shared with the look tuning).
   The AI is asked again only when the facts change or the last call failed, to spare free quotas.

## Adding a platform (Phase 4)

1. Implement `UdpSocket` (send, onMessage, close) on top of the platform's UDP API.
2. Implement `ScreenCapturer.capture()` to return a small `PixelFrame`. Downscale natively; set `order: "bgr"`
   if the native buffer is BGRA.
3. Create `WizLight`s and a `SyncEngine` from `@ambientlight/core`, then call `start()` / `stop()`.

- **Electron (Windows):** capture with the GDI helper in the main process (decision 15), and do UDP there with
  `node:dgram`, reusing the CLI's adapters. The renderer shows the UI only ([UI_DESIGN.md](UI_DESIGN.md)).
- **Android:** a Kotlin foreground service runs `MediaProjection` → `ImageReader`, downscales, and streams
  RGB (or a pre-averaged color) to TypeScript. UDP goes through `react-native-udp`.
