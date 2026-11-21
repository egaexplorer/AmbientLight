# apps/desktop (Phase 4, planned)

An Electron desktop app wrapping `@ambientlight/core`:

- Screen capture with Electron's `desktopCapturer`, implementing the core's `ScreenCapturer`
- UDP from the main process with `node:dgram` (reuse `apps/pc-cli/src/udp.ts`)
- Automatic bulb discovery (`discoverBulbs`), a settings UI, tray icon, and start with Windows

See [docs/ROADMAP.md](../../docs/ROADMAP.md) and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#adding-a-platform-phase-4).
When you scaffold this app, add `apps/desktop` to the root `package.json` workspaces and `tsconfig.json` references.
