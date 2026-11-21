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
      If not, try a faster backend behind `ScreenCapturer` (e.g. `node-screenshots`, or move to Electron early)
- [ ] Black-bar (letterbox) detection so movie bars don't darken the light
- [ ] Hue-specific compensation (WiZ greens and yellows tend to look off)
- [ ] Route low-saturation colors to the white channels (`c`/`w` or `temp`) for cleaner whites
- [ ] Presets: gaming (fast), movie (smooth), ambient (very smooth, dimmer)

## Phase 4: desktop app (Electron) and Android port (React Native) 🗓️

**Electron (`apps/desktop`)**

- [ ] Capture with `desktopCapturer`, using the same `ScreenCapturer` interface
- [ ] Automatic bulb discovery (`getPilot` broadcast) and a settings UI that writes the same config
- [ ] Tray icon, start with Windows, per-display selection, live color preview

**Android (`apps/android`)**

- [ ] React Native app reusing `@ambientlight/core` and shared UI
- [ ] UDP through `react-native-udp` (implements the core's `UdpSocket`)
- [ ] Kotlin native module: `MediaProjection` in a foreground service, downscaled RGB streamed to TypeScript
- [ ] Android TV support (see namanb-lab/wiz-sync)

## Later ideas

- Multi-zone: several bulbs mapped to screen regions (left/right/top), like Hyperion edge mapping
- Audio-reactive mode (WASAPI loopback, see MihirGupta07/wiz-sync)
