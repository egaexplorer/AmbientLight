# WiZ PC Screen-Sync Ambilight: Project Guide

Copied from the Google Drive doc *WiZ PC Screen-Sync Ambilight Project Guide* (last edited 2026-11-21),
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

Licenses were checked on GitHub on 21 November 2026. Code under MIT or Apache-2.0 can be reused if its copyright
and license notice is kept (Apache-2.0 also requires keeping any NOTICE file and marking changed files). GPL-3.0
code must not be copied into this project unless the whole project is released under GPL-3.0. Repositories with no
license are all rights reserved, so use them only as design references and write the code independently.

Screen-sync implementations:

- [one-adnan/ambient-setup](https://github.com/one-adnan/ambient-setup) (Python, cross-platform): HSV saturation
  boost, gamma, green/yellow hue compensation, EMA smoothing, gaming/movie/ambient presets.
  License: none (all rights reserved).
- [namanb-lab/wiz-sync](https://github.com/namanb-lab/wiz-sync) (Android and Android TV): reference for Phase 4
  `MediaProjection` capture and per-bulb control.
  License: none (all rights reserved).
- [MihirGupta07/wiz-sync](https://github.com/MihirGupta07/wiz-sync) (Windows): video and WASAPI audio sync over
  UDP 38899 with smoothing and latency controls.
  License: none (all rights reserved).
- [awawa-dev/HyperHDR](https://github.com/awawa-dev/HyperHDR) (C++, Windows/macOS/Linux): Hyperion.ng fork whose
  version 22 added a Philips WiZ driver and setup wizard (PR #1469, merged March 2026). The most complete existing
  WiZ screen sync to compare against; also a reference for its floating-point color pipeline and inertia smoothing.
  License: MIT.

TypeScript / Node.js WiZ libraries:

- [uditkarode/wikari](https://github.com/uditkarode/wikari): typed library with discovery, `getPilot`/`setPilot`,
  and state subscriptions.
  License: GPL-3.0.
- [noturbob/wiz-pc](https://github.com/noturbob/wiz-pc): "latest-wins" UDP scheduler and routing of
  low-saturation colors to the warm/cool white channels.
  License: none (all rights reserved).
- [shikhar13012001/wiz-led-nodejs](https://github.com/shikhar13012001/wiz-led-nodejs): LAN discovery and
  real-time UDP color streaming.
  License: none (`package.json` says ISC, but there is no LICENSE file).
- [sbidy/pywizlight](https://github.com/sbidy/pywizlight) (Python): the library behind Home Assistant's WiZ
  integration; broadcast discovery, re-sending a command until the bulb replies, built-in scene IDs.
  License: MIT.
- [kpsuperplane/homebridge-wiz-lan](https://github.com/kpsuperplane/homebridge-wiz-lan) (TypeScript): Homebridge
  plugin; broadcast discovery and push updates, where the bulb reports state changes to a listener on UDP `38900`.
  License: Apache-2.0.

Broader ecosystems:

- [GreenSky-Productions/SignalRGB-WIZ-Network-Plugin](https://github.com/GreenSky-Productions/SignalRGB-WIZ-Network-Plugin):
  WiZ in SignalRGB (needs "Allow Local Communication" in the WiZ app).
  License: none (all rights reserved).
- [hyperion-project/hyperion.ng](https://github.com/hyperion-project/hyperion.ng): multi-zone edge mapping, smoothing,
  black-bar detection.
  License: MIT.
- [psieg/Lightpack](https://github.com/psieg/Lightpack) (Prismatik): PC ambilight app for LED strips with a screen
  grabber per platform, including a Windows Desktop Duplication (DXGI) grabber.
  License: GPL-3.0.
- [kershner/screenBloom](https://github.com/kershner/screenBloom) (Python): screen sync for Philips Hue bulbs.
  Inactive since 2022.
  License: none (all rights reserved).

Screen capture and UDP building blocks (Phases 3–4):

- [nashaofu/node-screenshots](https://github.com/nashaofu/node-screenshots): native screenshots (Rust XCap) for
  Windows, macOS and Linux; candidate replacement for `screenshot-desktop`, which spawns a process per frame.
  License: MIT.
- [evanwhitt/hyperion-android-reborn](https://github.com/evanwhitt/hyperion-android-reborn): Android and Android TV
  `MediaProjection` grabber for Hyperion/HyperHDR, one APK for TV and phone.
  License: MIT.
- [tradle/react-native-udp](https://github.com/tradle/react-native-udp): Node's `dgram` API for React Native.
  Last updated March 2023; `react-native-jsi-udp` is a JSI-based alternative.
  License: MIT.
