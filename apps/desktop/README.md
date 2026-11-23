# apps/desktop (Phase 4, Windows)

The Electron desktop app for AmbientLight. It wraps `@ambientlight/core` and `@ambientlight/node`:

- Screen capture with the same GDI helper as the CLI (decision 15 in
  [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)), in the main process behind the core's `ScreenCapturer`
- UDP, discovery, Blink and the sync loop (`SyncSession`) in the main process; the React renderer only draws

```powershell
npm run desktop      # from the repository root
```

What works so far and how to use it: [README.md](../../README.md#desktop-app-windows). Screens and what backs each
control: [docs/UI_DESIGN.md](../../docs/UI_DESIGN.md). Process model and files:
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#appsdesktop-ambientlightdesktop-windows). Development (mock API,
running it on Linux for tests): [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md#the-desktop-app). Milestones:
[docs/ROADMAP.md](../../docs/ROADMAP.md#phase-4-desktop-app-electron-and-android-port-react-native-).
