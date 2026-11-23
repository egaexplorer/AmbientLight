# apps/desktop (Phase 4, planned)

An Electron desktop app for Windows wrapping `@ambientlight/core`:

- Screen capture with the same GDI helper as the CLI (decision 15 in
  [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)), in the main process behind the core's `ScreenCapturer`
- UDP from the main process with `node:dgram`, reusing the CLI's adapter
- Bulb discovery, Blink, film looks, live color preview, tuning, a tray icon and start with Windows

Screens and what backs each control: [docs/UI_DESIGN.md](../../docs/UI_DESIGN.md). Milestones:
[docs/ROADMAP.md](../../docs/ROADMAP.md#phase-4-desktop-app-electron-and-android-port-react-native-).
When you scaffold this app, add `apps/desktop` to the root `package.json` workspaces and `tsconfig.json` references.
