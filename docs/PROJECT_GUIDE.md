# WiZ PC Screen-Sync Ambilight: Project Guide

Copied from the Google Drive doc *WiZ PC Screen-Sync Ambilight Project Guide* (last edited 2026-11-18),
so the original spec lives with the code. What's actually built is in `ROADMAP.md` and `ARCHITECTURE.md`.

## 1. Overview and architecture

A background loop runs at 5–15 frames per second (the WiZ bulb's processing limit):

- **Capture:** the PC app captures the active display (native OS or library screenshot tools).
- **Process:** the frame is downscaled and its average RGB color is calculated.
- **Transmit:** the app sends a JSON payload over **UDP port 38899** directly to the bulb's local IP.
- **Display:** the bulb changes color right away, with no cloud servers involved.

## 2. Hardware and network setup

- **Philips WiZ smart bulb**, set up on the local Wi-Fi with the official WiZ app.
- **Static IP / DHCP reservation** for the bulb (recommended) so the app always targets the right address.
- **Same subnet:** the PC and the bulb must be on the same local network.

## 3. WiZ local UDP protocol

- Port: `38899`, transport: UDP
- Sample payload:

```json
{ "method": "setPilot", "params": { "r": 255, "g": 0, "b": 0, "dimming": 100 } }
```

## 4. Tech stack: TypeScript on PC and Android

- **Shared core (pure TypeScript):** WiZ UDP command formatting (`setPilot`, `getPilot` discovery), downscaling
  and average color, brightness/gamma calibration, and frame-rate throttling (5–15 FPS).
- **PC (Node.js, then Electron):** `node:dgram` for UDP; `screenshot-desktop` for the CLI prototype, then
  Electron's `desktopCapturer` for the desktop GUI.
- **Android (React Native + Kotlin native module):** reuses the shared core and UI, `react-native-udp` for UDP,
  and a Kotlin `MediaProjection` foreground service that streams downscaled RGB values to TypeScript.

## 5. Roadmap

1. **Proof of concept:** TypeScript Node.js project; capture one frame with `screenshot-desktop`, average it,
   and send one `setPilot` packet with `dgram`.
2. **Continuous sync and throttling:** non-blocking loop (100–200 ms interval) with smoothing and a
   minimum-change threshold so the bulb isn't overwhelmed.
3. **Testing and calibration:** full-screen YouTube Ambilight test videos to tune color accuracy, minimum
   dimming, and latency.
4. **Desktop app and Android port:** Electron app with automatic discovery and a settings UI; React Native port
   with a Kotlin `MediaProjection` service.

## 6. Open-source references

Screen-sync implementations:

- [one-adnan/ambient-setup](https://github.com/one-adnan/ambient-setup) (Python, cross-platform): HSV saturation
  boost, gamma, green/yellow hue compensation, EMA smoothing, gaming/movie/ambient presets.
- [namanb-lab/wiz-sync](https://github.com/namanb-lab) (Android and Android TV): reference for Phase 4
  `MediaProjection` capture and per-bulb control.
- [MihirGupta07/wiz-sync](https://github.com/MihirGupta07/wiz-sync) (Windows): video and WASAPI audio sync over
  UDP 38899 with smoothing and latency controls.

TypeScript / Node.js WiZ libraries:

- [uditkarode/wikari](https://github.com/uditkarode/wikari): typed library with discovery, `getPilot`/`setPilot`,
  and state subscriptions.
- [noturbob/wiz-pc](https://github.com/noturbob/wiz-pc): "latest-wins" UDP scheduler and routing of
  low-saturation colors to the warm/cool white channels.
- [shikhar13012001/wiz-led-nodejs](https://github.com/shikhar13012001/wiz-led-nodejs): LAN discovery and
  real-time UDP color streaming.

Broader ecosystems:

- [GreenSky-Productions/SignalRGB-WIZ-Network-Plugin](https://github.com/GreenSky-Productions/SignalRGB-WIZ-Network-Plugin):
  WiZ in SignalRGB (needs "Allow Local Communication" in the WiZ app).
- [hyperion-project/hyperion.ng](https://github.com/hyperion-project/hyperion.ng): multi-zone edge mapping, smoothing,
  black-bar detection.
