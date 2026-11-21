# Notes for AI coding assistants

AmbientLight syncs Philips WiZ bulbs to the PC/Android screen color. It's a TypeScript monorepo using npm workspaces.

- Overview and setup: `README.md`. Design: `docs/ARCHITECTURE.md`. Protocol: `docs/WIZ_PROTOCOL.md`.
  Plan: `docs/ROADMAP.md`. Conventions and scripts: `docs/DEVELOPMENT.md`.
- `packages/core` is platform-agnostic and shared with the future React Native app. Never import `node:*`
  there or use Node/DOM globals (`"types": []` enforces this). Put platform code in `apps/*` behind
  `UdpSocket` / `ScreenCapturer` / `ColorSink`.
- ESM with NodeNext: relative imports need the `.js` suffix. Use `import type` for types.
- Verify changes with `npm run check` (build, type-check tests, run tests). Tests use `node:test` and fakes
  from `packages/core/test/helpers.ts`; they need no bulb or network.
- The 16 open-source references are cloned (read-only, outside git) in
  `C:\AI_Sandbox\Project\AmbientLight-references\<owner>__<repo>`. `docs/REFERENCE_NOTES.md` summarizes what each one
  teaches and where to look in it; read that first. Never copy code from the GPL-3.0 or unlicensed ones (see
  `docs/PROJECT_GUIDE.md` section 6); describe and reimplement ideas instead.
- Keep the docs in `docs/*.md` up to date when behavior, config keys, or the roadmap change (the project's
  code documentation lives in these Markdown files).
