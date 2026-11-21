# Roadmap

Based on the *WiZ PC Screen-Sync Ambilight Project Guide* (Google Drive).

## Phase 1: Node.js + TypeScript proof of concept ✅

- [x] TypeScript Node.js project (`tsc` build, `tsx` for running from source)
- [x] Capture a frame with `screenshot-desktop` (`apps/pc-cli/src/capture.ts`)
- [x] Downscale (sharp, 64×36) and compute the average RGB color (`averageColor`)
- [x] Send a `setPilot` UDP packet with `node:dgram` → `npm run once`
- [x] Connectivity test command → `npm run color -- --rgb 255,0,0`
- [x] Bulb discovery (`getPilot` broadcast) → `npm run discover`

## Phase 2: continuous sync loop and throttling ✅

- [x] Non-blocking timed loop, 5–15 FPS (`SyncEngine`, default 10 FPS)
- [x] Color smoothing (EMA) and minimum-change threshold
- [x] Keep-alive re-send for lost UDP packets
- [x] No stale-frame backlog (one frame at a time; the newest frame wins)
- [x] Restore the bulb's previous state on Ctrl+C
- [x] Multiple bulbs (same color)

## Phase 3: testing and calibration ⏳

- [ ] Run full-screen YouTube Ambilight test videos and tune `saturationBoost`, `gamma`, `brightnessGamma`, `minDimming`
- [ ] Measure end-to-end latency (screen change → bulb) and real FPS on Windows
- [ ] Decide whether `screenshot-desktop` is fast enough (spawns a process per frame, ~50–200 ms on Windows).
      If not, try a faster backend behind `ScreenCapturer` (e.g. `node-screenshots`, which captures in-process
      and returns raw RGBA, or move to Electron early)
- [ ] Black-bar (letterbox) detection so movie bars don't darken the light: 3-line probe from each edge, switch
      only after the border is stable for ~2 s (HyperHDR, hyperion.ng)
- [ ] Hue-specific compensation (WiZ greens and yellows tend to look off): extra saturation for green/yellow
      hues, per-channel gains scaled by saturation so grays stay neutral (ambient-setup, namanb-lab)
- [x] Route low-saturation colors to the white LEDs (`temp`) for cleaner whites, with hysteresis so a scene near
      the threshold doesn't flip modes (wiz-pc, namanb-lab) → `whiteSaturation`, `whiteTemp`
- [x] Send pale colors as the pure hue plus the white LEDs, like the WiZ app; an RGB-only pale mix looks pink
      → `paleWhite`, `npm run state`
- [x] Measure the app's `r,g,b,c,w` for 11 colors with `npm run state` and fit the encoder to them (hue level,
      white level, hue-tinted cold/warm split)
