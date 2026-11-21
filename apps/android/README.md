# apps/android (Phase 4, planned)

A React Native app that reuses `@ambientlight/core` unchanged:

- UDP through `react-native-udp`, wrapped as the core's `UdpSocket`
- Screen capture through a small Kotlin native module: `MediaProjection` → `ImageReader` inside a
  foreground service, downscaled to about 64×36 and streamed to TypeScript as a `PixelFrame`
  (or a pre-averaged color)
- The same `SyncEngine` loop, calibration, and smoothing as the PC app

Reference: namanb-lab/wiz-sync (Android and Android TV screen sync for WiZ).
See [docs/ROADMAP.md](../../docs/ROADMAP.md).
