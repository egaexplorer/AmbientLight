# Reference study notes

What the 16 open-source references in [PROJECT_GUIDE.md](PROJECT_GUIDE.md#6-open-source-references) do, and
what AmbientLight can learn from them. Each lesson names the AmbientLight module it would change. Planned work
that came out of this study is tracked in [ROADMAP.md](ROADMAP.md).

## Local clones

The references are cloned (shallow, read-only) next to this repository, outside git:

```text
C:\AI_Sandbox\Project\AmbientLight-references\<owner>__<repo>
```

Cloned on 2026-11-21. To recreate a clone, run this from `AmbientLight-references`:

```bash
git clone --depth 1 --filter=blob:limit=2m https://github.com/<owner>/<repo>.git <owner>__<repo>
```

| Folder | Commit | Last commit | License |
| --- | --- | --- | --- |
| `one-adnan__ambient-setup` | `eef5792` | 2026-11-16 | none |
| `namanb-lab__wiz-sync` | `10b0adb` | 2026-10-29 | none |
| `MihirGupta07__wiz-sync` | `b12d68e` | 2026-10-26 | none |
| `awawa-dev__HyperHDR` | `89fc6f0` | 2026-11-14 | MIT |
| `uditkarode__wikari` | `224043c` | 2025-10-26 | GPL-3.0 |
| `noturbob__wiz-pc` | `16f32d3` | 2026-09-17 | none |
| `shikhar13012001__wiz-led-nodejs` | `86d6c4e` | 2024-03-05 | none (ISC in `package.json`, no LICENSE file) |
| `sbidy__pywizlight` | `19e607a` | 2026-11-04 | MIT |
| `kpsuperplane__homebridge-wiz-lan` | `03f2ada` | 2026-10-24 | Apache-2.0 |
| `GreenSky-Productions__SignalRGB-WIZ-Network-Plugin` | `7223eee` | 2026-08-18 | none |
| `hyperion-project__hyperion.ng` | `126c534` | 2026-11-20 | MIT |
| `psieg__Lightpack` | `8e3bef8` | 2026-11-19 | GPL-3.0 |
| `kershner__screenBloom` | `f2e14c8` | 2018-06-07 | none |
| `nashaofu__node-screenshots` | `c74c32b` | 2026-02-07 | MIT |
| `evanwhitt__hyperion-android-reborn` | `b25fccb` | 2026-08-07 | MIT |
| `tradle__react-native-udp` | `8422c40` | 2023-01-26 | MIT |

**Rule for using them:** these notes describe ideas in our own words. Never copy code from the GPL-3.0 or
unlicensed repositories into AmbientLight; write it independently. Code from MIT or Apache-2.0 projects may be
reused only with its copyright and license notice (see the license note in PROJECT_GUIDE.md).

## What AmbientLight already does right

Several design decisions in [ARCHITECTURE.md](ARCHITECTURE.md) match what the more mature projects converged on:

- **Hue and brightness are split.** ambient-setup, namanb-lab/wiz-sync and MihirGupta07/wiz-sync all send a
  full-strength hue in `r,g,b` and put brightness in `dimming`, like `calibrate()`. HyperHDR's WiZ driver and the
  SignalRGB plugin send raw RGB with a fixed `dimming`, which wastes the bulb's range in dark scenes.
- **Averaging in linear light** (`averageColor`) is what ambient-setup does too.
- **Newest frame wins, no queue** (`SyncEngine`). wiz-pc's scheduler is built around the same rule;
  wiz-led-nodejs shows the failure mode (a FIFO queue with a 300 ms gap that builds a backlog of stale colors).
- **Keep-alive re-send** (`keepAliveMs`). MihirGupta07/wiz-sync re-sends every 1 s for the same reason.
- **Subnet broadcast on every adapter** (`apps/pc-cli/src/network.ts`). HyperHDR's WiZ discovery does the same.

## Top lessons, ranked

| # | Lesson | Affects | Source |
| --- | --- | --- | --- |
| 1 | Newer WiZ firmware rejects unsigned `setPilot` (`-32602`). Detect it and support an optional signing key. | `wiz/protocol.ts`, `wiz/light.ts`, `pc-cli` `color`/`sync` | pywizlight |
| 2 | Make smoothing time-based (`1 − e^(−dt/τ)`) and snap on scene cuts. | `color/smoothing.ts`, `sync/engine.ts` | HyperHDR, MihirGupta07 |
| 3 | Below the black threshold, fade to a fixed warm glow (or hold the last hue) instead of keeping a noisy hue. | `color/calibration.ts` | ambient-setup, SignalRGB, namanb-lab |
| 4 | Take the hue from vivid pixels but the brightness from the plain luminance mean. | `color/average.ts`, `calibrate` | ambient-setup, namanb-lab, MihirGupta07, screenBloom |
| 5 | Route near-gray scenes to the white LEDs (`temp`), with hysteresis, and detect bulb type with `getSystemConfig`. | `calibrate`, `wiz/light.ts`, discovery | wiz-pc, namanb-lab, MihirGupta07, homebridge-wiz-lan |
| 6 | Hue compensation: extra saturation for green/yellow; per-channel gains scaled by saturation. | `calibrate` | ambient-setup, namanb-lab |
| 7 | Letterbox detection with a 3-line probe plus a stability counter. | new `color/letterbox.ts`, `average.ts` | HyperHDR, hyperion.ng, ambient-setup |
| 8 | Discovery: also broadcast `registration`; save bulbs by MAC and re-resolve the IP. | `wiz/discovery.ts`, `pc-cli` config | MihirGupta07, wiz-pc, SignalRGB, ambient-setup, HyperHDR |
| 9 | Retransmit `getPilot` once after ~400 ms; clamp dimming to the bulb's `minDimLevel`. | `wiz/light.ts` | homebridge-wiz-lan, pywizlight |
| 10 | Faster PC capture: `node-screenshots` now; reuse the last frame when the screen didn't change. | `apps/pc-cli/src/capture.ts` | node-screenshots, Prismatik |
| 11 | An `identify` command that flashes one bulb. | `pc-cli` `commands.ts` | ambient-setup, HyperHDR, namanb-lab |
| 12 | Presets (ambient / movie / gaming / relax) as bundles of existing options. | `pc-cli` config | ambient-setup |
| 13 | Android capture: tiny `VirtualDisplay`, `acquireLatestImage`, rotation and Android 14 rules. | `apps/android` (Phase 4) | namanb-lab, hyperion-android-reborn |

The per-repository sections below explain each lesson.

---

## Screen-sync apps for WiZ

### one-adnan/ambient-setup (Python, no license)

Cross-platform WiZ screen sync with a Tk GUI, presets and multi-bulb regions. Core loop in `ambient.py`.

Techniques:

- **Separate weights for color and brightness** (`Engine._update`). Brightness is the (optionally
  center-weighted) mean luminance. Color is a weighted mean where each pixel's weight grows with its brightness
  and saturation (`_vivid_weights`, blended in by `COLOR_WEIGHTING` 0–1). A red lamp in a dark room stays red
  instead of turning brown.
- **Center weighting and focus** (`_radial_weights`, `FOCUS`): weight rises toward the middle; gaming samples
  only the central 25 % of the screen.
- **Dark scenes fade to a warm neutral glow** (`finalize_color`): below `DARK_LEVEL` (≈0.08 of value) the color
  crossfades to `(255,150,80)` through a narrow smoothstep band (0.8×–1.2× the level). The comment notes that a
  wide band blends warm with blue into pink.
- **Hue-range boost**: hues 0.12–0.45 of the circle (green/yellow, ~43°–162°) get ×1.12 extra saturation.
- **Channel gains scaled by saturation**: `GAIN_R 1.2, GAIN_B 1.05` are applied in proportion to saturation, so
  grays and whites stay neutral while saturated reds get the correction.
- **Letterbox crop** (`crop_black_bars`): an edge row/column is a bar when fewer than 5 % of its pixels are lit
  (max channel above ≈ sRGB 20); at most 25 % per side is cropped; a fully black frame is left alone.
- **Presets** with concrete values, e.g. gaming: 16×16 sample, 0.03 s per frame, `FOCUS 0.25`, `MIN_BRIGHTNESS 30`;
  movie: letterbox crop, center weight 1.7; relax: max brightness 50 %, smoothing 0.92.
- **Bulbs saved by MAC** in `bulbs.json`, so a DHCP change doesn't break the setup. **Identify** lights one bulb
  green and turns the others off.

Applies to AmbientLight: lessons 3, 4, 6, 7, 11 and 12. Split `averageColor` output into a vivid-weighted color
and a plain luminance (or add a second function), add `darkColor`/`darkLevel` and saturation-scaled channel gains to
`CalibrationOptions`, and add presets on top of the existing options.

Skip: smoothing is applied to the final `r,g,b,dimming` and uses a per-frame alpha, so its feel changes with the
frame rate. Lesson 2 is the better model.

### namanb-lab/wiz-sync (Android and Android TV, no license)

Kotlin Android app; the whole source is generated from `.github/workflows/build.yml`.

Techniques:

- **The GPU downscales for free**: the `VirtualDisplay` is created at 96 px wide (height from the aspect ratio), so
  each frame is a tiny RGBA buffer. `ImageReader` holds 2 images and the listener uses `acquireLatestImage()`,
  dropping stale frames; it processes at most one frame per 100 ms.
- **Reads pixels with `rowStride`/`pixelStride`** (row padding is common on Android).
- **Color weighting**: pixels with max channel below 24 are skipped for color but still count toward brightness;
  weight = value² × (0.15 + saturation).
- **A frame with no usable color keeps the previous color** instead of sending a random hue.
- **Near-gray → white LEDs**: saturation below 0.12 sends `temp 4500` with the same dimming.
- **Pink problem**: the README notes that the bulb's red and blue LEDs overpower green, so scenes look pink. It
  clamps saturation to at least `minSat` (0.7) and defaults `gainB` to 0.8.
- **Discovery** broadcasts `registration`, then asks each bulb for `getSystemConfig` (model, firmware) and shows
  RSSI; a **blink** button identifies a bulb.
- Foreground service types: `mediaProjection` for capture (`FOREGROUND_SERVICE_MEDIA_PROJECTION` permission).
- Known limits it documents: DRM apps (Netflix) capture as black; some TVs have no capture-permission dialog;
  4K video can lag on TVs.

Applies to AmbientLight: lessons 3, 4, 5, 6 and 13. Its Android capture design is the template for the Phase 4
Kotlin module.

### MihirGupta07/wiz-sync (Windows, Python, no license)

Mostly an audio-reactive app (WASAPI loopback, beat/drop detection), plus a video-file mode.

Techniques:

- **Output gate** (`LightOut`): at most `SEND_HZ = 15` per second, only when the color changed by ≥4 in any channel,
  plus a 1 s keep-alive. Important events (beats, drops) bypass the rate limit, and a drop is sent **twice** because
  UDP has no retry. A **light delay** holds packets back so lights line up with Bluetooth speakers.
- **Time-based smoothing with scene cuts** (`video_to_color`): colors glide with a 0.25 s half-life
  (`a = 1 − 0.5^(dt/0.25)`) and **snap instantly** when the mean absolute pixel change exceeds 40 (a scene cut).
- **Color weighting**: weight = saturation² × value + 0.02, so vivid pixels dominate and a gray scene reads white.
  Brightness is the mean luma mapped to `10 + 90 × luma^0.6`.
- **Discovery** sends both `registration` and `getPilot` to `255.255.255.255`, the `/24` and the `/16` broadcast
  addresses, and binds the socket to the LAN IP so broadcasts don't leave through a VPN. The comment says some
  firmware only answers one of the two messages.
- **Bulb type** from `getSystemConfig.moduleName` (e.g. `ESP25_SHRGB_01`): `RGB` = color, `TW`/`DW` = white only.
- Restores the bulbs to warm white (`temp 2700, dimming 80`) on stop. AmbientLight's `pilotToRestoreParams`
  (restore the exact previous state) is better.

Applies to AmbientLight: lessons 2, 5 and 8. The scene-cut snap is the main idea for `SyncEngine`.
Later: the audio mode in ROADMAP "Later ideas".

---

## WiZ protocol libraries

### sbidy/pywizlight (Python, MIT)

The library behind Home Assistant's WiZ integration; the most complete protocol reference.

Techniques and protocol facts:

- **Signed requests on newer firmware** (README "Signed requests", `utils.py` `sign_request`). Some firmware replies
  with `"env":"pro"` and an `hmac` field. Reads still work, but an unsigned `setPilot` fails with `-32602 Invalid
  params`, and a wrong signature with `-32605 Security error`. The key is the `udp_signing_key` (32 hex characters,
  one per home) from the WiZ app's "local integration" export. To sign: add `sigTs` (Unix seconds) to `params`,
  compute HMAC-SHA256 over the compact JSON of `params` (no spaces) with the hex-decoded key, and send
  `{"method", "env":"pro", "params", "hmac": base64(digest)}`. The bulb rejects a `sigTs` about a minute old, so
  the PC clock must be correct.
- **Retries with backoff** (`bulb.py` `_send_udp_message_with_retry`): datagrams at 0, 0.75, 2.25, 5.25, 8.25 and
  11.25 s (max 6) until a reply arrives, 13 s total. Right for commands that must land, wrong for a 10 FPS stream.
- **Push updates** (`push_manager.py`): listen on UDP **38900**, send `registration` with `register: true`, the
  host IP and a generated MAC; bulbs then send `syncPilot` with their state and `firstBeat` when they boot. The
  library stopped acknowledging `syncPilot` because bulbs keep sending anyway. Keep-alive is 20 s. The Android
  WiZ app sends the literal string `test` to that port; ignore it.
- **Capabilities**: `getModelConfig` returns `minDimLevel` (bulbs that don't report it use 10) and newer firmware
  reports `cctRange` (e.g. `[2200,2700,6500,6500]`). `scenes.py` has the scene ID ↔ name table, including the
  HDMI sync box modes 201–204.

Applies to AmbientLight: lessons 1 and 9, plus facts for [WIZ_PROTOCOL.md](WIZ_PROTOCOL.md). Signing matters most:
`WizLight.setPilot` is fire-and-forget, so on signed firmware the bulb would silently ignore every color and
`npm run color` would look broken with no error. HMAC needs a platform crypto function, so it has to be injected
into the core (like `UdpSocket`); `packages/core` can't import `node:crypto`.

### uditkarode/wikari (TypeScript, GPL-3.0)

Typed Node.js library. Ideas only: no code may be copied.

- `subscribe()` sends `registration` with `register: true` and the host IP/MAC; the bulb then pushes `syncPilot`
  roughly every 5 s, and wikari acknowledges each one with a `syncPilot` reply carrying the same `id` and `env`.
  (pywizlight found the acknowledgement unnecessary.)
- One shared socket and one outstanding request at a time; replies are matched by bulb IP and method name,
  because WiZ replies carry no request id. AmbientLight's `getPilot` matches the same way.

Applies to AmbientLight: confirms the push-update protocol (ROADMAP "Later ideas").

### kpsuperplane/homebridge-wiz-lan (TypeScript, Apache-2.0)

Homebridge plugin that exposes WiZ bulbs and plugs to Apple Home. `src/util/network.ts` documents several hard
lessons about UDP to power-saving Wi-Fi bulbs:

- **`getPilot` retransmit once at 400 ms** within a 1 s timeout: one dropped packet then costs ~400 ms instead of
  the full timeout. Only once, because replies carry no request id: a duplicate reply arriving later could be
  mistaken for the answer to a newer request. It ignores one duplicate reply within a 600 ms window.
- **`setPilot` timeout 2 s** for the same id-less matching reason.
- **Rate floors per device**: at most one `getPilot` per second, one per 30 s for offline devices, and discovery at
  most every 5 s. Waiting callers join the in-flight probe instead of sending another.
- **Offline tracking** (`offline.ts`): a device is marked offline after N consecutive failures and recovers on the
  first success; one dropped packet counts once even if several callers shared it.
- **Discovery**: broadcast `registration` (`register: false`), then send `getSystemConfig` to each responder to
  get `moduleName` (`SHRGB` color, `SHTW` tunable white, `SHDW` dimmable white and others).

Applies to AmbientLight: lessons 5, 8 and 9. `restoreOnExit` depends on one `getPilot` reply, so a single
retransmit makes it noticeably more reliable.

### shikhar13012001/wiz-led-nodejs (Node.js, no license file)

Small audio-to-color demo built on wikari. Its `lib/microTaskQ.js` runs commands through a FIFO queue with a
fixed 300 ms pause after each one.

Applies to AmbientLight: only as a counter-example. A queue plus a fixed delay builds an ever-growing backlog
when input is faster than 3 per second, so the light lags further and further behind. `SyncEngine`'s
newest-frame-wins loop avoids this.

### noturbob/wiz-pc (C++ engine + Next.js UI, no license)

Effects engine with a web dashboard. `engine/src/scheduler.hpp` and `engine/src/color.hpp` hold the useful parts.

- **Per-bulb latest-wins scheduler**: producers overwrite one pending state per bulb as often as they like; a
  tick sends each bulb's latest state only if it's dirty and that bulb's rate budget (default 20 Hz) allows it.
  A slow bulb never builds a backlog.
- **Near-gray → `temp`**: saturation below 0.15 sends `temp 4000` instead of RGB, because WiZ RGB LEDs render pale
  colors tinted or washed out.
- **OKLab crossfades**: blending two far-apart colors in OKLab avoids the muddy gray an RGB lerp passes through.
- **Per-bulb calibration slot**: gamma and per-channel white balance per bulb.
- Off is sent as a bare `{"state":false}`.

Applies to AmbientLight: lesson 5 (add hysteresis, e.g. switch to white below 0.12 and back to color above 0.18,
so a scene near the threshold doesn't flip modes every frame), per-bulb calibration once several bulbs are
supported, and OKLab interpolation if smoothing moves to a perceptual color space.

---

## Ambient-light engines

### awawa-dev/HyperHDR (C++, MIT)

Fork of Hyperion.ng with a native WiZ driver since v22 (`sources/led-drivers/net/DriverNetWiz.cpp`).

- **WiZ driver**: one LED per bulb (`lamps[]` with name, IP and optional MAC), so each bulb can show its own screen
  zone. Sends `setPilot` with `r,g,b` and a fixed user `dimming`. Discovery broadcasts `getPilot` on every
  interface's broadcast address for 2 s and dedupes by IP or MAC. **Identify** sends blue and then the `pulse`
  method (`{"delta":100,"duration":1000}`).
- **Time-based smoothing** (`sources/infinite-color-engine/InfiniteExponentialInterpolator.cpp`): the step is
  `k = 1 − exp(−dt/τ)` with τ = 150 ms, so the feel doesn't depend on the frame rate or capture jitter. Small
  remaining differences use a larger `k` (k^0.6 below 16/255, up to k^1 above 60/255), so colors don't creep
  toward their target for a long time.
- **Spring smoothing in YUV** (`InfiniteHybridInterpolator.cpp`): a damped spring (stiffness 150, damping 26)
  moves the color, and the luminance step per update is capped (0.02), so brightness can't jump even when hue
  changes quickly.
- **Black borders** (`sources/blackborder/`): the detector probes three lines (at 33 %, 66 % and the center) from
  each edge until a non-black pixel. The processor only switches to a new border after it was seen 50 frames in a
  row, ignores up to 10 inconsistent frames, falls back to "unknown" after 600, and adds a 1-pixel margin.

Applies to AmbientLight: lessons 2 and 7, and multi-zone mapping (ROADMAP "Later ideas"). For our frame rates
(5–15 FPS) the frame counts should become times (e.g. switch after ~2 s stable).

Skip: the fixed `dimming` with brightness carried in `r,g,b`, as explained in "What AmbientLight already does right".

### hyperion-project/hyperion.ng (C++, MIT)

The original ambient-light engine.

- **Image-to-LED modes** (`include/hyperion/ImageToLedsMap.h`): mean, mean of squares (closer to linear-light
  averaging), dominant color, and an advanced dominant color using clustering. Dominant color is an alternative to
  lesson 4 when one object should set the light.
- **Smoothing decoupled from capture** (`libsrc/hyperion/LinearColorSmoothing.cpp`): a settling time window
  (150 ms) and a separate output rate (25 Hz) mean the LEDs get interpolated values on a steady clock even if
  capture is slower. `updateDelay` delays output by N frames to match TV latency. A "decay" mode weights frames in
  the window and can dither.
- **Backlight threshold** (`RgbTransform`): a minimum brightness, optionally keeping the color, when the screen is
  dark (the same problem as lesson 3).

Applies to AmbientLight: once `SyncEngine` has a time-based smoother, sending at a steady rate while capture is
slow (screenshot-desktop runs at 5–10 FPS) lets the bulb fade smoothly instead of stepping. A `delayMs` option
could line the light up with a TV's input lag.

### psieg/Lightpack: Prismatik (C++/Qt, GPL-3.0)

Desktop ambilight app for LED strips. Ideas only: no code may be copied. `Software/grab/DDuplGrabber.cpp` is the
Windows Desktop Duplication (DXGI) grabber:

- `AcquireNextFrame` with a short timeout: on timeout it **reuses the last image**; a frame whose
  `LastPresentTime` is 0 means nothing changed, so it is released and skipped.
- **Access lost** (`DXGI_ERROR_ACCESS_LOST`, e.g. UAC secure desktop, resolution change, fullscreen switch) puts the
  grabber into a "reallocate" state instead of failing.
- **Downscale on the GPU**: it copies the frame into a texture with mipmaps, generates them and reads back a small
  mip level, so the CPU only touches a few kilobytes.

Applies to AmbientLight: lesson 10. If capture ever needs a native backend (or Electron's `desktopCapturer`), the
same three rules apply: skip unchanged frames, recover from lost access, and downscale before reading pixels.

### kershner/screenBloom (Python, no license, last commit 2018)

Screen sync for Philips Hue (`app/modules/img_proc.py`).

- **Ignores near-white and near-black pixels** when averaging, so white UI text and black backgrounds don't
  dominate; the share of dark pixels drives brightness.
- **Zones**: rectangles of the screen mapped to groups of bulbs.
- Sets the Hue bulb's own `transitiontime` to the update interval so the bulb fades between updates. WiZ
  `setPilot` has no transition parameter (`speed` only applies to scenes), which is why AmbientLight smooths on
  the PC.

Applies to AmbientLight: supports lesson 4 (exclude or down-weight near-white UI pixels when the desktop, not a
video, is on screen).

### GreenSky-Productions/SignalRGB-WIZ-Network-Plugin (JavaScript, no license)

WiZ device plugin for SignalRGB (`WIZ.js`).

- Discovery broadcasts `registration` and **repeats every 60 s**, so bulbs that join later are found.
- Sends only when the color or brightness changed.
- When the incoming color is black, it sends a user-chosen **dim color at minimum brightness** instead of off.
- Brightness is a fixed user setting; the screen color is sent as raw RGB.

Applies to AmbientLight: lessons 3 and 8 (periodic rediscovery in the Electron app).

---

## Capture and transport building blocks

### nashaofu/node-screenshots (Rust/N-API, MIT)

Native screenshots built on the XCap crate, prebuilt for Windows (x64, x86, arm64), macOS and Linux.
`Monitor.all()` lists displays with id, name, bounds, rotation, scale factor, refresh rate and primary flag;
`monitor.captureImage()` returns an `Image` with `toRaw()` (RGBA), crop, and PNG/JPEG/BMP encoders.

Applies to AmbientLight: lesson 10. A `NodeScreenshotsCapturer` behind `ScreenCapturer` avoids
`screenshot-desktop`'s process-per-frame and JPEG round trip: capture → `toRaw()` → `sharp` resize from raw RGBA
(or our own box downscale). It can replace `listDisplays()` too. Measure it in Phase 3 before switching.

### evanwhitt/hyperion-android-reborn (Java, MIT)

Android and Android TV grabber that streams to Hyperion/HyperHDR (`common/src/main/java/com/hyperion/grabber/`).

- `HyperionScreenEncoder`: `ImageReader` (RGBA_8888) + `VirtualDisplay`; registers the `MediaProjection.Callback`
  **before** `createVirtualDisplay` (required on Android 14+), captures on a background `HandlerThread` with
  `acquireLatestImage()`, and always closes each `Image`.
- Capture size is forced even (`& ~1`); on rotation it calls `VirtualDisplay.resize()` with swapped dimensions.
- Under high load it skips border detection first, then averaging (load shedding).
- `HyperionScreenService` runs as a foreground service of type `mediaProjection`, holds a partial wake lock, and has
  a boot receiver to start with the TV. `util/BorderProcessor.java` uses the same 3-line letterbox probe as Hyperion.

Applies to AmbientLight: lesson 13. Combined with namanb-lab's 96-px-wide virtual display, this is the Phase 4
Kotlin `MediaProjection` module design: tiny GPU-scaled frames, latest-image only, a foreground service, rotation
handling, and averaging in Kotlin or TypeScript.

### tradle/react-native-udp (Java/Obj-C, MIT)

Node `dgram`-style UDP for React Native (v4.1.7, last commit January 2023).

- Uses the legacy `NativeModules` bridge and sends every datagram as a base64 string. That is fine for ~10
  packets per second, and New Architecture apps can still load it through the interop layer.
- Supports `setBroadcast`; it acquires a Wi-Fi `MulticastLock` only for multicast membership. Discovery replies
  are unicast, so that's enough for us.
- Depends on the `buffer` package for `Buffer`.

Applies to AmbientLight: the Android `UdpSocket` adapter can wrap it directly. If it breaks on a future React
Native version, `react-native-jsi-udp` has a similar API.