- [ ] Measure the app between saturation 0.5 and 0.75 (e.g. #ff7070, #ff6060) and replace the ramp if it differs
- [ ] Presets: gaming (fast), movie (smooth), ambient (very smooth, dimmer)

Lessons from the reference study ([REFERENCE_NOTES.md](REFERENCE_NOTES.md)):

- [x] Detect bulbs that require signed `setPilot` (`hmac` in replies, `-32602` reply) and tell the user →
      `npm run check-bulb`
- [ ] Support an optional `signingKey` through an injected HMAC-SHA256 function, since the core can't import
      `node:crypto` (pywizlight)
- [ ] Time-based smoothing (`1 − e^(−dt/τ)`) so the feel doesn't change with FPS, plus an instant snap on scene
      cuts (HyperHDR, MihirGupta07/wiz-sync). This also fixes a known issue of `colorMode: "dominant"`: when the
      dominant hue family changes (e.g. red → green), the RGB smoothing fades through a muddy in-between color
      (brownish yellow) for a few frames. Snap when the hue family changes, or blend in OKLab (wiz-pc)
- [ ] Dark scenes: below `blackThreshold`, fade to a configurable warm glow or hold the last hue instead of
      showing a noisy hue (ambient-setup, SignalRGB plugin)
- [x] Take the hue from vivid pixels and the brightness from the plain luminance mean (ambient-setup,
      namanb-lab) → `colorWeighting`
- [x] Dominant color instead of a mix of hues: vote colorful pixels into hue bins, average only the strongest
      hue family, keep the previous one on near ties (hyperion.ng's dominant-color mode) → `colorMode`
- [ ] Discovery: also broadcast `registration`; save bulbs by MAC and re-resolve their IP at startup; read
      `getSystemConfig` to tell color bulbs from white-only ones
- [x] Requests (`getPilot` and others) retransmit once after 400 ms (homebridge-wiz-lan)
- [ ] Clamp dimming to `getModelConfig.minDimLevel` (`check-bulb` already reports it) (pywizlight)
- [ ] `identify` command that flashes one bulb (ambient-setup, HyperHDR)

## Phase 4: desktop app (Electron) and Android port (React Native) 🗓️

**Electron (`apps/desktop`)**

- [ ] Capture with `desktopCapturer`, using the same `ScreenCapturer` interface
- [ ] Automatic bulb discovery (`getPilot` broadcast) and a settings UI that writes the same config
- [ ] Tray icon, start with Windows, per-display selection, live color preview

**Android (`apps/android`)**

- [ ] React Native app reusing `@ambientlight/core` and shared UI
- [ ] UDP through `react-native-udp` (implements the core's `UdpSocket`)
- [ ] Kotlin native module: `MediaProjection` in a foreground service, downscaled RGB streamed to TypeScript.
      Render the `VirtualDisplay` ~96 px wide so the GPU downscales, use `ImageReader` with 2 images and
      `acquireLatestImage()`, respect `rowStride`, register the projection callback before
      `createVirtualDisplay` (Android 14+), and resize on rotation (namanb-lab, hyperion-android-reborn)
- [ ] Android TV support (see namanb-lab/wiz-sync); DRM apps capture as black, which can't be worked around

**Electron, from the reference study**

- [ ] Re-run discovery periodically (e.g. every 60 s) so bulbs that join later appear (SignalRGB plugin)

## Later ideas

- Multi-zone: several bulbs mapped to screen regions (left/right/top), like Hyperion edge mapping
  (HyperHDR's WiZ driver maps one zone per bulb)
- Audio-reactive mode (WASAPI loopback, see MihirGupta07/wiz-sync)
- Push updates: `registration` with `register: true` and a listener on UDP 38900, so the Electron UI shows changes
  made in the WiZ app (pywizlight, wikari)
- Send at a steady rate between captures with the time-based smoother, and an optional `delayMs` to match TV
  input lag (hyperion.ng)
- Per-bulb calibration (gamma and white balance) once several bulbs are supported (wiz-pc)

## Backlog: Bardi / Tuya Wi-Fi bulbs (side project)

For after Phase 4; no code yet. Bardi bulbs are rebranded Tuya devices. Both routes below add a new `ColorSink`
next to `WizLight`, so `SyncEngine` and `calibrate` don't change.

**Route A: stock firmware, Tuya local protocol (no jailbreak)**

- [ ] Get the device id and local key. The Tuya IoT platform can't link the Bardi app, so re-pair the bulb in the
      Smart Life app, link that account to a Tuya IoT cloud project, and run `tinytuya wizard`. Re-pairing changes
      the key.
- [ ] `TuyaLight` in `packages/core/src/tuya/`: TCP port 6668. Protocol 3.1/3.3 uses AES-128-ECB + CRC32, 3.4 adds
      session-key negotiation + HMAC-SHA256, and 3.5 uses AES-GCM with `0x6699` frames. Send a heartbeat about
      every 10 s, reconnect when the connection drops, and send only the newest color while a write is in flight.
      TCP and crypto must be injected interfaces like `UdpSocket` (the core can't import `node:net`/`node:crypto`).
      This shares the injected-crypto work with the WiZ `signingKey` item.
- [ ] Map `WizColor` to data points (DPs). Newer ("v2") lights use 20 on/off, 21 mode (`white`/`colour`),
      22 brightness 10–1000, 23 white temperature 0–1000, and 24 color `HHHHSSSSVVVV` (hue 0–360, saturation and
      value 0–1000). For sync, try 28 `control_data` or 27 `music_data`: the bulb doesn't save these and changes
      color instantly. Older ("v1") lights use DPs 1–5. Read the bulb's DP list first, because it varies.
- [ ] Restore on exit: read the DPs (`DP_QUERY`) before syncing and write them back afterwards.
- [ ] Config: a `bulbs` entry can also be an object, e.g.
      `{ "type": "tuya", "host", "id", "key", "version" }`. Plain IP strings stay WiZ.
- Expect about 5–10 updates per second. A bulb may accept only one local connection, so close the app while
  syncing.
- Protocol references (MIT; clone them into `AmbientLight-references` when work starts):
  `jasonacox/tinytuya` (3.1–3.5) and `codetheweb/tuyapi` (Node.js; 3.5 since 7.7.0).

**Route B: jailbreak to OpenBeken, then DDP**

- [ ] Identify the chip from the module label (e.g. Tuya WB2L = BK7231T, CB2L/CBLC = BK7231N) or a teardown on
      elektroda.com. OpenBeken supports those and several other Tuya chips.
- [ ] Flash over the air with tuya-cloudcutter if the bulb's firmware isn't patched (Tuya patched its SDK in 2022;
      check the project's patched-firmware list). Otherwise open the bulb and flash it over serial, never while
      it's on mains power. The warranty, the cloud and the app are lost, and a bad flash can brick the bulb.
- [ ] Start OpenBeken's DDP driver from the startup command (`startDriver DDP`), because it resets on reboot.
- [ ] `DdpLight` in the core: DDP over UDP 4048, a 10-byte header followed by RGB bytes. DDP has no brightness
      field, so scale `r,g,b` by `dimming`. White mode sends an RGBW payload (OpenBeken 1.17.795 or later drives
      the white channel) or a warm RGB. Needs binary `UdpSocket.send`, which only sends strings today.
- [ ] Restore on exit: the light keeps the last DDP color, so restore it with OpenBeken's Tasmota-style HTTP
      commands (`/cm?cmnd=...`).
- Bonus: the same sink also drives WLED strips.
